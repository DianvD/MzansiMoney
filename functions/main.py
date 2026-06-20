"""MzansiMoney Cloud Functions entry point.

``import_csv`` is the dashboard CSV path. It runs every import through the same
duplicate-safe spine the future Gmail/PDF paths will reuse:

    parse -> prepare (fingerprint + integrity) -> document-ledger dedup -> write

so the same statement can never inflate the numbers, whatever channel it arrives
through.
"""
from __future__ import annotations

import base64
import binascii
import os
import uuid
from datetime import datetime

from firebase_admin import firestore, initialize_app
from firebase_functions import https_fn, options

from core.bills import classified_to_bill
from core.categorize import categorize, merchant_key
from core.classify import classify
from core.cryptobox import get_statement_password, store_statement_password
from core.documents import DUPLICATE, NEEDS_REVIEW, DocumentLedger
from core.identity import (
    account_id,
    content_sha256,
    extract_account_number,
    logical_key,
)
from core.ingest import prepare_transactions
from core.model import CREDIT, DEBIT, RawTxn, normalize
from core.parsers import get_parser, list_institutions
from core.parsers.generic import GenericCsvParser
from core import pdftable
from core.pdf import extract_text, extract_words
from core.profiles import (
    is_trusted,
    needs_confirmation,
    profile_from_detection,
    with_corrected_mapping,
)
from core.profilestore import ProfileStore
from core import recovery
from core.storage import store_original

initialize_app()

# Cloud Functions region - the ONE place to change it. Override per deployment with
# the FUNCTIONS_REGION env var (set it in functions/.env); defaults to africa-south1.
# Must match the web client's VITE_FUNCTIONS_REGION (see web/src/firebase.ts).
_REGION = os.environ.get("FUNCTIONS_REGION", "africa-south1")

_BATCH_LIMIT = 400  # Firestore caps a write batch at 500.


@https_fn.on_call(
    region=_REGION,
    memory=options.MemoryOption.GB_1,  # full-history CSVs can be tens of thousands of rows
    timeout_sec=540,
    cors=options.CorsOptions(cors_origins="*", cors_methods=["GET", "POST"]),
)
def import_csv(req: https_fn.CallableRequest) -> dict:
    if req.auth is None:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            "You must be signed in to import transactions.",
        )
    uid = req.auth.uid
    data = req.data or {}

    csv_text = data.get("csvText")
    if not isinstance(csv_text, str) or not csv_text.strip():
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            "csvText is required and must be a non-empty string.",
        )

    institution = (data.get("institution") or "generic").strip().lower()
    source_document = (data.get("sourceDocument") or "manual-upload.csv").strip()
    gmail_message_id = data.get("gmailMessageId")  # set by the future Gmail path
    force = bool(data.get("force"))  # user override for needs_review
    # Adaptive parse-profile controls (see the profiles block below).
    preview_only = bool(data.get("previewOnly"))  # detect + return how we'd read it, write nothing
    confirm = bool(data.get("confirm"))  # client resolved the column-mapping question, go ahead
    profile_label = (data.get("profileLabel") or "").strip()
    profile_mapping = data.get("profileMapping") or None  # explicit role->col override (a fix)
    if profile_mapping:
        profile_mapping = {
            role: int(col)
            for role, col in profile_mapping.items()
            if col is not None and str(col) != ""
        }

    parser = get_parser(institution)
    # Home-loan imports default to a clearly-labelled account so the bond isn't
    # silently bucketed as "Default" alongside cash.
    default_account = "Home Loan" if parser.account_type == "home_loan" else "Default"
    account = (data.get("account") or default_account).strip() or default_account
    # Account identity is the account number, not the typed label - so the same
    # account dedups however it's labelled. Client may pass it; else recover it
    # from the statement body or filename (Nedbank: Statement_<number>_...csv).
    account_number = (data.get("accountNumber") or "").strip() or extract_account_number(
        source_document, csv_text
    )

    db = firestore.client()

    # ---- adaptive parse profiles ------------------------------------------
    # Remember how each bank's export is laid out - keyed by column *shape*, never
    # by transaction values - so we parse it the same way every time instead of
    # re-guessing, and so a mis-detected column can be fixed once and stick. Applies
    # to the generic/column-mapping family (cash CSVs); the home-loan parser keeps
    # its own fixed positional logic and opts out.
    learned_profile = None
    profile_state = None  # "reused" | "learned" | "corrected"
    if isinstance(parser, GenericCsvParser):
        detection = parser.detect(csv_text)
        store = ProfileStore(db, uid)
        existing = store.get(detection.fingerprint)

        if preview_only:
            return _profile_preview(parser, csv_text, detection, existing, profile_mapping)

        if profile_mapping:
            prof = with_corrected_mapping(
                profile_from_detection(detection),
                profile_mapping,
                label=profile_label or (existing or {}).get("label", ""),
            )
            store.save(prof)
            learned_profile, profile_state = prof, "corrected"
            raw_txns = parser.parse_with_profile(csv_text, prof)
        elif is_trusted(existing):
            store.touch(detection.fingerprint)
            learned_profile, profile_state = existing, "reused"
            raw_txns = parser.parse_with_profile(csv_text, existing)
        else:
            # Unknown shape we're unsure about - ask the user to eyeball the columns
            # before trusting the guess (accuracy/no-duplicates is the prime
            # directive). `force` is the dedup/needs_review override, NOT a column
            # bypass - only an explicit `confirm` skips this gate.
            if needs_confirmation(detection) and not confirm:
                return _profile_preview(parser, csv_text, detection, existing, None)
            prof = profile_from_detection(detection, label=profile_label, source="auto")
            store.save(prof)
            learned_profile, profile_state = prof, "learned"
            raw_txns = parser.parse(csv_text)
    else:
        # Non-generic parsers (home loan) have a fixed layout - nothing to learn or
        # confirm, so a preview just says "go ahead".
        if preview_only:
            return {"status": "preview", "imported": 0, "autoOk": True,
                    "fingerprint": "", "confidence": 1.0, "known": False,
                    "columns": [], "mapping": {}, "sample": []}
        raw_txns = parser.parse(csv_text)

    if not raw_txns:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            "No transactions could be parsed from this file. Check the format or "
            f"pick a specific institution. Known: {', '.join(list_institutions())}.",
        )

    content_hash = content_sha256(csv_text.encode("utf-8"))
    ledger = DocumentLedger(db, uid)

    prep = prepare_transactions(
        raw_txns,
        institution=parser.institution,
        account=account,
        source_document=source_document,
        document_id=content_hash,
        learned=_load_rules(db, uid),
        account_type=parser.account_type,
        account_number=account_number,
    )

    lkey = logical_key(
        institution=parser.institution,
        account=account,
        period_start=prep.period_start,
        period_end=prep.period_end,
        doc_type="bank_statement",
    )

    base_meta = {
        "source": "gmail" if gmail_message_id else "dashboard",
        "gmailMessageId": gmail_message_id,
        "filename": source_document,
        "institution": parser.institution,
        "account": account,
        "docType": "bank_statement",
        "logicalKey": lkey,
        "periodStart": _ts(prep.period_start),
        "periodEnd": _ts(prep.period_end),
        "rowsParsed": prep.rows_parsed,
        "integrityOk": prep.integrity_ok,
        "integrityDetail": prep.integrity_detail,
        "createdAt": firestore.SERVER_TIMESTAMP,
    }

    decision = ledger.check(
        content_hash=content_hash,
        gmail_message_id=gmail_message_id,
        institution=parser.institution,
        logical_key=lkey,
    )

    if decision.decision == DUPLICATE:
        if decision.existing_id:
            ledger.record_duplicate_attempt(decision.existing_id)
        return {
            "status": "duplicate",
            "reason": decision.reason,
            "imported": 0,
            "existingId": decision.existing_id,
        }

    if decision.decision == NEEDS_REVIEW and not force:
        ledger.register(content_hash, {**base_meta, "status": "needs_review", "reason": decision.reason})
        return {
            "status": "needs_review",
            "reason": decision.reason,
            "imported": 0,
            "existingId": decision.existing_id,
        }

    # Mark the document 'importing' BEFORE writing, so a mid-write failure leaves
    # a recoverable state (writes are idempotent by fingerprint, so a retry is
    # safe) rather than a committed-but-unrecorded import.
    ledger.register(content_hash, {**base_meta, "status": "importing"})

    # ---- write transactions (idempotent: doc id = fingerprint) -------------
    written = _write_transactions(db, uid, prep.transactions)

    ledger.register(
        content_hash,
        {
            **base_meta,
            "status": "imported",
            "transactionsWritten": written,
            "duplicatesInFile": prep.duplicates_in_file,
        },
    )

    return {
        "status": "imported",
        "institution": parser.institution,
        "imported": written,
        "duplicatesInFile": prep.duplicates_in_file,
        "integrityOk": prep.integrity_ok,
        "integrityDetail": prep.integrity_detail,
        "profile": _profile_summary(learned_profile, profile_state),
    }


@https_fn.on_call(
    region=_REGION,
    memory=options.MemoryOption.MB_512,
    cors=options.CorsOptions(cors_origins="*", cors_methods=["GET", "POST"]),
)
def import_document(req: https_fn.CallableRequest) -> dict:
    """Import a PDF document (invoice / statement) via the same dedup spine.

    Invoices become Bills; statements are recorded without double-counting;
    encrypted PDFs ask for a password (your bank statement password is your
    account number - it is passed per-request and never stored)."""
    if req.auth is None:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.UNAUTHENTICATED, "You must be signed in."
        )
    uid = req.auth.uid
    data = req.data or {}

    b64 = data.get("pdfBase64")
    if not isinstance(b64, str) or not b64.strip():
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT, "pdfBase64 is required."
        )
    try:
        # Tolerate whitespace/newlines some clients insert into base64.
        pdf_bytes = base64.b64decode("".join(b64.split()))
    except (binascii.Error, ValueError):
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT, "pdfBase64 is not valid base64."
        )
    if len(pdf_bytes) > 15 * 1024 * 1024:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT, "File too large (15 MB max)."
        )

    filename = (data.get("filename") or "document.pdf").strip()
    password = data.get("password") or None
    force = bool(data.get("force"))
    account = (data.get("account") or "").strip() or None
    account_number = (data.get("accountNumber") or "").strip() or None
    preview_only = bool(data.get("previewOnly"))
    confirm = bool(data.get("confirm"))
    profile_label = (data.get("profileLabel") or "").strip()
    profile_mapping = data.get("profileMapping") or None
    if profile_mapping:
        profile_mapping = {r: int(c) for r, c in profile_mapping.items() if c is not None and str(c) != ""}

    return _process_pdf(
        firestore.client(), uid, pdf_bytes,
        filename=filename, password=password, force=force, source="dashboard",
        account=account, account_number=account_number,
        preview_only=preview_only, confirm=confirm,
        profile_mapping=profile_mapping, profile_label=profile_label,
    )


def _process_pdf(db, uid, pdf_bytes, *, filename, password=None, force=False,
                 source="dashboard", gmail_message_id=None, account=None, account_number=None,
                 preview_only=False, confirm=False, profile_mapping=None, profile_label="") -> dict:
    """Shared PDF ingest: classify -> dedup -> bill/statement/record. Used by both
    the dashboard callable and the email-intake endpoint."""
    content_hash = content_sha256(pdf_bytes)
    ledger = DocumentLedger(db, uid)

    extracted = extract_text(pdf_bytes, password=password)
    effective_pw = password
    # Auto-unlock with the saved statement password (your account number) when the
    # caller didn't supply one - this is what makes emailed encrypted statements
    # open by themselves.
    if extracted.needs_password and not password:
        saved = get_statement_password(db, uid)
        if saved:
            extracted = extract_text(pdf_bytes, password=saved)
            effective_pw = saved
    if extracted.needs_password:
        ledger.register(content_hash, {
            "filename": filename, "status": "needs_password", "docType": "encrypted",
            "source": source, "gmailMessageId": gmail_message_id,
            "createdAt": firestore.SERVER_TIMESTAMP,
        })
        return {"status": "needs_password",
                "reason": "This PDF is password-protected. Provide the password "
                          "(for bank statements this is usually your account number)."}

    classified = classify(extracted.text, filename)
    period_start = classified.period_start or classified.issue_date
    period_end = classified.period_end or classified.issue_date
    lkey = logical_key(
        institution=classified.institution, account=classified.account,
        period_start=period_start, period_end=period_end, doc_type=classified.doc_type,
    )

    base_meta = {
        "source": source, "gmailMessageId": gmail_message_id, "filename": filename,
        "institution": classified.institution, "docType": classified.doc_type,
        "docNumber": classified.doc_number, "account": classified.account,
        "total": classified.total, "logicalKey": lkey,
        "issueDate": _ts(classified.issue_date), "dueDate": _ts(classified.due_date),
        "createdAt": firestore.SERVER_TIMESTAMP,
    }

    # Explicit "how would you read this statement?" - return the reconstructed
    # columns for the user to confirm/fix, writing nothing (no storage, no ledger).
    if preview_only:
        if classified.is_bill:
            return {"status": "preview", "autoOk": True, "imported": 0,
                    "columns": [], "mapping": {}, "sample": []}
        parser = GenericCsvParser()
        rows = pdftable.reconstruct_rows(extract_words(pdf_bytes, password=effective_pw))
        roles = pdftable.resolve_roles(rows, parser, None) if rows else None
        if not roles:
            return {"status": "preview", "autoOk": True, "imported": 0,
                    "columns": [], "mapping": {}, "sample": [], "reason": "no_table"}
        fp = parser.fingerprint_from_rows(rows)
        return _statement_preview(rows, roles, parser, fp, ProfileStore(db, uid).get(fp))

    decision = ledger.check(
        content_hash=content_hash, gmail_message_id=gmail_message_id,
        doc_number=classified.doc_number, institution=classified.institution, logical_key=lkey,
    )
    if decision.decision == DUPLICATE:
        if decision.existing_id:
            ledger.record_duplicate_attempt(decision.existing_id)
        return {"status": "duplicate", "reason": decision.reason, "existingId": decision.existing_id}
    if decision.decision == NEEDS_REVIEW and not force:
        ledger.register(content_hash, {**base_meta, "status": "needs_review", "reason": decision.reason})
        return {"status": "needs_review", "reason": decision.reason, "existingId": decision.existing_id}

    storage_path = store_original(uid, content_hash, pdf_bytes)

    # Foreign-currency invoices (e.g. a USD Anthropic invoice) are NOT minted as a
    # ZAR bill - that would mis-state the total. The real charge lands on the bank
    # statement in rands; here we just record the document with a note for context.
    if classified.is_bill and classified.currency != "ZAR":
        amt = (f"{classified.currency} {classified.total:.2f}"
               if classified.total is not None else f"{classified.currency} (amount unread)")
        note = (f"Foreign-currency invoice ({amt}) from {classified.institution}. Recorded for "
                "reference - the actual charge appears on your bank statement in rands.")
        ledger.register(content_hash, {**base_meta, "status": "recorded", "kind": "foreign_invoice",
            "storagePath": storage_path, "currency": classified.currency, "note": note, "reason": note})
        return {"status": "recorded", "kind": "foreign_invoice", "institution": classified.institution,
                "currency": classified.currency, "amount": classified.total, "reason": note}

    if classified.is_bill:
        if classified.total is None:
            ledger.register(content_hash, {**base_meta, "status": "needs_review",
                "storagePath": storage_path, "reason": "Could not read the amount due from this invoice."})
            return {"status": "needs_review", "reason": "Could not read the amount due from this invoice.",
                    "institution": classified.institution}
        bill_id, bill = classified_to_bill(classified, document_id=content_hash, source_document=filename)
        db.collection("users").document(uid).collection("bills").document(bill_id).set(
            {**bill, "createdAt": firestore.SERVER_TIMESTAMP})
        ledger.register(content_hash, {**base_meta, "status": "imported",
            "kind": "bill", "billId": bill_id, "storagePath": storage_path})
        return {"status": "imported", "kind": "bill", "institution": classified.institution,
                "docType": classified.doc_type, "amount": classified.total, "docNumber": classified.doc_number}

    # Statement: reconstruct the transaction table and import line items through the
    # SAME dedup spine + learn/confirm flow as CSV. See docs/PDF_STATEMENTS.md.
    parser = GenericCsvParser()
    words = extract_words(pdf_bytes, password=effective_pw)
    rows = pdftable.reconstruct_rows(words)
    roles = pdftable.resolve_roles(rows, parser, None) if rows else None

    if not roles:
        scanned = not any(words)  # pages exist but carry no extractable text layer
        reason = ("This statement looks scanned (no text layer). Upload a CSV, or a "
                  "text-based PDF, to import the transactions.") if scanned else (
                  "Couldn't confidently read the transaction table from this PDF. "
                  "Upload a CSV/Excel export for now.")
        ledger.register(content_hash, {**base_meta, "status": "recorded", "storagePath": storage_path,
            "kind": "statement_unparsed", "reason": reason})
        return {"status": "recorded", "docType": classified.doc_type,
                "institution": classified.institution, "reason": reason}

    # Reuse, confirm, or learn the column layout (per-issuer PDF profile).
    fingerprint = parser.fingerprint_from_rows(rows)
    store = ProfileStore(db, uid)
    existing = store.get(fingerprint)
    override = None
    learned_profile = None
    profile_state = None
    if profile_mapping:
        override = profile_mapping
        learned_profile = {"fingerprint": fingerprint, "kind": "pdf", "source": "confirmed",
                           "confidence": 1.0, "label": profile_label or (existing or {}).get("label", ""),
                           "mapping": {k: int(v) for k, v in profile_mapping.items() if v is not None}}
        store.save(learned_profile)
        profile_state = "corrected"
    elif is_trusted(existing):
        override = existing.get("mapping")
        store.touch(fingerprint)
        learned_profile, profile_state = existing, "reused"
    else:
        confident = (roles.get("balance") is not None and roles.get("description") is not None
                     and len(rows) >= 5)
        if not confident and not confirm:
            # Only the interactive (dashboard) path can show a confirm UI. An
            # auto-imported (Gmail) statement we're unsure about is recorded for
            # review - never guessed, never silently dropped.
            if source == "dashboard":
                return _statement_preview(rows, roles, parser, fingerprint, existing)
            reason = ("Statement received but its columns were uncertain - open it in "
                      "the app to confirm and import.")
            ledger.register(content_hash, {**base_meta, "status": "recorded", "storagePath": storage_path,
                "kind": "statement_unparsed", "reason": reason})
            return {"status": "recorded", "docType": classified.doc_type,
                    "institution": classified.institution, "reason": reason}
        learned_profile = {"fingerprint": fingerprint, "kind": "pdf", "source": "auto",
                           "confidence": 0.9 if confident else 0.6, "label": profile_label,
                           "mapping": {k: roles[k] for k in ("date", "description", "balance")
                                       if roles.get(k) is not None}}
        store.save(learned_profile)
        profile_state = "learned"

    eff_roles = pdftable.resolve_roles(rows, parser, override)
    raw_txns = pdftable.txns_from_rows(rows, parser, eff_roles) if eff_roles else []
    if not raw_txns:
        reason = "Couldn't read the transactions from this statement. Upload a CSV/Excel export."
        ledger.register(content_hash, {**base_meta, "status": "recorded", "storagePath": storage_path,
            "kind": "statement_unparsed", "reason": reason})
        return {"status": "recorded", "docType": classified.doc_type,
                "institution": classified.institution, "reason": reason}

    acct_label = (account or classified.account or "Statement").strip() or "Statement"
    acct_number = account_number or extract_account_number(filename, extracted.text)
    institution = classified.institution or "Statement"

    prep = prepare_transactions(
        raw_txns, institution=institution, account=acct_label,
        source_document=filename, document_id=content_hash,
        learned=_load_rules(db, uid), account_type="cash", account_number=acct_number,
    )

    ledger.register(content_hash, {**base_meta, "status": "importing", "storagePath": storage_path,
        "kind": "statement_txns", "rowsParsed": prep.rows_parsed, "integrityOk": prep.integrity_ok,
        "integrityDetail": prep.integrity_detail})

    written = _write_transactions(db, uid, prep.transactions)

    ledger.register(content_hash, {**base_meta, "status": "imported", "storagePath": storage_path,
        "kind": "statement_txns", "transactionsWritten": written, "duplicatesInFile": prep.duplicates_in_file})

    return {"status": "imported", "kind": "statement_txns", "institution": institution,
            "imported": written, "integrityOk": prep.integrity_ok,
            "integrityDetail": prep.integrity_detail, "duplicatesInFile": prep.duplicates_in_file,
            "profile": _profile_summary(learned_profile, profile_state)}


@https_fn.on_request(region=_REGION, memory=options.MemoryOption.MB_512)
def ingest_email(req: https_fn.Request):
    """Email auto-import endpoint, called by the Gmail Apps Script. Gated by a
    shared secret; writes under the configured owner uid via the same PDF
    pipeline. Bills (invoices) import automatically; encrypted statements are
    flagged for a password."""
    import json

    if req.method != "POST":
        return https_fn.Response("POST only", status=405)
    secret = os.environ.get("GMAIL_INTAKE_SECRET")
    owner = os.environ.get("GMAIL_OWNER_UID")
    if not secret or not owner:
        return https_fn.Response("not configured", status=503)

    body = req.get_json(silent=True) or {}
    if body.get("secret") != secret:
        return https_fn.Response("forbidden", status=403)

    b64 = body.get("pdfBase64")
    if not isinstance(b64, str) or not b64.strip():
        return https_fn.Response("pdfBase64 required", status=400)
    try:
        pdf_bytes = base64.b64decode("".join(b64.split()))
    except (binascii.Error, ValueError):
        return https_fn.Response("bad base64", status=400)
    if len(pdf_bytes) > 15 * 1024 * 1024:
        return https_fn.Response("file too large", status=400)

    result = _process_pdf(
        firestore.client(), owner, pdf_bytes,
        filename=(body.get("filename") or "email.pdf"),
        source="gmail", gmail_message_id=body.get("gmailMessageId"),
    )
    return https_fn.Response(json.dumps(result), status=200, content_type="application/json")


@https_fn.on_call(
    region=_REGION,
    memory=options.MemoryOption.MB_256,
    cors=options.CorsOptions(cors_origins="*", cors_methods=["GET", "POST"]),
)
def add_transaction(req: https_fn.CallableRequest) -> dict:
    """Add a single transaction by hand.

    Manual entries are user-asserted truth, so they get a unique id (they are not
    deduplicated against each other - two deliberate identical entries both
    stand). The client disables the form while pending to avoid accidental
    double-submits."""
    if req.auth is None:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.UNAUTHENTICATED, "You must be signed in."
        )
    uid = req.auth.uid
    data = req.data or {}

    def bad(msg: str):
        return https_fn.HttpsError(https_fn.FunctionsErrorCode.INVALID_ARGUMENT, msg)

    date_str = (data.get("date") or "").strip()
    try:
        when = datetime.strptime(date_str, "%Y-%m-%d")
    except (ValueError, TypeError):
        raise bad("date must be YYYY-MM-DD.")

    description = (data.get("description") or "").strip()
    if not description:
        raise bad("description is required.")

    try:
        amount = float(data.get("amount"))
    except (TypeError, ValueError):
        raise bad("amount must be a number.")
    if not amount > 0:  # also rejects NaN
        raise bad("amount must be greater than zero.")
    amount = round(amount, 2)

    direction = (data.get("direction") or DEBIT).strip().lower()
    if direction not in (DEBIT, CREDIT):
        raise bad("direction must be 'debit' or 'credit'.")

    account = (data.get("account") or "Default").strip() or "Default"
    category_override = (data.get("category") or "").strip()

    db = firestore.client()
    raw = RawTxn(date=when, description=description, amount=amount, direction=direction)
    doc = normalize(raw, account=account, institution="Manual",
                    source_document="manual-entry", job_id="manual")
    doc["accountId"] = account_id("Manual", account)
    doc["documentId"] = "manual"
    doc["balanceAfter"] = None
    doc["fingerprintScheme"] = "manual"
    doc["category"] = category_override or categorize(
        doc["merchant"], description, direction, _load_rules(db, uid)
    )
    doc["source"] = "manual"
    txn_id = f"manual:{uuid.uuid4().hex}"
    doc["hash"] = txn_id
    doc["createdAt"] = firestore.SERVER_TIMESTAMP

    db.collection("users").document(uid).collection("transactions").document(txn_id).set(doc)
    return {"status": "added", "id": txn_id, "category": doc["category"], "amount": amount}


@https_fn.on_call(
    region=_REGION,
    memory=options.MemoryOption.MB_256,
    cors=options.CorsOptions(cors_origins="*", cors_methods=["GET", "POST"]),
)
def set_category(req: https_fn.CallableRequest) -> dict:
    """Override a transaction's category. Optionally learn the rule so future
    imports (and all existing transactions) from the same merchant use it."""
    if req.auth is None:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.UNAUTHENTICATED, "You must be signed in."
        )
    uid = req.auth.uid
    data = req.data or {}

    txn_id = (data.get("transactionId") or "").strip()
    category = (data.get("category") or "").strip()
    apply_to_merchant = bool(data.get("applyToMerchant"))
    if not txn_id or not category:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            "transactionId and category are required.",
        )

    db = firestore.client()
    txns = db.collection("users").document(uid).collection("transactions")
    snap = txns.document(txn_id).get()
    if not snap.exists:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.NOT_FOUND, "Transaction not found."
        )

    txns.document(txn_id).set({"category": category}, merge=True)
    updated = 1

    if apply_to_merchant:
        merchant = (snap.to_dict() or {}).get("merchant", "")
        key = merchant_key(merchant)
        if key:
            # Persist the learned rule for future imports.
            db.collection("users").document(uid).collection("categoryRules").document(key).set(
                {"merchant": merchant, "category": category, "updatedAt": firestore.SERVER_TIMESTAMP}
            )
            # Re-apply to all existing transactions from the same merchant.
            from google.cloud.firestore_v1.base_query import FieldFilter

            matches = txns.where(filter=FieldFilter("merchant", "==", merchant)).get()
            batch = db.batch()
            n = 0
            for ref in matches:
                batch.set(ref.reference, {"category": category}, merge=True)
                n += 1
                if n % 400 == 0:
                    batch.commit()
                    batch = db.batch()
            batch.commit()
            updated = n or 1

    return {"status": "ok", "updated": updated, "learned": apply_to_merchant}


@https_fn.on_call(
    region=_REGION,
    memory=options.MemoryOption.MB_256,
    cors=options.CorsOptions(cors_origins="*", cors_methods=["GET", "POST"]),
)
def delete_transaction(req: https_fn.CallableRequest) -> dict:
    """Delete a transaction (e.g. to correct a manual-entry mistake). Imported
    transactions can be re-added by re-importing - deletion is a manual edit, not
    a permanent suppression."""
    if req.auth is None:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.UNAUTHENTICATED, "You must be signed in."
        )
    txn_id = (req.data or {}).get("transactionId", "").strip()
    if not txn_id:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT, "transactionId is required."
        )
    db = firestore.client()
    db.collection("users").document(req.auth.uid).collection("transactions").document(txn_id).delete()
    return {"status": "deleted", "id": txn_id}


@https_fn.on_call(
    region=_REGION,
    memory=options.MemoryOption.MB_256,
    cors=options.CorsOptions(cors_origins="*", cors_methods=["GET", "POST"]),
)
def set_statement_password(req: https_fn.CallableRequest) -> dict:
    """Save (AES-encrypted) the password used to open your encrypted bank-statement
    PDFs - typically your account number. Stored server-side only; used to
    auto-unlock statements on import."""
    if req.auth is None:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.UNAUTHENTICATED, "You must be signed in."
        )
    password = ((req.data or {}).get("password") or "").strip()
    if not password:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INVALID_ARGUMENT, "password is required."
        )
    try:
        store_statement_password(firestore.client(), req.auth.uid, password)
    except RuntimeError as e:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.FAILED_PRECONDITION, str(e))
    return {"status": "saved"}


@https_fn.on_call(
    region=_REGION,
    memory=options.MemoryOption.MB_512,
    cors=options.CorsOptions(cors_origins="*", cors_methods=["GET", "POST"]),
)
def revert_import(req: https_fn.CallableRequest) -> dict:
    """Undo one import: remove exactly the transactions it wrote and mark the
    ledger entry reverted (so the file can be cleanly re-imported). Dry-run first;
    the commit needs the confirmation token from the dry-run. See docs/RECOVERY.md."""
    if req.auth is None:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.UNAUTHENTICATED, "You must be signed in.")
    data = req.data or {}
    document_id = (data.get("documentId") or "").strip()
    if not document_id:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.INVALID_ARGUMENT, "documentId is required.")
    try:
        return recovery.revert_import(
            firestore.client(), req.auth.uid,
            document_id=document_id,
            dry_run=bool(data.get("dryRun", True)),
            confirm_token=data.get("confirmToken"),
            reason=(data.get("reason") or "").strip(),
            revert_bills=bool(data.get("revertBills", True)),
        )
    except ValueError as e:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.INVALID_ARGUMENT, str(e))
    except LookupError as e:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.NOT_FOUND, str(e))
    except PermissionError as e:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.FAILED_PRECONDITION, str(e))


@https_fn.on_call(
    region=_REGION,
    memory=options.MemoryOption.MB_512,
    cors=options.CorsOptions(cors_origins="*", cors_methods=["GET", "POST"]),
)
def export_ledger(req: https_fn.CallableRequest) -> dict:
    """Back up the backend-owned ledger (transactions, bills, documents,
    categoryRules) to a JSON snapshot in Storage, with a manifest in Firestore."""
    if req.auth is None:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.UNAUTHENTICATED, "You must be signed in.")
    try:
        return recovery.export_ledger(firestore.client(), req.auth.uid,
                                      reason=((req.data or {}).get("reason") or "manual"))
    except RuntimeError as e:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.FAILED_PRECONDITION, str(e))


@https_fn.on_call(
    region=_REGION,
    memory=options.MemoryOption.MB_512,
    cors=options.CorsOptions(cors_origins="*", cors_methods=["GET", "POST"]),
)
def audit_integrity(req: https_fn.CallableRequest) -> dict:
    """Read-only health report: per-import claimed-vs-live counts (skew detection)
    and stuck imports. Surfaces silent corruption early."""
    if req.auth is None:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.UNAUTHENTICATED, "You must be signed in.")
    return recovery.audit_integrity(firestore.client(), req.auth.uid)


def _sample_rows(txns) -> list[dict]:
    """First few parsed rows for a column-confirm preview (shared by CSV + PDF)."""
    return [
        {"date": t.date.date().isoformat(), "description": t.description,
         "amount": t.amount if t.direction == CREDIT else -t.amount, "balance": t.balance}
        for t in txns[:6]
    ]


def _profile_preview(parser, csv_text: str, detection, existing, override_mapping) -> dict:
    """Return how we'd read this file - column names, the role->column mapping, and
    a few sample parsed rows - so the client can confirm or fix the columns before
    anything is written. Nothing is saved here."""
    mapping = override_mapping or (existing or {}).get("mapping") or detection.mapping
    mapping = {role: int(col) for role, col in mapping.items()}
    if detection.has_header and detection.header_cells:
        columns = list(detection.header_cells)
    else:
        columns = [f"Column {i + 1}" for i in range(detection.ncols)]
    preview_profile = {**profile_from_detection(detection), "mapping": mapping}
    sample = _sample_rows(parser.parse_with_profile(csv_text, preview_profile))
    return {
        "status": "preview",
        "imported": 0,
        "fingerprint": detection.fingerprint,
        "hasHeader": detection.has_header,
        "confidence": detection.confidence,
        "known": bool(existing),
        "label": (existing or {}).get("label", ""),
        "columns": columns,
        "ncols": detection.ncols,
        "mapping": mapping,
        "sample": sample,
        # The client can skip the confirm UI when we already trust the layout.
        "autoOk": is_trusted(existing) or not needs_confirmation(detection),
    }


def _statement_preview(rows, roles, parser, fingerprint, existing) -> dict:
    """Preview a PDF statement's reconstructed table for the column-confirm UI, in
    the SAME shape as the CSV preview so the client reuses the same component. The
    user confirms/fixes date / description / balance; amounts are the rest."""
    columns = pdftable.column_labels(rows)
    mapping = {"date": roles["date"]}
    if roles.get("description") is not None:
        mapping["description"] = roles["description"]
    if roles.get("balance") is not None:
        mapping["balance"] = roles["balance"]
    if roles.get("amount_cols"):
        mapping["amount"] = roles["amount_cols"][0]
    sample = _sample_rows(pdftable.txns_from_rows(rows, parser, roles))
    return {"status": "preview", "kind": "statement", "imported": 0,
            "fingerprint": fingerprint, "hasHeader": False,
            "confidence": 1.0 if roles.get("balance") is not None else 0.5,
            "known": bool(existing), "label": (existing or {}).get("label", ""),
            "columns": columns, "ncols": len(columns), "mapping": mapping, "sample": sample,
            "autoOk": is_trusted(existing) or roles.get("balance") is not None}


def _profile_summary(profile, state) -> dict | None:
    """Compact profile info attached to a successful import, so the UI can say
    'learned / reused this layout' and offer a fix."""
    if not profile:
        return None
    return {
        "state": state,
        "fingerprint": profile.get("fingerprint"),
        "mapping": profile.get("mapping"),
        "confidence": profile.get("confidence"),
        "source": profile.get("source"),
        "label": profile.get("label"),
        "hasHeader": profile.get("hasHeader"),
    }


def _write_transactions(db, uid: str, prepared) -> int:
    """Write prepared transactions in idempotent, batch-limited commits (doc id =
    fingerprint, so a re-import overwrites identical rows instead of duplicating).
    Shared by the CSV and PDF-statement import paths."""
    txns_ref = db.collection("users").document(uid).collection("transactions")
    written = 0
    for start in range(0, len(prepared), _BATCH_LIMIT):
        batch = db.batch()
        for prep_txn in prepared[start : start + _BATCH_LIMIT]:
            batch.set(txns_ref.document(prep_txn.fingerprint),
                      {**prep_txn.doc, "createdAt": firestore.SERVER_TIMESTAMP})
            written += 1
        batch.commit()
    return written


def _load_rules(db, uid: str) -> dict:
    """Load the user's learned merchant->category rules (merchant_key -> category)."""
    try:
        col = db.collection("users").document(uid).collection("categoryRules")
        return {d.id: (d.to_dict() or {}).get("category") for d in col.stream()
                if (d.to_dict() or {}).get("category")}
    except Exception:
        return {}


def _ts(d):
    """date -> datetime for Firestore (Firestore has no bare-date type)."""
    if d is None:
        return None
    return datetime(d.year, d.month, d.day)
