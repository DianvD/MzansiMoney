"""Nedbank CSV parser.

Demonstrates the per-institution pattern: it's a thin subclass of the generic
parser with header hints tuned to Nedbank's export. As we get real Nedbank files
we tighten this - but until then the generic mapping already handles it, and the
class exists so the registry and the rest of the app reference a stable name.
"""
from __future__ import annotations

from .generic import GenericCsvParser


class NedbankParser(GenericCsvParser):
    institution = "Nedbank"
    extra_hints = {
        "description": ["description", "transaction description", "narrative"],
        "amount": ["amount"],
        "balance": ["balance"],
    }
