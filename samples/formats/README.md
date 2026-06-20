# Format fixtures (synthetic)

Fake-but-realistic bank export **layouts** used to exercise the adaptive parser.
All data here is invented - no real accounts, balances, or people. Each file is a
different *shape* the generic parser must handle without any bank-specific code:

| File | Shape | Resembles |
|---|---|---|
| `debit-credit-columns.csv` | header row; separate Money Out / Money In columns; comma | Capitec-style |
| `signed-amount-semicolon.csv` | header row; single signed Amount column; semicolon | Discovery / many EU exports |
| `headerless-positional.csv` | no header; date, description, amount, balance inferred by position | Nedbank CSV export |
| `reference-vs-narrative.csv` | header row where the auto-detector picks the *wrong* description column | the "confident but wrong → user corrects once" case |

Add a new file here (with **fake** rows) when a real bank's layout isn't parsed
correctly, then tighten the generic heuristics until it is - we never add a
per-bank parser class.
