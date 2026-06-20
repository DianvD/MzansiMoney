# Security scanning

MzansiMoney runs professional-grade security scanning in CI
(`.github/workflows/security.yml`) and the same scanners can be run locally.

The CI pipeline covers:

- **CodeQL** (security-extended) over the `web/` JS/TS frontend.
- **Bandit** — Python SAST over `functions/`.
- **Semgrep** — `p/ci`, `p/python`, `p/javascript`, `p/secrets`, OWASP Top Ten,
  plus the custom app rules in `.semgrep.yml`.
- **pip-audit** — Python dependency CVEs (`functions/requirements.txt`).
- **npm audit** — `web/` production deps (fails on high/critical).
- **gitleaks** — secret scan over full git history (config `.gitleaks.toml`).
- **dependency-review** — new/changed deps on pull requests.

## Run locally

Install the dev scanners into your functions venv once:

```bash
# Windows
functions/venv/Scripts/pip install -r functions/requirements-dev.txt
# macOS / Linux
pip install -r functions/requirements-dev.txt
```

### Python SAST — Bandit

```bash
bandit -c pyproject.toml -r functions \
  -x '*/venv/*,*/__pycache__/*,*_test.py'
```

(`-x` takes comma-separated globs; tests, the venv and caches are skipped. The
config in `pyproject.toml [tool.bandit]` adds the same exclusions for IDE/CI runs.)

### Python dependency CVEs — pip-audit

```bash
pip-audit -r functions/requirements.txt
```

### Multi-ruleset SAST — Semgrep

```bash
# Custom app rules only (fast):
semgrep scan --config .semgrep.yml

# Full set (matches CI):
semgrep scan --config .semgrep.yml --config p/python --config p/javascript \
  --config p/secrets --config p/owasp-top-ten
```

### Frontend dependency CVEs — npm audit

```bash
cd web
npm audit --omit=dev                 # report
npm audit --omit=dev --audit-level=high   # fail on high/critical (what CI does)
```

### Secret scan — gitleaks

```bash
# scans the working tree + full history; config = .gitleaks.toml
gitleaks detect --config .gitleaks.toml --redact
```

The `.gitleaks.toml` allowlist intentionally permits two non-secrets: the
dev-only placeholder recovery key (only used when `ALLOW_DEV_SECRETS=1`) and the
public Firebase web API key.

## Triage

CodeQL/Bandit/Semgrep findings appear in the GitHub **Security** tab (SARIF).
pip-audit and `npm audit` failing the build means a dependency needs upgrading.
A new gitleaks hit means a real secret was committed — rotate it and scrub
history; do not just add it to the allowlist.
