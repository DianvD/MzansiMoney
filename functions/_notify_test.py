"""Notification body + device-label checks (pure, offline).

The Firestore-facing parts (record_login) are covered by the emulator e2e; here we
lock down the pure logic: UA -> friendly label, and that the alert bodies carry the
key facts + safety guidance.
Run: python _notify_test.py
"""
from core.notify import device_label, new_login_body, secret_changed_body


def test_device_label():
    assert device_label("Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537") == "Chrome on Windows"
    assert device_label("Mozilla/5.0 (Windows) Edg/120") == "Edge on Windows"
    assert device_label("Mozilla/5.0 (X11; Linux) Firefox/119") == "Firefox on Linux"
    assert device_label("Mozilla/5.0 (iPhone; CPU iPhone OS 17) Safari") == "Safari on iOS"
    assert device_label("") == "a browser on an unknown device"
    print("ok  device_label maps a User-Agent to a friendly name")


def test_alert_bodies_carry_key_facts():
    text, html = secret_changed_body("app-lock PIN", "2026-06-22 14:00 SAST")
    assert "app-lock PIN" in text and "act immediately" in text.lower()
    assert "app-lock PIN" in html and "<ol>" in html
    text, html = new_login_body("Chrome on Windows", "2026-06-22 14:00 SAST")
    assert "Chrome on Windows" in text and "Chrome on Windows" in html
    assert "turn these login alerts off" in text.lower()
    print("ok  alert bodies include the device/secret + safety guidance")


if __name__ == "__main__":
    test_device_label()
    test_alert_bodies_carry_key_facts()
    print("\nALL NOTIFY TESTS PASSED")
