# PDF statement → transactions

> Status: **built & tested** (Phase 1 + graceful scanned fallback). Turning a
> bank-statement *PDF* into line-item transactions, so accounts that only give PDFs
> (no CSV) still work. Reuses the existing import spine - the PDF path produces the
> same `RawTxn`s and flows through the same dedup/fingerprint/integrity pipeline as
> CSV. Validated read-only on a real Capitec statement (96 txns, closing balance
> matched) and end-to-end on a synthetic fixture + real Nedbank statements in the
> emulator. **Pending (Phase 2):** an interactive PDF column-confirm UI + learned
> per-issuer PDF profiles for the uncertain-layout case (today such layouts fall
> back to "recorded").

## Why this is needed (and why it's not trivial)

Today `_process_pdf` (in `functions/main.py`) classifies a PDF, and for a
**statement** it just records the document - **no transactions are created**
(`"Statement recorded. Line-item PDF parsing not yet supported; upload a CSV/Excel."`).
Not every bank gives a CSV, so this is a real gap.

The hard part is **table reconstruction**. `pdf.py` uses pypdf's default
`extract_text()`, which returns text in PDF draw order and **scrambles columns** -
on a real Capitec statement the debit-order section comes out as a column of bare
`"Capitec"` strings with the amounts detached elsewhere. A statement's transaction
table is laid out by *horizontal position*, not by reading order, so we must
recover columns from **spatial coordinates**, then map them to roles.

Two extraction modes were tested on a real Capitec statement:

| Mode | Result |
|---|---|
| pypdf `extract_text()` (current) | columns scrambled - **unusable for tables** |
| pypdf `extract_text(extraction_mode="layout")` | columns stay aligned as whitespace-padded text - usable, but fragile when a description contains spaces |
| **pdfplumber (word bounding boxes)** | **recommended** - word-level x/y coordinates let us cluster columns robustly |

## The big win: reuse the entire downstream spine

A PDF statement, once its rows are recovered, becomes a list of `RawTxn`
(`functions/core/model.py`) - exactly what the CSV parsers emit. So it feeds the
**same** path:

```
PDF bytes ─▶ extract words+coords ─▶ reconstruct table ─▶ map columns to roles
         ─▶ RawTxn[] ─▶ ingest.prepare_transactions ─▶ DocumentLedger dedup ─▶ write
```

That means we get, for free: the balance-aware transaction fingerprint, within-doc
dedup, the balance-chain integrity check, account identity by number, and the
canonical Firestore shape. **Nothing about dedup or accounting needs to change** -
we only add a new *front end* that turns a PDF table into `RawTxn`s.

It also slots into the work just shipped:

- **Adaptive parse profiles** extend naturally to PDF. A statement's layout gets a
  *shape fingerprint* (issuer + the table's column headers / x-positions), and the
  learned/confirmed column mapping is remembered per issuer - same idea as the CSV
  parser, same `parseProfiles` collection (with a `kind: "pdf"` discriminator).
- The **column-confirm UI** (Import page) is reused: when the table is recovered
  but the column roles are uncertain, return a `preview` with the detected table
  and let the user confirm/fix, exactly like CSV.
- **Cross-channel dedup matters here.** This is recovery threat **T1**: the same
  statement as a PDF *and* a CSV. If both carry a running balance, the balance-aware
  fingerprint reconciles them automatically. If not, the existing `logical_key`
  `needs_review` gate (same institution/account/period/docType) blocks the second
  one for review. Both already exist - PDF import inherits them.

## Recommended architecture

**Add a coordinate extractor + a table reconstructor; reuse classify + the spine.**

```
NEW dependency:  pdfplumber  (pulls pdfminer.six; pure-Python, deploys on Gen2)

CHANGED  functions/core/pdf.py
  + extract_words(data, password) -> pages of [{text, x0, x1, top, bottom}]
    (keep extract_text() for classify; add word-level extraction for tables)

NEW      functions/core/pdftable.py   (pure, unit-testable)
  - reconstruct_rows(words) -> list[Row]   cluster words into lines (by `top`),
        then into columns (cluster x-centers), so each row is a list of cell
        strings positioned like the CSV row arrays the generic parser already eats.
  - find_header / map_columns: reuse the role hints + Detection from
        parsers/generic.py - a reconstructed table is just rows[][], so the SAME
        column-mapping + shape-fingerprint logic applies.
  - stitch_multiline: merge wrapped description lines (a continuation line has no
        date and no amount) into the transaction above it.

CHANGED  functions/main.py  _process_pdf (statement branch)
  - if classify says bank_statement:
        words = pdf.extract_words(...)
        rows  = pdftable.reconstruct_rows(words)
        detection = GenericCsvParser().detect_rows(rows)   # rows-based detect()
        profile lookup/reuse/preview  (same as import_csv)
        raw_txns -> prepare_transactions -> ledger dedup -> write
  - if the table can't be recovered confidently -> fall back to today's "recorded"
        + surface for manual review (never import garbage).
```

`GenericCsvParser` already separates *detect mapping* from *parse rows*; the only
refactor is to let it accept a pre-tokenized `rows[][]` (from a PDF) as well as raw
CSV text - a small extraction of the existing `_locate_header` / `_infer_positional`
/ `_row_to_txn` to operate on a row matrix. The CSV path keeps working unchanged.

## Column reconstruction (the core algorithm)

1. **Words → lines.** Group words whose vertical position (`top`) is within a small
   tolerance into one visual line. Sort lines top-to-bottom, words left-to-right.
2. **Lines → columns.** Collect the x-centers of numeric/amount-like words across
   the table body; cluster them into column bands (k-means-lite / gap detection).
   Assign every word to its band ⇒ each line becomes `[cell, cell, …]`.
3. **Map roles.** Run the existing role detection over the header row (Capitec:
   *Posting Date / Transaction Date / Description / Money In / Money Out / Balance*),
   or infer positionally when there's no header - identical to the CSV engine.
4. **Stitch multi-line descriptions.** A line with no parseable date and no amount
   is a wrapped description; append it to the previous transaction's description.
5. **Drop non-data lines.** Summary/header/footer/marketing lines have no
   date+amount and fall away (the CSV `_row_to_txn` already returns `None` for these).
6. **Integrity.** Run `ingest._check_balance_chain` on the recovered rows; a broken
   chain flags the document for review instead of importing skewed numbers.

## Edge cases to handle explicitly

- **Encrypted PDFs** - already handled (`pdf.extract_text` reports `needs_password`;
  the saved statement password auto-unlocks). Word extraction uses the same decrypt.
- **Multi-page tables** - concatenate rows across pages; the header repeats or
  doesn't; key off date-led rows, not header position.
- **Multi-line descriptions / wrapped text** - the stitch step (above).
- **No running balance** - falls to the `s:` (sequence) fingerprint scheme, same as
  CSV; dedup still safe.
- **Cr/Dr and split Money-In/Money-Out columns** - `make_txn` already handles
  debit/credit columns and `Cr`/`Dr` suffixes (`parsers/base.py`).
- **Amounts with thousands spaces** (`R8 720.92`) - `parse_amount` already handles
  SA grouping.
- **Summary tables that look like data** (Money In/Out summaries, fee tables) -
  excluded because they lack a transaction date; only the dated table body parses.
- **Image-only / scanned PDFs** - out of scope for v1 (would need OCR); detect "no
  extractable words" and fall back to "recorded - please upload a CSV".
- **Foreign-currency / non-statement PDFs** - `classify` already routes invoices to
  bills and flags foreign currency; unchanged.

## Confidence, preview & never-import-garbage

Mirror the CSV flow: if column detection is confident and the balance chain
verifies, import and learn the layout. If uncertain (no header, low confidence,
chain break), return `status: "preview"` with the **reconstructed table + a few
sample parsed rows** so the user confirms/fixes the column roles before any write -
reusing the existing column-confirm UI. If the table can't be recovered at all,
keep today's safe behaviour (record the document, ask for a CSV).

## Testing

- **Offline** (`_pdftable_test.py`): feed a synthetic word-list (fake coordinates)
  into `reconstruct_rows` and assert correct rows/columns, multi-line stitching, and
  summary-line rejection. Pure, no PDF needed.
- **Fixture PDFs**: generate a couple of **synthetic** statement PDFs (fake data) in
  a known layout (e.g. via reportlab in a dev script) and assert end-to-end row
  recovery - no real statements in the repo, ever.
- **Emulator e2e** (`_emulator_pdf_e2e.py`): import a synthetic statement PDF, assert
  the right transactions land, the balance chain verifies, and a re-import (and a CSV
  of the same period) reconcile via dedup - i.e. PDF inherits the duplicate-safe spine.

## Dependency note

`pdfplumber` (+ `pdfminer.six`, `Pillow`) deploys fine on Cloud Functions Gen2
Python; it adds a little cold-start weight. If we want zero new dependencies for an
MVP, pypdf's `extraction_mode="layout"` + a whitespace column splitter can ship
first, with pdfplumber as the robust follow-up - but coordinate clustering is the
reliable long-term answer, so prefer it unless cold-start is a real concern.

## Phased plan

- **Phase 1 (MVP) - ✅ done.** pdfplumber word extraction (`pdf.extract_words`) +
  `pdftable.reconstruct_rows` (per-page column streets, main-ledger isolation) +
  `pdftable.infer_roles`/`extract_statement_txns` (balance = always-present column,
  amount = signed sum of the rest, so Money In/Out/**Fee** all map) + wired into
  `_process_pdf` → `prepare_transactions` → dedup spine. Multi-page handled.
  Offline `_pdftable_test.py` + synthetic fixture + `_emulator_pdf_e2e.py`.
- **Phase 3 (graceful, no OCR) - ✅ done.** Image-only/scanned statements (no
  extractable text layer) are detected and returned as a clear "upload a CSV / text
  PDF" message rather than importing garbage. (Real OCR intentionally skipped -
  awkward on Functions, small cost; revisit with Cloud Vision if needed.)
- **Phase 2 - ✅ done.** Learned **per-issuer PDF profiles** + an interactive
  column-confirm UI for PDFs (reusing the CSV `preview` flow) so uncertain layouts
  are confirmed/fixed once and remembered, instead of falling back to "recorded".
- **Remaining polish (not built):** multi-line description stitching (when a
  description wraps onto a second line the transaction is still captured, but the
  wrapped text is truncated); an OCR option for scanned PDFs.

## Files this will touch

- `functions/core/pdf.py` - add word-coordinate extraction (keep `extract_text`).
- `functions/core/pdftable.py` - **new**, table reconstruction (pure).
- `functions/core/parsers/generic.py` - let `detect`/parse operate on a rows matrix
  (small refactor; CSV path unchanged).
- `functions/main.py` - `_process_pdf` statement branch → real import via the spine.
- `functions/core/profilestore.py` / `profiles.py` - optional `kind:"pdf"` profiles.
- `web/src/pages/Import.tsx` - reuse the column-confirm UI for PDF previews.
- `functions/requirements.txt` - add `pdfplumber`.
- Tests: `_pdftable_test.py`, `_emulator_pdf_e2e.py`, a synthetic fixture generator.
