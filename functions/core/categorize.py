"""Rule-based categorization.

V1 is a static keyword map tuned for South African merchants. The seam for the
roadmap (learned per-merchant overrides, then AI) is ``categorize``: give it the
merchant + description and it returns a category. Later, a user-override lookup
can run before these rules, and an AI fallback after them - without touching
callers.
"""
from __future__ import annotations

import re

from .model import CREDIT

UNCATEGORIZED = "Uncategorized"

_WS = re.compile(r"\s+")


def merchant_key(merchant: str) -> str:
    """Stable key for a merchant, used to store/look up learned category rules."""
    return _WS.sub(" ", (merchant or "").strip().lower())

# Ordered: first matching keyword wins, so put specific before generic
# (e.g. "uber eats" before "uber").
_RULES: list[tuple[str, str]] = [
    # Income
    ("salary", "Income"),
    ("salaris", "Income"),
    ("payroll", "Income"),
    ("interest received", "Income"),
    # Home loan / bond (before generic - specific account names)
    ("nedbhl", "Home Loan"),
    ("homeloan", "Home Loan"),
    ("home loan", "Home Loan"),
    ("bond repay", "Home Loan"),
    # Levies
    ("levy", "Levies"),
    ("hoa", "Levies"),
    ("body corporate", "Levies"),
    ("sectional title", "Levies"),
    # Eating out / delivery (before generic transport for "uber eats")
    ("uber eats", "Eating Out"),
    ("mr d", "Eating Out"),
    ("mrd food", "Eating Out"),
    ("kfc", "Eating Out"),
    ("nandos", "Eating Out"),
    ("mcdonald", "Eating Out"),
    ("mcd ", "Eating Out"),
    ("steers", "Eating Out"),
    ("kauai", "Eating Out"),
    ("debonairs", "Eating Out"),
    ("spur", "Eating Out"),
    ("ocean basket", "Eating Out"),
    ("vida e", "Eating Out"),
    ("seattle", "Eating Out"),
    ("fat cactus", "Eating Out"),
    ("die boer", "Eating Out"),
    ("pandas", "Eating Out"),
    ("mythos", "Eating Out"),
    ("bossa", "Eating Out"),
    ("vamos", "Eating Out"),
    ("marcel", "Eating Out"),
    ("macgregor", "Eating Out"),
    ("burger king", "Eating Out"),
    ("triggerfish", "Eating Out"),
    ("travellersrest", "Eating Out"),
    ("de oude", "Eating Out"),
    ("apache", "Eating Out"),
    ("iowa", "Eating Out"),
    # Groceries
    ("checkers", "Groceries"),
    ("woolworths", "Groceries"),
    ("pick n pay", "Groceries"),
    ("pnp", "Groceries"),
    ("shoprite", "Groceries"),
    ("spar", "Groceries"),
    ("food lover", "Groceries"),
    ("ok foods", "Groceries"),
    ("ok minimark", "Groceries"),
    ("usave", "Groceries"),
    ("boxer", "Groceries"),
    ("vleis", "Groceries"),
    ("value baking", "Groceries"),
    # Pets
    ("absolute pets", "Pets"),
    ("petshop", "Pets"),
    ("pet shop", "Pets"),
    ("animal anti", "Pets"),
    ("vet ", "Pets"),
    # Pharmacy / medical
    ("dis-chem", "Medical"),
    ("dischem", "Medical"),
    ("clicks", "Medical"),
    ("pharmacy", "Medical"),
    ("medirite", "Medical"),
    ("mediclinic", "Medical"),
    ("netcare", "Medical"),
    ("medical aid", "Medical"),
    ("discovery health", "Medical"),
    ("discovery", "Medical"),
    # Fuel
    ("shell", "Fuel"),
    ("engen", "Fuel"),
    ("sasol", "Fuel"),
    ("caltex", "Fuel"),
    ("astron", "Fuel"),
    ("bp ", "Fuel"),
    ("ithuba", "Fuel"),
    # Transport / parking
    ("uber", "Transport"),
    ("bolt", "Transport"),
    ("gautrain", "Transport"),
    ("parking", "Transport"),
    # Subscriptions
    ("netflix", "Subscriptions"),
    ("spotify", "Subscriptions"),
    ("showmax", "Subscriptions"),
    ("dstv", "Subscriptions"),
    ("youtube premium", "Subscriptions"),
    ("apple.com", "Subscriptions"),
    ("google storage", "Subscriptions"),
    ("google one", "Subscriptions"),
    ("icloud", "Subscriptions"),
    ("openai", "Subscriptions"),
    ("anthropic", "Subscriptions"),
    ("claude", "Subscriptions"),
    ("thangs", "Subscriptions"),
    # Gaming
    ("steam", "Gaming"),
    ("playstation", "Gaming"),
    ("xbox", "Gaming"),
    ("nintendo", "Gaming"),
    # Shopping
    ("takealot", "Shopping"),
    ("amazon", "Shopping"),
    ("superbalist", "Shopping"),
    ("mr price", "Shopping"),
    ("cotton on", "Shopping"),
    ("build a bear", "Shopping"),
    ("computer mania", "Shopping"),
    ("incredible connection", "Shopping"),
    ("hi-fi corp", "Shopping"),
    ("brights", "Shopping"),
    ("cape garden", "Shopping"),
    ("game ", "Shopping"),
    # Connectivity
    ("vodacom", "Airtime & Data"),
    ("mtn", "Airtime & Data"),
    ("telkom", "Airtime & Data"),
    ("cell c", "Airtime & Data"),
    ("rain", "Airtime & Data"),
    ("afrihost", "Internet"),
    ("webafrica", "Internet"),
    ("axxess", "Internet"),
    ("vumatel", "Internet"),
    ("cool ideas", "Internet"),
    ("mweb", "Internet"),
    # Insurance (kar insurance, life cover, short-term) - "insurance" is generic last
    ("kar insurance", "Insurance"),
    ("cap legacy", "Insurance"),
    ("sanlam", "Insurance"),
    ("old mutual", "Insurance"),
    ("outsurance", "Insurance"),
    ("dialdirect", "Insurance"),
    ("miway", "Insurance"),
    ("1life", "Insurance"),
    ("hollard", "Insurance"),
    ("momentum", "Insurance"),
    ("disc prem", "Insurance"),
    ("insurance", "Insurance"),
    # Investments
    ("easyequities", "Investments"),
    ("satrix", "Investments"),
    ("allan gray", "Investments"),
    ("coronation", "Investments"),
    ("sygnia", "Investments"),
    ("ninety one", "Investments"),
    # ATM & cash
    ("atm cash", "ATM & Cash"),
    ("cash withdrawal", "ATM & Cash"),
    # Bank fees
    ("monthly fee", "Bank Fees"),
    ("service fee", "Bank Fees"),
    ("admin fee", "Bank Fees"),
    ("bank charge", "Bank Fees"),
    ("saswitch", "Bank Fees"),
    ("unpaid item", "Bank Fees"),
    ("digital statement", "Bank Fees"),
    # Utilities
    ("eskom", "Utilities"),
    ("municipal", "Utilities"),
    ("prepaid electricity", "Utilities"),
    ("city of cape town", "Utilities"),
    ("city of cpt", "Utilities"),
]


def categorize(
    merchant: str,
    description: str = "",
    direction: str = "",
    learned: dict[str, str] | None = None,
) -> str:
    """Return a category for a transaction, or ``Uncategorized``.

    ``learned`` (merchant_key -> category) is consulted FIRST, so a user's past
    override wins over the static rules - this is how categorization "learns over
    time". ``direction`` lets a credit that looks like pay land in Income even
    when the narrative is terse.
    """
    if learned:
        hit = learned.get(merchant_key(merchant))
        if hit:
            return hit
    haystack = f"{merchant} {description}".lower()
    for keyword, category in _RULES:
        if keyword in haystack:
            return category
    if direction == CREDIT and ("salary" in haystack or "pay" in haystack):
        return "Income"
    return UNCATEGORIZED


# Home-loan lines are their own small vocabulary; the cash rules above would
# mislabel them (e.g. INTEREST/ADMIN FEE -> Bank Fees), so the home-loan import
# path categorizes with this instead. These categories also drive the monthly
# breakdown on the Home Loan page.
_HOME_LOAN_RULES: list[tuple[str, str]] = [
    ("interest", "Home Loan Interest"),
    ("insurance", "Home Loan Insurance"),
    ("admin", "Home Loan Fees"),
    ("fee", "Home Loan Fees"),
    ("service", "Home Loan Fees"),
    ("payment", "Home Loan Payment"),
    ("transfer", "Home Loan Transfer"),
    ("withdrawal", "Home Loan Transfer"),
]


def home_loan_category(description: str) -> str:
    """Categorize a single home-loan statement line by its description."""
    text = (description or "").lower()
    for keyword, category in _HOME_LOAN_RULES:
        if keyword in text:
            return category
    return "Home Loan"
