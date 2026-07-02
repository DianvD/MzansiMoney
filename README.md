# MzansiMoney

> **BREAKING CHANGE — functions now require `OWNER_UID`.**
> Every callable rejects requests unless `OWNER_UID` is set in `functions/.env`
> and matches the caller's Firebase Auth UID. Existing self-hosters must add this
> variable before redeploying or all function calls will fail. See
> [docs/SETUP.md §5b](docs/SETUP.md) for the setup steps. If you deployed from
> the initial release commit **a04da06**, also rotate `RECOVERY_TOKEN_SECRET` —
> see [SECURITY.md](SECURITY.md) for details.

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
- **Bills — "To pay"**: the Bills page extracts payment details (reference numbers,
  amounts, bank accounts) from invoice PDFs and lets you mark bills paid once you've
  transferred the money. Import skip warnings surface any rows that were skipped
  during a statement import so nothing silently disappears.
- **More**: transactions search (paginated) with tap-to-recategorize (it learns),
  recurring / debit-order tracking, bills (overdue / upcoming / paid), net worth and
  savings goals, a home-loan (bond) tracker, an app lock (PIN, 6–12 chars, plus
  biometric), and an installable PWA.

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

## Security

- **Owner gate (fail-closed):** every callable is rejected unless the caller's UID
  matches the `OWNER_UID` env var. No open mode.
- **Client read-only:** clients can never write transactions, bills, or the dedup
  ledger directly — only the backend Admin SDK can.
- **Secrets in Secret Manager:** `RECOVERY_TOKEN_SECRET`, `STATEMENT_KEY`,
  `GMAIL_INTAKE_SECRET`, and `SMTP_PASS` are provisioned as Firebase Secrets.
- **Encryption-at-rest:** statement files stored in Firebase Storage are encrypted
  with AES-256-GCM before upload.
- **HTTP security headers:** CSP, HSTS (2-year, preload), X-Frame-Options DENY, and
  more are set on all hosting responses.
- **Optional App Check:** reCAPTCHA v3 attestation on every callable (`ENFORCE_APP_CHECK`).

Your own real statements belong in `examples/`, which is gitignored and must never be
committed. Use the synthetic fixtures in `samples/` for development and tests.

## License

[FSL-1.1-MIT](LICENSE) (Functional Source License). In plain terms:

- **Free to use, self-host, modify, and learn from** — personal use, internal use,
  education, and research are all explicitly permitted.
- **You may not sell MzansiMoney (or a derivative) as a competing product or
  hosted service.**
- **Each release automatically becomes plain [MIT](https://opensource.org/license/mit)
  two years after publication.**

Versions up to and including commit `a942404` were published under MIT and remain
MIT. Everything after that is FSL-1.1-MIT.
