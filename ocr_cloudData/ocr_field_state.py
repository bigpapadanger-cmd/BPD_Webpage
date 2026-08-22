"""Progressive candidate/locking state for the coordinate-first OCR pipeline."""

from collections import Counter, defaultdict

from ocr_layout import REPORT_FIELDS, INFORMATIONAL_FIELDS

FIELD_STATE_VERSION = "field-state-v2.1-resilient-best-fit"

REPORT_FIELDS = set(REPORT_FIELDS)
INFORMATIONAL_FIELDS = set(INFORMATIONAL_FIELDS)

STAGE_ORDER = {
    "pass1": 1,
    "pass2": 2,
    "pass3a": 3,
    "pass3b": 4,
    "paddle": 5,
    "final": 6,
}

# Stages intentionally become more permissive as independent evidence accrues.
PASS2_AGREEMENT_MIN_BEST = 65.0
PASS2_AGREEMENT_MIN_AVERAGE = 58.0
PASS2_SELF_CONSENSUS_MIN_BEST = 84.0
PASS3A_MIN_BEST = 60.0
PASS3B_MIN_BEST = 55.0
PADDLE_MIN_CONFIDENCE = 72.0
PADDLE_OVERRIDE_CONFIDENCE = 90.0


def is_informational_field(field_name):
    return str(field_name or "").lower() in INFORMATIONAL_FIELDS


def is_report_field(field_name):
    return str(field_name or "").lower() in REPORT_FIELDS


def new_field_state(field_name, coordinate_ref=None):
    return {
        "field": str(field_name),
        "coordinateRef": dict(coordinate_ref or {}),
        "candidates": [],
        "value": None,
        "chosen_confidence": 0.0,
        "support_count": 0,
        "independent_support_count": 0,
        "conflicting_values": False,
        "locked": False,
        "locked_at": None,
        "lock_reason": None,
        "resolved_pass": False,
        "review_required": not is_informational_field(field_name),
        "status": "unread",
        "presence": None,
    }


def add_candidate(field_state, candidate):
    if not isinstance(field_state, dict) or not isinstance(candidate, dict):
        return field_state
    candidate = dict(candidate)
    value = candidate.get("value")
    if value is not None:
        try:
            candidate["value"] = int(value)
        except (TypeError, ValueError):
            candidate["value"] = None
    candidate["confidence"] = round(float(candidate.get("confidence", 0.0) or 0.0), 2)
    field_state.setdefault("candidates", []).append(candidate)
    return field_state


def is_locked(field_result):
    return bool(isinstance(field_result, dict) and field_result.get("locked") is True)


def lock_field(field_result, stage, confidence, reason):
    if not isinstance(field_result, dict):
        return field_result
    field_result["locked"] = True
    field_result["locked_at"] = str(stage)
    field_result["lock_reason"] = str(reason)
    field_result["chosen_confidence"] = round(float(confidence or 0.0), 2)
    field_result["resolved_pass"] = field_result.get("value") is not None
    field_result["review_required"] = False if field_result["resolved_pass"] else not is_informational_field(field_result.get("field"))
    field_result["status"] = f"locked_{stage}"
    return field_result


def unlock_field(field_result, reason="conflict"):
    if not isinstance(field_result, dict):
        return field_result
    field_result["locked"] = False
    field_result["unlock_reason"] = str(reason)
    field_result["review_required"] = not is_informational_field(field_result.get("field"))
    return field_result


def _valid_candidates(field_state):
    return [
        item for item in (field_state.get("candidates") or [])
        if isinstance(item, dict)
        and item.get("value") is not None
        and item.get("plausible", True) is not False
    ]


def _candidate_groups(field_state):
    grouped = defaultdict(list)
    for item in _valid_candidates(field_state):
        grouped[int(item["value"])].append(item)
    return grouped


def _group_score(items):
    if not items:
        return (0, 0, 0.0, 0.0)
    engines = {str(i.get("engine") or "tesseract") for i in items}
    stages = {str(i.get("stage") or "unknown") for i in items}
    families = {str(i.get("family") or i.get("stage") or "unknown") for i in items}
    confidences = [float(i.get("confidence", 0.0) or 0.0) for i in items]
    best = max(confidences, default=0.0)
    avg = sum(confidences) / max(1, len(confidences))
    # Stage diversity is more meaningful than running many PSMs in one sweep.
    diversity = len(stages) * 2 + len(engines) + min(3, len(families))
    return diversity, len(items), best, avg


def _digit_difference(left, right):
    left = str(int(left))
    right = str(int(right))
    if len(left) != len(right):
        return None
    return sum(1 for a, b in zip(left, right) if a != b)


def _contextual_preference(field_state, ranked, stage):
    """Return a narrowly-scoped best-fit override for known OCR drop/substitution cases."""
    if not ranked:
        return None
    field_name = str(field_state.get("field") or "").lower()
    default_value, default_items = ranked[0]
    default_best = _group_score(default_items)[2]

    # Scores occasionally have one confidently read digit substituted across a
    # family of correlated threshold variants.  Prefer a very-high-confidence
    # same-length, one-digit correction only after the full Tesseract sweep.
    if field_name == "score" and stage in {"pass3b", "paddle"}:
        strongest = max(ranked, key=lambda pair: _group_score(pair[1])[2])
        strongest_value, strongest_items = strongest
        strongest_best = _group_score(strongest_items)[2]
        if (
            int(strongest_value) != int(default_value)
            and strongest_best >= 92.0
            and strongest_best >= default_best + 8.0
            and default_best < 90.0
            and _digit_difference(strongest_value, default_value) == 1
            and any(str(item.get("stage") or "") in {"pass1", "pass2"} for item in strongest_items)
        ):
            return strongest, "score_high_confidence_single_digit_resolution"

    # A shifted ping crop often drops only the leading digit (28 -> 8).  The
    # longer direct-coordinate read is safer when the competing short read is
    # low confidence and is an exact suffix.
    if field_name == "ping":
        short_text = str(int(default_value))
        for value, items in ranked[1:]:
            long_text = str(int(value))
            long_best = _group_score(items)[2]
            if (
                len(long_text) == len(short_text) + 1
                and long_text.endswith(short_text)
                and long_best >= 5.0
                and default_best <= 45.0
            ):
                return (value, items), "ping_leading_digit_recovered"
    return None


def evaluate_field_state(field_state, stage):
    """Select the current winner and decide whether evidence is strong enough to lock."""
    if not isinstance(field_state, dict):
        return field_state
    if is_locked(field_state):
        return field_state

    stage = str(stage or "").lower()
    grouped = _candidate_groups(field_state)
    if not grouped:
        field_state.update({
            "value": None,
            "chosen_confidence": 0.0,
            "support_count": 0,
            "independent_support_count": 0,
            "conflicting_values": False,
            "resolved_pass": False,
            "review_required": not is_informational_field(field_state.get("field")),
            "status": f"{stage}_no_read",
        })
        return field_state

    ranked = sorted(
        grouped.items(),
        key=lambda pair: _group_score(pair[1]),
        reverse=True,
    )
    contextual = _contextual_preference(field_state, ranked, stage)
    contextual_reason = None
    if contextual is not None:
        preferred, contextual_reason = contextual
        ranked = [preferred] + [pair for pair in ranked if int(pair[0]) != int(preferred[0])]
    value, items = ranked[0]
    diversity, support, best, average = _group_score(items)
    stages = {str(i.get("stage") or "unknown") for i in items}
    families = {str(i.get("family") or i.get("stage") or "unknown") for i in items}
    competitor_best = max(
        (
            max(float(i.get("confidence", 0.0) or 0.0) for i in other_items)
            for other_value, other_items in grouped.items()
            if int(other_value) != int(value)
        ),
        default=0.0,
    )
    conflict = len(grouped) > 1 and competitor_best >= max(45.0, best - 18.0)

    # Conservative confidence: reward independent stages rather than repeated
    # OCR calls in a single sweep.
    confidence = min(
        99.0,
        best
        + max(0, len(stages) - 1) * 6.0
        + max(0, len(families) - 1) * 2.0
        + min(20.0, max(0, support - 1) * 4.0)
        - (12.0 if conflict else 0.0),
    )
    field_state.update({
        "value": int(value),
        "chosen_confidence": round(confidence, 2),
        "support_count": int(support),
        "independent_support_count": int(len(stages)),
        "conflicting_values": bool(conflict),
        "candidate_summary": [
            {
                "value": int(candidate_value),
                "support": len(candidate_items),
                "stages": sorted({str(i.get("stage") or "") for i in candidate_items}),
                "bestConfidence": round(_group_score(candidate_items)[2], 2),
                "averageConfidence": round(_group_score(candidate_items)[3], 2),
            }
            for candidate_value, candidate_items in ranked
        ],
    })

    if contextual_reason:
        warnings = field_state.setdefault("advisory_warnings", [])
        if contextual_reason not in warnings:
            warnings.append(contextual_reason)
        field_state["contextual_resolution"] = {
            "reason": contextual_reason,
            "value": int(value),
        }
        if contextual_reason == "score_high_confidence_single_digit_resolution":
            lock_field(field_state, stage, confidence, contextual_reason)
            return field_state

    field_name = str(field_state.get("field") or "").lower()
    informational = is_informational_field(field_name)
    locked = False
    reason = "needs_more_evidence"
    zero_seven_sensitive = int(value) in {0, 7} and not informational

    if stage == "pass1":
        # Pass 1 establishes a provisional read only. Pass 2 must validate it.
        reason = "pass1_provisional"
    elif stage == "pass2":
        has_cross_pass_agreement = "pass1" in stages and "pass2" in stages
        if zero_seven_sensitive:
            safe_zero_seven_agreement = (
                has_cross_pass_agreement
                and not conflict
                and best >= 70.0
                and competitor_best < 45.0
            )
            if safe_zero_seven_agreement:
                lock_field(field_state, stage, confidence, "pass1_pass2_zero_seven_agreement")
                return field_state
            field_state["locked"] = False
            field_state["resolved_pass"] = False
            field_state["review_required"] = True
            field_state["status"] = "zero_seven_specialist_required"
            field_state["lock_reason"] = "zero_seven_specialist_required"
            return field_state
        pass2_family_count = len({
            str(i.get("family") or "") for i in items
            if str(i.get("stage") or "") == "pass2"
        })
        locked = (
            not conflict
            and (
                (
                    has_cross_pass_agreement
                    and best >= PASS2_AGREEMENT_MIN_BEST
                    and average >= PASS2_AGREEMENT_MIN_AVERAGE
                )
                or (
                    pass2_family_count >= 2
                    and best >= PASS2_SELF_CONSENSUS_MIN_BEST
                )
            )
        )
        reason = "pass1_pass2_agreement" if locked else "pass2_needs_deeper_validation"
    elif stage == "pass3a":
        if zero_seven_sensitive:
            safe_zero_seven_agreement = (
                len(stages) >= 2
                and not conflict
                and best >= 65.0
                and competitor_best < 45.0
            )
            if safe_zero_seven_agreement:
                lock_field(field_state, stage, confidence, "cross_stage_zero_seven_agreement")
                return field_state
            field_state["locked"] = False
            field_state["resolved_pass"] = False
            field_state["review_required"] = True
            field_state["status"] = "zero_seven_specialist_required"
            field_state["lock_reason"] = "zero_seven_specialist_required"
            return field_state
        locked = not conflict and len(stages) >= 2 and best >= PASS3A_MIN_BEST
        reason = "pass3a_consensus" if locked else "pass3a_needs_b_sweep"
    elif stage == "pass3b":
        if zero_seven_sensitive and not any(str(i.get("engine")) == "zero_seven_specialist" for i in items):
            field_state["locked"] = False
            field_state["resolved_pass"] = False
            field_state["review_required"] = True
            field_state["status"] = "zero_seven_specialist_required"
            field_state["lock_reason"] = "zero_seven_specialist_required"
            return field_state
        locked = not conflict and (
            (len(stages) >= 2 and best >= PASS3B_MIN_BEST)
            or (
                len(stages) >= 3
                and support >= 4
                and competitor_best < 45.0
            )
        )
        reason = "pass3b_consensus" if locked else "paddle_required"
    elif stage == "paddle":
        paddle_items = [i for i in items if str(i.get("engine")) == "paddle"]
        paddle_best = max([float(i.get("confidence", 0.0) or 0.0) for i in paddle_items], default=0.0)
        # Strong Paddle may override a Tesseract conflict; otherwise require its
        # value to agree with at least one Tesseract stage.
        tesseract_agreement = any(str(i.get("engine")) != "paddle" for i in items)
        locked = (
            paddle_best >= PADDLE_OVERRIDE_CONFIDENCE
            or (paddle_best >= PADDLE_MIN_CONFIDENCE and tesseract_agreement)
        )
        reason = "paddle_best_fit" if locked else "paddle_unresolved"

    if locked:
        lock_field(field_state, stage, confidence, reason)
    else:
        field_state["locked"] = False
        field_state["lock_reason"] = reason
        field_state["resolved_pass"] = bool(informational and field_state.get("value") is not None)
        field_state["review_required"] = False if informational else True
        field_state["status"] = reason
    return field_state


def should_request_paddle_for_field(field_name, field_result):
    if not isinstance(field_result, dict) or field_result.get("not_applicable"):
        return False
    if is_locked(field_result):
        return False
    field_name = str(field_name or "").lower()
    # Ping does not load Paddle by itself. If Paddle is already needed for a
    # report field/identity, the orchestrator may include ping in the same batch.
    if field_name in INFORMATIONAL_FIELDS:
        return False
    return True


def build_paddle_request_fields(identity_result, number_results, include_informational=False):
    requested = []
    if isinstance(identity_result, dict) and int(identity_result.get("username_support", 0) or 0) < 2:
        requested.append("username")
    for field_name, state in (number_results or {}).items():
        if should_request_paddle_for_field(field_name, state):
            requested.append(str(field_name))
    if requested and include_informational:
        for field_name, state in (number_results or {}).items():
            if str(field_name) in INFORMATIONAL_FIELDS and not is_locked(state):
                requested.append(str(field_name))
    return list(dict.fromkeys(requested))


def summarize_locks(number_results):
    stages = Counter()
    locked = 0
    unresolved = 0
    for field_name, state in (number_results or {}).items():
        if not isinstance(state, dict):
            continue
        if is_locked(state):
            locked += 1
            stages[str(state.get("locked_at") or "unknown")] += 1
        elif str(field_name) not in INFORMATIONAL_FIELDS:
            unresolved += 1
    return {
        "version": FIELD_STATE_VERSION,
        "lockedFields": int(locked),
        "unlockedReportFields": int(unresolved),
        "lockedByStage": dict(stages),
    }
