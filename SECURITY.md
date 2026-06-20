# Security Policy

MzansiMoney is a **self-hostable** personal-finance app (React/Vite frontend +
Firebase Cloud Functions in Python). It handles sensitive financial data, so we
take security reports seriously and appreciate responsible disclosure.

## Reporting a vulnerability

**Please do not open a public GitHub issue for security problems.**

Report privately via GitHub's built-in private vulnerability reporting:

1. Go to the repository's **Security** tab → **Report a vulnerability**
   (GitHub Security Advisories). This opens a private channel with the maintainer.
2. If that is unavailable, email the maintainer at the address on the GitHub
   profile [@DianvD](https://github.com/DianvD) with the subject line
   `MzansiMoney security`.

Please include:

- A description of the issue and its impact.
- Steps to reproduce (a proof-of-concept if you have one).
- Affected version / commit and your deployment setup (region, any custom config).
- Whether the issue is already public anywhere.

## Our commitment / response times

- **Acknowledgement:** within **3 business days**.
- **Triage & initial assessment:** within **7 business days**.
- **Fix or mitigation plan:** communicated after triage; timeline depends on
  severity. Critical issues are prioritized.
- We will keep you updated and credit you in the advisory (unless you prefer to
  remain anonymous). Please give us a reasonable window to ship a fix before any
  public disclosure (we aim for **90 days** or sooner).

## Scope

In scope:

- The application code in this repository: `functions/` (Python Cloud Functions)
  and `web/` (React/TypeScript frontend).
- `firestore.rules` and `storage.rules` (the data-access controls).
- The import/dedup pipeline and the recovery/confirmation-token logic.

Out of scope:

- **A specific deployed instance's data or secrets.** Each self-hoster runs their
  own Firebase project; their data and misconfiguration are their responsibility,
  not a vulnerability in this repo (unless the code led them there).
- Firebase / Google Cloud platform issues — report those to Google.
- Findings that require a self-hoster to have already mis-set secrets (see below).
- Denial of service via resource exhaustion against your own instance.
- Reports from automated scanners with no demonstrated impact.

## Self-hosting: you must set your own secrets

This is the most important operational note. Because MzansiMoney is self-hosted,
**each operator is responsible for provisioning their own secrets.** The backend
**fails closed** if they are missing — it will not fall back to an insecure
default in production. You must set:

| Secret | Protects |
|---|---|
| `RECOVERY_TOKEN_SECRET` | HMAC key for the confirmation tokens that guard destructive recovery operations. **Required.** Generate with `openssl rand -hex 32` (≥ 32 chars). |
| `STATEMENT_KEY` | AES-256-GCM key for the encrypted statement password (only if you save statement passwords). `openssl rand -hex 32`. |
| `GMAIL_INTAKE_SECRET` | Shared HMAC key for the signed Gmail email-intake endpoint (only if you use Gmail auto-import). Use a long random value. |

Never set `ALLOW_DEV_SECRETS=1` in production — it exists solely to let local
dev/tests run with a throwaway, publicly-known key. See
[`docs/SETUP.md`](docs/SETUP.md) §5b.

**Firebase web API keys** (the `VITE_FIREBASE_API_KEY` / `apiKey` values in the
frontend) are **public by design** — they identify your project, they are not
secrets. Your data is protected by `firestore.rules`, not by hiding that key.

## Supported versions

This is an actively developed, single-maintainer project. Security fixes land on
the default branch (`main`); please run a recent commit. There is no long-term
support branch — **the latest `main` is the supported version.**

| Version | Supported |
|---|---|
| Latest `main` | ✅ |
| Older commits / forks | ❌ (please update) |
