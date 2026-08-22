"""Paddle recovery for isolated failed coordinate references only.

Paddle never receives Pass-1 sanitized/cropped artifacts.  It recrops the raw
prepared scoreboard from the immutable coordinate reference, verifies visual
content exists, reads only requested regions, and adds confidence-weighted
candidates to the same field state used by Tesseract Passes 1/2/3.
"""

import re
import time
from threading import local

import cv2
import numpy as np

from ocr_layout import NUMBER_LIMITS
from ocr_pass1 import crop_from_ref, region_has_content
from ocr_field_state import add_candidate, evaluate_field_state, is_locked
from ocr_text import uppercase_text, parse_clan_username, best_expected_score, normalize_name_for_match
from paddle_runtime import get_model as runtime_get_paddle_model

PADDLE_VALIDATION_VERSION = "paddle-v13.2-username-numeric-only"

PADDLE_VARIANT_SPECS = (
    {
        "label": "exact",
        "expandX": 0.0,
        "expandY": 0.0,
        "shiftX": 0.0,
        "shiftY": 0.0,
    },
    {
        "label": "expanded",
        "expandX": 0.04,
        "expandY": 0.14,
        "shiftX": 0.0,
        "shiftY": 0.0,
    },
)

_PROGRESS = local()
_TIMING = local()


def set_progress_callback(callback):
    _PROGRESS.callback = callback


def clear_progress_callback():
    _PROGRESS.callback = None


def report_progress(stage, progress):
    callback = getattr(_PROGRESS, "callback", None)
    if callback is None:
        return
    try:
        callback(stage, progress)
    except Exception:
        pass


def reset_paddle_timing():
    _TIMING.data = {
        "modelInitSeconds": 0.0,
        "inferenceSeconds": 0.0,
        "calls": 0,
    }


def get_paddle_timing():
    return dict(getattr(_TIMING, "data", {}) or {})


def _timing_add(key, value):
    if not hasattr(_TIMING, "data"):
        reset_paddle_timing()
    _TIMING.data[key] = float(_TIMING.data.get(key, 0.0) or 0.0) + float(value or 0.0)


def get_paddle_model():
    started = time.perf_counter()
    model = runtime_get_paddle_model(trigger="isolated_coordinate_recovery")
    _timing_add("modelInitSeconds", time.perf_counter() - started)
    return model


def result_to_dict(result):
    payload = getattr(result, "json", None)
    if callable(payload):
        payload = payload()
    if isinstance(payload, str):
        import json
        try:
            payload = json.loads(payload)
        except Exception:
            payload = {}
    if not isinstance(payload, dict):
        return {}
    inner = payload.get("res", payload)
    return inner if isinstance(inner, dict) else {}


def _prepare_raw_crop(crop, field_name, variant="exact"):
    if crop is None or crop.size == 0:
        return None
    field_name = str(field_name or "")
    h, w = crop.shape[:2]
    # Numeric focus is applied only after recropping from the raw coordinate.
    # The coordinate itself remains the canonical source of truth.
    if crop is None or crop.size == 0:
        return None
    if field_name == "username":
        scale = 3.0
    elif field_name == "score":
        scale = 4.0
    else:
        scale = 6.0
    if variant == "expanded":
        scale *= 1.08
    prepared = cv2.resize(crop, None, fx=scale, fy=scale, interpolation=cv2.INTER_LANCZOS4)
    # Paddle recognition benefits from a clean border but not from the aggressive
    # Tesseract sanitization pipeline.
    prepared = cv2.copyMakeBorder(prepared, 12, 12, 16, 16, cv2.BORDER_CONSTANT, value=(0, 0, 0))
    return prepared


def _parse_numeric(text, field_name):
    value = str(text or "").upper().strip()
    value = value.replace("O", "0").replace("Q", "0")
    value = value.replace("I", "1").replace("L", "1")
    digits = re.sub(r"[^0-9]", "", value)
    if not digits:
        return None
    try:
        number = int(digits)
    except ValueError:
        return None
    minimum, maximum = NUMBER_LIMITS.get(str(field_name), (0, 99999))
    return number if minimum <= number <= maximum else None


def _predict_batch(items):
    """items: list of {key, image}. Returns key->{text, confidence}."""
    valid = [item for item in items if item.get("image") is not None and item["image"].size > 0]
    if not valid:
        return {}
    report_progress("paddle", 93)
    model = get_paddle_model()
    started = time.perf_counter()
    results = model.predict(
        input=[item["image"] for item in valid],
        batch_size=min(8, len(valid)),
    )
    _timing_add("inferenceSeconds", time.perf_counter() - started)
    if not hasattr(_TIMING, "data"):
        reset_paddle_timing()
    _TIMING.data["calls"] = int(_TIMING.data.get("calls", 0) or 0) + 1
    output = {}
    for item, result in zip(valid, results):
        data = result_to_dict(result)
        output[item["key"]] = {
            "text": str(data.get("rec_text", "") or "").strip(),
            "confidence": float(data.get("rec_score", 0.0) or 0.0),
        }
    return output


def validate_isolated_regions(
    image,
    row_reference,
    identity_result,
    number_results,
    expected_names=None,
    requested_fields=None,
):
    """Recover only unresolved fields using raw coordinate references."""
    started = time.perf_counter()
    reset_paddle_timing()
    requested = list(dict.fromkeys(str(v) for v in (requested_fields or []) if str(v)))
    result = {
        "applied": False,
        "ran": False,
        "resolved_identity": False,
        "resolved_fields": [],
        "requested_fields": requested,
        "evidence": {},
        "presence": {},
        "error": None,
        "timing": {},
    }
    if not requested:
        result["timing"] = {"totalSeconds": 0.0, **get_paddle_timing()}
        return result

    fields = row_reference.get("fields") or {}
    batch_items = []
    plans = []
    for field_name in requested:
        if field_name == "username":
            coordinate_ref = fields.get("username") or (identity_result.get("coordinateRef") or {}).get("username")
        else:
            state = number_results.get(field_name) or {}
            coordinate_ref = state.get("coordinateRef") or fields.get(field_name)
        if not isinstance(coordinate_ref, dict):
            continue
        raw_exact = crop_from_ref(image, coordinate_ref)
        presence = region_has_content(raw_exact)
        result["presence"][field_name] = presence

        # Presence is advisory, not authoritative. Thin Rocket League zeros and
        # colored ping glyphs can score poorly even when OCR evidence exists.
        # Skip only a genuinely blank-looking coordinate with no prior OCR clue.
        prior_state = (
            number_results.get(field_name, {})
            if field_name != "username"
            else {}
        )
        prior_candidates = [
            item
            for item in (prior_state.get("candidates") or [])
            if isinstance(item, dict)
            and (
                item.get("value") is not None
                or str(item.get("raw") or "").strip()
            )
        ]
        truly_blank = (
            not presence.get("present")
            and float(presence.get("contrast", 0.0) or 0.0) < 4.0
            and float(presence.get("edgeRatio", 0.0) or 0.0) < 0.004
            and float(presence.get("brightRatio", 0.0) or 0.0) < 0.004
            and not prior_candidates
            and field_name != "username"
        )
        if truly_blank:
            result["evidence"][field_name] = {
                "skipped": True,
                "reason": "coordinate_region_confirmed_blank",
                "presence": presence,
            }
            continue

        variants = [
            spec
            for spec in PADDLE_VARIANT_SPECS
            if field_name != "username" or spec["label"] == "exact"
        ]
        for spec in variants:
            variant = spec["label"]
            raw_crop = crop_from_ref(
                image,
                coordinate_ref,
                expand_x=spec["expandX"],
                expand_y=spec["expandY"],
                shift_x=spec["shiftX"],
                shift_y=spec["shiftY"],
            )
            prepared = _prepare_raw_crop(raw_crop, field_name, variant=variant)
            key = f"{field_name}:{variant}"
            if prepared is None or prepared.size == 0:
                continue
            batch_items.append({"key": key, "image": prepared})
            plans.append({"key": key, "field": field_name, "variant": variant})

    if not batch_items:
        result["timing"] = {"totalSeconds": round(time.perf_counter() - started, 4), **get_paddle_timing()}
        return result

    try:
        reads = _predict_batch(batch_items)
        result["ran"] = True
        result["applied"] = bool(reads)
        for plan in plans:
            field_name = plan["field"]
            read = reads.get(plan["key"], {})
            text = str(read.get("text", "") or "").strip()
            confidence_100 = round(float(read.get("confidence", 0.0) or 0.0) * 100.0, 2)
            result["evidence"].setdefault(field_name, {"reads": []})["reads"].append({
                "variant": plan["variant"],
                "text": text,
                "confidence": confidence_100,
            })
            if field_name == "username":
                clan, username = parse_clan_username(uppercase_text(text))
                if not normalize_name_for_match(username):
                    continue
                current = str(identity_result.get("username") or "")
                current_score = best_expected_score(current, expected_names or [])
                paddle_score = best_expected_score(username, expected_names or [])
                accept = (
                    confidence_100 >= 88.0
                    or (
                        confidence_100 >= 65.0
                        and paddle_score >= max(0.65, current_score + 0.02)
                    )
                )
                if accept:
                    identity_result["username"] = uppercase_text(username)
                    if clan:
                        identity_result["clan"] = uppercase_text(clan)
                    identity_result["username_support"] = max(2, int(identity_result.get("username_support", 0) or 0))
                    identity_result["username_status"] = "paddle_coordinate_validated"
                    result["resolved_identity"] = True
                    if "username" not in result["resolved_fields"]:
                        result["resolved_fields"].append("username")
                continue

            state = number_results.get(field_name)
            if not isinstance(state, dict):
                continue

            # Preserve a ping value already recovered from contextual evidence.
            # Paddle may include signal-bar artifacts, such as reading 28 as 128.
            if (
                field_name == "ping"
                and isinstance(
                    state.get("contextual_resolution"),
                    dict
                )
                and state["contextual_resolution"].get("value") is not None
            ):
                continue

            value = _parse_numeric(text, field_name)
            if value is None:
                continue

            add_candidate(state, {
                "stage": "paddle",
                "engine": "paddle",
                "family": f"paddle_{plan['variant']}",
                "value": int(value),
                "confidence": confidence_100,
                "raw": text,
                "plausible": True,
            })

        # Evaluate once after every Paddle variant for each requested numeric field
        # has been added, so exact/expanded consensus is visible to best-fit logic.
        for field_name in requested:
            if field_name == "username":
                continue

            state = number_results.get(field_name)
            if not isinstance(state, dict):
                continue

            # Do not reevaluate and replace a contextually recovered ping.
            if (
                field_name == "ping"
                and isinstance(
                    state.get("contextual_resolution"),
                    dict
                )
                and state["contextual_resolution"].get("value") is not None
            ):
                continue

            before = is_locked(state)
            evaluate_field_state(state, "paddle")
            if is_locked(state) and not before and field_name not in result["resolved_fields"]:
                result["resolved_fields"].append(field_name)
    except Exception as error:
        result["error"] = str(error)

    result["timing"] = {
        "totalSeconds": round(time.perf_counter() - started, 4),
        **{key: round(float(value or 0.0), 4) for key, value in get_paddle_timing().items()},
    }
    return result


def validate_with_paddle(*args, **kwargs):
    """Legacy API retained only to make stale callers fail clearly, not silently recrop."""
    return {
        "applied": False,
        "ran": False,
        "resolved_identity": False,
        "resolved_fields": [],
        "requested_fields": list(kwargs.get("requested_fields") or []),
        "evidence": {},
        "error": "legacy_validate_with_paddle_disabled_use_coordinate_references",
        "timing": {},
    }
