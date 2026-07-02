"""Security notifications - "was this you?" emails.

Two kinds:
* **Secret-changed alerts** (app-lock PIN, statement password) - always sent (a
  security event the user must always hear about).
* **New-device sign-in alerts** - sent only when a sign-in comes from a device we
  haven't seen, and only if the user hasn't turned login alerts off.

Recipient is the signed-in user's own email (from their Google ID token). All
sends are fail-soft via :mod:`core.mailer` - a notification can never break the
action that triggered it. The pure bits (device label, body text) are unit-tested.
"""
from __future__ import annotations

import hashlib
import html as _html_lib
from datetime import datetime, timedelta, timezone
from typing import Optional

from firebase_admin import firestore

from . import mailer

# South Africa has no DST, so SAST is a fixed UTC+2 - safe to compute without a tz db.
_SAST = timezone(timedelta(hours=2))

# App name shown in notification emails. Reads MAIL_FROM_NAME for consistency with
# the From header; falls back to "MzansiMoney" when unset.
def _app_name() -> str:
    import os
    # nosemgrep: insecure-env-default-literal -- cosmetic app name shown in emails, not a secret.
    return os.environ.get("MAIL_FROM_NAME") or "MzansiMoney"


def _now_str() -> str:
    return datetime.now(_SAST).strftime("%Y-%m-%d %H:%M SAST")


def device_label(user_agent: str) -> str:
    """A friendly 'Chrome on Windows'-style label from a User-Agent string."""
    low = (user_agent or "").lower()
    if "edg" in low:
        browser = "Edge"
    elif "chrome" in low:
        browser = "Chrome"
    elif "firefox" in low:
        browser = "Firefox"
    elif "safari" in low:
        browser = "Safari"
    else:
        browser = "a browser"
    if "windows" in low:
        os_name = "Windows"
    elif "android" in low:
        os_name = "Android"
    elif "iphone" in low or "ipad" in low or "ios" in low:
        os_name = "iOS"
    elif "mac" in low:
        os_name = "Mac"
    elif "linux" in low:
        os_name = "Linux"
    else:
        os_name = "an unknown device"
    return f"{browser} on {os_name}"


# ---- bodies (pure) --------------------------------------------------------

def secret_changed_body(what: str, when: str) -> tuple[str, str]:
    """(text, html) for a 'your <what> was changed' alert."""
    app = _app_name()
    text = (
        f"Your {app} {what} was just changed ({when}).\n\n"
        f"If this was you, you can ignore this email.\n\n"
        f"If it was NOT you, act immediately:\n"
        f"  1. Open your Google Account security and sign out of all sessions.\n"
        f"  2. Set a new {what} in {app}.\n"
    )
    _what = _html_lib.escape(what)
    _when = _html_lib.escape(when)
    _app = _html_lib.escape(app)
    html = (
        f"<p>Your {_app} <strong>{_what}</strong> was just changed (<strong>{_when}</strong>).</p>"
        f"<p>If this was you, you can ignore this email.</p>"
        f"<p><strong>If it was NOT you, act immediately:</strong></p>"
        f"<ol><li>Open your Google Account security and sign out of all sessions.</li>"
        f"<li>Set a new {_what} in {_app}.</li></ol>"
    )
    return text, html


def new_login_body(label: str, when: str) -> tuple[str, str]:
    """(text, html) for a 'new device signed in' alert."""
    app = _app_name()
    text = (
        f"A new device just signed in to your {app} account.\n\n"
        f"Device: {label}\n"
        f"When:   {when}\n\n"
        f"If this was you, no action is needed.\n\n"
        f"If you don't recognise it, open your Google Account security and sign out "
        f"of all sessions.\n\n"
        f"(You can turn these login alerts off in {app} - Security settings.)"
    )
    _label = _html_lib.escape(label)
    _when = _html_lib.escape(when)
    _app = _html_lib.escape(app)
    html_body = (
        f"<p>A new device just signed in to your {_app} account.</p>"
        f"<p><strong>Device:</strong> {_label}<br><strong>When:</strong> {_when}</p>"
        f"<p>If this was you, no action is needed. If you don't recognise it, open your "
        f"Google Account security and sign out of all sessions.</p>"
        f"<p style='color:#888;font-size:12px'>You can turn these login alerts off in "
        f"{_app} &rarr; Security settings.</p>"
    )
    return text, html_body


# ---- secret-changed alerts ------------------------------------------------

def notify_secret_changed(email: Optional[str], what: str) -> bool:
    """Send a 'your <what> was changed' email. Always attempted (no opt-out)."""
    app = _app_name()
    text, html = secret_changed_body(what, _now_str())
    return mailer.send_email(email or "", f"Your {app} {what} was changed", text, html)


# ---- new-device login alerts ----------------------------------------------

def _login_alerts_enabled(db, uid: str) -> bool:
    """Login alerts default ON; the user can turn them off in settings/notifications."""
    snap = db.collection("users").document(uid).collection("settings").document("notifications").get()
    if not snap.exists:
        return True
    return bool((snap.to_dict() or {}).get("loginAlerts", True))


def record_login(db, uid: str, *, email: Optional[str], device_id: str, user_agent: str = "") -> dict:
    """Record a sign-in from a device and alert on a genuinely NEW one.

    A device is identified by a random per-browser id (hashed here - we never store
    the raw id). The very first device on an account is the owner enrolling, so it's
    recorded silently; only a *subsequent* unseen device triggers an alert (and only
    if login alerts are enabled)."""
    if not device_id:
        return {"status": "skipped"}

    devices = db.collection("users").document(uid).collection("devices")
    dev_hash = hashlib.sha256(device_id.encode("utf-8")).hexdigest()
    ref = devices.document(dev_hash)

    if ref.get().exists:
        ref.set({"lastSeenAt": firestore.SERVER_TIMESTAMP}, merge=True)
        return {"status": "known"}

    # New device. Check whether the account already had one BEFORE we add this.
    had_device = any(True for _ in devices.limit(1).stream())
    label = device_label(user_agent)
    ref.set({
        "firstSeenAt": firestore.SERVER_TIMESTAMP,
        "lastSeenAt": firestore.SERVER_TIMESTAMP,
        "userAgent": (user_agent or "")[:300],
        "label": label,
    })

    if not had_device:
        return {"status": "first_device", "alerted": False}

    app = _app_name()
    alerted = False
    if _login_alerts_enabled(db, uid):
        text, html = new_login_body(label, _now_str())
        alerted = mailer.send_email(email or "", f"New sign-in to your {app} account", text, html)
    return {"status": "new_device", "alerted": alerted}
