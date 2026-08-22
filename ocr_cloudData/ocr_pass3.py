"""OCR Pass 3: targeted A/B recovery on unresolved coordinate references only."""

import re
import time

import cv2
import numpy as np
import pytesseract
from pytesseract import Output

from ocr_identity import normalize_expected_names, team_constrained_name_assignment
from ocr_layout import NUMBER_LIMITS, REPORT_FIELDS, INFORMATIONAL_FIELDS
from ocr_pass1 import crop_from_ref, region_has_content, read_digits
from ocr_pass2 import sanitize_identity_crop
from ocr_text import uppercase_text, normalize_name_for_match, parse_clan_username
from ocr_field_state import add_candidate, evaluate_field_state, is_locked, lock_field, new_field_state
from zero_seven import evaluate_zero_seven, ZERO_SEVEN_VERSION

PASS3_VERSION = "pass3-v15.3-score-context-weighted"

FUZZY_LOW_CONFIDENCE = 70.0
FUZZY_AMBIGUOUS_MARGIN = 7.0
FUZZY_STRONG_MATCH = 85.0
MATCHCONFIDENCE = 86.0
MATCHMARGIN = 25.0

PASS3A_SWEEP_SPECS = (
    {
        "label": "adaptive_left",
        "expandX": 0.0,
        "expandY": 0.0,
        "shiftX": -0.025,
        "shiftY": 0.0,
    },
    {
        "label": "adaptive_center",
        "expandX": 0.0,
        "expandY": 0.0,
        "shiftX": 0.0,
        "shiftY": 0.0,
    },
    {
        "label": "adaptive_right",
        "expandX": 0.0,
        "expandY": 0.0,
        "shiftX": 0.025,
        "shiftY": 0.0,
    },
)

PASS3B_SWEEP_SPECS = (
    {
        "label": "exact_otsu",
        "expandX": 0.0,
        "expandY": 0.16,
        "shiftX": 0.0,
        "shiftY": 0.0,
    },
    {
        "label": "exact_channel",
        "expandX": 0.0,
        "expandY": 0.16,
        "shiftX": 0.0,
        "shiftY": 0.0,
    },
    {
        "label": "wide_left",
        "expandX": 0.05,
        "expandY": 0.16,
        "shiftX": -0.025,
        "shiftY": 0.0,
    },
    {
        "label": "wide_right",
        "expandX": 0.05,
        "expandY": 0.16,
        "shiftX": 0.025,
        "shiftY": 0.0,
    },
    {
        "label": "wide_adaptive",
        "expandX": 0.06,
        "expandY": 0.16,
        "shiftX": 0.0,
        "shiftY": 0.0,
    },
)

STAT_TYPICAL_LIMITS = {
    "score": 1500,
    "goals": 8,
    "assists": 8,
    "demos": 12,
    "saves": 10,
    "shots": 15,
}

SCORE_CONTEXT_FIELDS = (
    "goals",
    "assists",
    "demos",
    "saves",
    "shots",
)
SCORE_CONTEXT_MIN_CONFIDENCE = 65.0
SCORE_CONTEXT_STRONG_CONFLICT_CONFIDENCE = 80.0


def apply_expected_name_matching(players, expected_player_names, players_per_team):
    expected_names = normalize_expected_names(expected_player_names)
    result = {
        "enabled": bool(expected_names),
        "expectedNames": expected_names,
        "lowConfidenceThreshold": FUZZY_LOW_CONFIDENCE,
        "ambiguousMarginThreshold": FUZZY_AMBIGUOUS_MARGIN,
        "strongMatchThreshold": FUZZY_STRONG_MATCH,
        "lowConfidenceCount": 0,
        "ambiguousCount": 0,
        "multipleLowConfidenceMatches": False,
        "hasLowConfidenceMatches": False,
        "hasAmbiguousMatches": False,
        "needsReview": False,
        "allMatched": False,
        "allConfident": False,
        "allUnique": False,
        "strictPass": False,
        "matches": [],
    }
    for player in players:
        for key in ("clan", "username"):
            player[key] = uppercase_text(player.get(key, ""))
    if not expected_names:
        result["needsReview"] = True
        return result

    assignments, score_matrix = team_constrained_name_assignment(players, expected_names, players_per_team)
    for row_index, player in enumerate(players):
        assigned = assignments[row_index] if row_index < len(assignments) else None
        team_index = int(player.get("teamIndex", 0) or 0)
        start = 0 if team_index == 1 else int(players_per_team)
        stop = min(len(expected_names), start + int(players_per_team))
        allowed = list(range(start, stop))
        ranked = sorted(
            [
                {"name": expected_names[i], "confidence": round(float(score_matrix[row_index][i]), 2)}
                for i in allowed
            ],
            key=lambda item: item["confidence"],
            reverse=True,
        )
        if assigned is None:
            matched = ""
            confidence = 0.0
            second_best = ranked[0]["confidence"] if ranked else 0.0
        else:
            matched = expected_names[assigned]
            confidence = float(score_matrix[row_index][assigned])
            alternatives = [float(score_matrix[row_index][i]) for i in allowed if i != assigned]
            second_best = max(alternatives, default=0.0)
        margin = confidence - second_best
        low = confidence < FUZZY_LOW_CONFIDENCE
        ambiguous = confidence < FUZZY_STRONG_MATCH and margin < FUZZY_AMBIGUOUS_MARGIN
        status = "MATCHED"
        if low and ambiguous:
            status = "LOW_CONFIDENCE_AMBIGUOUS"
        elif low:
            status = "LOW_CONFIDENCE"
        elif ambiguous:
            status = "AMBIGUOUS"
        player.update({
            "matchedName": str(matched or ""),
            "matchConfidence": round(confidence, 2),
            "matchMargin": round(margin, 2),
            "matchStatus": status,
            "matchCandidates": ranked,
        })
        result["matches"].append({
            "team": player.get("team"),
            "teamPlayerIndex": player.get("teamPlayerIndex"),
            "ocrUsername": player.get("username"),
            "clan": player.get("clan"),
            "matchedName": str(matched or ""),
            "confidence": round(confidence, 2),
            "secondBestConfidence": round(second_best, 2),
            "margin": round(margin, 2),
            "status": status,
            "candidates": ranked,
        })
        result["lowConfidenceCount"] += int(low)
        result["ambiguousCount"] += int(ambiguous)

    result["hasLowConfidenceMatches"] = result["lowConfidenceCount"] > 0
    result["multipleLowConfidenceMatches"] = result["lowConfidenceCount"] >= 2
    result["hasAmbiguousMatches"] = result["ambiguousCount"] > 0
    matched_names = [str(p.get("matchedName") or "") for p in players]
    result["allMatched"] = len(players) == len(expected_names) and all(matched_names)
    result["allConfident"] = result["allMatched"] and all(p.get("matchStatus") == "MATCHED" for p in players)
    result["allUnique"] = result["allMatched"] and len(set(matched_names)) == len(expected_names) and set(matched_names) == set(expected_names)
    result["needsReview"] = result["hasLowConfidenceMatches"] or result["hasAmbiguousMatches"] or not result["allUnique"]
    result["strictPass"] = result["enabled"] and result["allMatched"] and result["allConfident"] and result["allUnique"] and not result["needsReview"]
    return result


def _focus(crop, field_name):
    return crop


def _process(crop, mode, scale=7.0):
    if crop is None or crop.size == 0:
        return None
    if mode == "channel":
        b, g, r = cv2.split(crop)
        gray = np.maximum(np.maximum(b, g), r).astype(np.uint8)
    else:
        gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    gray = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_LANCZOS4)
    gray = cv2.createCLAHE(2.8, (4, 4)).apply(gray)
    if mode == "otsu":
        blur = cv2.GaussianBlur(gray, (3, 3), 0)
        _, gray = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    elif mode == "adaptive":
        gray = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 3)
    elif mode == "sharpen":
        blur = cv2.GaussianBlur(gray, (0, 0), 0.7)
        gray = cv2.addWeighted(gray, 1.55, blur, -0.55, 0)
    return gray


def read_numeric_pass3a(image, coordinate_ref, field_name):
    """Small targeted sweep. No broad recrop or orientation search."""
    candidates = []
    for spec in PASS3A_SWEEP_SPECS:
        crop = _focus(
            crop_from_ref(
                image,
                coordinate_ref,
                expand_x=spec["expandX"],
                expand_y=spec["expandY"],
                shift_x=spec["shiftX"],
                shift_y=spec["shiftY"],
            ),
            field_name,
        )
        processed = _process(crop, "adaptive", scale=6.0)
        candidate = read_digits(
            processed,
            field_name,
            stage="pass3a",
            family=spec["label"],
            psm=10,
        )
        candidate["sweepExpandX"] = spec["expandX"]
        candidate["sweepExpandY"] = spec["expandY"]
        candidate["sweepShiftX"] = spec["shiftX"]
        candidate["sweepShiftY"] = spec["shiftY"]
        candidates.append(candidate)
    return candidates


def read_numeric_pass3b(image, coordinate_ref, field_name):
    """Deeper sweep used only if Pass 3A cannot lock the field."""
    candidates = []
    mode_by_label = {
        "exact_otsu": ("otsu", 7),
        "exact_channel": ("channel", 10),
        "wide_left": ("sharpen", 7),
        "wide_right": ("sharpen", 7),
        "wide_adaptive": ("adaptive", 13),
    }
    for spec in PASS3B_SWEEP_SPECS:
        mode, psm = mode_by_label[spec["label"]]
        crop = crop_from_ref(
            image,
            coordinate_ref,
            expand_x=spec["expandX"],
            expand_y=spec["expandY"],
            shift_x=spec["shiftX"],
            shift_y=spec["shiftY"],
        )
        crop = _focus(crop, field_name)
        candidate = read_digits(
            _process(crop, mode, scale=8.0),
            field_name,
            stage="pass3b",
            family=spec["label"],
            psm=psm,
        )
        candidate["sweepExpandX"] = spec["expandX"]
        candidate["sweepExpandY"] = spec["expandY"]
        candidate["sweepShiftX"] = spec["shiftX"]
        candidate["sweepShiftY"] = spec["shiftY"]
        candidates.append(candidate)
    return candidates


def _zero_seven_preprocess(crop, mode):
    if crop is None or crop.size == 0:
        return None, None
    h, w = crop.shape[:2]
    # Centralize one-glyph stat cells but keep enough margin for Rocket League's
    # slanted zero/seven font.
    x1 = int(w * 0.14)
    x2 = max(x1 + 1, int(w * 0.86))
    y1 = int(h * 0.02)
    y2 = max(y1 + 1, int(h * 0.98))
    focused = crop[y1:y2, x1:x2]
    processed = _process(focused, mode if mode in {"otsu", "channel"} else "sharpen", scale=9.0)
    return processed, {"x1": x1, "y1": y1, "x2": x2, "y2": y2, "mode": mode}


def apply_zero_seven_specialist(image, coordinate_ref, field_state):
    if not isinstance(field_state, dict) or is_locked(field_state):
        return None
    value = field_state.get("value")
    summary_values = {item.get("value") for item in (field_state.get("candidate_summary") or [])}
    if value not in {0, 7} and not ({0, 7} & summary_values):
        return None
    crop = crop_from_ref(image, coordinate_ref, expand_x=0.03, expand_y=0.10)
    verdict = evaluate_zero_seven(field_state, crop, _zero_seven_preprocess)
    field_state["zero_seven_version"] = ZERO_SEVEN_VERSION
    field_state["zero_seven_check_used"] = bool(verdict.get("used"))
    field_state["zero_seven_verdict"] = verdict
    if not verdict.get("used"):
        return verdict

    specialist_candidate = verdict.get("candidate") if verdict.get("candidate") in {0, 7} else None
    specialist_confidence = float(verdict.get("confidence", 0.0) or 0.0)
    fallback_used = not bool(verdict.get("resolved"))
    if fallback_used:
        # Reaching this point means Passes 1/2/3 could not safely separate 0
        # from 7.  Prefer the conservative zero, retain the evidence, and pass
        # the player with an explicit advisory rather than failing the report.
        specialist_candidate = 0
        specialist_confidence = max(55.0, min(79.0, specialist_confidence))

    field_name = str(field_state.get("field") or "field")
    warning = (
        f"{field_name}_zero_seven_defaulted_to_zero"
        if fallback_used
        else f"{field_name}_zero_seven_specialist_resolved"
    )
    reason = (
        "zero_seven_default_zero_advisory"
        if fallback_used
        else "zero_seven_specialist_authoritative"
    )
    add_candidate(field_state, {
        "stage": "pass3b",
        "engine": "zero_seven_specialist",
        "family": "topology",
        "value": int(specialist_candidate),
        "confidence": specialist_confidence,
        "raw": str(specialist_candidate),
        "plausible": True,
        "authoritative": True,
        "fallback": bool(fallback_used),
    })
    evaluate_field_state(field_state, "pass3b")
    field_state["value"] = int(specialist_candidate)
    field_state["locked"] = False
    field_state["conflicting_values"] = bool(
        len({
            int(item.get("value"))
            for item in (field_state.get("candidates") or [])
            if isinstance(item, dict) and item.get("value") is not None
        }) > 1
    )
    field_state["zero_seven_resolution"] = {
        "value": int(specialist_candidate),
        "fallback": bool(fallback_used),
        "warning": warning,
    }
    warnings = field_state.setdefault("advisory_warnings", [])
    if warning not in warnings:
        warnings.append(warning)
    lock_field(field_state, "pass3b", specialist_confidence, reason)
    verdict["finalCandidate"] = int(specialist_candidate)
    verdict["fallbackUsed"] = bool(fallback_used)
    verdict["advisoryWarning"] = warning
    return verdict


def _read_text_variant(crop, mode, psm):
    if crop is None or crop.size == 0:
        return {"text": "", "confidence": 0.0}
    processed = _process(crop, mode, scale=4.0)
    data = pytesseract.image_to_data(processed, config=f"--oem 3 --psm {int(psm)}", output_type=Output.DICT)
    texts = []
    confidences = []
    for text, confidence in zip(data.get("text", []), data.get("conf", [])):
        text = str(text or "").strip()
        if not text:
            continue
        texts.append(text)
        try:
            confidence = float(confidence)
        except (TypeError, ValueError):
            confidence = -1.0
        if confidence >= 0:
            confidences.append(confidence)
    return {
        "text": uppercase_text(" ".join(texts)),
        "confidence": round(sum(confidences) / max(1, len(confidences)), 2) if texts else 0.0,
    }


def deepen_identity(image, row_reference, identity_result):
    fields = row_reference.get("fields") or {}
    username_ref = fields.get("username") or {}
    raw = crop_from_ref(image, username_ref, expand_x=0.02, expand_y=0.08)
    raw = sanitize_identity_crop(raw)
    reads = []
    for mode, psm in (("otsu", 7), ("channel", 7), ("sharpen", 6)):
        read = _read_text_variant(raw, mode, psm)
        clan, username = parse_clan_username(read.get("text", ""))
        reads.append({"stage": "pass3", "mode": mode, "username": username, "clan": clan, "confidence": read.get("confidence", 0.0)})
    identity_result.setdefault("reads", []).extend(reads)
    usable = [r for r in reads if normalize_name_for_match(r.get("username"))]
    if usable:
        best = max(usable, key=lambda r: float(r.get("confidence", 0.0) or 0.0))
        current_support = int(identity_result.get("username_support", 0) or 0)
        current_name = normalize_name_for_match(identity_result.get("username"))
        agreement = sum(1 for r in usable if normalize_name_for_match(r.get("username")) == normalize_name_for_match(best.get("username")))
        if agreement >= 2 or not current_name:
            identity_result["username"] = uppercase_text(best.get("username", ""))
            if best.get("clan"):
                identity_result["clan"] = uppercase_text(best.get("clan"))
            identity_result["username_support"] = max(current_support, agreement)
    return identity_result


def numeric_field_confidence(field_result):
    return round(float((field_result or {}).get("chosen_confidence", 0.0) or 0.0), 2)


def _candidate_supports_value(field_state, wanted_value):
    candidates = [
        item
        for item in (field_state.get("candidates") or [])
        if isinstance(item, dict)
        and item.get("value") is not None
        and int(item.get("value")) == int(wanted_value)
        and item.get("plausible", True) is not False
    ]
    stages = {
        str(item.get("stage") or "unknown")
        for item in candidates
    }
    best_confidence = max(
        (
            float(item.get("confidence", 0.0) or 0.0)
            for item in candidates
        ),
        default=0.0
    )
    return {
        "count": len(candidates),
        "independentStages": len(stages),
        "bestConfidence": best_confidence,
    }


def apply_zero_score_context(number_results):
    """Use a well-supported zero score as a conservative stat prior.

    In a standard Rocket League scoreboard, goals, assists, saves and shots all
    award score.  A confirmed score of zero therefore supports zero for those
    fields.  This may resolve an unread/weak field, but it never silently
    replaces two strong agreeing OCR stages; that case remains a reviewable
    conflict.
    """
    warnings = []
    if not isinstance(number_results, dict):
        return warnings

    score_state = number_results.get("score") or {}
    if score_state.get("value") is None:
        return warnings
    try:
        score_value = int(score_state.get("value"))
    except (TypeError, ValueError):
        return warnings
    if score_value != 0:
        return warnings

    score_confidence = float(
        score_state.get("chosen_confidence", 0.0)
        or 0.0
    )
    score_support = _candidate_supports_value(
        score_state,
        0
    )
    score_confirmed = bool(
        (
            is_locked(score_state)
            and (
                score_support["independentStages"] >= 2
                or score_confidence >= 80.0
            )
        )
        or (
            score_support["independentStages"] >= 2
            and score_confidence >= SCORE_CONTEXT_MIN_CONFIDENCE
        )
    )
    if not score_confirmed:
        return warnings

    context_confidence = max(
        SCORE_CONTEXT_MIN_CONFIDENCE,
        min(89.0, score_confidence - 4.0)
    )

    for field_name in SCORE_CONTEXT_FIELDS:
        field_state = number_results.get(field_name)
        if not isinstance(field_state, dict):
            continue

        current_value = field_state.get("value")
        current_confidence = float(
            field_state.get("chosen_confidence", 0.0)
            or 0.0
        )
        current_support = _candidate_supports_value(
            field_state,
            current_value
            if current_value is not None
            else -1
        )
        strong_nonzero_conflict = bool(
            current_value is not None
            and int(current_value) != 0
            and current_support["independentStages"] >= 2
            and current_confidence
            >= SCORE_CONTEXT_STRONG_CONFLICT_CONFIDENCE
            and not field_state.get("conflicting_values")
        )

        advisory = field_state.setdefault(
            "advisory_warnings",
            []
        )
        if (
            current_value is not None
            and int(current_value) == 0
            and is_locked(field_state)
            and not field_state.get("review_required")
        ):
            field_state["score_context_support"] = {
                "score": 0,
                "action": "supported_existing_zero",
            }
            continue

        if strong_nonzero_conflict:
            warning = f"{field_name}_zero_score_conflict_needs_review"
            if warning not in advisory:
                advisory.append(warning)
            warnings.append(warning)
            field_state["review_required"] = True
            field_state["resolved_pass"] = False
            field_state["status"] = "zero_score_stat_conflict"
            field_state["score_context_resolution"] = {
                "score": 0,
                "originalValue": int(current_value),
                "action": "kept_strong_nonzero_for_review",
                "warning": warning,
            }
            continue

        original_value = (
            None
            if current_value is None
            else int(current_value)
        )
        zero_support = _candidate_supports_value(
            field_state,
            0
        )
        candidate_confidence = max(
            context_confidence,
            min(89.0, zero_support["bestConfidence"])
        )
        add_candidate(field_state, {
            "stage": "final",
            "engine": "score_context",
            "family": "confirmed_zero_score",
            "value": 0,
            "confidence": candidate_confidence,
            "raw": "0",
            "plausible": True,
            "authoritative": True,
            "contextual": True,
        })
        field_state["value"] = 0
        field_state["conflicting_values"] = bool(
            original_value not in (None, 0)
        )
        warning = (
            f"{field_name}_zero_score_context_overrode_weak_nonzero"
            if original_value not in (None, 0)
            else f"{field_name}_zero_score_context_confirmed"
        )
        if warning not in advisory:
            advisory.append(warning)
        warnings.append(warning)
        field_state["score_context_resolution"] = {
            "score": 0,
            "originalValue": original_value,
            "value": 0,
            "action": (
                "overrode_weak_nonzero"
                if original_value not in (None, 0)
                else "confirmed_zero"
            ),
            "warning": warning,
        }
        lock_field(
            field_state,
            "final",
            candidate_confidence,
            "confirmed_zero_score_context"
        )

    return list(dict.fromkeys(warnings))


def finalize_unresolved_numeric_defaults(number_results):
    warnings = apply_zero_score_context(
        number_results
    )
    for field_name, state in (number_results or {}).items():
        if state.get("value") is None:
            if field_name in INFORMATIONAL_FIELDS:
                state.update({
                    "value": None,
                    "status": "ping_unresolved_informational",
                    "review_required": False,
                    "resolved_pass": True,
                })
            else:
                state.update({
                    "value": 0,
                    "defaulted_to_zero": True,
                    "status": "unresolved_default_zero",
                    "review_required": True,
                    "resolved_pass": False,
                })
                warnings.append(f"{field_name}_unresolved_defaulted_to_zero")
    return warnings


def evaluate_stat_plausibility(number_results, middle_stat_name):
    warnings = []
    review_fields = []
    for field_name, state in (number_results or {}).items():
        if field_name in INFORMATIONAL_FIELDS:
            if state.get("value") is None:
                warnings.append("ping_unresolved_informational")
            continue
        if state.get("review_required"):
            review_fields.append(field_name)
        value = state.get("value")
        if value is None:
            continue
        typical = STAT_TYPICAL_LIMITS.get(field_name)
        if typical is not None and int(value) > typical:
            warnings.append(f"{field_name}_above_typical:{int(value)}")
    goals = (number_results.get("goals") or {}).get("value")
    shots = (number_results.get("shots") or {}).get("value")
    if goals is not None and shots is not None and int(goals) > int(shots) + 1:
        warnings.append("goals_exceed_shots_needs_verification")
        review_fields.extend(["goals", "shots"])
    return {"warnings": list(dict.fromkeys(warnings)), "review_fields": sorted(set(review_fields))}


def build_player_validation(player_index, player, row_anchor, row_reference, identity_result, number_results, timing=None, paddle_result=None):
    stat_plausibility = evaluate_stat_plausibility(number_results, "assists" if "assists" in number_results else "demos")
    advisory_warnings = list(dict.fromkeys(
        warning
        for state in number_results.values()
        for warning in (state.get("advisory_warnings") or [])
    ))
    stat_warnings = list(dict.fromkeys(stat_plausibility["warnings"] + advisory_warnings))
    number_review_fields = sorted(set(
        [name for name, state in number_results.items() if name not in INFORMATIONAL_FIELDS and state.get("review_required")]
        + stat_plausibility["review_fields"]
    ))
    username_present = bool(
        normalize_name_for_match(
            player.get("username")
        )
    )

    username_support = int(
        identity_result.get(
            "username_support",
            0
        )
        or 0
    )

    strong_unique_roster_match = (
        str(
            player.get(
                "matchStatus",
                ""
            )
            or ""
        ).upper() == "MATCHED"
        and float(
            player.get(
                "matchConfidence",
                0.0
            )
            or 0.0
        ) >= MATCHCONFIDENCE
        and float(
            player.get(
                "matchMargin",
                0.0
            )
            or 0.0
        ) >= MATCHMARGIN
    )

    identity_confirmed = (
        username_support >= 2
        or strong_unique_roster_match
    )

    identity_review = not identity_confirmed

    review_reasons = []
    if identity_review:
        review_reasons.append("username_not_confirmed")
    if number_review_fields:
        review_reasons.append("numeric_fields_need_review:" + ",".join(number_review_fields))
    resolved_pass = username_present and not number_review_fields
    paddle_result = paddle_result if isinstance(paddle_result, dict) else {}
    return {
        "player_index": int(player_index),
        "team": player.get("team"),
        "team_player_index": player.get("teamPlayerIndex"),
        "timing": dict(timing or {}),
        "anchor": {
            "type": row_anchor.get("type"),
            "confidence": row_anchor.get("confidence"),
            "centerY": row_anchor.get("center_y"),
            "numberCenterY": row_reference.get("numberCenterY"),
            "centerSource": row_reference.get("centerSource"),
            "rowSpacing": row_anchor.get("row_spacing"),
            "orientation": row_anchor.get("orientation"),
            "pingRegion": row_anchor.get("ping_region"),
            "statRegion": row_anchor.get("stat_region"),
        },
        "two_check_review": {
            "pass": not review_reasons,
            "needs_review": bool(review_reasons),
            "review_reasons": review_reasons,
            "username_support": username_support,
            "username_confirmed": identity_confirmed,
            "username_confirmed_by": (
                "ocr_agreement"
                if username_support >= 2
                else (
                    "strong_unique_roster_match"
                    if strong_unique_roster_match
                    else None
                )
            ),
            "strong_unique_roster_match": strong_unique_roster_match,
            "numeric_review_fields": number_review_fields,
            "stat_warnings": stat_warnings,
            "needs_paddle_ocr": bool(paddle_result.get("requested_fields")),
            "paddle_applied": bool(paddle_result.get("applied")),
            "paddle_resolved_fields": list(paddle_result.get("resolved_fields") or []),
            "paddle_requested_fields": list(paddle_result.get("requested_fields") or []),
            "low_digit_approved_fields": [
                name for name, state in number_results.items()
                if state.get("zero_seven_resolution")
            ],
            "field_evidence": {name: state for name, state in number_results.items()},
            "field_confidence": {name: numeric_field_confidence(state) for name, state in number_results.items()},
            "field_status": {name: state.get("status") for name, state in number_results.items()},
        },
        "resolved": {
            "pass": bool(resolved_pass),
            "description": "All report fields are locked and a username was detected.",
        },
        "overall": "validated" if resolved_pass and not review_reasons else "review",
        "row": {
            "numberBand": dict(row_reference.get("numberBand") or {}),
            "numberCenterY": row_reference.get("numberCenterY"),
            "centerSource": row_reference.get("centerSource"),
            "coordinateRef": dict(row_reference.get("fields") or {}),
        },
    }


def parse_player_row(*args, **kwargs):
    """Legacy guard. The v16 orchestrator runs stages scoreboard-wide, not row-by-row."""
    raise RuntimeError(
        "parse_player_row is no longer the production path. Use ocr.read_scoreboard_image; "
        "v16 runs Pass 1/2/3 scoreboard-wide against frozen coordinate references."
    )
