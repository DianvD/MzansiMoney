"""PDF text extraction.

Thin wrapper over pypdf that also reports encryption state - several real bank
statements are password-protected, and we must surface that cleanly (ask the user
for the password) rather than importing empty/garbage text.
"""
from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO
from typing import Optional

from pypdf import PdfReader


@dataclass
class ExtractedPdf:
    text: str
    pages: int
    encrypted: bool
    needs_password: bool
    producer: Optional[str]


# Cap pages we extract - guards against decompression-bomb / pathological PDFs
# making the function spin. Real statements/invoices are well under this.
_MAX_PAGES = 50


def extract_text(data: bytes, password: Optional[str] = None) -> ExtractedPdf:
    try:
        reader = PdfReader(BytesIO(data))
    except Exception:
        # Unreadable/corrupt PDF - caller treats empty text as "unknown".
        return ExtractedPdf(text="", pages=0, encrypted=False, needs_password=False, producer=None)

    encrypted = bool(reader.is_encrypted)
    needs_password = False

    if encrypted:
        try:
            if reader.decrypt(password or "") == 0:
                needs_password = True
        except Exception:
            needs_password = True

    text = ""
    if not needs_password:
        try:
            for page in reader.pages[:_MAX_PAGES]:
                text += (page.extract_text() or "") + "\n"
        except Exception:
            # Decryption looked fine but content is still locked.
            needs_password = encrypted

    try:
        meta = reader.metadata or {}
    except Exception:
        meta = {}
    try:
        pages = len(reader.pages)
    except Exception:
        pages = 0

    return ExtractedPdf(
        text=text.strip(),
        pages=pages,
        encrypted=encrypted,
        needs_password=needs_password,
        producer=meta.get("/Producer"),
    )


def extract_words(data: bytes, password: Optional[str] = None) -> list[list[dict]]:
    """Per-page word boxes for table reconstruction (statement line items).

    Returns ``[page][word]`` where each word is ``{text, x0, x1, top, bottom}``.
    Default pypdf ``extract_text`` returns draw-order text that scrambles table
    columns; word coordinates let us rebuild the columns spatially (see
    ``core/pdftable.py``).

    Returns ``[]`` when the PDF is image-only/scanned (no extractable text layer),
    locked, or unreadable - the caller treats that as "can't parse, fall back".
    """
    try:
        import pdfplumber
    except Exception:
        return []
    try:
        with pdfplumber.open(BytesIO(data), password=password or "") as pdf:
            out: list[list[dict]] = []
            for page in pdf.pages[:_MAX_PAGES]:
                words = page.extract_words(use_text_flow=False, keep_blank_chars=False, x_tolerance=1.5)
                out.append([
                    {"text": w["text"], "x0": float(w["x0"]), "x1": float(w["x1"]),
                     "top": float(w["top"]), "bottom": float(w["bottom"])}
                    for w in words
                ])
            return out
    except Exception:
        return []
