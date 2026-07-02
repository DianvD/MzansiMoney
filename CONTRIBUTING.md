# Contributing

Thanks for helping out! This is a personal-finance app where **accuracy is the
prime directive** - a wrong or duplicated transaction silently skews every total -
so the bar for anything touching the import/dedup path is high. Most contributions
are smaller than that and very welcome.

## Getting set up

See [docs/LOCAL_DEV.md](docs/LOCAL_DEV.md). Everything runs on the Firebase
emulators - no cloud account, no real data.

## Project shape

- `functions/` - Firebase Cloud Functions (Python 3.12). The import pipeline,
  parsers, dedup spine, and recovery. See the project `CLAUDE.md` for the
  architecture and the dedup rules.
- `web/` - React + Vite + TypeScript + Tailwind dashboard.
- `docs/` - guides + design docs (`PARSERS.md`, `RECOVERY.md`, `VISION.md`).

## Before you open a PR

```bash
# Backend: offline suite must pass
cd functions && venv\Scripts\python run_tests.py

# Web: typecheck + build must pass
cd web && npm run build
```

The offline suite (`run_tests.py`) covers parsers, adaptive profiles, PDF table
reconstruction, dedup, classifier/bills, home-loan, account identity, and recovery
tokens — no Firebase account or network needed. Start the emulators (see
[docs/LOCAL_DEV.md](docs/LOCAL_DEV.md)) and sign in to exercise the full import
and recovery flows manually before opening a PR.

- **Add a test** for behaviour changes - match the existing `_*_test.py` style
  (plain asserts + a printed `ok` line).
- **Match the surrounding code** - comment density, naming, idioms. The codebase
  favours small, well-commented modules over cleverness.

## Adding support for a bank

Please **don't** add a per-bank parser class. The parser is adaptive - see
[docs/PARSERS.md](docs/PARSERS.md). If a layout doesn't parse, add a **synthetic**
sample (fake rows only) to `samples/formats/` and improve the generic heuristics.

## Two hard rules

1. **Never commit real financial data.** No real statements, account numbers,
   balances, or personal PDFs/CSVs - fixtures must be synthetic. (`examples/` is
   gitignored for local real files; never add to it in a PR.)
2. **Don't change the dedup math** (`functions/core/identity.py` /
   `ingest.py`) without reading the dedup section of `CLAUDE.md` and adding tests
   that prove duplicates still can't slip through and legitimate duplicates still
   survive.

## Commit & PR

- Small, focused commits with a clear message (what + why).
- Open a PR describing the change and how you tested it. CI runs the offline suite.
- Be kind in review. 🙂

## Licensing of contributions

MzansiMoney is licensed under [FSL-1.1-MIT](LICENSE). By submitting a pull
request you agree that your contribution is licensed under the same terms, and
you grant the maintainer the right to relicense the project (including your
contribution) under an OSI-approved open-source license in the future — this is
what lets every release convert to MIT after two years, and keeps dual-licensing
possible without chasing signatures later.
