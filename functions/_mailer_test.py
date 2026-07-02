"""Mailer config + fail-soft checks (offline, no network).

Verifies email is treated as OPTIONAL: unconfigured -> disabled and never raises;
configured-but-no-recipient -> no send attempted. We don't make a real SMTP call.
Run: python _mailer_test.py
"""
import os

from core import mailer

_SMTP_KEYS = ("SMTP_HOST", "SMTP_USER", "SMTP_PASS", "SMTP_PORT", "MAIL_FROM")


def _clear():
    for k in _SMTP_KEYS:
        os.environ.pop(k, None)


def test_unconfigured_is_disabled_and_failsoft():
    _clear()
    assert mailer.is_configured() is False
    # Fail-soft: returns False, never raises, when email isn't set up.
    assert mailer.send_email("x@example.com", "Hi", "body") is False
    print("ok  unconfigured mailer is disabled and fail-soft")


def test_configured_detection_and_empty_recipient():
    _clear()
    os.environ.update({"SMTP_HOST": "smtp.example.com", "SMTP_USER": "user", "SMTP_PASS": "pass"})
    try:
        assert mailer.is_configured() is True
        # Empty recipient short-circuits to False before any network call.
        assert mailer.send_email("", "Hi", "body") is False
    finally:
        _clear()
    print("ok  configured detection + empty-recipient guard (no network)")


if __name__ == "__main__":
    test_unconfigured_is_disabled_and_failsoft()
    test_configured_detection_and_empty_recipient()
    print("\nALL MAILER TESTS PASSED")
