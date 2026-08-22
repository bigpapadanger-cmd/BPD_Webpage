"""OCR Pass 2: validate Pass 1 using the same frozen coordinate references.

This module also keeps the lightweight compatibility helpers used by preparation.
It never rediscovers scoreboard orientation or field X positions.
"""

import os
import re
import shutil

import cv2
import numpy as np
import pytesseract
from pytesseract import Output

from ocr_layout import *  # compatibility exports used by preparation
from ocr_text import (
    clean_text,
    uppercase_text,
    normalize_text,
    normalize_name_for_match,
    text_similarity,
    parse_clan_username,
)
from ocr_pass1 import crop_safe, crop_from_ref, region_has_content, read_digits

PASS2_VERSION = "pass2-v5.2-username-only"

TESSERACT_PATH = (
    os.getenv("TESSERACT_CMD")
    or shutil.which("tesseract")
    or r"C:\Program Files\Tesseract-OCR\tesseract.exe"
)
pytesseract.pytesseract.tesseract_cmd = TESSERACT_PATH


def parse_identity_text(text):
    lines = [uppercase_text(line) for line in str(text or "").splitlines() if uppercase_text(line)]
    if not lines:
        return {"clan": "", "username": "", "lines": []}
    clan, username = parse_clan_username(lines[0])
    return {
        "clan": clan,
        "username": username,
        "lines": lines,
    }


def find_identity_icon_boundary(image, search_ratio=COLUMN_PARTY_ICON_SEARCH_RATIO):
    """Compatibility helper. Returns a conservative left trim when a bright icon is obvious."""
    if image is None or image.size == 0:
        return 0
    height, width = image.shape[:2]
    search_width = max(1, int(width * float(search_ratio)))
    gray = cv2.cvtColor(image[:, :search_width], cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 80, 180)
    columns = np.count_nonzero(edges, axis=0)
    active = np.flatnonzero(columns >= max(2, int(height * 0.08)))
    if active.size == 0:
        return 0
    boundary = int(active.max() + max(2, width * IDENTITY_ICON_PADDING_RATIO))
    return min(width - 1, max(0, boundary))


def sanitize_identity_crop(image, search_ratio=COLUMN_PARTY_ICON_SEARCH_RATIO):
    if image is None or image.size == 0:
        return image
    boundary = find_identity_icon_boundary(image, search_ratio=search_ratio)
    if boundary <= 0 or boundary >= image.shape[1] * 0.45:
        return image
    cropped = image[:, boundary:]
    return cropped if cropped is not None and cropped.size else image


def preprocess_variation(image, variation, scale=3.0):
    if image is None or image.size == 0:
        return None
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image.copy()
    gray = cv2.resize(gray, None, fx=float(scale), fy=float(scale), interpolation=cv2.INTER_LANCZOS4)
    if int(variation) == 1:
        return cv2.createCLAHE(2.0, (4, 4)).apply(gray)
    clahe = cv2.createCLAHE(2.6, (4, 4)).apply(gray)
    blur = cv2.GaussianBlur(clahe, (3, 3), 0)
    _, threshold = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return threshold


def preprocess_variation_1(image, scale=3.0):
    return preprocess_variation(image, 1, scale=scale)


def preprocess_variation_2(image, scale=3.0):
    return preprocess_variation(image, 2, scale=scale)


def row_contrast_score(crop):
    if crop is None or crop.size == 0:
        return 0.0
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY) if crop.ndim == 3 else crop
    return float(np.percentile(gray, 90) - np.percentile(gray, 10))


def tesseract_text(processed, psm=6):
    if processed is None or processed.size == 0:
        return "", 0.0
    data = pytesseract.image_to_data(processed, config=f"--oem 3 --psm {int(psm)}", output_type=Output.DICT)
    texts = []
    confidences = []
    for text, confidence in zip(data.get("text", []), data.get("conf", [])):
        text = clean_text(text)
        if not text:
            continue
        texts.append(text)
        try:
            confidence = float(confidence)
        except (TypeError, ValueError):
            confidence = -1.0
        if confidence >= 0:
            confidences.append(confidence)
    return uppercase_text(" ".join(texts)), round(sum(confidences) / max(1, len(confidences)), 2) if texts else 0.0


def tesseract_username(image):
    text, confidence = tesseract_text(preprocess_variation_1(image, scale=3.0), psm=7)
    parsed = parse_identity_text(text)
    return parsed.get("username", ""), confidence, text


def is_valid_tesseract_crop(image):
    return bool(image is not None and image.size > 0 and min(image.shape[:2]) >= 3)


def tesseract_number(processed):
    candidate = read_digits(processed, "score", stage="compat", family="compat", psm=7)
    return candidate.get("value"), candidate.get("confidence", 0.0), candidate.get("raw", "")


def choose_identity_value_two(first, second):
    first_value = str(first.get("value") or "")
    second_value = str(second.get("value") or "")
    if first_value and second_value and normalize_name_for_match(first_value) == normalize_name_for_match(second_value):
        return first_value, 2, max(float(first.get("confidence", 0.0)), float(second.get("confidence", 0.0)))
    winner = max((first, second), key=lambda item: float(item.get("confidence", 0.0) or 0.0))
    return str(winner.get("value") or ""), 1 if winner.get("value") else 0, float(winner.get("confidence", 0.0) or 0.0)


def two_identity_read(username_crop):
    username_crop = sanitize_identity_crop(username_crop)
    username_reads = []
    for variation, psm in ((1, 7), (2, 7)):
        text, confidence = tesseract_text(preprocess_variation(username_crop, variation, scale=3.0), psm=psm)
        clan, username = parse_clan_username(text)
        username_reads.append({"value": username, "clan": clan, "confidence": confidence, "raw": text})
    username, support, confidence = choose_identity_value_two(username_reads[0], username_reads[1])
    clan = ""
    for read in username_reads:
        if normalize_name_for_match(read.get("value")) == normalize_name_for_match(username) and read.get("clan"):
            clan = read["clan"]
            break

    return {
        "clan": uppercase_text(clan),
        "username": uppercase_text(username),
        "username_support": int(support),
        "username_reads": username_reads,
        "username_confidence": round(confidence, 2),
    }


def _focus_numeric(crop, field_name):
    return crop


def preprocess_numeric_pass2(crop, field_name, family):
    crop = _focus_numeric(crop, field_name)
    if crop is None or crop.size == 0:
        return None
    if family == "otsu":
        gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    else:
        b, g, r = cv2.split(crop)
        gray = np.maximum(np.maximum(b, g), r).astype(np.uint8)
    scale = 5.0 if str(field_name) != "score" else 4.0
    gray = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_LANCZOS4)
    gray = cv2.createCLAHE(2.5, (4, 4)).apply(gray)
    if family == "otsu":
        _, gray = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return gray


def read_numeric_pass2(image, coordinate_ref, field_name):
    raw_crop = crop_from_ref(image, coordinate_ref)
    presence = region_has_content(raw_crop)
    candidates = []
    for family, psm in (("otsu", 7), ("channel_max", 10)):
        candidate = read_digits(
            preprocess_numeric_pass2(raw_crop, field_name, family),
            field_name,
            stage="pass2",
            family=family,
            psm=psm,
        )
        if candidate.get("value") is not None:
            presence = dict(presence)
            presence["present"] = True
            presence["confirmedByOCR"] = True
            presence["ocrValue"] = candidate.get("value")
        candidate["presence"] = presence
        candidates.append(candidate)
    return candidates, presence


def read_identity_pass2(image, row_reference):
    fields = row_reference.get("fields") or {}
    username_raw = crop_from_ref(image, fields.get("username"))
    result = two_identity_read(username_raw)
    result["stage"] = "pass2"
    return result


def detect_middle_stat(image):
    """Compatibility fallback only; canonical header detection should usually own this."""
    if image is None or image.size == 0:
        return None, "", ""
    height, width = image.shape[:2]
    # Search the broad header zone rather than a fixed screen coordinate.
    crop = image[:max(1, int(height * 0.55)), int(width * 0.48):int(width * 0.80)]
    reads = []
    for variation in (1, 2):
        text, _ = tesseract_text(preprocess_variation(crop, variation, scale=2.0), psm=6)
        reads.append(text)
    joined = " ".join(reads)
    middle = "demos" if "DEMO" in joined else ("assists" if "ASSIST" in joined else None)
    return middle, reads[0] if reads else "", reads[1] if len(reads) > 1 else ""
