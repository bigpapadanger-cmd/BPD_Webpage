"""Shared OCR/text normalization helpers.

Kept separate from OCR engines so identity, preparation, Tesseract, and Paddle
use identical normalization without importing one another's heavy modules.
"""

import re
from difflib import SequenceMatcher

TEXT_VERSION = "text-v1.0-shared"


def clean_text(value):
    return re.sub(r"\s+", " ", str(value or "")).strip()


def uppercase_text(value):
    return clean_text(value).upper()


def normalize_text(value):
    return re.sub(r"[^a-z0-9]", "", clean_text(value).lower())


def normalize_name_for_match(value):
    value = uppercase_text(value)
    value = re.sub(
        r"^\s*\[[^\]\[]+[\]\[]\s*",
        "",
        value,
    )
    return re.sub(r"[^A-Z0-9]", "", value)


def text_similarity(first, second):
    first_normalized = normalize_text(first)
    second_normalized = normalize_text(second)
    if not first_normalized and not second_normalized:
        return 1.0
    if not first_normalized or not second_normalized:
        return 0.0
    return SequenceMatcher(
        None,
        first_normalized,
        second_normalized,
    ).ratio()


def name_similarity(first, second):
    first_normalized = normalize_name_for_match(first)
    second_normalized = normalize_name_for_match(second)
    if not first_normalized or not second_normalized:
        return 0.0
    if first_normalized == second_normalized:
        return 1.0
    return SequenceMatcher(
        None,
        first_normalized,
        second_normalized,
    ).ratio()



def best_expected_score(value, expected_names):
    """Return the strongest normalized username similarity in [0.0, 1.0]."""
    if not expected_names:
        return 0.0

    return max(
        (
            name_similarity(
                value,
                expected_name,
            )
            for expected_name in expected_names
        ),
        default=0.0,
    )


def parse_clan_username(value):
    value = uppercase_text(value)
    clan = ""
    username = value
    match = re.search(
        r"\[([A-Z0-9_-]{1,8})\]\s*(.+)",
        value,
    )
    if match:
        clan = uppercase_text(match.group(1))
        username = uppercase_text(match.group(2))
    return clan, username
