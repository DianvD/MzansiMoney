# Local development

Everything runs on the Firebase **emulators** - no cloud project, no cost, no real
data. The web app auto-connects to the emulators in `vite dev`.

## Prerequisites

- **Node 18+** and npm
- **Python 3.12** (Cloud Functions runtime)
- **JDK 21** - the Firestore/Storage emulators need Java 21+.
  - macOS/Linux: install any JDK 21 (e.g. Temurin) and ensure `java -version` shows 21.
  - Windows tip: Android Studio ships a JDK 21 JBR. Point Java at it **per-session**
    so you don't disturb a global `JAVA_HOME`:
    ```powershell
    $env:JAVA_HOME="C:\Program Files\Android\Android Studio\jbr"
    $env:PATH="C:\Program Files\Android\Android Studio\jbr\bin;$env:PATH"
    ```
- **Firebase CLI**: `npm i -g firebase-tools`

## 1. Backend deps (the emulator runs the function from this venv)

```bash
cd functions
python -m venv venv
venv\Scripts\pip install -r requirements.txt      # Windows
# source venv/bin/activate && pip install -r requirements.txt   # macOS/Linux
```

## 2. Start the emulators (from the repo root)

```bash
firebase emulators:start
```

Default ports: Auth `:9099` · Firestore `:8080` · Functions `:5001` ·
Storage `:9199` · Hosting `:5000` · UI `:4000`. They run against the `demo-*`
project alias, so nothing touches a real project.

> The recovery end-to-end test also needs the **storage** emulator:
> `firebase emulators:start --only auth,firestore,functions,storage`.

## 3. Start the web app

```bash
cd web
npm install
npm run dev          # http://localhost:5173
```

Sign in with the emulator's Google account, open **Import**, drop a CSV from
`samples/` (or `samples/formats/`), and watch the **Dashboard** fill in.

## Tests

```bash
# Offline (no Firebase): parser, adaptive profiles, dedup, classifier/bills,
# home-loan, account identity, recovery tokens
cd functions && venv\Scripts\python run_tests.py

# Live end-to-end (emulators must be running)
venv\Scripts\python _emulator_e2e.py            # CSV dedup / needs_review / integrity
venv\Scripts\python _emulator_profiles_e2e.py   # adaptive parser: learn → reuse → correct
venv\Scripts\python _emulator_recovery_e2e.py   # undo / backup / audit (needs storage emulator)
venv\Scripts\python _emulator_docs_e2e.py       # PDF: bills, dedup, encrypted, rules
```

Web typecheck + production build:

```bash
cd web && npm run build       # tsc -b && vite build
```

## Notes

- Emulator data is in-memory and disappears on restart - that's the point.
- The `*_e2e.py` scripts sign up a throwaway user in the Auth emulator and talk to
  the Functions/Firestore emulators over HTTP, then assert on what actually landed
  in Firestore.
- If a port is stuck after a crash, kill the leftover process holding it before
  restarting the emulators.
