import re
import time
from pathlib import Path

import cv2

from ocr_evidence import EVIDENCE_VERSION
from ocr_layout import LAYOUT_VERSION, INFORMATIONAL_FIELDS
from ocr_text import TEXT_VERSION, normalize_name_for_match, best_expected_score
from ocr_utils import UTILS_VERSION
from ocr_pass1 import (
    PASS1_VERSION,
    OCR_CROP_SHARPEN_ENABLED,
    OCR_CROP_SHARPEN_AMOUNT,
    OCR_CROP_SHARPEN_SIGMA,
    OCR_SHARPEN_FIELDS,
    build_coordinate_references,
    read_identity_pass1,
    read_numeric_pass1,
)
from ocr_pass2 import PASS2_VERSION, read_identity_pass2, read_numeric_pass2
from ocr_pass3 import (
    PASS3_VERSION,
    PASS3A_SWEEP_SPECS,
    PASS3B_SWEEP_SPECS,
    apply_expected_name_matching,
    read_numeric_pass3a,
    read_numeric_pass3b,
    apply_zero_seven_specialist,
    deepen_identity,
    finalize_unresolved_numeric_defaults,
    evaluate_stat_plausibility,
    build_player_validation,
)
from paddleocr_validation import (
    PADDLE_VALIDATION_VERSION,
    PADDLE_VARIANT_SPECS,
    set_progress_callback as set_paddle_progress_callback,
    validate_isolated_regions,
)
from zero_seven import ZERO_SEVEN_VERSION
from ocr_confidence import CONFIDENCE_VERSION, build_confidence_summary
from ocr_field_state import (
    FIELD_STATE_VERSION,
    new_field_state,
    add_candidate,
    evaluate_field_state,
    build_paddle_request_fields,
    summarize_locks,
    is_locked,
)
from ocr_identity import validate_expected_roster
from ocr_config import CONFIG_VERSION
from preparation import PREPARATION_VERSION, prepare_scoreboard
from ocr_debug import (
    debug_manifest,
    save_final_layout_overlay,
    save_structure_overlay,
    save_coordinate_reference_overlay,
    save_stage_crop_sheet,
    save_stage_variant_crop_sheet,
    save_pass1_sharpen_comparison,
)

OCR_VERSION = "main-v16.8-resilient-digits-username-only"


def _pipeline_versions():
    return {
        "config": CONFIG_VERSION,
        "confidence": CONFIDENCE_VERSION,
        "fieldState": FIELD_STATE_VERSION,
        "evidence": EVIDENCE_VERSION,
        "layout": LAYOUT_VERSION,
        "text": TEXT_VERSION,
        "utils": UTILS_VERSION,
        "preparation": PREPARATION_VERSION,
        "main": OCR_VERSION,
        "pass1": PASS1_VERSION,
        "pass2": PASS2_VERSION,
        "pass3": PASS3_VERSION,
        "zeroSeven": ZERO_SEVEN_VERSION,
        "paddle": PADDLE_VALIDATION_VERSION,
    }


def _progress(callback, stage, value):
    if callback is None:
        return
    try:
        callback(stage, value)
    except Exception:
        pass


def _strip_leading_bracket_prefix(value):
    value = str(value or "").strip()
    match = re.match(
        r"^\s*[^\s\]]{0,12}\]\s+(.+?)\s*$",
        value,
    )
    if match is None:
        return value
    suffix = str(match.group(1) or "").strip()
    return suffix if normalize_name_for_match(suffix) else value


def _merge_identity_pass2(identity, second):
    second = second if isinstance(second, dict) else {}
    identity.setdefault("reads", []).extend(second.get("username_reads") or [])
    first_name = normalize_name_for_match(identity.get("username"))
    second_name = normalize_name_for_match(second.get("username"))
    if first_name and second_name and first_name == second_name:
        identity["username_support"] = max(2, int(identity.get("username_support", 0) or 0))
        if second.get("clan") and not identity.get("clan"):
            identity["clan"] = second.get("clan")
    elif second_name:
        # Pass 2 is a validation pass, not an unconditional override. Prefer its
        # reading only when it is clearly more confident than Pass 1.
        second_conf = float(second.get("username_confidence", 0.0) or 0.0)
        first_conf = max(
            [float(r.get("confidence", 0.0) or 0.0) for r in identity.get("reads", []) if str(r.get("stage")) == "pass1"],
            default=0.0,
        )
        if not first_name or second_conf >= first_conf + 8.0:
            identity["username"] = second.get("username", "")
            identity["clan"] = second.get("clan", identity.get("clan", ""))
        identity["username_support"] = 1
    identity["username"] = _strip_leading_bracket_prefix(
        identity.get("username")
    )
    return identity


def _numeric_fields(middle_stat_name):
    return ("score", "goals", middle_stat_name, "saves", "shots", "ping")


def _team_expected_names(expected_names, team_index, players_per_team):
    start = 0 if int(team_index) == 1 else int(players_per_team)
    return list(expected_names[start:start + int(players_per_team)])


def build_player_public_result(player, validation, middle_stat_name):
    validation = validation if isinstance(validation, dict) else {}
    review = validation.get("two_check_review", {})
    field_confidence = review.get("field_confidence", {})
    warnings = list(dict.fromkeys((review.get("stat_warnings") or []) + [
        f"{field}_needs_review" for field in (review.get("numeric_review_fields") or [])
    ]))
    row_anchor = player.get("rowAnchor", {})
    departed_ping = (
        player.get("ping") is None
        and row_anchor.get("has_ping_anchor") is not True
        and row_anchor.get("has_stat_anchor") is True
    )
    if departed_ping and "player_departed_ping_unavailable" not in warnings:
        warnings.append("player_departed_ping_unavailable")
    values = [
        (float(player.get("matchConfidence", 0.0) or 0.0), 0.20),
        (float(field_confidence.get("score", 0.0) or 0.0), 0.20),
        (float(field_confidence.get("goals", 0.0) or 0.0), 0.20),
        (float(field_confidence.get(middle_stat_name, 0.0) or 0.0), 0.10),
        (float(field_confidence.get("saves", 0.0) or 0.0), 0.10),
        (float(field_confidence.get("shots", 0.0) or 0.0), 0.10),
        (float(row_anchor.get("confidence", 0.0) or 0.0) * 100.0, 0.10),
    ]
    overall = sum(value * weight for value, weight in values) / max(0.0001, sum(weight for _, weight in values))
    if review.get("needs_review"):
        overall = min(overall, 79.0)
    return {
        "player": player.get("matchedName") or player.get("username") or "",
        "details": {
            "score": player.get("score", 0),
            "goals": player.get("goals", 0),
            middle_stat_name: player.get(middle_stat_name, 0),
            "saves": player.get("saves", 0),
            "shots": player.get("shots", 0),
            "ping": None if departed_ping else player.get("ping"),
        },
        "confidence": round(overall, 2),
        "warnings": warnings,
    }


def build_public_result(players, validations, middle_stat_name, overall_validated, players_needing_review):
    by_index = {int(v.get("player_index", 0) or 0): v for v in validations}
    public_players = [build_player_public_result(p, by_index.get(i, {}), middle_stat_name) for i, p in enumerate(players, 1)]
    confidence_summary = build_confidence_summary(
        public_players=public_players,
        player_validations=validations,
        validation_pass=overall_validated,
        players_needing_review=players_needing_review,
    )
    return {
        "team1": [pp for pp, p in zip(public_players, players) if int(p.get("teamIndex", 0) or 0) == 1],
        "team2": [pp for pp, p in zip(public_players, players) if int(p.get("teamIndex", 0) or 0) == 2],
        "validation": {"pass": bool(overall_validated), "players_needing_review": int(players_needing_review)},
        "confidenceSummary": confidence_summary,
        "status": "completed" if overall_validated else "failed",
        "success": bool(overall_validated),
    }


def read_scoreboard_image(image_path, players_per_team, expected_player_names=None, progress_callback=None):
    pipeline_started = time.perf_counter()
    stage_timings = {}
    set_paddle_progress_callback(progress_callback)

    image_path = Path(image_path)
    if not image_path.exists():
        return {"success": False, "message": "Image file does not exist."}
    image = cv2.imread(str(image_path))
    if image is None:
        return {"success": False, "message": "Could not load image."}

    roster = validate_expected_roster(expected_player_names, players_per_team)
    if not roster["valid"]:
        return {
            "success": False,
            "stoppedEarly": True,
            "fullOcrStarted": False,
            "failureStage": "expected_roster",
            "message": "A complete unique expected-player roster is required before OCR can start.",
            "expectedPlayers": roster["expectedPlayers"],
            "submittedExpectedPlayers": len(roster["names"]),
        }
    expected_players = roster["expectedPlayers"]
    expected_names = roster["names"]
    expected_name_keys = roster["keys"]

    # ------------------------------------------------------------------
    # FOUNDATION / BOUNDING BOX GATE. Nothing OCR-related runs before this.
    # ------------------------------------------------------------------
    _progress(progress_callback, "foundation", 15)
    started = time.perf_counter()
    preflight = prepare_scoreboard(image, players_per_team, expected_names)
    stage_timings["foundationSeconds"] = round(time.perf_counter() - started, 4)
    if not preflight.get("pass"):
        debug_image = preflight.pop("_debugImage", image)

        save_structure_overlay(
            debug_image,
            preflight,
            players_per_team
        )

        return {
            "success": False,
            "stoppedEarly": True,
            "fullOcrStarted": False,
            "failureStage": "foundation",
            "message": "The bounding-box foundation failed validation; OCR stages were not started.",
            "preflight": preflight,
            "pipelineVersions": _pipeline_versions(),
            "visualDebug": debug_manifest(),
        }

    prepared_image = preflight.pop("_preparedImage", None)
    if prepared_image is not None and getattr(prepared_image, "size", 0):
        image = prepared_image
    prepared_data = preflight.get("preparedData") if isinstance(preflight.get("preparedData"), dict) else {}
    row_anchors = list(prepared_data.get("rowAnchors") or [])
    column_geometry = prepared_data.get("columnGeometry") if isinstance(prepared_data.get("columnGeometry"), dict) else {}
    middle_stat_name = str(prepared_data.get("middleStat") or "").lower()
    foundation_errors = []
    if len(row_anchors) != expected_players:
        foundation_errors.append("row_anchor_count")
    if middle_stat_name not in {"assists", "demos"}:
        foundation_errors.append("middle_stat")
    if not prepared_data.get("foundationPassed", True):
        foundation_errors.append("foundation_not_confirmed")
    required_geometry = {
        "name",
        "score",
        "goals",
        "middle",
        "saves",
        "shots",
        "ping"
    }

    if not required_geometry.issubset(
        column_geometry.keys()
    ):
        foundation_errors.append(
            "column_geometry"
        )

    # Always render the best structural evidence we have BEFORE a contract
    # failure can return. Debug mode 4 must remain useful even when OCR never
    # reaches coordinate-reference generation.
    save_structure_overlay(
        image,
        preflight,
        players_per_team
    )

    if foundation_errors:
        return {
            "success": False,
            "stoppedEarly": True,
            "fullOcrStarted": False,
            "failureStage": "foundation_contract",
            "message": "Foundation passed visually but did not provide a complete coordinate contract.",
            "evidenceContractErrors": foundation_errors,
            "preflight": preflight,
            "pipelineVersions": _pipeline_versions(),
            "visualDebug": debug_manifest(),
        }

    # ------------------------------------------------------------------
    # Freeze row/field coordinate references once. Passes 1/2/3/Paddle reuse them.
    # ------------------------------------------------------------------
    started = time.perf_counter()
    row_references = build_coordinate_references(image, row_anchors, column_geometry, middle_stat_name)
    stage_timings["coordinateReferenceSeconds"] = round(time.perf_counter() - started, 4)
    save_coordinate_reference_overlay(image, row_references)

    contexts = []
    for index, (anchor, row_ref) in enumerate(zip(row_anchors, row_references), start=1):
        states = {
            field: new_field_state(field, (row_ref.get("fields") or {}).get(field))
            for field in _numeric_fields(middle_stat_name)
        }
        contexts.append({
            "playerIndex": index,
            "anchor": anchor,
            "reference": row_ref,
            "identity": None,
            "fields": states,
            "paddle": {},
            "timing": {},
        })

    # ------------------------------------------------------------------
    # OCR PASS 1: baseline read + ping/stat-centered row coordinate reference.
    # ------------------------------------------------------------------
    _progress(progress_callback, "ocr_pass1", 38)
    save_stage_crop_sheet(image, row_references, "pass1")

    if OCR_CROP_SHARPEN_ENABLED:
        save_pass1_sharpen_comparison(
            image,
            row_references,
            OCR_SHARPEN_FIELDS,
            amount=OCR_CROP_SHARPEN_AMOUNT,
            blur_sigma=OCR_CROP_SHARPEN_SIGMA,
        )

    started = time.perf_counter()
    for context in contexts:
        row_started = time.perf_counter()
        context["identity"] = read_identity_pass1(image, context["reference"])
        for field_name, state in context["fields"].items():
            candidate, presence = read_numeric_pass1(image, state["coordinateRef"], field_name)
            state["presence"] = presence
            add_candidate(state, candidate)
            evaluate_field_state(state, "pass1")
        context["timing"]["ocrPass1Seconds"] = round(time.perf_counter() - row_started, 4)
    stage_timings["ocrPass1Seconds"] = round(time.perf_counter() - started, 4)

    # ------------------------------------------------------------------
    # OCR PASS 2: slightly deeper validation against exactly the same references.
    # ------------------------------------------------------------------
    _progress(progress_callback, "ocr_pass2", 58)
    save_stage_crop_sheet(image, row_references, "pass2")
    started = time.perf_counter()
    for context in contexts:
        row_started = time.perf_counter()
        context["identity"] = _merge_identity_pass2(context["identity"], read_identity_pass2(image, context["reference"]))
        for field_name, state in context["fields"].items():
            candidates, presence = read_numeric_pass2(image, state["coordinateRef"], field_name)
            state["presence"] = presence
            for candidate in candidates:
                add_candidate(state, candidate)
            evaluate_field_state(state, "pass2")
        context["timing"]["ocrPass2Seconds"] = round(time.perf_counter() - row_started, 4)
    stage_timings["ocrPass2Seconds"] = round(time.perf_counter() - started, 4)

    # ------------------------------------------------------------------
    # OCR PASS 3A: targeted sweep only on fields Pass 1/2 did not lock.
    # ------------------------------------------------------------------
    _progress(progress_callback, "ocr_pass3a", 72)
    requested_a = {
        c["playerIndex"]: [name for name, state in c["fields"].items() if not is_locked(state)]
        for c in contexts
    }
    save_stage_crop_sheet(image, row_references, "pass3a", requested_a)
    save_stage_variant_crop_sheet(
        image,
        row_references,
        "pass3a",
        requested_a,
        PASS3A_SWEEP_SPECS,
    )
    started = time.perf_counter()
    for context in contexts:
        row_started = time.perf_counter()
        if int(context["identity"].get("username_support", 0) or 0) < 2:
            context["identity"] = deepen_identity(image, context["reference"], context["identity"])
        for field_name, state in context["fields"].items():
            if is_locked(state):
                continue
            for candidate in read_numeric_pass3a(image, state["coordinateRef"], field_name):
                add_candidate(state, candidate)
            evaluate_field_state(state, "pass3a")
        context["timing"]["ocrPass3ASeconds"] = round(time.perf_counter() - row_started, 4)
    stage_timings["ocrPass3ASeconds"] = round(time.perf_counter() - started, 4)

    # ------------------------------------------------------------------
    # OCR PASS 3B: deeper sweep only where 3A still cannot lock a number.
    # ------------------------------------------------------------------
    _progress(progress_callback, "ocr_pass3b", 84)
    requested_b = {
        c["playerIndex"]: [name for name, state in c["fields"].items() if not is_locked(state)]
        for c in contexts
    }
    save_stage_crop_sheet(image, row_references, "pass3b", requested_b)
    save_stage_variant_crop_sheet(
        image,
        row_references,
        "pass3b",
        requested_b,
        PASS3B_SWEEP_SPECS,
    )
    started = time.perf_counter()
    for context in contexts:
        row_started = time.perf_counter()
        for field_name, state in context["fields"].items():
            if is_locked(state):
                continue
            for candidate in read_numeric_pass3b(image, state["coordinateRef"], field_name):
                add_candidate(state, candidate)
            evaluate_field_state(state, "pass3b")
            if not is_locked(state):
                apply_zero_seven_specialist(image, state["coordinateRef"], state)
        context["timing"]["ocrPass3BSeconds"] = round(time.perf_counter() - row_started, 4)
    stage_timings["ocrPass3BSeconds"] = round(time.perf_counter() - started, 4)
    stage_timings["ocrPass3Seconds"] = round(stage_timings["ocrPass3ASeconds"] + stage_timings["ocrPass3BSeconds"], 4)

    # ------------------------------------------------------------------
    # PADDLE: only isolated failed/conflicting coordinate refs. Raw coordinate
    # crops are recut from the prepared scoreboard; Pass-1 sanitized images are
    # never passed into Paddle.
    # ------------------------------------------------------------------
    _progress(progress_callback, "paddle", 92)
    requested_paddle = {}
    for context in contexts:
        identity = context["identity"]
        team_expected = _team_expected_names(expected_names, context["anchor"].get("team_index"), players_per_team)
        identity_score = best_expected_score(identity.get("username", ""), team_expected)
        requested = build_paddle_request_fields(identity, context["fields"], include_informational=True)
        if identity_score < 0.70 and "username" not in requested:
            requested.insert(0, "username")
        requested_paddle[context["playerIndex"]] = requested
    save_stage_crop_sheet(image, row_references, "paddle", requested_paddle)
    save_stage_variant_crop_sheet(
        image,
        row_references,
        "paddle",
        requested_paddle,
        PADDLE_VARIANT_SPECS,
    )
    started = time.perf_counter()
    for context in contexts:
        row_started = time.perf_counter()
        requested = requested_paddle.get(context["playerIndex"], [])
        context["paddle"] = validate_isolated_regions(
            image=image,
            row_reference=context["reference"],
            identity_result=context["identity"],
            number_results=context["fields"],
            expected_names=_team_expected_names(expected_names, context["anchor"].get("team_index"), players_per_team),
            requested_fields=requested,
        )
        context["timing"]["paddleSeconds"] = round(time.perf_counter() - row_started, 4)
        paddle_timing = context["paddle"].get("timing", {})
        context["timing"]["paddleModelInitSeconds"] = float(paddle_timing.get("modelInitSeconds", 0.0) or 0.0)
        context["timing"]["paddleInferenceSeconds"] = float(paddle_timing.get("inferenceSeconds", 0.0) or 0.0)
        context["timing"]["paddleCalls"] = int(paddle_timing.get("calls", 0) or 0)
    stage_timings["paddleSeconds"] = round(time.perf_counter() - started, 4)
    stage_timings["paddleModelInitSeconds"] = round(sum(c["timing"].get("paddleModelInitSeconds", 0.0) for c in contexts), 4)
    stage_timings["paddleInferenceSeconds"] = round(sum(c["timing"].get("paddleInferenceSeconds", 0.0) for c in contexts), 4)
    stage_timings["paddleCalls"] = sum(c["timing"].get("paddleCalls", 0) for c in contexts)

    # ------------------------------------------------------------------
    # FINALIZE PLAYER OBJECTS / VALIDATION.
    # ------------------------------------------------------------------
    _progress(progress_callback, "final_validation", 97)
    players = []
    team_counts = {1: 0, 2: 0}
    for context in contexts:
        finalize_unresolved_numeric_defaults(context["fields"])
        anchor = context["anchor"]
        team_index = int(anchor.get("team_index", 0) or 0)
        team_counts[team_index] = team_counts.get(team_index, 0) + 1
        identity = context["identity"]
        identity["username"] = _strip_leading_bracket_prefix(
            identity.get("username")
        )
        values = {name: state.get("value") for name, state in context["fields"].items()}
        player = {
            "team": f"TEAM {team_index}",
            "teamIndex": team_index,
            "teamPlayerIndex": team_counts[team_index],
            "clan": identity.get("clan", ""),
            "username": identity.get("username", ""),
            "score": values.get("score", 0),
            "goals": values.get("goals", 0),
            middle_stat_name: values.get(middle_stat_name, 0),
            "saves": values.get("saves", 0),
            "shots": values.get("shots", 0),
            "ping": values.get("ping"),
            "ocrMode": "foundation_coordinate_pass1_pass2_pass3_paddle",
            "needsPaddleOCR": bool(requested_paddle.get(context["playerIndex"])),
            "paddleApplied": bool(context["paddle"].get("applied")),
            "paddleResolvedFields": list(context["paddle"].get("resolved_fields") or []),
            "rowAnchor": {
                "type": anchor.get("type"),
                "orientation": anchor.get("orientation"),
                "confidence": anchor.get("confidence"),
                "has_ping_anchor": anchor.get("has_ping_anchor"),
                "has_stat_anchor": anchor.get("has_stat_anchor"),
                "numberCenterY": context["reference"].get("numberCenterY"),
                "centerSource": context["reference"].get("centerSource"),
            },
        }
        context["player"] = player
        players.append(player)

    matching = apply_expected_name_matching(players, expected_names, players_per_team)
    validations = []
    for context in contexts:
        validations.append(build_player_validation(
            context["playerIndex"],
            context["player"],
            context["anchor"],
            context["reference"],
            context["identity"],
            context["fields"],
            timing=context["timing"],
            paddle_result=context["paddle"],
        ))

    save_final_layout_overlay(image, row_anchors, players)

    player_count_pass = len(players) == expected_players
    all_resolved_pass = bool(validations) and all(v.get("resolved", {}).get("pass") for v in validations)
    review_count = sum(1 for v in validations if v.get("two_check_review", {}).get("needs_review"))
    two_check_pass = bool(validations) and review_count == 0
    matched_keys = [normalize_name_for_match(p.get("matchedName")) for p in players]
    roster_coverage = (
        len(matched_keys) == expected_players
        and all(matched_keys)
        and len(set(matched_keys)) == expected_players
        and set(matched_keys) == set(expected_name_keys)
    )
    matching_pass = bool(matching.get("strictPass")) and roster_coverage
    overall_validated = player_count_pass and all_resolved_pass and two_check_pass and matching_pass

    # Compatibility timing keys retained for existing telemetry consumers.
    stage_timings["ocrPass12Seconds"] = round(stage_timings["ocrPass1Seconds"] + stage_timings["ocrPass2Seconds"], 4)
    stage_timings["playerOcrSeconds"] = round(
        stage_timings["ocrPass1Seconds"] + stage_timings["ocrPass2Seconds"] + stage_timings["ocrPass3Seconds"] + stage_timings["paddleSeconds"], 4
    )
    stage_timings["recoverySeconds"] = round(stage_timings["ocrPass3Seconds"], 4)
    stage_timings["perPlayer"] = [
        {"playerIndex": c["playerIndex"], "team": c["player"].get("team"), **c["timing"]}
        for c in contexts
    ]

    all_warnings = []
    for validation in validations:
        if validation.get("two_check_review", {}).get("stat_warnings"):
            all_warnings.append({
                "player_index": validation.get("player_index"),
                "warnings": validation["two_check_review"]["stat_warnings"],
            })
    validation_report = {
        "pipeline": "foundation -> pass1 -> pass2 -> pass3a -> pass3b -> isolated_paddle -> final",
        "foundation_check": {
            "pass": True,
            "detected_rows": len(row_anchors),
            "expected_rows": expected_players,
            "column_geometry_source": column_geometry.get("source"),
            "coordinate_space": (prepared_data.get("evidenceReuse") or {}).get("coordinateSpace"),
        },
        "row_anchor_check": {
            "pass": len(row_anchors) == expected_players,
            "expected_rows": expected_players,
            "detected_rows": len(row_anchors),
            "coordinateReferences": row_references,
        },
        "field_lock_summary": {
            "players": [
                {"playerIndex": c["playerIndex"], **summarize_locks(c["fields"])}
                for c in contexts
            ]
        },
        "two_check_review": {
            "pass": two_check_pass,
            "players_needing_review": review_count,
            "players": validations,
        },
        "paddle_ocr": {
            "requested_players": sum(
                1
                for values in requested_paddle.values()
                if values
            ),
            "applied_players": sum(
                1
                for c in contexts
                if c["paddle"].get("applied")
            ),
            "used": any(
                c["paddle"].get("applied")
                for c in contexts
            ),
            "requestedFieldsByPlayer": requested_paddle,
            "errorsByPlayer": {
                str(c["playerIndex"]): c["paddle"].get("error")
                for c in contexts
                if c["paddle"].get("error")
            },
            "presenceByPlayer": {
                str(c["playerIndex"]): dict(
                    c["paddle"].get("presence") or {}
                )
                for c in contexts
                if c["paddle"].get("presence")
            },
        },
        "resolved_data_check": {"pass": player_count_pass and all_resolved_pass},
        "stat_plausibility": {"warning_players": len(all_warnings), "warnings": all_warnings},
        "name_matching_check": {
            "pass": matching_pass,
            "enabled": matching.get("enabled"),
            "required": True,
            "strict_pass": matching.get("strictPass", False),
            "all_matched": matching.get("allMatched", False),
            "all_confident": matching.get("allConfident", False),
            "all_unique": matching.get("allUnique", False),
            "final_roster_coverage_pass": roster_coverage,
            "expected_name_count_pass": len(expected_names) == expected_players,
            "low_confidence_count": matching.get("lowConfidenceCount", 0),
            "ambiguous_count": matching.get("ambiguousCount", 0),
            "matches": matching.get("matches", []),
        },
        "overall": "validated" if overall_validated else "review",
    }

    stage_timings["finalValidationSeconds"] = 0.0
    stage_timings["totalSeconds"] = round(time.perf_counter() - pipeline_started, 4)

    public_result = build_public_result(players, validations, middle_stat_name, overall_validated, review_count)
    clean_players = []
    for player in players:
        clean_players.append({
            "team": player.get("team"),
            "teamIndex": player.get("teamIndex"),
            "teamPlayerIndex": player.get("teamPlayerIndex"),
            "clan": player.get("clan", ""),
            "username": player.get("username", ""),
            "score": player.get("score", 0),
            "goals": player.get("goals", 0),
            middle_stat_name: player.get(middle_stat_name, 0),
            "saves": player.get("saves", 0),
            "shots": player.get("shots", 0),
            "ping": player.get("ping"),
            "matchedName": str(player.get("matchedName") or ""),
            "matchConfidence": float(player.get("matchConfidence", 0.0) or 0.0),
            "matchMargin": float(player.get("matchMargin", 0.0) or 0.0),
            "matchStatus": str(player.get("matchStatus") or "UNMATCHED"),
            "ocrMode": player.get("ocrMode"),
            "needsPaddleOCR": player.get("needsPaddleOCR", False),
            "paddleApplied": player.get("paddleApplied", False),
            "paddleResolvedFields": player.get("paddleResolvedFields", []),
            "rowAnchor": player.get("rowAnchor", {}),
        })

    preflight_summary = {
        key: preflight.get(key)
        for key in (
            "pass", "reason", "stage", "matchSize", "width", "height", "aspectRatio",
            "detectedPingRegions", "detectedStatRows", "detectedRows", "directAnchorRows",
            "pingStatRows", "preflightConfidence", "preflightConfidenceComponents", "warnings",
            "headerHits", "middleStat", "teamStructure", "autoAlignment",
        )
        if key in preflight
    }
    response = {
        "success": bool(overall_validated),
        "pipelineVersions": _pipeline_versions(),
        "matchSize": f"{players_per_team}v{players_per_team}",
        "playersPerTeam": players_per_team,
        "expectedPlayers": expected_players,
        "middleStat": middle_stat_name,
        "detectedPlayers": len(clean_players),
        "preflightSummary": preflight_summary,
        "teams": [
            {"team": "TEAM 1", "teamIndex": 1, "players": [p for p in clean_players if p["teamIndex"] == 1]},
            {"team": "TEAM 2", "teamIndex": 2, "players": [p for p in clean_players if p["teamIndex"] == 2]},
        ],
        "players": clean_players,
        "validation": validation_report,
        "publicResult": public_result,
        "performance": stage_timings,
        "visualDebug": debug_manifest(),
    }
    if not overall_validated:
        response.update({
            "stoppedEarly": False,
            "fullOcrStarted": True,
            "failureStage": "final_validation",
            "message": "OCR completed, but one or more coordinate-referenced fields or roster matches remain unresolved.",
        })
    else:
        response["message"] = "Scoreboard OCR validated successfully."
    return response
