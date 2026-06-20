# Parsers & the adaptive import engine

MzansiMoney turns any bank export into one canonical transaction. There is **no
per-bank code on the happy path** - a generic, self-learning parser handles most
CSV/Excel exports, and remembers each layout it sees so it gets more automatic the
more you import.

## How it works

```
upload ─▶ detect() ─▶ shape fingerprint ─▶ known profile? ──yes─▶ reuse mapping
                                              │
                                              no
                                              ▼
                                   confident?  ──yes─▶ learn + import
                                              │
                                              no
                                              ▼
                                   ask you to confirm/fix columns ─▶ remember
```

1. **Detect.** `GenericCsvParser.detect()` (`functions/core/parsers/generic.py`)
   reads the file and works out which column is the date / description / amount (or
   money-out + money-in) / balance - by header names, or by column *type pattern*
   when there's no header row.
2. **Fingerprint the shape.** `Detection.fingerprint` is a hash of the **layout
   only** - delimiter + header names, or column-count + per-column type pattern when
   headerless. It never includes a transaction value, so it carries no personal
   data, and the same bank's exports share one fingerprint month to month.
3. **Reuse or learn.** Profiles live at `users/{uid}/parseProfiles/{fingerprint}`
   (`functions/core/profilestore.py`). A trusted profile is reused as-is. An
   unknown, high-confidence layout is learned automatically. An unknown,
   *uncertain* layout (e.g. no header row, or a missing column) returns
   `status: "preview"` so you can confirm or fix the mapping before anything is
   written - accuracy is the prime directive.
4. **Correct once, stick forever.** If a column is mis-read (e.g. a "Reference"
   column taken as the description), fix it in the Import screen; the corrected
   mapping is saved as **confirmed** and reused for every future file of that shape.

The pure logic is in `functions/core/profiles.py`; it's unit-tested in
`functions/_profile_test.py` and end-to-end in `functions/_emulator_profiles_e2e.py`.

## Confidence & the confirm gate

`profiles.needs_confirmation()` flags a detection for review when confidence is low
(positional guesses, partial mappings) or the description column is missing.
`profiles.is_trusted()` decides whether a saved profile can be reused without
re-asking (user-confirmed, or an auto profile the detector was confident about).

## Supporting a new bank

**Don't write a parser class.** Instead:

1. Try importing the bank's CSV/Excel. Most exports just work, or work after you
   confirm the columns once in the Import screen.
2. If it parses wrong, fix the columns in the UI - that correction is remembered.
3. If a layout *can't* be expressed by column mapping (a genuinely weird format),
   add a **synthetic** sample of that shape to `samples/formats/` (fake rows only -
   never real data) and improve the generic heuristics in `generic.py` until it
   parses, then add a test. See `samples/formats/README.md`.

The only hand-written parsers that remain are deliberate special cases:
`homeloan.py` (bond statements: positional, no balance, inverted signs). The
generic engine is always the default and the fallback.

## The canonical transaction

Every parser emits a `RawTxn` (`functions/core/model.py`); `normalize()` turns it
into the one Firestore transaction shape the whole app reads. Change the shape
there and mirror it in `web/src/types.ts`. Identity, dedup and the balance-aware
fingerprint live in `functions/core/identity.py` - see the project `CLAUDE.md` for
the dedup rules (they are the source-of-truth-critical math; don't change them
without reading that section).
