"""Run all offline backend tests (no Firebase/emulator needed).

    python run_tests.py

The `_emulator_*_e2e.py` scripts are separate - they need the emulators running.
"""
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
TESTS = ["_smoketest.py", "_parse_test.py", "_profile_test.py", "_pdftable_test.py",
         "_dedup_test.py", "_homeloan_test.py", "_account_test.py",
         "_recovery_test.py", "_applock_test.py"]


def main() -> int:
    failed = []
    for t in TESTS:
        print(f"\n{'=' * 60}\n  {t}\n{'=' * 60}")
        if subprocess.run([sys.executable, str(HERE / t)]).returncode != 0:
            failed.append(t)
    print("\n" + ("ALL OFFLINE TESTS PASSED" if not failed else f"FAILED: {failed}"))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
