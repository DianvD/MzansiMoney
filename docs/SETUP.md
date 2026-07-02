# Self-host setup - deploy your own MzansiMoney

This guide gets MzansiMoney running on **your own** Firebase project, so your financial
data lives only in an account you control. Nobody else's instance can see it, and
yours can't see theirs - every signed-in Google user gets an isolated
`users/{uid}/**` space, enforced by `firestore.rules`.

> Want to just try it with no cloud account? See [LOCAL_DEV.md](LOCAL_DEV.md) - it
> runs entirely on emulators.

Budget: at personal scale this sits inside Firebase's free Spark quotas, but Cloud
Functions require the **Blaze** (pay-as-you-go) plan to deploy. Blaze still gives
you the free tier first, so the realistic cost is ~R0/month.

## 0. Prerequisites

- Node 18+, Python 3.12, JDK 21, and the Firebase CLI (`npm i -g firebase-tools`)
- A Google account
- `firebase login`

## 1. Create your Firebase project

In the [Firebase console](https://console.firebase.google.com):

1. **Create a project.**
2. **Authentication** → enable the **Google** sign-in provider.
3. **Firestore Database** → create it. **Pick your region now - it's permanent.**
   Choose the one closest to you (e.g. `europe-west1`, `us-central1`,
   `africa-south1`). Remember this value; you'll set it as `<your-region>` below.
4. **Storage** → enable it (same region).
5. **Hosting** → you'll deploy to it in step 6.
6. **Upgrade to the Blaze plan** (required for Cloud Functions; free tier still applies).

## 2. Clone & point the repo at your project

```bash
git clone <this-repo-url> && cd <repo>
firebase use --add        # pick your project, give it the alias: prod
```

This writes `.firebaserc`. (The default alias stays a `demo-*` project for emulators.)

## 3. Set your region

The region is **one setting per side** (both default to `africa-south1`, so if that
is your region you can skip this step):

- **Backend:** `FUNCTIONS_REGION` in `functions/.env` (copy the example):

  ```bash
  cp functions/.env.example functions/.env    # then set FUNCTIONS_REGION=<your-region>
  ```

- **Web:** `VITE_FUNCTIONS_REGION` in `web/.env.production` (you create that in step 4).

Set both to **`<your-region>`**. They must match each other and the region you chose
for Firestore/Storage in step 1. No source-file editing needed.

## 4. Web config

```bash
cp web/.env.example web/.env.production
```

Fill `web/.env.production` from your Firebase **web app** config
(console → Project settings → your web app):

```
VITE_USE_EMULATORS=false
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=<your-project-id>.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=<your-project-id>
VITE_FIREBASE_APP_ID=...
VITE_FUNCTIONS_REGION=<your-region>   # same value as FUNCTIONS_REGION (step 3)

# Owner front-gate: denies any non-owner immediately after Google sign-in.
# UX guard only — the backend OWNER_UID check is the real enforcement.
# Set to the SAME value as functions' OWNER_UID.
VITE_OWNER_UID=<your-firebase-uid>
```

Optional web settings (add to `web/.env.production` if you want them):

```
# App Check reCAPTCHA v3 site key (public — ships in the page).
# Required if ENFORCE_APP_CHECK=true is set on the backend.
# Get it from Firebase console -> App Check -> register the Web app.
# VITE_RECAPTCHA_SITE_KEY=<your-recaptcha-site-key>
```

These web keys are public by design - they identify the project, they are not
secrets. Firestore rules are what protect the data.

## 5. Backend deps

```bash
cd functions
python -m venv venv
venv\Scripts\pip install -r requirements.txt     # Windows
# source venv/bin/activate && pip install -r requirements.txt   # macOS/Linux
cd ..
```

## 5b. OWNER_UID — required, fail-closed

Every callable rejects requests unless the caller's Firebase Auth UID matches
`OWNER_UID`. This is the primary authorization gate and there is **no fallback** —
leave it unset and all function calls fail.

**How to find your UID:**
1. Open the [Firebase console](https://console.firebase.google.com) → your project
   → **Authentication** → **Users**.
2. Sign in once (step 7 below), then look up your email; your UID is in the row.
3. Alternatively: `firebase auth:export users.json --format=json` and read the
   `localId` field for your account.

Add it to `functions/.env`:

```
OWNER_UID=<your-firebase-uid>
```

Set the **same value** as `VITE_OWNER_UID` in `web/.env.production` (the web
front-gate is a UX guard; the backend check and Firestore rules are the real
enforcement).

## 5c. Secret Manager secrets (set before deploy)

The backend **fails closed** if required secrets are missing - it will not fall back
to an insecure default.

```bash
# Required: HMAC key for confirmation tokens (guards destructive recovery ops)
firebase functions:secrets:set RECOVERY_TOKEN_SECRET
# Enter a value from: openssl rand -hex 32  (>= 32 chars)

# Required if you save statement passwords: AES-256-GCM encryption key
firebase functions:secrets:set STATEMENT_KEY
# Enter a value from: openssl rand -hex 32

# Required if you use Gmail auto-import: shared HMAC for the intake endpoint
firebase functions:secrets:set GMAIL_INTAKE_SECRET
# Enter a long random value (>= 16 chars)

# Required if you configure security alert emails: SMTP password / app-password
firebase functions:secrets:set SMTP_PASS
```

For **local dev/tests** against the emulators, create `functions/.secret.local`
(gitignored) and put placeholder values there:

```
RECOVERY_TOKEN_SECRET=dev-only-insecure-recovery-secret-do-not-use-in-prod
STATEMENT_KEY=dev-only-insecure-statement-key-do-not-use-in-prod
```

You may also set `ALLOW_DEV_SECRETS=1` in `functions/.env` to let the backend
substitute throwaway keys automatically — **never set that in production.**

| Secret (Secret Manager) | Required | What it protects |
|---|---|---|
| `RECOVERY_TOKEN_SECRET` | **Yes** | HMAC key for confirmation tokens that guard destructive recovery ops. `openssl rand -hex 32`. |
| `STATEMENT_KEY` | If you save statement passwords | AES-256-GCM key for encrypted statement-password storage. `openssl rand -hex 32`. |
| `GMAIL_INTAKE_SECRET` | If you use Gmail auto-import | Shared HMAC key for the signed email-intake endpoint. |
| `SMTP_PASS` | If you configure security alert emails | SMTP password or app-password for the notification sender account. |

| Variable (functions/.env) | Required | What it does |
|---|---|---|
| `OWNER_UID` | **Yes** | Your Firebase Auth UID. Every callable fails if this is missing or wrong. |
| `GMAIL_OWNER_UID` | If using Gmail auto-import | Same as OWNER_UID; sets the user the intake writes under. |
| `CORS_ORIGINS` | Optional | Comma-separated allowed CORS origins for HTTP endpoints (default `*`). Set to your hosting domain in production, e.g. `https://your-project-id.web.app`. |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `MAIL_FROM` / `MAIL_FROM_NAME` | Optional | SMTP server config for security alert emails. `SMTP_PASS` is set via Secret Manager above, not here. |

## 6. Deploy

```bash
cd web && npm install && npm run build && cd ..
firebase deploy --project prod
```

This pushes Firestore rules, Storage rules, Cloud Functions, and the built web app
to Hosting. When it finishes you'll get your URL: `https://<your-project-id>.web.app`.

## 7. First run

Open your URL, **Continue with Google**, go to **Import**, and drop a bank CSV.
The dashboard fills in. The first time you import a new bank, MzansiMoney will ask you to
confirm the columns (see [PARSERS.md](PARSERS.md)); after that it's automatic.

## Optional extras

- **Encrypted statements:** save your statement password once (Security settings)
  so emailed/encrypted PDFs auto-unlock. It's stored AES-encrypted, backend-only
  (`STATEMENT_KEY` secret, see 5c).
- **Gmail auto-import:** a Google Apps Script posts PDFs from a labelled inbox to
  the backend hourly - see [`gmail-apps-script.gs`](gmail-apps-script.gs). Set
  `GMAIL_INTAKE_SECRET` (Secret Manager) and `GMAIL_OWNER_UID` (functions/.env)
  — see 5c. The script signs each request with HMAC over `timestamp.payload`; the
  secret never travels on the wire and stale requests are rejected (~5 min window).
  Paste the same secret into `SECRET` in the Apps Script.
- **App Check (reCAPTCHA v3):** requires Firebase App Check attestation on every
  callable, blocking non-browser clients. Enable it:
  1. Firebase console → **App Check** → register your web app with the reCAPTCHA
     v3 provider. Copy the **site key** (public).
  2. Set `VITE_RECAPTCHA_SITE_KEY=<site-key>` in `web/.env.production`.
  3. Set `ENFORCE_APP_CHECK=true` in `functions/.env`.
  4. Redeploy both web and functions.
- **Security alert emails:** the backend can send a notification email on
  suspicious auth events (owner gate blocks, etc.). Set `SMTP_HOST`, `SMTP_PORT`,
  `SMTP_USER`, `MAIL_FROM`, `MAIL_FROM_NAME` in `functions/.env` and provision
  `SMTP_PASS` via Secret Manager (see 5c). Using Gmail: generate an App Password
  (Google Account → Security → App passwords) rather than your real password.
- **Bills — "To pay":** when you import an invoice PDF the backend extracts payment
  details (reference number, amount, bank account) and stores them with the bill.
  On the Bills page, "To pay" items show the payment details so you can transfer
  the money, then tap "Mark paid" to record it. A bill remains in the "To pay"
  view until explicitly marked paid or the import is reverted.
- **Backups & recovery:** the Import page has a "Data health & recovery" panel -
  back up your ledger, undo a single import, and check that every import's numbers
  reconcile. See [RECOVERY.md](RECOVERY.md).

## Troubleshooting

- **Functions won't deploy** - confirm the project is on **Blaze** and that
  `FUNCTIONS_REGION` (in `functions/.env`) is a
  [supported Functions region](https://firebase.google.com/docs/functions/locations).
- **Web can't reach functions** - `VITE_FUNCTIONS_REGION` (web) must match
  `FUNCTIONS_REGION` (backend).
- **Emulators won't start** - you need **JDK 21+** (`java -version`).

## Security scanning

This repo ships professional-grade security scanning in CI
(`.github/workflows/security.yml`: CodeQL, Bandit, Semgrep, pip-audit, npm audit,
gitleaks, dependency-review). To run the scanners locally, install
`functions/requirements-dev.txt` and follow
[SECURITY-SCANNING.md](SECURITY-SCANNING.md). To report a vulnerability, see
[../SECURITY.md](../SECURITY.md).
