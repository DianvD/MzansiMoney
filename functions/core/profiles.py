"""Parse profiles - remembering how each source's files are laid out.

The first time a file of a given *shape* is imported, the parser detects its
column mapping and we save it as a profile keyed by ``Detection.fingerprint``.
Later files of the same shape reuse the saved (and possibly user-corrected)
mapping instead of re-guessing - so the app adapts to each bank the more you feed
it, with **no bank-specific code** and **no transaction data stored** (the
fingerprint is built from column shape only).

This module is pure (no Firestore). The Firestore-facing store + the import
wiring live in ``profilestore.py`` / ``main.py``.
"""
from __future__ import annotations

from .parsers.generic import Detection

# Roles a mapping can carry. "amount" XOR ("debit"+"credit") cover the money; the
# rest are optional but improve accuracy/dedup.
ROLES = ("date", "description", "amount", "debit", "credit", "balance")

# A profile the user has explicitly approved/corrected is trusted over a freshly
# guessed one and is never silently overwritten by a re-detect.
SOURCE_AUTO = "auto"
SOURCE_CONFIRMED = "confirmed"


def profile_from_detection(det: Detection, *, label: str = "", source: str = SOURCE_AUTO) -> dict:
    """Build the persistable profile document from a detection."""
    return {
        "fingerprint": det.fingerprint,
        "mapping": {role: int(col) for role, col in det.mapping.items()},
        "headerCells": list(det.header_cells),
        "delimiter": det.delimiter,
        "ncols": det.ncols,
        "typeSignature": "".join(det.type_signature),
        "hasHeader": det.has_header,
        "confidence": det.confidence,
        "label": (label or "").strip(),
        "source": source,
    }


def with_corrected_mapping(profile: dict, mapping: dict, *, label: str | None = None) -> dict:
    """Apply a user's column correction to a profile and mark it confirmed."""
    out = {**profile, "mapping": {role: int(col) for role, col in mapping.items()},
           "source": SOURCE_CONFIRMED}
    if label is not None:
        out["label"] = label.strip()
    return out


def needs_confirmation(det: Detection, threshold: float = 0.8) -> bool:
    """Whether to ask the user to eyeball the mapping before trusting it.

    True when confidence is low (positional guesses, partial mappings) or the
    description column is missing - the most common mis-map and the one a user
    will most want to fix.
    """
    return det.confidence < threshold or "description" not in det.mapping


def is_trusted(profile: dict | None) -> bool:
    """A saved profile we can reuse without re-asking: user-confirmed, or an
    auto profile the detector was confident about."""
    if not profile or not profile.get("mapping"):
        return False
    if profile.get("source") == SOURCE_CONFIRMED:
        return True
    return float(profile.get("confidence") or 0) >= 0.8
