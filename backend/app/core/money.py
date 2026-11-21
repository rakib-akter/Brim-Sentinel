"""Money helpers. All money is integer minor units (cents) + explicit currency.
Decimal is used for intermediate tax/FX math; ROUND_HALF_UP at currency boundaries.
No binary floats are used for any payment, threshold, tax or approval decision."""
from __future__ import annotations

import re
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

CENT = Decimal("0.01")

# Approval/release thresholds in CAD minor units (PRD §4A).
CAD_10K = 10_000_00
CAD_50K = 50_000_00
CAD_100K = 100_000_00
CAD_250K = 250_000_00
CAD_500K = 500_000_00


def to_minor(value: Decimal | str | int) -> int:
    d = Decimal(str(value)) if not isinstance(value, Decimal) else value
    return int((d.quantize(CENT, rounding=ROUND_HALF_UP) * 100).to_integral_value(rounding=ROUND_HALF_UP))


def from_minor(minor: int) -> Decimal:
    return (Decimal(minor) / 100).quantize(CENT)


def fmt(minor: int | None, currency: str = "CAD") -> str:
    if minor is None:
        return "unknown"
    sign = "-" if minor < 0 else ""
    return f"{sign}{currency} {abs(from_minor(minor)):,.2f}"


_WS = re.compile(r"[\s   ]")


def parse_money(raw: str) -> Decimal | None:
    """Parse '$1,488.34', '-$1,042.76', '1 014,18 $', '(12.00)'. Returns None if ambiguous."""
    if raw is None:
        return None
    s = _WS.sub("", raw).replace("$", "").replace("CAD", "").replace("USD", "")
    neg = False
    if s.startswith("(") and s.endswith(")"):
        neg, s = True, s[1:-1]
    if s.startswith("-"):
        neg, s = True, s[1:]
    if not s:
        return None
    if re.fullmatch(r"\d{1,3}(,\d{3})*(\.\d{1,2})?|\d+(\.\d{1,2})?", s):
        s = s.replace(",", "")
    elif re.fullmatch(r"\d{1,3}(\.\d{3})*(,\d{1,2})?|\d+(,\d{1,2})?", s):
        # French/European: '.' or space thousands, ',' decimal
        s = s.replace(".", "").replace(",", ".")
    else:
        return None
    try:
        d = Decimal(s)
    except InvalidOperation:
        return None
    return -d if neg else d


def convert_to_cad_minor(amount_minor: int, rate: Decimal) -> int:
    return to_minor(from_minor(amount_minor) * rate)
