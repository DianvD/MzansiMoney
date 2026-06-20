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

## 1. Install dependencies

One command from the repo root installs both the web and functions deps (the
emulator runs the function from the functions venv):

```bash
./scripts/setup          # macOS / Linux / Git Bash
scripts\setup.ps1        # Windows PowerShell
```

<details><summary>Or do it manually</summary>

```bash
cd web && npm install && cd ..
cd functions
python -m venv venv
venv\Scripts\pip install -r requirements.txt      # Windows
# source venv/bin/activate && pip install -r requirements.txt   # macOS/Linux
```
</details>

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
cd web && npm run dev          # http://localhost:5173
```

Sign in with the emulator's Google account, open **Import**, drop a CSV from
`samples/` (or `samples/formats/`), and watch the **Dashboard** fill in.

## Tests

The offline suite needs no Firebase or network - it covers the parser, adaptive
profiles, dedup, classifier/bills, home-loan, account identity, and recovery tokens:

```bash
cd functions && venv\Scripts\python run_tests.py     # Windows
# cd functions && venv/bin/python run_tests.py       # macOS/Linux
```

Web typecheck + production build:

```bash
cd web && npm run build       # tsc -b && vite build
```

## Notes

- Emulator data is in-memory and disappears on restart - that's the point.
- If a port is stuck after a crash, kill the leftover process holding it before
  restarting the emulators.
