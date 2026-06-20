# MzansiMoney - architecture & project rules

Self-hostable personal finance app. This file is the quick context for anyone (human
or AI) working on the code. Per-area detail lives in `docs/`.

## Stack (locked decisions, do not relitigate)
- **Frontend:** React + Vite + TypeScript + Tailwind v4, desktop-web first (`web/`).
- **Backend:** Firebase Cloud Functions in Python (Gen2) (`functions/`). No always-on
  server, no Docker, no microservices.
- **Data / Auth / Hosting:** Firebase (Firestore, Google sign-in, Hosting, Storage).
- **The import pipeline is the heart of the app.** Every data source becomes a parser
  that emits the common `RawTxn`, which `model.normalize` turns into the one canonical
  Firestore transaction. The dashboard never knows the source.
- **Single source of truth = the canonical transaction** (`functions/core/model.py`);
  `web/src/types.ts` mirrors it.

## Accuracy / no-duplicates is the prime directive
Two-layer dedup plus an integrity check, and we NEVER silently merge:
- **Layer 1 - document ledger** (`users/{uid}/documents`, doc id = `sha256(bytes)`):
  before importing, `documents.DocumentLedger.check` tests strongest-first: exact-bytes
  hash, Gmail messageId, biller doc number, logical key `(institution, account, period,
  docType)`. A match is a `duplicate` (skip) or, for same-logical-different-bytes,
  `needs_review` (block, surface to the user; `force:true` overrides).
- **Layer 2 - transaction fingerprint** (`identity.transaction_fingerprint` = the
  Firestore doc id): balance-aware. With a running balance,
  `hash(account|date|signedAmount|balanceAfter)` is unique within a doc (two identical
  R50 coffees both survive) yet identical across overlapping statements (they reconcile
  via idempotent writes). No balance falls back to `hash(... | normDesc | dayIndex)`.
  **Never key on date+amount+desc alone - it collapses legitimate duplicates.**
- **Integrity check** (`ingest._check_balance_chain`): verifies `balance[i] ==
  balance[i-1] + signedAmount[i]`; a failure flags the doc rather than importing garbage.

Statements (cash ledgers) route to transactions; invoices/pro-formas route to
**bills/payables** (`classify.py`), never counted as separate spending.

## Data model (Firestore, all under `users/{uid}/`)
```
transactions/{fingerprint}   canonical txn (accountType cash|home_loan)
documents/{sha256}           ingestion ledger / dedup index + audit
bills/{billFingerprint}      payables from invoices
categoryRules/{merchantKey}  learned merchant->category overrides
parseProfiles/{shapeFp}      learned per-bank column mapping (backend-owned)
holdings/{id}, goals/{id}    client-owned net-worth + savings
recoveryLog/{id}             recovery action audit (backend-owned)
snapshots/{id}               ledger backup manifests (blob in Storage)
settings/{security|homeLoan|watchlist|recurring|ui|branding}   client-owned prefs
secure/statementPassword     AES-GCM encrypted (backend-only; rules deny client)
```
Account identity is the **account number** (`accountId = <institution>-<number>`), so a
re-import under a different label can't fork a phantom account. `accountType` splits cash
from the home-loan liability. **Privacy:** clients are read-only on the financial
collections; only the backend (Admin SDK) writes them. Rules in `firestore.rules`.

Callables: `import_csv`, `import_document`, `add_transaction`, `set_category`,
`delete_transaction`, `set_statement_password`, and recovery (`revert_import`,
`export_ledger`, `audit_integrity`). HTTP `ingest_email` (Gmail Apps Script intake).

## Backend layout (`functions/core/`)
- `model.py` - `RawTxn`, `normalize`, merchant derivation.
- `identity.py` - content hash + balance-aware fingerprint + account id. The dedup math.
- `ingest.py` - pure prep: fingerprints, within-doc dedup, balance-chain integrity.
- `documents.py` - `DocumentLedger` (Layer-1 dedup).
- `classify.py` - PDF doc-type + issuer/header extraction; invoice->bill, statement->txns.
- `pdf.py` - pypdf text extraction + encryption detection + `extract_words` (pdfplumber).
- `pdftable.py` - reconstruct a statement's transaction table from word coordinates.
- `categorize.py` - keyword->category rules.
- `parsers/` - `base.py`, `generic.py` (column-mapping + `detect()`/`parse_with_profile()`),
  `nedbank.py`, `homeloan.py`, `__init__.py` (registry). Preferred way to support a new
  bank is a **learned parse profile**, not a parser subclass (see docs/PARSERS.md).
- `profiles.py` / `profilestore.py` - parse-profile helpers + the Firestore store.
- `recovery.py` - per-import undo / backup / audit + confirmation tokens (docs/RECOVERY.md).
- `cryptobox.py` / `storage.py` - encrypted statement password / Storage retention.
- `main.py` hosts the callables + the `ingest_email` HTTP endpoint.

## Branding
The app is fully brandable: `web/src/branding/skins.ts` defines accent palettes + preset
skins + `DEFAULT_SKIN_ID` (the one line a self-hoster edits). Theming swaps Tailwind's
`--color-indigo-*` variables at runtime. Users can also customize name/colour/Gmail-label
in the in-app Appearance settings.

## Region
The code ships configured for `africa-south1`. A self-hoster in another region replaces
that string in `functions/main.py` and `web/src/firebase.ts` (see docs/SETUP.md).

## Tests
`functions/run_tests.py` runs the offline suite (parsers, profiles, PDF table, dedup,
home-loan, account identity, recovery). `samples/` holds synthetic fixtures. Your own
real statements go in `examples/` (gitignored, never commit).
