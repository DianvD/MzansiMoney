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

The code ships with one region. Replace it with **`<your-region>`** in two places:

- `functions/main.py` - every `region="..."` on the `@https_fn.on_call` /
  `@https_fn.on_request` decorators.
- `web/src/firebase.ts` - the `getFunctions(app, "...")` call.

(Find-and-replace the old region string across both files.) Firestore and Storage
already use the region you chose at creation.

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
  so emailed/encrypted PDFs auto-unlock. It's stored AES-encrypted, backend-only.
- **Gmail auto-import:** a Google Apps Script posts PDFs from a labelled inbox to
  the backend hourly - see [`gmail-apps-script.gs`](gmail-apps-script.gs). Set the
  function config secrets `GMAIL_INTAKE_SECRET` and `GMAIL_OWNER_UID`.
- **Backups & recovery:** the Import page has a "Data health & recovery" panel -
  back up your ledger, undo a single import, and check that every import's numbers
  reconcile. See [RECOVERY.md](RECOVERY.md).

## Troubleshooting

- **Functions won't deploy** - confirm the project is on **Blaze** and the region
  in `functions/main.py` matches a [supported Functions region](https://firebase.google.com/docs/functions/locations).
- **Web can't reach functions** - the region in `web/src/firebase.ts` must match
  `functions/main.py`.
- **Emulators won't start** - you need **JDK 21+** (`java -version`).
