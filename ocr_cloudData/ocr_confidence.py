from ocr_utils import safe_float, safe_int
CONFIDENCE_VERSION = "confidence-v1.3-report-fields-progressive-locks-hardened"


# ============================================================
# CONFIDENCE BAND THRESHOLDS
# Labels the FINAL overall confidence score.
# Does not directly control pass/fail.
# ============================================================

CONFIDENCE_BAND_VERY_HIGH = 90.0   # 90+ = very_high
CONFIDENCE_BAND_HIGH = 83.0        # 83-89.99 = high
CONFIDENCE_BAND_MODERATE = 75.0    # 75-82.99 = moderate
CONFIDENCE_BAND_LOW = 66.0         # 66-74.99 = low
# Anything below LOW = very_low


# ============================================================
# OVERALL CONFIDENCE WEIGHTS
# Controls how much each confidence category affects the
# final overall confidence score.
# MUST total 1.0.
# ============================================================

OVERALL_WEIGHT_AVERAGE_PLAYER = 0.45
# 45% of final score = average confidence of all players

OVERALL_WEIGHT_MINIMUM_PLAYER = 0.25
# 25% = confidence of the weakest player

OVERALL_WEIGHT_AVERAGE_FIELD = 0.15
# 15% = average confidence of all report-stat fields

OVERALL_WEIGHT_MINIMUM_FIELD = 0.15
# 15% = confidence of the weakest report-stat field


# ============================================================
# OVERALL CONFIDENCE CAPS
# Maximum overall confidence allowed when a problem exists.
# Lower number = harsher penalty.
# ============================================================

OVERALL_CAP_PLAYER_REVIEW = 75.0
# If any player still needs review, overall cannot exceed 75
OVERALL_CAP_VALIDATION_FAILED = 70.0
# If final validation fails, overall cannot exceed 70
OVERALL_CAP_ZERO_SEVEN_UNRESOLVED = 69.0
# If a 0-vs-7 issue remains unresolved, overall cannot exceed 69
OVERALL_CAP_LOW_PLAYER_CONFIDENCE = 68.0
# Applied when weakest player falls below its trigger threshold
OVERALL_CAP_LOW_FIELD_CONFIDENCE = 69.0
# Applied when weakest stat field falls below its trigger threshold
OVERALL_CAP_INCOMPLETE_PLAYER_COVERAGE = 74.0
# Applied if confidence data is missing for one or more players


# ============================================================
# FIELD CONFIDENCE CLASSIFICATION
# Used to label/count strong and weak stat fields in telemetry.
# Does not directly determine reportReady.
# ============================================================

STRONG_FIELD_CONFIDENCE = 83.0
# Field confidence >= 83 counts as strong
WEAK_FIELD_CONFIDENCE = 60.0
# Field confidence < 60 counts as weak


# ============================================================
# LOW-CONFIDENCE CAP TRIGGERS
# These thresholds decide WHEN the low-confidence caps above
# are activated.
# ============================================================

MINIMUM_PLAYER_CONFIDENCE_BEFORE_CAP = 70.0
# If weakest player < 70, apply OVERALL_CAP_LOW_PLAYER_CONFIDENCE
MINIMUM_FIELD_CONFIDENCE_BEFORE_CAP = 55.0
# If weakest field < 55, apply OVERALL_CAP_LOW_FIELD_CONFIDENCE


# ============================================================
# REPORT READY REQUIREMENTS
# Hard requirements for reportReady = True.
# Raising these makes final approval stricter.
# ============================================================

REPORT_READY_MINIMUM_PLAYER_CONFIDENCE = 80.0
# Every player must be at least 80 confidence
REPORT_READY_MINIMUM_FIELD_CONFIDENCE = 70.0
# Every report-stat field must be at least 70 confidence
REPORT_READY_MINIMUM_PLAYER_COVERAGE = 1.0
# 1.0 = confidence data required for 100% of players


# ============================================================
# INFORMATIONAL FIELDS
# These fields are displayed but ignored when calculating
# report confidence and report readiness.
# ============================================================

INFORMATIONAL_FIELDS = {
    "ping"
}






def _band(value):
    value = safe_float(value)

    if value >= CONFIDENCE_BAND_VERY_HIGH:
        return "very_high"

    if value >= CONFIDENCE_BAND_HIGH:
        return "high"

    if value >= CONFIDENCE_BAND_MODERATE:
        return "moderate"

    if value >= CONFIDENCE_BAND_LOW:
        return "low"

    return "very_low"


def build_confidence_summary(
    public_players,
    player_validations,
    validation_pass,
    players_needing_review
):
    public_players = [
        item
        for item in (public_players or [])
        if isinstance(item, dict)
    ]

    player_validations = [
        item
        for item in (player_validations or [])
        if isinstance(item, dict)
    ]

    player_confidences = [
        safe_float(
            item.get("confidence"),
            0.0
        )
        for item in public_players
    ]

    field_entries = []

    zero_seven_used = 0
    zero_seven_resolved = 0
    zero_seven_unresolved = 0

    paddle_resolved_field_keys = set()

    for validation in player_validations:
        player_index = safe_int(
            validation.get("player_index"),
            0
        )

        review = validation.get(
            "two_check_review",
            {}
        )

        if not isinstance(review, dict):
            continue

        field_confidence = review.get(
            "field_confidence",
            {}
        )

        field_evidence = review.get(
            "field_evidence",
            {}
        )

        if not isinstance(field_confidence, dict):
            field_confidence = {}

        if not isinstance(field_evidence, dict):
            field_evidence = {}

        for field_name, confidence in field_confidence.items():
            normalized_field_name = str(
                field_name
            ).lower()

            if normalized_field_name in INFORMATIONAL_FIELDS:
                continue

            evidence = field_evidence.get(
                field_name,
                {}
            )

            if not isinstance(evidence, dict):
                evidence = {}

            if evidence.get("not_applicable"):
                continue

            field_entries.append({
                "playerIndex": player_index,
                "field": str(field_name),
                "confidence": safe_float(
                    confidence,
                    0.0
                )
            })

            if evidence.get("zero_seven_check_used"):
                zero_seven_used += 1

                if evidence.get("zero_seven_resolved"):
                    zero_seven_resolved += 1

                elif evidence.get("zero_seven_requires_paddle"):
                    zero_seven_unresolved += 1

            if evidence.get("source") == "paddle":
                paddle_resolved_field_keys.add((
                    player_index,
                    str(field_name)
                ))

        for field_name in (
            review.get(
                "paddle_resolved_fields",
                []
            )
            or []
        ):
            if str(field_name).lower() in INFORMATIONAL_FIELDS:
                continue

            paddle_resolved_field_keys.add((
                player_index,
                str(field_name)
            ))

    average_player = (
        sum(player_confidences)
        / len(player_confidences)
        if player_confidences
        else 0.0
    )

    minimum_player = (
        min(player_confidences)
        if player_confidences
        else 0.0
    )

    field_confidences = [
        item["confidence"]
        for item in field_entries
    ]

    average_field = (
        sum(field_confidences)
        / len(field_confidences)
        if field_confidences
        else 0.0
    )

    minimum_field = (
        min(field_confidences)
        if field_confidences
        else 0.0
    )

    weakest_field = (
        min(
            field_entries,
            key=lambda item: item["confidence"]
        )
        if field_entries
        else None
    )

    overall = (
        average_player
        * OVERALL_WEIGHT_AVERAGE_PLAYER
        + minimum_player
        * OVERALL_WEIGHT_MINIMUM_PLAYER
        + average_field
        * OVERALL_WEIGHT_AVERAGE_FIELD
        + minimum_field
        * OVERALL_WEIGHT_MINIMUM_FIELD
    )

    review_count = safe_int(
        players_needing_review,
        0
    )

    if review_count > 0:
        overall = min(
            overall,
            OVERALL_CAP_PLAYER_REVIEW
        )

    if not validation_pass:
        overall = min(
            overall,
            OVERALL_CAP_VALIDATION_FAILED
        )

    if zero_seven_unresolved > 0:
        overall = min(
            overall,
            OVERALL_CAP_ZERO_SEVEN_UNRESOLVED
        )

    if (
        player_confidences
        and minimum_player
        < MINIMUM_PLAYER_CONFIDENCE_BEFORE_CAP
    ):
        overall = min(
            overall,
            OVERALL_CAP_LOW_PLAYER_CONFIDENCE
        )

    if (
        field_confidences
        and minimum_field
        < MINIMUM_FIELD_CONFIDENCE_BEFORE_CAP
    ):
        overall = min(
            overall,
            OVERALL_CAP_LOW_FIELD_CONFIDENCE
        )

    strong_field_count = sum(
        1
        for value in field_confidences
        if value >= STRONG_FIELD_CONFIDENCE
    )

    weak_field_count = sum(
        1
        for value in field_confidences
        if value < WEAK_FIELD_CONFIDENCE
    )

    strong_field_ratio = (
        strong_field_count
        / len(field_confidences)
        if field_confidences
        else 0.0
    )

    expected_player_evidence = len(
        player_validations
    )

    player_confidence_coverage = (
        len(player_confidences)
        / expected_player_evidence
        if expected_player_evidence > 0
        else (
            1.0
            if player_confidences
            else 0.0
        )
    )

    player_confidence_coverage = max(
        0.0,
        min(
            1.0,
            player_confidence_coverage
        )
    )

    if (
        player_confidence_coverage
        < REPORT_READY_MINIMUM_PLAYER_COVERAGE
    ):
        overall = min(
            overall,
            OVERALL_CAP_INCOMPLETE_PLAYER_COVERAGE
        )

    report_ready = bool(
        validation_pass
        and review_count == 0
        and player_confidences
        and field_confidences
        and minimum_player
        >= REPORT_READY_MINIMUM_PLAYER_CONFIDENCE
        and minimum_field
        >= REPORT_READY_MINIMUM_FIELD_CONFIDENCE
        and zero_seven_unresolved == 0
        and player_confidence_coverage
        >= REPORT_READY_MINIMUM_PLAYER_COVERAGE
    )

    overall = round(
        max(
            0.0,
            min(
                100.0,
                overall
            )
        ),
        2
    )

    checks = {
        "validationPass": bool(
            validation_pass
        ),

        "allPlayersAtLeast80": bool(
            player_confidences
            and all(
                value
                >= REPORT_READY_MINIMUM_PLAYER_CONFIDENCE
                for value in player_confidences
            )
        ),

        "allFieldsAtLeast70": bool(
            field_confidences
            and all(
                value
                >= REPORT_READY_MINIMUM_FIELD_CONFIDENCE
                for value in field_confidences
            )
        ),

        "zeroSevenUnresolved": int(
            zero_seven_unresolved
        ),

        "playersNeedingReview": int(
            review_count
        ),

        "weakFieldsBelow60": int(
            weak_field_count
        ),

        "strongFieldRatio": round(
            strong_field_ratio,
            4
        ),

        "playerConfidenceCoverage": round(
            player_confidence_coverage,
            4
        ),

        "reportReady": bool(
            report_ready
        )
    }

    return {
        "version": CONFIDENCE_VERSION,

        "overall": overall,

        "band": _band(
            overall
        ),

        "averagePlayer": round(
            average_player,
            2
        ),

        "minimumPlayer": round(
            minimum_player,
            2
        ),

        "averageField": round(
            average_field,
            2
        ),

        "minimumField": round(
            minimum_field,
            2
        ),

        "weakestField": weakest_field,

        "zeroSeven": {
            "checked": int(
                zero_seven_used
            ),
            "resolved": int(
                zero_seven_resolved
            ),
            "unresolved": int(
                zero_seven_unresolved
            )
        },

        "paddleResolvedFields": len(
            paddle_resolved_field_keys
        ),

        "fieldStrength": {
            "strongThreshold": STRONG_FIELD_CONFIDENCE,
            "strongCount": int(
                strong_field_count
            ),
            "weakThreshold": WEAK_FIELD_CONFIDENCE,
            "weakCount": int(
                weak_field_count
            ),
            "strongRatio": round(
                strong_field_ratio,
                4
            )
        },

        "coverage": {
            "playerConfidence": round(
                player_confidence_coverage,
                4
            ),
            "playersWithConfidence": len(
                player_confidences
            ),
            "playerValidationRows": int(
                expected_player_evidence
            ),
            "fieldsWithConfidence": len(
                field_confidences
            )
        },

        "reportReady": bool(
            report_ready
        ),

        "checks": checks
    }
