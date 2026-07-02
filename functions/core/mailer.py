"""Outbound email - provider-agnostic SMTP.

The SAME code works with Gmail, SendGrid, Mailgun, Resend, or any SMTP host: the
deployer just sets the ``SMTP_*`` secrets for whichever provider they picked.

**Fail-soft by design:** if email isn't configured - or a send fails - we log and
return ``False`` instead of raising. A security *notification* must never break the
user action that triggered it (changing a PIN should still succeed even if the
"your PIN changed" email can't go out).

Config (all via env / Firebase secrets):
* ``SMTP_HOST``      - e.g. smtp.gmail.com, smtp.sendgrid.net (required to enable email)
* ``SMTP_PORT``      - 587 (STARTTLS, default) or 465 (implicit TLS)
* ``SMTP_USER``      - SMTP username (for SendGrid this is literally "apikey")
* ``SMTP_PASS``      - SMTP password / app password / API key (required)
* ``MAIL_FROM``      - From address (defaults to SMTP_USER)
* ``MAIL_FROM_NAME`` - From display name (defaults to "MzansiMoney")
"""
from __future__ import annotations

import logging
import os
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr
from typing import Optional

_logger = logging.getLogger("core.mailer")

_SEND_TIMEOUT = 10  # seconds - never let a slow SMTP host hang the function


def _config() -> Optional[dict]:
    """Resolve SMTP config from env, or None if email isn't configured. Email is
    considered configured only when host + user + password are all present."""
    host = os.environ.get("SMTP_HOST")
    user = os.environ.get("SMTP_USER")
    password = os.environ.get("SMTP_PASS")
    if not host or not user or not password:
        return None
    try:
        port = int(os.environ.get("SMTP_PORT") or 587)
    except (TypeError, ValueError):
        port = 587
    return {
        "host": host,
        "port": port,
        "user": user,
        "password": password,
        "from": os.environ.get("MAIL_FROM") or user,
        "from_name": os.environ.get("MAIL_FROM_NAME") or "MzansiMoney",
    }


def is_configured() -> bool:
    """Whether outbound email is set up (so callers can choose an in-app fallback)."""
    return _config() is not None


def send_email(to: str, subject: str, text_body: str, html_body: Optional[str] = None) -> bool:
    """Best-effort send. Returns True on success; False if unconfigured, no
    recipient, or on ANY error - it never raises (fail-soft)."""
    cfg = _config()
    if not cfg:
        _logger.info("Email not configured (SMTP_* unset); skipping message to %s", to or "?")
        return False
    if not to:
        return False

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = formataddr((cfg["from_name"], cfg["from"]))
    msg["To"] = to
    msg.set_content(text_body)
    if html_body:
        msg.add_alternative(html_body, subtype="html")

    try:
        if cfg["port"] == 465:
            ctx = ssl.create_default_context()
            with smtplib.SMTP_SSL(cfg["host"], cfg["port"], timeout=_SEND_TIMEOUT, context=ctx) as s:
                s.login(cfg["user"], cfg["password"])
                s.send_message(msg)
        else:
            with smtplib.SMTP(cfg["host"], cfg["port"], timeout=_SEND_TIMEOUT) as s:
                s.starttls(context=ssl.create_default_context())
                s.login(cfg["user"], cfg["password"])
                s.send_message(msg)
        _logger.info("Sent email: subject=%r", subject)
        return True
    except Exception as e:  # noqa: BLE001 - fail-soft: a notification must not break the op
        _logger.warning("Email send to %s failed: %s", to, e.__class__.__name__)
        return False
