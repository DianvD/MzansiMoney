# MzansiMoney

A self-hostable **personal finance operating system**: one private source of truth
for your money. Import your bank statements, see your balance, spending, income,
category breakdown, bills, recurring payments, net worth, and a dedicated home-loan
tracker. Built South-Africa-first (rand formatting, SA bank exports), but it works
anywhere.

It is **yours**: deploy it to your own Firebase project, and your data lives only
in an account you control. Every signed-in user gets an isolated, backend-owned
data space (enforced by `firestore.rules`).

> **Make it your own.** The app is fully brandable, in the app (Appearance settings)
> and in one config line. Ship it as MzansiMoney, switch to the BraaiBucks skin, or
> give it your own name, accent colour, and Gmail label. See `web/src/branding/`.

## Quickstart (local, no cloud account)

Run the whole app on Firebase emulators - no Firebase project, no billing:

```bash
git clone https://github.com/DianvD/MzansiMoney.git && cd MzansiMoney
./scripts/setup              # installs web + functions deps (Windows: scripts\setup.ps1)
firebase emulators:start     # terminal 1
cd web && npm run dev        # terminal 2  ->  http://localhost:5173
```

Prerequisites: Node 18+, Python 3.12, JDK 21, and the Firebase CLI
(`npm i -g firebase-tools`). Full walkthrough: [docs/LOCAL_DEV.md](docs/LOCAL_DEV.md).
To deploy your own copy to Firebase, see [docs/SETUP.md](docs/SETUP.md).

## What it does

- **Import**: CSV, Excel, and PDF statements. A generic, **self-learning parser**
  auto-detects most bank layouts, remembers each bank's columns (correct it once and
  it sticks), and turns PDF statements into transactions too. Invoices become
  **bills**; encrypted PDFs auto-unlock with your saved statement password. Optional
  **Gmail auto-import** picks up labelled statement emails hourly.
- **Duplicate-proof by design**: a two-layer document ledger plus a balance-aware
  transaction fingerprint plus a balance-chain integrity check. Re-imports, the same
  statement from two channels, or an invoice that also appears inside a statement
  never inflate your numbers, while two genuinely identical transactions are both
  kept.
- **Customizable dashboard**: a Customize mode to drag-reorder, resize, and
  hide/show cards. Make it truly yours.
- **Multiple accounts**: a top-bar account switcher, accounts auto-discovered from
  your data, a default account for zero-friction imports, and a per-import account
  picker.
- **Recovery and data health**: undo a single import (removes exactly its rows),
  back up your whole ledger to JSON, and an integrity check that flags any import
  whose live count drifts. Dry-run, confirm, and auto-snapshot before anything is
  deleted. See [docs/RECOVERY.md](docs/RECOVERY.md).
- **More**: transactions search with tap-to-recategorize (it learns), recurring /
  debit-order tracking, bills (overdue / upcoming / paid), net worth and savings
  goals, a home-loan (bond) tracker, an app lock (PIN plus biometric), and an
  installable PWA.

## Stack

- **Web** (`web/`): React, Vite, TypeScript, Tailwind v4. Desktop-first.
- **Backend** (`functions/`): Firebase Cloud Functions in Python (Gen2). The import
  pipeline, parsers, dedup spine, and recovery.
- **Data / Auth / Hosting**: Firebase (Firestore, Google sign-in, Hosting, Storage).

## Get started

- **Run it locally** with zero cloud setup (Firebase emulators): see
  [docs/LOCAL_DEV.md](docs/LOCAL_DEV.md).
- **Self-host** to your own Firebase project: see [docs/SETUP.md](docs/SETUP.md).
- **How the adaptive parser works** and how to support a new bank:
  [docs/PARSERS.md](docs/PARSERS.md).
- **PDF statement parsing**: [docs/PDF_STATEMENTS.md](docs/PDF_STATEMENTS.md).
- **Contributing**: [CONTRIBUTING.md](CONTRIBUTING.md).

## Privacy

Your financial data is private to you. Clients are read-only on the financial
collections; only the backend (Cloud Functions, Admin SDK) writes them. Your own
real statements belong in `examples/`, which is gitignored and must never be
committed. Use the synthetic fixtures in `samples/` for development and tests.

## License

[MIT](LICENSE).
