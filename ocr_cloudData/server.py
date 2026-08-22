import hmac
import json
import logging
import re
import tempfile
import time
import traceback
from pathlib import Path
from uuid import uuid4

import cv2
import numpy as np
from flask import Flask, Response, jsonify, request

from ocr import read_scoreboard_image
from ocr_evidence import EVIDENCE_VERSION
from ocr_layout import LAYOUT_VERSION
from ocr_text import TEXT_VERSION
from ocr_utils import UTILS_VERSION
from ocr_config import (
    LOW_CONFIDENCE_THRESHOLD,
    OCR_API_KEY,
    OCR_DEBUG_LEVEL,
    OCR_DEBUG_STORAGE_PREFIX,
    OCR_MAX_UPLOAD_SIZE_MB,
    OCR_PROCESS_MAX_ATTEMPTS,
    OCR_PROGRESS_WRITE_MIN_DELTA,
    OCR_PROGRESS_WRITE_MIN_INTERVAL_SECONDS,
    OCR_TASK_TOKEN
)
from ocr_diagnostics import (
    build_run_report,
    debug_enabled,
    mark_stage,
    profile_ocr_run
)
from ocr_debug import (
    begin_debug_context,
    clear_debug_context,
    collect_debug_files,
    save_localization_overlay
)
from ocr_identity import (
    IDENTITY_VERSION,
    normalize_expected_names,
    validate_expected_roster
)
from ocr_text import normalize_name_for_match
from ocr_results import (
    build_detail_result,
    build_public_result_from_ocr,
    build_usage_result
)
from ocr_store import (
    STORE_VERSION,
    claim_job_for_processing,
    complete_job,
    create_job,
    delete_object,
    download_object_bytes,
    download_object_to_file,
    enqueue_job,
    fail_job,
    get_job,
    public_job,
    read_json_artifact,
    update_job,
    update_job_progress,
    upload_debug_file,
    upload_source_image,
    validate_store_configuration,
    write_json_artifact
)
from paddle_runtime import (
    get_runtime_status as get_paddle_runtime_status,
    model_loaded as paddle_model_loaded,
    warm_model as warm_paddle_model
)
from preparation import (
    PREPARATION_VERSION,
    localize_scoreboard
)


SERVER_VERSION = "server-v3.3-shared-roster-contract"
LOGGER = logging.getLogger("bpd.ocr.server")

app = Flask(__name__)
# Browser traffic is same-origin through the Cloudflare Worker, so Cloud Run
# does not need a permissive CORS layer. The private API key remains the
# application-level gate for /api/ocr/* endpoints.
app.config["MAX_CONTENT_LENGTH"] = (
    OCR_MAX_UPLOAD_SIZE_MB
    * 1024
    * 1024
)

ALLOWED_EXTENSIONS = {
    ".png",
    ".jpg",
    ".jpeg",
    ".webp"
}

OCR_PROGRESS_MILESTONES = {
    "job_accepted": 3,
    "initializing": 5,
    "paddle_warmup": 8,
    "foundation": 15,
    "preflight": 15,
    "rows_located": 30,
    "ocr_pass1": 38,
    "ocr_pass2": 58,
    "ocr_pass3a": 72,
    "ocr_pass3b": 84,
    "paddle": 92,
    "final_validation": 97,
    "completed": 100
}


# ============================================================
# AUTHENTICATION
# ============================================================

@app.before_request
def require_ocr_authentication():
    if request.method == "OPTIONS":
        return None

    if not request.path.startswith("/api/ocr"):
        return None

    if not OCR_API_KEY:
        LOGGER.error("OCR_API_KEY is not configured.")
        return jsonify({
            "success": False,
            "message": "OCR service authentication is not configured."
        }), 503

    received_key = request.headers.get(
        "X-API-Key",
        ""
    ).strip()

    if (
        not received_key
        or not hmac.compare_digest(
            received_key,
            OCR_API_KEY
        )
    ):
        return jsonify({
            "success": False,
            "message": "Unauthorized."
        }), 401

    if request.path == "/api/ocr/process":
        if not OCR_TASK_TOKEN:
            LOGGER.error("OCR_TASK_TOKEN is not configured.")
            return jsonify({
                "success": False,
                "message": "OCR task authentication is not configured."
            }), 503

        received_task_token = request.headers.get(
            "X-OCR-Task-Token",
            ""
        ).strip()

        if (
            not received_task_token
            or not hmac.compare_digest(
                received_task_token,
                OCR_TASK_TOKEN
            )
        ):
            return jsonify({
                "success": False,
                "message": "Unauthorized task delivery."
            }), 401

    return None


# ============================================================
# REQUEST HELPERS
# ============================================================

def parse_expected_player_names(value):
    if value is None:
        return []

    parsed = value

    if isinstance(value, str):
        text = value.strip()

        if not text:
            return []

        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            parsed = [
                item.strip()
                for item in text.split(",")
                if item.strip()
            ]

    if not isinstance(parsed, list):
        return []

    return normalize_expected_names(parsed)


def normalize_job_id(value):
    value = str(value or "").strip()

    if re.fullmatch(
        r"[A-Za-z0-9_-]{8,128}",
        value
    ):
        return value

    return uuid4().hex


def get_image_upload():
    if "image" not in request.files:
        return None, None, None, (
            jsonify({
                "success": False,
                "message": "No image was uploaded."
            }),
            400
        )

    image_file = request.files["image"]

    if not image_file.filename:
        return None, None, None, (
            jsonify({
                "success": False,
                "message": "Uploaded image has no filename."
            }),
            400
        )

    extension = Path(
        image_file.filename
    ).suffix.lower()

    if extension not in ALLOWED_EXTENSIONS:
        return None, None, None, (
            jsonify({
                "success": False,
                "message": (
                    "Unsupported image type. Use PNG, JPG, JPEG, or WEBP."
                )
            }),
            400
        )

    image_bytes = image_file.read()

    if not image_bytes:
        return None, None, None, (
            jsonify({
                "success": False,
                "message": "Uploaded image is empty."
            }),
            400
        )

    decoded = cv2.imdecode(
        np.frombuffer(
            image_bytes,
            dtype=np.uint8
        ),
        cv2.IMREAD_COLOR
    )

    if decoded is None or decoded.size == 0:
        return None, None, None, (
            jsonify({
                "success": False,
                "message": "Uploaded file is not a readable image."
            }),
            400
        )

    return (
        image_file,
        image_bytes,
        decoded,
        None
    )


def parse_players_per_team():
    raw = (
        request.form.get("playersPerTeam")
        or (
            request.get_json(silent=True) or {}
        ).get("playersPerTeam")
    )

    try:
        value = int(raw)
    except (TypeError, ValueError):
        return None

    if value not in {1, 2, 3, 4}:
        return None

    return value


def validate_submitted_roster(
    players_per_team,
    expected_player_names
):
    """Compatibility wrapper around the shared roster contract."""
    return validate_expected_roster(
        expected_player_names,
        players_per_team
    )


# ============================================================
# DEFENSE-IN-DEPTH FINAL VALIDATION
# ============================================================

def validate_final_ocr_result(
    result,
    expected_player_names,
    expected_players,
    players_per_team
):
    if not isinstance(result, dict):
        return False, {
            "stage": "server_validation",
            "reason": "OCR result is not an object."
        }

    players = result.get("players")

    if not isinstance(players, list):
        return False, {
            "stage": "server_validation",
            "reason": "OCR result does not contain a player list."
        }

    if len(players) != expected_players:
        return False, {
            "stage": "server_validation",
            "reason": (
                "OCR player row count does not match the submitted match size."
            ),
            "expectedPlayers": expected_players,
            "detectedPlayers": len(players)
        }

    roster_contract = validate_expected_roster(
        expected_player_names,
        players_per_team
    )
    expected_names = roster_contract[
        "names"
    ]
    expected_keys = roster_contract[
        "keys"
    ]

    if (
        not roster_contract["valid"]
        or roster_contract["expectedPlayers"]
        != expected_players
    ):
        return False, {
            "stage": "server_validation",
            "reason": (
                "Submitted expected-player roster is incomplete or duplicated."
            )
        }

    expected_set = set(expected_keys)
    team_expected_sets = {
        1: set(expected_keys[:players_per_team]),
        2: set(expected_keys[players_per_team:])
    }
    matched_keys = []

    for index, player in enumerate(
        players,
        start=1
    ):
        if not isinstance(player, dict):
            return False, {
                "stage": "server_validation",
                "reason": f"Player row {index} is not a valid object."
            }

        team_index = int(
            player.get("teamIndex", 0)
            or 0
        )

        if team_index not in {1, 2}:
            return False, {
                "stage": "server_validation",
                "reason": f"Player row {index} has no valid physical team."
            }

        matched_name = str(
            player.get("matchedName")
            or ""
        ).strip()
        matched_key = normalize_name_for_match(
            matched_name
        )

        if not matched_key:
            return False, {
                "stage": "server_validation",
                "reason": f"Player row {index} has no matchedName."
            }

        try:
            confidence = float(
                player.get("matchConfidence")
            )
        except (TypeError, ValueError):
            return False, {
                "stage": "server_validation",
                "reason": (
                    f"Player row {index} has no valid matchConfidence."
                )
            }

        if confidence < LOW_CONFIDENCE_THRESHOLD:
            return False, {
                "stage": "server_validation",
                "reason": (
                    f"Player row {index} did not meet the minimum "
                    "roster-match confidence."
                ),
                "matchedName": matched_name,
                "matchConfidence": round(confidence, 2),
                "requiredConfidence": LOW_CONFIDENCE_THRESHOLD
            }

        if str(player.get("matchStatus") or "") != "MATCHED":
            return False, {
                "stage": "server_validation",
                "reason": f"Player row {index} was not uniquely matched.",
                "matchedName": matched_name,
                "matchConfidence": round(confidence, 2),
                "matchStatus": player.get("matchStatus")
            }

        if matched_key not in expected_set:
            return False, {
                "stage": "server_validation",
                "reason": (
                    f"Player row {index} matched outside the submitted roster."
                ),
                "matchedName": matched_name
            }

        if matched_key not in team_expected_sets[team_index]:
            return False, {
                "stage": "server_validation",
                "reason": (
                    f"Player row {index} matched a player from the wrong "
                    "physical team."
                ),
                "teamIndex": team_index,
                "matchedName": matched_name
            }

        matched_keys.append(matched_key)

    if (
        len(set(matched_keys)) != expected_players
        or set(matched_keys) != expected_set
    ):
        return False, {
            "stage": "server_validation",
            "reason": (
                "OCR roster coverage does not exactly match the submitted roster."
            )
        }

    validation = result.get("validation")

    if (
        not isinstance(validation, dict)
        or validation.get("overall") != "validated"
    ):
        return False, {
            "stage": "server_validation",
            "reason": "OCR validation did not finish in the validated state."
        }

    return True, {
        "stage": "server_validation",
        "reason": "validated"
    }


# ============================================================
# OCR EXECUTION / PROGRESS
# ============================================================

def build_ocr_progress_callback(
    job_id,
    initial_progress=5
):
    try:
        initial_progress = int(round(float(initial_progress)))
    except (TypeError, ValueError):
        initial_progress = 5

    state = {
        "stage": "initializing",
        "progress": max(0, min(99, initial_progress)),
        "lastWrittenProgress": max(0, min(99, initial_progress)),
        "lastWrite": 0.0
    }

    def progress_callback(stage, progress=None):
        stage = str(
            stage
            or state["stage"]
            or "processing"
        )
        mark_stage(stage)

        if progress is None:
            progress = OCR_PROGRESS_MILESTONES.get(
                stage,
                state["progress"]
            )

        try:
            numeric_progress = int(round(float(progress)))
        except (TypeError, ValueError):
            return

        numeric_progress = max(
            state["progress"],
            min(99, numeric_progress)
        )
        now = time.monotonic()
        stage_changed = stage != state["stage"]
        progress_changed = numeric_progress > state["progress"]
        interval_elapsed = (
            now - state["lastWrite"]
            >= OCR_PROGRESS_WRITE_MIN_INTERVAL_SECONDS
        )
        progress_delta = (
            numeric_progress
            - int(state.get("lastWrittenProgress", 0) or 0)
        )

        state["stage"] = stage
        state["progress"] = numeric_progress

        should_write = (
            stage_changed
            or (
                progress_changed
                and interval_elapsed
                and progress_delta >= OCR_PROGRESS_WRITE_MIN_DELTA
            )
        )
        if not should_write:
            return

        update_job_progress(
            job_id,
            stage,
            numeric_progress,
            stage_changed=stage_changed
        )
        state["lastWrite"] = now
        state["lastWrittenProgress"] = numeric_progress

    return progress_callback


def run_scoreboard_ocr(
    job_id,
    temp_path,
    players_per_team,
    expected_player_names,
    initial_progress=5
):
    run_started_at = time.perf_counter()
    progress_callback = build_ocr_progress_callback(
        job_id,
        initial_progress=initial_progress
    )
    diagnostics = None

    if debug_enabled("summary"):
        with profile_ocr_run() as profiler:
            try:
                result = read_scoreboard_image(
                    image_path=temp_path,
                    players_per_team=players_per_team,
                    expected_player_names=expected_player_names,
                    progress_callback=progress_callback
                )
            finally:
                diagnostics = profiler.finish()
    else:
        result = read_scoreboard_image(
            image_path=temp_path,
            players_per_team=players_per_team,
            expected_player_names=expected_player_names,
            progress_callback=progress_callback
        )

    wall_seconds = round(
        time.perf_counter() - run_started_at,
        4
    )

    if isinstance(result, dict):
        performance = result.setdefault(
            "performance",
            {}
        )

        if not isinstance(performance, dict):
            performance = {}
            result["performance"] = performance

        performance.setdefault(
            "totalSeconds",
            wall_seconds
        )

        if isinstance(diagnostics, dict):
            performance["resourceUsage"] = diagnostics
            result["runReport"] = build_run_report(
                result,
                diagnostics
            )

    return result


def _sanitized_debug_payload(result):
    # Make a detached JSON-safe copy and remove ephemeral local filesystem paths
    # before the debug JSON is persisted to Cloud Storage.
    payload = json.loads(
        json.dumps(
            result,
            default=str
        )
    )
    visual = payload.get("visualDebug")
    if isinstance(visual, dict):
        cleaned = []
        for item in visual.get("savedImages", []) or []:
            if not isinstance(item, dict):
                continue
            cleaned.append({
                "name": item.get("name"),
                "filename": item.get("filename"),
                "bytes": item.get("bytes")
            })
        visual["savedImages"] = cleaned
    return payload


def persist_result_artifacts(
    job_id,
    result,
    debug_files=None,
    localization_debug_object=None
):
    # Conservative policy:
    #   off/summary/usage -> no result JSON/images written to GCS
    #   full              -> one debug JSON object
    #   images            -> debug JSON + at most the centralized image budget
    # The source image remains the only mandatory GCS upload per normal job.
    artifacts = {}

    if localization_debug_object:
        artifacts["localizationOverlay"] = str(
            localization_debug_object
        )

    debug_image_objects = {}
    if debug_enabled("images"):
        for item in debug_files or []:
            if not isinstance(item, dict):
                continue
            local_path = item.get("path")
            if not local_path:
                continue
            try:
                object_name = upload_debug_file(
                    job_id,
                    local_path,
                    filename=item.get("filename")
                )
                debug_image_objects[str(
                    item.get("name")
                    or Path(local_path).stem
                )] = object_name
            except Exception:
                LOGGER.exception(
                    "Could not persist OCR debug image for %s",
                    job_id
                )

    if debug_image_objects:
        artifacts["debugImages"] = debug_image_objects

    if debug_enabled("full"):
        try:
            debug_payload = _sanitized_debug_payload(
                result
            )
            debug_payload["debugArtifactPolicy"] = {
                "level": OCR_DEBUG_LEVEL,
                "localizationOverlayStored": bool(
                    localization_debug_object
                ),
                "imageCount": len(debug_image_objects),
                "imageNames": list(debug_image_objects.keys())
            }
            artifacts["debug"] = write_json_artifact(
                job_id,
                "debug",
                debug_payload
            )
        except Exception:
            LOGGER.exception(
                "Could not persist OCR debug artifact for %s",
                job_id
            )

    return artifacts


# ============================================================
# HEALTH
# ============================================================

@app.route("/", methods=["GET"])
@app.route("/health", methods=["GET"])
def health_check():
    store = validate_store_configuration()

    return jsonify({
        "success": True,
        "service": "bpd-ocr",
        "serverVersion": SERVER_VERSION,
        "preparationVersion": PREPARATION_VERSION,
        "identityVersion": IDENTITY_VERSION,
        "evidenceVersion": EVIDENCE_VERSION,
        "layoutVersion": LAYOUT_VERSION,
        "textVersion": TEXT_VERSION,
        "utilsVersion": UTILS_VERSION,
        "storeVersion": STORE_VERSION,
        "durableStoreReady": store["ready"],
        "durableStoreMissing": store["missing"],
        "paddleLoaded": paddle_model_loaded(),
        "paddle": get_paddle_runtime_status(),
        "debug": {
            "level": OCR_DEBUG_LEVEL,
            "fullJsonPersisted": debug_enabled("full"),
            "visualImagesPersisted": debug_enabled("images"),
            "legacyPerCropImages": False
        }
    })


# ============================================================
# LIGHTWEIGHT SCOREBOARD LOCALIZATION
# ============================================================

@app.route(
    "/api/ocr/localize",
    methods=["POST"]
)
def ocr_localize_endpoint():
    image_file, image_bytes, image, error = get_image_upload()

    if error is not None:
        return error

    players_per_team = parse_players_per_team()

    if players_per_team is None:
        return jsonify({
            "success": False,
            "message": "playersPerTeam must be 1, 2, 3, or 4."
        }), 400

    debug_trace_id = normalize_job_id(
        request.form.get("debugTraceId")
    )

    begin_debug_context(debug_trace_id)
    started_at = time.perf_counter()
    result = localize_scoreboard(
        image,
        players_per_team
    )
    runtime_seconds = round(
        time.perf_counter() - started_at,
        4
    )

    localization_debug_object = None
    local_debug_item = save_localization_overlay(
        debug_trace_id,
        image,
        result
    )

    if local_debug_item is not None:
        try:
            # This is only reached in OCR_DEBUG_LEVEL=images, so the extra GCS
            # write exists only during explicit visual testing.
            localization_debug_object = upload_debug_file(
                debug_trace_id,
                local_debug_item["path"],
                filename=local_debug_item["filename"]
            )
        except Exception:
            LOGGER.exception(
                "Could not persist localization debug image %s",
                debug_trace_id
            )
        finally:
            pass

    base_response = {
        "runtimeSeconds": runtime_seconds,
        "debugTraceId": debug_trace_id,
        "debugArtifact": localization_debug_object
    }
    clear_debug_context()

    if result.get("pass") is not True:
        return jsonify({
            "success": False,
            "status": "manual_crop_required",
            "message": result.get(
                "reason",
                "Scoreboard localization failed."
            ),
            "stage": result.get(
                "stage",
                "localization"
            ),
            "localization": result,
            **base_response
        }), 422

    return jsonify({
        "success": True,
        "status": "localized",
        "bounds": result["bounds"],
        "confidence": result.get(
            "boundsConfidence",
            0.0
        ),
        "method": result.get(
            "locator",
            "structural_geometry"
        ),
        "diagnostics": {
            "detectedRows": result.get("detectedRows", 0),
            "detectedPingRegions": result.get(
                "detectedPingRegions",
                0
            ),
            "detectedStatRows": result.get(
                "detectedStatRows",
                0
            ),
            "teamStructure": result.get(
                "teamStructure",
                {}
            )
        },
        **base_response
    })


# ============================================================
# DURABLE JOB SUBMISSION
# ============================================================

@app.route(
    "/api/ocr",
    methods=["POST"]
)
def ocr_endpoint():
    store_state = validate_store_configuration()

    if not store_state["ready"]:
        return jsonify({
            "success": False,
            "message": (
                "Durable OCR storage/task configuration is incomplete."
            ),
            "missing": store_state["missing"]
        }), 503

    image_file, image_bytes, image, error = get_image_upload()

    if error is not None:
        return error

    players_per_team = parse_players_per_team()

    if players_per_team is None:
        return jsonify({
            "success": False,
            "message": "playersPerTeam must be 1, 2, 3, or 4."
        }), 400

    expected_player_names = parse_expected_player_names(
        request.form.get("expectedPlayerNames")
        or request.form.get("playerNames")
    )
    roster = validate_submitted_roster(
        players_per_team,
        expected_player_names
    )

    if not roster["valid"]:
        return jsonify({
            "success": False,
            "message": (
                "expectedPlayerNames is required and must contain exactly "
                f"{roster['expectedPlayers']} unique player names, ordered "
                "Team 1 first and Team 2 second."
            ),
            "expectedPlayers": roster["expectedPlayers"],
            "receivedPlayerNames": len(roster["names"])
        }), 400

    job_id = normalize_job_id(
        request.form.get("jobId")
    )
    existing = get_job(job_id)

    if existing is not None:
        return jsonify(
            public_job(existing)
        ), 200

    debug_trace_id = normalize_job_id(
        request.form.get("debugTraceId")
        or job_id
    )
    localization_debug_object = str(
        request.form.get("localizationDebugObject")
        or ""
    ).strip()
    expected_debug_prefix = (
        f"{OCR_DEBUG_STORAGE_PREFIX}/{debug_trace_id}/"
    )
    if (
        not localization_debug_object
        or not localization_debug_object.startswith(
            expected_debug_prefix
        )
    ):
        localization_debug_object = None

    source_object = None

    try:
        source_object = upload_source_image(
            job_id,
            image_bytes,
            image_file.filename,
            image_file.mimetype
        )
        create_job(
            job_id=job_id,
            players_per_team=players_per_team,
            expected_player_names=roster["names"],
            source_object=source_object,
            original_filename=image_file.filename,
            debug_trace_id=debug_trace_id,
            localization_debug_object=localization_debug_object
        )
        enqueue_job(job_id)
    except Exception as error:
        LOGGER.exception(
            "Could not create durable OCR job %s",
            job_id
        )

        if source_object:
            delete_object(source_object)

        try:
            job = get_job(job_id)
            if job is not None:
                fail_job(
                    job_id,
                    "OCR job could not be queued.",
                    failure_stage="job_queue"
                )
        except Exception:
            pass

        return jsonify({
            "success": False,
            "status": "failed",
            "jobId": job_id,
            "message": str(error)
        }), 500

    job = get_job(job_id)

    return jsonify(
        public_job(job)
    ), 202


# ============================================================
# CLOUD TASK PROCESSING REQUEST
# ============================================================

@app.route(
    "/api/ocr/process",
    methods=["POST"]
)
def ocr_process_endpoint():
    payload = request.get_json(
        silent=True
    ) or {}
    job_id = str(
        payload.get("jobId")
        or ""
    ).strip()

    if not job_id:
        return jsonify({
            "success": False,
            "message": "jobId is required."
        }), 400

    delivery_name = request.headers.get(
        "X-CloudTasks-TaskName",
        ""
    )
    claim = claim_job_for_processing(
        job_id,
        delivery_name=delivery_name
    )

    if claim["reason"] == "not_found":
        return jsonify({
            "success": False,
            "message": "OCR job not found.",
            "jobId": job_id
        }), 404

    if not claim["claimed"]:
        return jsonify({
            "success": True,
            "jobId": job_id,
            "status": (
                claim.get("job") or {}
            ).get("status"),
            "message": (
                "OCR task did not need another processing pass."
            )
        }), 200

    job = claim["job"]
    players_per_team = int(
        job["playersPerTeam"]
    )
    expected_players = int(
        job["expectedPlayers"]
    )
    expected_player_names = list(
        job.get("expectedPlayerNames")
        or []
    )
    source_object = job.get("sourceObject")
    original_filename = str(
        job.get("originalFilename")
        or "scoreboard.png"
    )
    extension = Path(original_filename).suffix.lower()

    if extension not in ALLOWED_EXTENSIONS:
        extension = ".png"

    temp_path = None
    terminal_result = False
    begin_debug_context(job_id)

    try:
        resume_progress = max(
            int(job.get("progress", 5) or 5),
            OCR_PROGRESS_MILESTONES["paddle_warmup"]
        )
        update_job_progress(
            job_id,
            "paddle_warmup",
            resume_progress,
            message="Preparing OCR recognition model.",
            stage_changed=True
        )

        # Paddle is expected on most real jobs. Load it synchronously inside
        # the Cloud Tasks processing request so request-based Cloud Run CPU is
        # available for the entire operation.
        warm_paddle_model(
            trigger="cloud_task_processing"
        )

        with tempfile.NamedTemporaryFile(
            suffix=extension,
            delete=False
        ) as temp_file:
            temp_path = Path(temp_file.name)

        download_object_to_file(
            source_object,
            temp_path
        )

        result = run_scoreboard_ocr(
            job_id=job_id,
            temp_path=temp_path,
            players_per_team=players_per_team,
            expected_player_names=expected_player_names,
            initial_progress=resume_progress
        )

        if not isinstance(result, dict):
            raise RuntimeError(
                "OCR returned an invalid response."
            )

        result["success"] = result.get("success") is True
        result["matchSize"] = (
            f"{players_per_team}v{players_per_team}"
        )
        result["playersPerTeam"] = players_per_team
        result["expectedPlayers"] = expected_players

        if result["success"]:
            server_validated, server_validation = (
                validate_final_ocr_result(
                    result,
                    expected_player_names,
                    expected_players,
                    players_per_team
                )
            )
            result["serverValidation"] = server_validation

            if not server_validated:
                result["success"] = False
                result["failureStage"] = "server_validation"
                result["message"] = server_validation.get(
                    "reason",
                    "Server validation failed."
                )

        public_result = build_public_result_from_ocr(
            result
        )
        runtime_seconds = (
            result.get("performance", {})
            .get("totalSeconds")
        )
        usage_summary = build_usage_result(
            job_id,
            result
        )
        artifacts = persist_result_artifacts(
            job_id,
            result,
            debug_files=collect_debug_files(),
            localization_debug_object=job.get(
                "localizationDebugObject"
            )
        )

        if result["success"]:
            complete_job(
                job_id,
                public_result,
                runtime_seconds,
                artifacts=artifacts,
                usage_summary=usage_summary
            )
        else:
            failure_stage = (
                result.get("failureStage")
                or (
                    result.get("preflight")
                    or {}
                ).get("stage")
                or "final_validation"
            )
            message = result.get(
                "message",
                "OCR validation failed."
            )
            preflight_reason = (
                result.get("preflight")
                or {}
            ).get("reason")

            if preflight_reason:
                message = (
                    message
                    + " Reason: "
                    + str(preflight_reason)
                )

            fail_job(
                job_id,
                message,
                failure_stage=failure_stage,
                public_result=public_result,
                runtime_seconds=runtime_seconds,
                artifacts=artifacts,
                usage_summary=usage_summary
            )

        terminal_result = True
        return jsonify({
            "success": True,
            "jobId": job_id,
            "status": (
                "completed"
                if result["success"]
                else "failed"
            )
        }), 200

    except Exception as error:
        LOGGER.exception(
            "OCR task failed for %s",
            job_id
        )
        traceback.print_exc()

        attempt_count = int(
            (job or {}).get(
                "attemptCount",
                1
            )
            or 1
        )

        if attempt_count >= OCR_PROCESS_MAX_ATTEMPTS:
            # Do not leave an exhausted Cloud Tasks delivery looking queued
            # forever. Convert the final infrastructure failure into a durable
            # terminal job that the returning browser can actually explain.
            terminal_result = True
            public_result = {
                "team1": [],
                "team2": [],
                "validation": {
                    "pass": False,
                    "players_needing_review": 0
                },
                "confidenceSummary": {
                    "overall": 0.0,
                    "band": "very_low"
                },
                "status": "failed",
                "success": False,
                "failureStage": "infrastructure",
                "message": (
                    "OCR processing failed after "
                    f"{attempt_count} attempts."
                )
            }
            fail_job(
                job_id,
                public_result["message"],
                failure_stage="infrastructure",
                public_result=public_result
            )

            return jsonify({
                "success": True,
                "jobId": job_id,
                "status": "failed",
                "message": public_result["message"]
            }), 200

        # Return 5xx so Cloud Tasks retries. The lease is cleared so the next
        # delivery can reclaim the job. Durable input remains in Cloud Storage.
        update_job(
            job_id,
            {
                "status": "queued",
                "stage": "retry_pending",
                "progress": min(
                    int(
                        (job or {}).get(
                            "progress",
                            5
                        )
                        or 5
                    ),
                    96
                ),
                "message": (
                    "OCR processing was interrupted and will be retried."
                ),
                "leaseExpiresAt": None,
                "lastError": str(error)
            }
        )

        return jsonify({
            "success": False,
            "jobId": job_id,
            "status": "retry_pending",
            "attemptCount": attempt_count,
            "maximumAttempts": OCR_PROCESS_MAX_ATTEMPTS,
            "message": str(error)
        }), 500

    finally:
        if temp_path is not None:
            try:
                temp_path.unlink(
                    missing_ok=True
                )
            except Exception:
                pass

        clear_debug_context()

        # Delete the submitted image only after a deterministic terminal OCR
        # result. On infrastructure failures it remains available for retry.
        if terminal_result:
            delete_object(source_object)


# ============================================================
# JOB STATUS / ARTIFACTS
# ============================================================

@app.route(
    "/api/ocr/status/<job_id>",
    methods=["GET"]
)
def ocr_job_status(job_id):
    job = get_job(job_id)

    if job is None:
        return jsonify({
            "success": False,
            "message": "OCR job not found.",
            "jobId": job_id
        }), 404

    return jsonify(
        public_job(job)
    )


def _debug_visual_routes(job_id, job):
    artifacts = job.get("artifacts") or {}
    routes = {}
    if artifacts.get("localizationOverlay"):
        routes["localizationOverlay"] = (
            f"/api/ocr/debug/{job_id}/image/localizationOverlay"
        )
    for key in (artifacts.get("debugImages") or {}):
        routes[str(key)] = (
            f"/api/ocr/debug/{job_id}/image/{key}"
        )
    return routes


def artifact_response(job_id, artifact_name):
    job = get_job(job_id)

    if job is None:
        return jsonify({
            "success": False,
            "message": "OCR job not found.",
            "jobId": job_id
        }), 404

    artifacts = job.get("artifacts") or {}
    if artifact_name == "usage":
        usage_summary = job.get("usageSummary")
        if isinstance(usage_summary, dict):
            return jsonify(usage_summary)

    object_name = artifacts.get(artifact_name)

    if object_name:
        payload = read_json_artifact(
            object_name
        )
        if payload is not None:
            return jsonify(payload)

    # To conserve GCS Class A operations, detail/usage are not stored as
    # separate JSON objects. In full/images mode they are derived on demand
    # from the single persisted debug result.
    debug_object = artifacts.get("debug")
    debug_payload = (
        read_json_artifact(debug_object)
        if debug_object
        else None
    )

    if isinstance(debug_payload, dict):
        if artifact_name == "detail":
            return jsonify(
                build_detail_result(
                    job_id,
                    debug_payload
                )
            )
        if artifact_name == "usage":
            return jsonify(
                build_usage_result(
                    job_id,
                    debug_payload
                )
            )
        if artifact_name == "debug":
            debug_payload["visualArtifacts"] = (
                _debug_visual_routes(
                    job_id,
                    job
                )
            )
            return jsonify(debug_payload)

    return jsonify({
        "success": False,
        "message": f"OCR {artifact_name} data is not available at the current debug level.",
        "jobId": job_id,
        "debugLevel": OCR_DEBUG_LEVEL
    }), 404


@app.route(
    "/api/ocr/detail/<job_id>",
    methods=["GET"]
)
def ocr_detail_result(job_id):
    return artifact_response(
        job_id,
        "detail"
    )


@app.route(
    "/api/ocr/usage/<job_id>",
    methods=["GET"]
)
def ocr_usage_result(job_id):
    return artifact_response(
        job_id,
        "usage"
    )


@app.route(
    "/api/ocr/debug/<job_id>",
    methods=["GET"]
)
def ocr_debug_result(job_id):
    return artifact_response(
        job_id,
        "debug"
    )


@app.route(
    "/api/ocr/debug/<job_id>/image/<image_key>",
    methods=["GET"]
)
def ocr_debug_image(job_id, image_key):
    job = get_job(job_id)
    if job is None:
        return jsonify({
            "success": False,
            "message": "OCR job not found.",
            "jobId": job_id
        }), 404

    artifacts = job.get("artifacts") or {}
    object_name = None
    if image_key == "localizationOverlay":
        object_name = artifacts.get("localizationOverlay")
    else:
        object_name = (
            artifacts.get("debugImages")
            or {}
        ).get(image_key)

    if not object_name:
        return jsonify({
            "success": False,
            "message": "Debug image is not available.",
            "jobId": job_id,
            "image": image_key
        }), 404

    image_bytes = download_object_bytes(
        object_name
    )
    if image_bytes is None:
        return jsonify({
            "success": False,
            "message": "Debug image artifact was not found.",
            "jobId": job_id,
            "image": image_key
        }), 404

    return Response(
        image_bytes,
        status=200,
        mimetype="image/jpeg",
        headers={
            "Cache-Control": "no-store"
        }
    )


# ============================================================
# MANUAL PADDLE WARMUP
# ============================================================

@app.route(
    "/api/ocr/warmup",
    methods=["POST"]
)
def ocr_paddle_warmup():
    try:
        state = warm_paddle_model(
            trigger="manual_endpoint"
        )
        return jsonify({
            "success": True,
            "paddle": state
        })
    except Exception as error:
        LOGGER.exception(
            "Paddle warmup failed"
        )
        return jsonify({
            "success": False,
            "message": str(error),
            "paddle": get_paddle_runtime_status()
        }), 500


# ============================================================
# ERROR HANDLERS
# ============================================================

@app.errorhandler(413)
def upload_too_large(error):
    return jsonify({
        "success": False,
        "message": (
            f"Uploaded image exceeds the {OCR_MAX_UPLOAD_SIZE_MB} MB limit."
        )
    }), 413


@app.errorhandler(404)
def route_not_found(error):
    return jsonify({
        "success": False,
        "message": "Route not found."
    }), 404
