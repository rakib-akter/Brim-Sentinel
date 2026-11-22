"""Source-grounded review: finding extracted values on the page."""
from app.services.doc_layout import Target, Tok, date_spellings, locate, money_spellings


def _words(page: int, y: float, *words: tuple[float, str]) -> list[Tok]:
    return [Tok(page, x, y, x + 6 * len(w), y + 8, w) for x, w in words]


def test_values_are_boxed_next_to_their_labels_not_elsewhere():
    toks = (_words(1, 100, (50, "Invoice"), (100, "#:"), (130, "KE26-1198"))
            + _words(1, 120, (50, "Terms:"), (100, "Net"), (130, "30"))
            + _words(1, 300, (50, "Widgets"), (300, "1"), (400, "$6,989.45"))
            + _words(1, 400, (300, "Subtotal"), (400, "$6,185.35"))
            + _words(1, 420, (300, "Total"), (340, "CAD"), (400, "$6,989.45")))
    anchors = {a["key"]: a for a in locate(toks, [
        Target("invoice_number", ["KE26-1198"], ("invoice #",)),
        Target("total", money_spellings(698945), ("total",), "last"),
        Target("subtotal", money_spellings(618535), ("subtotal",), "last"),
        Target("terms_30", ["2030"]),  # must not match "30" or anything inside a word
        Target("line:1", ["Widgets"], row="right"),
    ])}
    assert anchors["invoice_number"]["box"][0] == 130 and anchors["invoice_number"]["confidence"] is None
    assert anchors["total"]["box"][1] == 420  # the labelled total row, not the matching line amount
    assert anchors["total"]["box"][0] == 400  # the $ sign is part of the box
    assert anchors["subtotal"]["box"][1] == 400
    assert "terms_30" not in anchors
    assert anchors["line:1"]["box"][2] == 400 + 6 * len("$6,989.45")  # whole row to the amount


def test_ocr_phrase_tokens_are_sliced_and_keep_confidence():
    toks = [Tok(1, 0, 10, 190, 30, "Total CAD $1,234.56", 0.91)]
    (a,) = locate(toks, [Target("total", money_spellings(123456), ("total",), "last")])
    assert a["confidence"] == 0.91
    assert 85 < a["box"][0] < 95 and a["box"][2] == 190


def test_numbers_do_not_match_inside_other_numbers():
    toks = _words(1, 10, (0, "12345.67"))
    assert locate(toks, [Target("x", money_spellings(4567))]) == []


def test_spellings_cover_english_and_french_documents():
    assert "1,234.56" in money_spellings(123456) and "1 234,56" in money_spellings(123456)
    assert {"2026-10-19", "Oct 19, 2026", "19/10/2026", "19 octobre 2026"} <= set(date_spellings("2026-10-19"))
