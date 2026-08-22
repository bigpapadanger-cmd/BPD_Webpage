import cv2
import numpy as np
import re
import pytesseract
from pytesseract import Output

from ocr_utils import safe_float, safe_int
ZERO_SEVEN_VERSION = "zero-seven-v3.1-zero-preferred-topology"
ZERO_SEVEN_VALUES = {0, 7}
ZERO_SEVEN_RESOLVE_CONFIDENCE = 80.0
ZERO_SEVEN_CHALLENGE_CONFIDENCE = 74.0






def _read_zero_seven(processed, psm, mode):
    result = {
        "value": None,
        "confidence": 0.0,
        "raw": "",
        "psm": int(psm),
        "mode": str(mode)
    }
    if processed is None or processed.size == 0:
        return result
    config = (
        "--oem 3 "
        f"--psm {int(psm)} "
        "-c tessedit_char_whitelist=07"
    )
    data = pytesseract.image_to_data(
        processed,
        config=config,
        output_type=Output.DICT
    )
    digit_tokens = []
    confidences = []
    for raw_text, confidence in zip(
        data.get("text", []),
        data.get("conf", [])
    ):
        cleaned = re.sub(
            r"[^07]",
            "",
            str(raw_text or "")
        )
        if not cleaned:
            continue
        digit_tokens.append(cleaned)
        confidence_value = safe_float(
            confidence,
            -1.0
        )
        if confidence_value >= 0:
            confidences.append(confidence_value)
    raw_digits = "".join(digit_tokens)
    if len(raw_digits) != 1:
        return result
    result["value"] = int(raw_digits)
    result["raw"] = raw_digits
    result["confidence"] = round(
        sum(confidences) / len(confidences)
        if confidences
        else 0.0,
        2
    )
    return result


def _count_holes(binary):
    contours, hierarchy = cv2.findContours(
        binary,
        cv2.RETR_CCOMP,
        cv2.CHAIN_APPROX_SIMPLE
    )
    if hierarchy is None or not contours:
        return 0
    hierarchy = hierarchy[0]
    glyph_area = max(
        1,
        int(binary.shape[0] * binary.shape[1])
    )
    hole_count = 0
    for index, contour in enumerate(contours):
        if int(hierarchy[index][3]) < 0:
            continue
        area = float(cv2.contourArea(contour))
        if (
            area >= glyph_area * 0.010
            and area <= glyph_area * 0.40
        ):
            hole_count += 1
    return hole_count


def _shape_features(processed):
    result = {
        "value": None,
        "strength": 0.0,
        "margin": 0.0,
        "zeroScore": 0.0,
        "sevenScore": 0.0,
        "holeCount": 0,
        "topologyHoleVotes": 0,
        "topologyVariantCount": 0,
        "stableHoleRatio": 0.0,
        "foregroundRatio": 0.0,
        "topInk": 0.0,
        "bottomInk": 0.0,
        "leftMidInk": 0.0,
        "rightMidInk": 0.0,
        "centerInk": 0.0,
        "leftRightBalance": 0.0,
        "topBottomBalance": 0.0
    }
    if processed is None or processed.size == 0:
        return result
    if len(processed.shape) == 3:
        gray = cv2.cvtColor(
            processed,
            cv2.COLOR_BGR2GRAY
        )
    else:
        gray = processed.copy()
    if float(gray.mean()) < 127.0:
        gray = cv2.bitwise_not(gray)
    _, binary = cv2.threshold(
        gray,
        0,
        255,
        cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU
    )
    points = cv2.findNonZero(binary)
    if points is None:
        return result
    x, y, width, height = cv2.boundingRect(points)
    if width < 3 or height < 5:
        return result
    glyph = binary[
        y:y + height,
        x:x + width
    ]
    foreground = glyph > 0
    foreground_ratio = float(
        np.mean(foreground)
    )
    result["foregroundRatio"] = round(
        foreground_ratio,
        4
    )

    kernel = np.ones((2, 2), dtype=np.uint8)
    topology_variants = [
        glyph,
        cv2.morphologyEx(
            glyph,
            cv2.MORPH_CLOSE,
            kernel,
            iterations=1
        ),
        cv2.morphologyEx(
            glyph,
            cv2.MORPH_OPEN,
            kernel,
            iterations=1
        )
    ]
    topology_holes = [
        _count_holes(variant)
        for variant in topology_variants
    ]
    hole_votes = sum(
        1
        for count in topology_holes
        if count >= 1
    )
    stable_hole_ratio = (
        hole_votes / len(topology_holes)
        if topology_holes
        else 0.0
    )
    result["holeCount"] = int(topology_holes[0])
    result["topologyHoleVotes"] = int(hole_votes)
    result["topologyVariantCount"] = len(topology_holes)
    result["stableHoleRatio"] = round(
        stable_hole_ratio,
        4
    )

    def band_mean(y1, y2, x1, x2):
        band_y1 = max(
            0,
            min(height, int(round(height * y1)))
        )
        band_y2 = max(
            band_y1 + 1,
            min(height, int(round(height * y2)))
        )
        band_x1 = max(
            0,
            min(width, int(round(width * x1)))
        )
        band_x2 = max(
            band_x1 + 1,
            min(width, int(round(width * x2)))
        )
        return float(
            np.mean(
                foreground[
                    band_y1:band_y2,
                    band_x1:band_x2
                ]
            )
        )

    top_ink = band_mean(0.00, 0.24, 0.05, 0.95)
    bottom_ink = band_mean(0.76, 1.00, 0.05, 0.95)
    left_mid_ink = band_mean(0.25, 0.75, 0.00, 0.30)
    right_mid_ink = band_mean(0.25, 0.75, 0.70, 1.00)
    center_ink = band_mean(0.28, 0.72, 0.34, 0.66)
    upper_right_ink = band_mean(0.18, 0.55, 0.55, 1.00)
    lower_left_ink = band_mean(0.48, 0.92, 0.00, 0.45)
    left_right_balance = 1.0 - min(
        1.0,
        abs(left_mid_ink - right_mid_ink)
    )
    top_bottom_balance = 1.0 - min(
        1.0,
        abs(top_ink - bottom_ink)
    )
    result.update({
        "topInk": round(top_ink, 4),
        "bottomInk": round(bottom_ink, 4),
        "leftMidInk": round(left_mid_ink, 4),
        "rightMidInk": round(right_mid_ink, 4),
        "centerInk": round(center_ink, 4),
        "leftRightBalance": round(left_right_balance, 4),
        "topBottomBalance": round(top_bottom_balance, 4)
    })

    zero_score = 0.0
    seven_score = 0.0
    if stable_hole_ratio >= 0.67:
        zero_score += 0.62
    elif stable_hole_ratio >= 0.34:
        zero_score += 0.38
    else:
        seven_score += 0.22
    zero_score += min(0.10, left_mid_ink * 0.20)
    zero_score += min(0.10, right_mid_ink * 0.20)
    zero_score += min(0.08, bottom_ink * 0.16)
    if center_ink <= 0.34:
        zero_score += 0.06
    if (
        min(left_mid_ink, right_mid_ink) >= 0.16
        and left_right_balance >= 0.78
    ):
        zero_score += 0.18
    if (
        min(top_ink, bottom_ink) >= 0.16
        and top_bottom_balance >= 0.76
        and center_ink <= 0.24
    ):
        zero_score += 0.13

    seven_score += min(0.18, top_ink * 0.28)
    if right_mid_ink > left_mid_ink + 0.05:
        seven_score += min(
            0.17,
            (right_mid_ink - left_mid_ink) * 0.46
        )
    if top_ink > bottom_ink + 0.05:
        seven_score += min(
            0.15,
            (top_ink - bottom_ink) * 0.42
        )
    if upper_right_ink > lower_left_ink + 0.04:
        seven_score += min(
            0.13,
            (upper_right_ink - lower_left_ink) * 0.38
        )
    if stable_hole_ratio == 0.0:
        seven_score += 0.08

    zero_score = min(1.0, zero_score)
    seven_score = min(1.0, seven_score)
    margin = abs(zero_score - seven_score)
    result["zeroScore"] = round(zero_score, 4)
    result["sevenScore"] = round(seven_score, 4)
    result["margin"] = round(margin, 4)
    if margin < 0.10:
        return result
    result["value"] = (
        0
        if zero_score > seven_score
        else 7
    )
    result["strength"] = round(
        min(
            0.96,
            0.44 + margin * 0.72
        ),
        4
    )
    return result


def _candidate_values(field_result):
    values = set()
    for candidate in field_result.get(
        "candidate_summary",
        []
    ):
        value = candidate.get("value")
        if value is None:
            continue
        try:
            values.add(int(value))
        except (TypeError, ValueError):
            continue
    return values


def _confidence(
    support,
    competing_support,
    mode_support,
    psm_support,
    average_confidence,
    best_confidence,
    shape_agrees,
    shape_strength,
    existing_agrees,
    perfect_vote
):
    confidence = 49.0
    confidence += min(28.0, support * 5.5)
    confidence -= min(24.0, competing_support * 10.0)
    confidence += min(5.0, max(0, mode_support - 1) * 2.5)
    confidence += min(3.0, max(0, psm_support - 1) * 3.0)
    confidence += min(
        7.0,
        max(0.0, average_confidence) * 0.07
    )
    confidence += min(
        4.0,
        max(0.0, best_confidence - 45.0) * 0.07
    )
    if shape_agrees:
        confidence += 7.0 * max(
            0.0,
            min(1.0, shape_strength)
        )
    if existing_agrees:
        confidence += 3.0
    if perfect_vote:
        confidence += 3.0
    return round(
        max(0.0, min(96.0, confidence)),
        2
    )


def evaluate_zero_seven(
    field_result,
    field_crop,
    preprocess_callback
):
    current_value = field_result.get("value")
    try:
        current_value = (
            int(current_value)
            if current_value is not None
            else None
        )
    except (TypeError, ValueError):
        current_value = None
    chosen_confidence = safe_float(
        field_result.get("chosen_confidence"),
        0.0
    )
    existing_support = safe_int(
        field_result.get("support_count"),
        0
    )
    review_required = bool(
        field_result.get("review_required", False)
    )
    micro_resolved = bool(
        field_result.get("micro_digit_resolved", False)
    )
    candidate_values = _candidate_values(field_result)
    explicit_conflict = (
        0 in candidate_values
        and 7 in candidate_values
    )
    generic_zero_seven_resolution = (
        micro_resolved
        and not review_required
        and current_value in ZERO_SEVEN_VALUES
    )
    current_uncertain = (
        current_value in ZERO_SEVEN_VALUES
        and (
            review_required
            or chosen_confidence < 92.0
            or existing_support < 2
            or bool(
                field_result.get(
                    "conflicting_values",
                    False
                )
            )
            or generic_zero_seven_resolution
        )
    )
    if not (
        explicit_conflict
        or current_uncertain
    ):
        return {
            "used": False,
            "resolved": False,
            "requiresPaddle": False
        }
    if field_crop is None or field_crop.size == 0:
        return {
            "used": False,
            "resolved": False,
            "requiresPaddle": False
        }

    specs = (
        ("gray", 10),
        ("otsu", 10),
        ("channel", 10),
        ("gray", 13),
        ("otsu", 13),
        ("channel", 13)
    )
    reads = []
    grouped = {
        0: [],
        7: []
    }
    shape_votes = []
    for mode, psm in specs:
        processed, targeting = preprocess_callback(
            field_crop,
            mode
        )
        read = _read_zero_seven(
            processed,
            psm,
            mode
        )
        read["targeting"] = targeting
        reads.append(read)
        value = read.get("value")
        if value in ZERO_SEVEN_VALUES:
            grouped[int(value)].append(read)
        if psm == 10:
            shape = _shape_features(processed)
            shape["mode"] = mode
            shape_votes.append(shape)

    ranked = sorted(
        grouped.items(),
        key=lambda pair: (
            len(pair[1]),
            len({item.get("mode") for item in pair[1]}),
            len({item.get("psm") for item in pair[1]}),
            sum(
                safe_float(item.get("confidence"), 0.0)
                for item in pair[1]
            ) / max(1, len(pair[1])),
            max(
                (
                    safe_float(item.get("confidence"), 0.0)
                    for item in pair[1]
                ),
                default=0.0
            )
        ),
        reverse=True
    )
    candidate_value, candidate_reads = ranked[0]
    competing_value, competing_reads = ranked[1]
    support = len(candidate_reads)
    competing_support = len(competing_reads)
    mode_support = len({
        item.get("mode")
        for item in candidate_reads
        if item.get("mode")
    })
    psm_support = len({
        item.get("psm")
        for item in candidate_reads
        if item.get("psm") is not None
    })
    average_confidence = (
        sum(
            safe_float(item.get("confidence"), 0.0)
            for item in candidate_reads
        ) / max(1, support)
    )
    best_confidence = max(
        (
            safe_float(item.get("confidence"), 0.0)
            for item in candidate_reads
        ),
        default=0.0
    )

    usable_shape_votes = [
        vote
        for vote in shape_votes
        if vote.get("value") in ZERO_SEVEN_VALUES
    ]
    shape_support = {
        0: 0.0,
        7: 0.0
    }
    for vote in usable_shape_votes:
        shape_support[int(vote["value"])] += safe_float(
            vote.get("strength"),
            0.0
        )
    shape_value = None
    shape_strength = 0.0
    if shape_support[0] != shape_support[7]:
        shape_value = (
            0
            if shape_support[0] > shape_support[7]
            else 7
        )
        total_shape = shape_support[0] + shape_support[7]
        shape_strength = (
            abs(shape_support[0] - shape_support[7])
            / max(0.001, total_shape)
        )
    average_hole_ratio = (
        sum(
            safe_float(vote.get("stableHoleRatio"), 0.0)
            for vote in shape_votes
        ) / max(1, len(shape_votes))
    )
    shape_agrees = shape_value == candidate_value
    shape_opposes = (
        shape_value in ZERO_SEVEN_VALUES
        and shape_value != candidate_value
        and shape_strength >= 0.30
    )
    topology_supports_candidate = (
        average_hole_ratio >= 0.34
        if candidate_value == 0
        else average_hole_ratio <= 0.34
    )
    topology_strongly_opposes = (
        average_hole_ratio <= 0.10
        if candidate_value == 0
        else average_hole_ratio >= 0.67
    )
    existing_agrees = (
        current_value == candidate_value
        and existing_support >= 1
    )
    perfect_vote = (
        support == len(specs)
        and competing_support == 0
    )
    confidence = _confidence(
        support=support,
        competing_support=competing_support,
        mode_support=mode_support,
        psm_support=psm_support,
        average_confidence=average_confidence,
        best_confidence=best_confidence,
        shape_agrees=shape_agrees,
        shape_strength=shape_strength,
        existing_agrees=existing_agrees,
        perfect_vote=perfect_vote
    )

    evidence_diverse = (
        mode_support >= 2
        and psm_support >= 2
    )
    strong_vote = (
        support >= 4
        and competing_support <= 1
        and evidence_diverse
        and (
            average_confidence >= 34.0
            or best_confidence >= 58.0
        )
    )
    existing_supported_vote = (
        existing_agrees
        and support >= 3
        and competing_support <= 1
        and mode_support >= 2
        and (
            average_confidence >= 28.0
            or best_confidence >= 50.0
        )
    )
    very_strong_vote = (
        support >= 5
        and competing_support <= 1
        and mode_support >= 3
        and psm_support >= 2
    )
    shape_gate = (
        not shape_opposes
        and not topology_strongly_opposes
        and (
            shape_agrees
            or topology_supports_candidate
            or very_strong_vote
        )
    )
    topology_vote_values = [
        int(vote.get("value"))
        for vote in usable_shape_votes
        if vote.get("value") in ZERO_SEVEN_VALUES
    ]
    topology_unanimous = (
        len(topology_vote_values) >= 3
        and len(set(topology_vote_values)) == 1
    )
    topology_value = (
        topology_vote_values[0]
        if topology_unanimous
        else None
    )
    # Topology is independent evidence, not merely a check on Tesseract's
    # preferred character.  A stable enclosed shape is strong evidence for 0
    # even when the character reader calls the same glyph a 7.  Seven remains
    # deliberately stricter: it must have unanimous open-shape topology and
    # agree with the specialist OCR candidate.
    topology_zero_resolution = (
        topology_unanimous
        and topology_value == 0
        and shape_strength >= 0.85
        and average_hole_ratio >= 0.80
    )
    topology_seven_resolution = (
        topology_unanimous
        and topology_value == 7
        and topology_value == candidate_value
        and competing_support == 0
        and shape_strength >= 0.90
        and average_hole_ratio <= 0.08
    )
    topology_only_resolution = (
        topology_zero_resolution
        or topology_seven_resolution
    )
    resolved_candidate = (
        int(topology_value)
        if topology_only_resolution
        else int(candidate_value)
    )
    if topology_only_resolution:
        confidence = max(
            confidence,
            90.0 if resolved_candidate == 0 else 87.0
        )
    resolved = (
        topology_only_resolution
        or (
            shape_gate
            and (
                strong_vote
                or existing_supported_vote
                or very_strong_vote
            )
            and confidence >= ZERO_SEVEN_RESOLVE_CONFIDENCE
        )
    )
    strong_challenge = (
        current_value in ZERO_SEVEN_VALUES
        and candidate_value != current_value
        and support >= 3
        and competing_support <= 1
        and mode_support >= 2
        and confidence >= ZERO_SEVEN_CHALLENGE_CONFIDENCE
    )
    requires_paddle = (
        not resolved
        and (
            explicit_conflict
            or strong_challenge
            or shape_opposes
            or topology_strongly_opposes
            or generic_zero_seven_resolution
        )
    )
    trigger = (
        "generic_micro_0_7_postcheck"
        if generic_zero_seven_resolution
        else (
            "explicit_0_7_conflict"
            if explicit_conflict
            else "uncertain_0_or_7"
        )
    )
    return {
        "used": True,
        "resolved": bool(resolved),
        "requiresPaddle": bool(requires_paddle),
        "trigger": trigger,
        "candidate": int(resolved_candidate),
        "ocrCandidate": int(candidate_value),
        "competingCandidate": int(competing_value),
        "support": int(support),
        "competingSupport": int(competing_support),
        "modeSupport": int(mode_support),
        "psmSupport": int(psm_support),
        "evidenceDiverse": bool(evidence_diverse),
        "averageConfidence": round(average_confidence, 2),
        "bestConfidence": round(best_confidence, 2),
        "confidence": confidence,
        "existingValue": current_value,
        "existingConfidence": round(chosen_confidence, 2),
        "existingSupport": int(existing_support),
        "existingAgrees": bool(existing_agrees),
        "genericMicroResolved": bool(generic_zero_seven_resolution),
        "strongChallenge": bool(strong_challenge),
        "shapeValue": shape_value,
        "shapeStrength": round(shape_strength, 4),
        "shapeAgrees": bool(shape_agrees),
        "shapeOpposes": bool(shape_opposes),
        "averageStableHoleRatio": round(average_hole_ratio, 4),
        "topologySupportsCandidate": bool(topology_supports_candidate),
        "topologyStronglyOpposes": bool(topology_strongly_opposes),
        "topologyOnlyResolution": bool(topology_only_resolution),
        "topologyZeroResolution": bool(topology_zero_resolution),
        "topologySevenResolution": bool(topology_seven_resolution),
        "topologyUnanimous": bool(topology_unanimous),
        "topologyValue": topology_value,
        "zeroPreferred": True,
        "shapeVotes": shape_votes,
        "reads": reads
    }
