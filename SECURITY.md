# Security Policy

MzansiMoney is a **self-hostable** personal-finance app (React/Vite frontend +
Firebase Cloud Functions in Python). It handles sensitive financial data, so we
take security reports seriously and appreciate responsible disclosure.

## IMPORTANT: Rotate RECOVERY_TOKEN_SECRET if you deployed from commit a04da06

If you deployed from commit **a04da06** (the initial public release), your
`RECOVERY_TOKEN_SECRET` was seeded by a **dev fallback string that exists in the
public git history** (`app-recovery-dev-secret`).
That string is burned — it is no longer secret.

**Action required:** rotate the key immediately and redeploy.

```bash
firebase functions:secrets:set RECOVERY_TOKEN_SECRET
# Enter a fresh value from: openssl rand -hex 32
firebase deploy --only functions
```

This key guards the HMAC confirmation tokens that authorise destructive recovery
operations (import undo, ledger restore). A stolen key would let an attacker
forge those tokens — but only if they also have a valid session as the owner
(the `OWNER_UID` callable gate and Firestore rules are separate layers). Still,
rotate it.

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

## Security posture summary

| Control | What it does |
|---|---|
| **Owner allow-list (fail-closed)** | Every callable rejects the request if `OWNER_UID` env var is unset or the caller's UID doesn't match. No fallback, no open mode. |
| **Firestore rules** | Clients are read-only on all financial collections (`transactions`, `bills`, `documents`, etc.); only the backend Admin SDK writes them. An optional UID pin (see `firestore.rules` comment block) adds a second layer. |
| **Storage rules** | Clients may read their own archive; writes are always denied. Optional UID pin available (see `storage.rules` comment block). |
| **Secret Manager** | `RECOVERY_TOKEN_SECRET`, `STATEMENT_KEY`, `GMAIL_INTAKE_SECRET`, and `SMTP_PASS` are provisioned as Firebase Secrets — never in env files or source. |
| **Encryption-at-rest (Storage)** | Statement files stored in Firebase Storage are encrypted with AES-256-GCM before upload. The key (`STATEMENT_KEY`) is a Secret Manager secret. |
| **Single-use recovery tokens** | Confirmation tokens for destructive recovery ops are HMAC-signed, short-lived (~5 min), and bound to uid+op+target. A replayed or forged token is rejected. |
| **Security alert emails** | When SMTP credentials are configured, the backend sends a notification email on suspicious auth events (optional). |
| **App Check (opt-in)** | Set `ENFORCE_APP_CHECK=true` (backend) and `VITE_RECAPTCHA_SITE_KEY` (web) to require reCAPTCHA v3 attestation on every callable. |
| **HTTP security headers** | All hosting responses carry CSP, HSTS (2-year, preload), X-Frame-Options DENY, X-Content-Type-Options, Referrer-Policy, COOP, and Permissions-Policy. |
| **ALLOW_DEV_SECRETS** | A dev-only flag that substitutes throwaway keys in local tests. It is a `FAILED_PRECONDITION` to set this in production. |

## Self-hosting: you must provision your own secrets

This is the most important operational note. Because MzansiMoney is self-hosted,
**each operator is responsible for provisioning their own secrets.** The backend
**fails closed** if they are missing.

### Secret Manager secrets (set via `firebase functions:secrets:set`)

| Secret | Required | What it protects |
|---|---|---|
| `RECOVERY_TOKEN_SECRET` | **Yes** | HMAC key for the confirmation tokens that guard destructive recovery operations. Generate with `openssl rand -hex 32` (>= 32 chars). |
| `STATEMENT_KEY` | If you save statement passwords | AES-256-GCM key for encrypted statement-password storage. `openssl rand -hex 32`. |
| `GMAIL_INTAKE_SECRET` | If you use Gmail auto-import | Shared HMAC key for the signed email-intake endpoint (>= 16 chars; use a long random value). |
| `SMTP_PASS` | If you configure security alert emails | Password / app-password for the SMTP account used to send security notifications. |

### Plain environment variables (set in `functions/.env`)

| Variable | Required | What it does |
|---|---|---|
| `OWNER_UID` | **Yes** | Your Firebase Auth UID. Every callable is rejected if this is unset or doesn't match. |
| `FUNCTIONS_REGION` | If not `africa-south1` | Cloud Functions region; must match Firestore/Storage region and `VITE_FUNCTIONS_REGION`. |
| `GMAIL_OWNER_UID` | If using Gmail auto-import | Firebase Auth UID that email intake writes under. Usually the same as `OWNER_UID`. |
| `CORS_ORIGINS` | Optional | Comma-separated allowed CORS origins for HTTP endpoints. Defaults to `*`. |
| `ENFORCE_APP_CHECK` | Optional | Set `true` to require Firebase App Check on every callable. |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `MAIL_FROM` / `MAIL_FROM_NAME` | Optional | SMTP config for security alert emails. `SMTP_PASS` is a Secret Manager secret, not here. |

See [`docs/SETUP.md`](docs/SETUP.md) §5b for the exact provisioning commands.

Never set `ALLOW_DEV_SECRETS=1` in production — it exists solely to let local
dev/tests run with a throwaway, publicly-known key.

**Firebase web API keys** (the `VITE_FIREBASE_API_KEY` / `apiKey` values in the
frontend) are **public by design** — they identify your project, they are not
secrets. Your data is protected by `firestore.rules`, not by hiding that key.

## Supported versions

This is an actively developed, single-maintainer project. Security fixes land on
the default branch (`main`); please run a recent commit. There is no long-term
support branch — **the latest `main` is the supported version.**

| Version | Supported |
|---|---|
| Latest `main` | yes |
| Older commits / forks | no (please update) |
