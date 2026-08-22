import copy
import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

from google.api_core.exceptions import AlreadyExists
from google.cloud import firestore
from google.cloud import storage
from google.cloud import tasks_v2
from google.protobuf import duration_pb2

from ocr_config import (
    GCP_PROJECT_ID,
    OCR_API_KEY,
    OCR_DEBUG_STORAGE_PREFIX,
    OCR_FIRESTORE_COLLECTION,
    OCR_JOB_RETENTION_SECONDS,
    OCR_STORAGE_BUCKET,
    OCR_STORAGE_PREFIX,
    OCR_TASK_DISPATCH_DEADLINE_SECONDS,
    OCR_TASK_LEASE_SECONDS,
    OCR_TASK_LOCATION,
    OCR_TASK_QUEUE,
    OCR_TASK_TARGET_URL,
    OCR_TASK_TOKEN
)


STORE_VERSION = "store-v1.1-budgeted-debug-artifacts"

_FIRESTORE_CLIENT = None
_STORAGE_CLIENT = None
_TASKS_CLIENT = None


def _utc_now():
    return datetime.now(timezone.utc)


def _get_firestore_client():
    global _FIRESTORE_CLIENT
    if _FIRESTORE_CLIENT is None:
        _FIRESTORE_CLIENT = firestore.Client(
            project=GCP_PROJECT_ID or None
        )
    return _FIRESTORE_CLIENT


def _get_storage_client():
    global _STORAGE_CLIENT
    if _STORAGE_CLIENT is None:
        _STORAGE_CLIENT = storage.Client(
            project=GCP_PROJECT_ID or None
        )
    return _STORAGE_CLIENT


def _get_tasks_client():
    global _TASKS_CLIENT
    if _TASKS_CLIENT is None:
        _TASKS_CLIENT = tasks_v2.CloudTasksClient()
    return _TASKS_CLIENT


def validate_store_configuration():
    missing = []

    for name, value in (
        ("GOOGLE_CLOUD_PROJECT", GCP_PROJECT_ID),
        ("OCR_STORAGE_BUCKET", OCR_STORAGE_BUCKET),
        ("OCR_TASK_QUEUE", OCR_TASK_QUEUE),
        ("OCR_TASK_LOCATION", OCR_TASK_LOCATION),
        ("OCR_TASK_TARGET_URL", OCR_TASK_TARGET_URL),
        ("OCR_API_KEY", OCR_API_KEY),
        ("OCR_TASK_TOKEN", OCR_TASK_TOKEN)
    ):
        if not str(value or "").strip():
            missing.append(name)

    return {
        "ready": not missing,
        "missing": missing,
        "version": STORE_VERSION
    }


def _job_ref(job_id):
    return (
        _get_firestore_client()
        .collection(OCR_FIRESTORE_COLLECTION)
        .document(str(job_id))
    )


def _safe_task_id(job_id):
    value = re.sub(
        r"[^A-Za-z0-9_-]",
        "-",
        str(job_id or "")
    ).strip("-")

    if not value:
        value = "job"

    return (
        "ocr-" + value
    )[:500]


def _object_name(job_id, filename):
    safe_filename = re.sub(
        r"[^A-Za-z0-9._-]",
        "_",
        str(filename or "scoreboard.png")
    )

    return (
        f"{OCR_STORAGE_PREFIX}/{job_id}/{safe_filename}"
    ).strip("/")


def _json_object_name(job_id, kind):
    safe_kind = re.sub(
        r"[^A-Za-z0-9_-]",
        "_",
        str(kind or "result")
    )

    return (
        f"{OCR_STORAGE_PREFIX}/{job_id}/{safe_kind}.json"
    ).strip("/")


def _debug_object_name(trace_id, filename):
    safe_trace = re.sub(
        r"[^A-Za-z0-9._-]",
        "_",
        str(trace_id or "trace")
    )
    safe_filename = re.sub(
        r"[^A-Za-z0-9._-]",
        "_",
        str(filename or "debug.jpg")
    )
    return (
        f"{OCR_DEBUG_STORAGE_PREFIX}/{safe_trace}/{safe_filename}"
    ).strip("/")


def _json_safe(value):
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).isoformat()

    if isinstance(value, dict):
        return {
            str(key): _json_safe(item)
            for key, item in value.items()
        }

    if isinstance(value, (list, tuple)):
        return [
            _json_safe(item)
            for item in value
        ]

    return value


def upload_source_image(
    job_id,
    image_bytes,
    filename,
    content_type
):
    object_name = _object_name(
        job_id,
        filename
    )
    bucket = _get_storage_client().bucket(
        OCR_STORAGE_BUCKET
    )
    blob = bucket.blob(object_name)
    blob.upload_from_string(
        image_bytes,
        content_type=(
            content_type
            or "application/octet-stream"
        )
    )
    return object_name


def download_object_to_file(
    object_name,
    destination_path
):
    bucket = _get_storage_client().bucket(
        OCR_STORAGE_BUCKET
    )
    blob = bucket.blob(object_name)
    blob.download_to_filename(
        str(destination_path)
    )
    return destination_path


def delete_object(object_name):
    if not object_name:
        return False

    bucket = _get_storage_client().bucket(
        OCR_STORAGE_BUCKET
    )
    blob = bucket.blob(object_name)

    try:
        blob.delete()
        return True
    except Exception:
        return False


def write_json_artifact(
    job_id,
    kind,
    payload
):
    object_name = _json_object_name(
        job_id,
        kind
    )
    bucket = _get_storage_client().bucket(
        OCR_STORAGE_BUCKET
    )
    blob = bucket.blob(object_name)
    blob.upload_from_string(
        json.dumps(
            payload,
            ensure_ascii=False,
            separators=(",", ":"),
            default=str
        ).encode("utf-8"),
        content_type="application/json"
    )
    return object_name


def read_json_artifact(object_name):
    if not object_name:
        return None

    bucket = _get_storage_client().bucket(
        OCR_STORAGE_BUCKET
    )
    blob = bucket.blob(object_name)

    if not blob.exists():
        return None

    return json.loads(
        blob.download_as_bytes().decode("utf-8")
    )


def upload_debug_file(
    trace_id,
    local_path,
    filename=None
):
    local_path = str(local_path)
    final_filename = filename or Path(local_path).name
    object_name = _debug_object_name(
        trace_id,
        final_filename
    )
    bucket = _get_storage_client().bucket(
        OCR_STORAGE_BUCKET
    )
    blob = bucket.blob(object_name)
    blob.upload_from_filename(
        local_path,
        content_type="image/jpeg"
    )
    return object_name


def download_object_bytes(object_name):
    if not object_name:
        return None
    bucket = _get_storage_client().bucket(
        OCR_STORAGE_BUCKET
    )
    blob = bucket.blob(object_name)
    if not blob.exists():
        return None
    return blob.download_as_bytes()


def create_job(
    job_id,
    players_per_team,
    expected_player_names,
    source_object,
    original_filename,
    debug_trace_id=None,
    localization_debug_object=None
):
    now = _utc_now()
    expected_players = int(players_per_team) * 2
    expires_at = now + timedelta(
        seconds=OCR_JOB_RETENTION_SECONDS
    )

    document = {
        "schemaVersion": 3,
        "storeVersion": STORE_VERSION,
        "jobId": str(job_id),
        "status": "queued",
        "stage": "job_accepted",
        "progress": 3,
        "message": "OCR job accepted.",
        "playersPerTeam": int(players_per_team),
        "expectedPlayers": expected_players,
        "expectedPlayerNames": list(
            expected_player_names or []
        ),
        "sourceObject": str(source_object),
        "originalFilename": str(
            original_filename or "scoreboard.png"
        ),
        "createdAt": now,
        "updatedAt": now,
        "stageStartedAt": now,
        "expiresAt": expires_at,
        "taskName": None,
        "attemptCount": 0,
        "leaseExpiresAt": None,
        "failureStage": None,
        "publicResult": None,
        "usageSummary": None,
        "runtimeSeconds": None,
        "debugTraceId": (
            str(debug_trace_id)
            if debug_trace_id
            else None
        ),
        "localizationDebugObject": (
            str(localization_debug_object)
            if localization_debug_object
            else None
        ),
        "artifacts": {}
    }

    _job_ref(job_id).create(document)
    return copy.deepcopy(document)


def get_job(job_id):
    snapshot = _job_ref(job_id).get()

    if not snapshot.exists:
        return None

    return snapshot.to_dict()


def update_job(job_id, updates):
    updates = dict(updates or {})
    updates["updatedAt"] = _utc_now()
    _job_ref(job_id).set(
        updates,
        merge=True
    )
    return updates


def update_job_progress(
    job_id,
    stage,
    progress,
    message=None,
    stage_changed=False
):
    now = _utc_now()
    updates = {
        "status": "processing",
        "stage": str(stage or "processing"),
        "progress": max(
            0,
            min(99, int(round(float(progress or 0))))
        ),
        "updatedAt": now
    }

    if message:
        updates["message"] = str(message)

    if stage_changed:
        updates["stageStartedAt"] = now

    _job_ref(job_id).set(
        updates,
        merge=True
    )


def enqueue_job(job_id):
    client = _get_tasks_client()
    parent = client.queue_path(
        GCP_PROJECT_ID,
        OCR_TASK_LOCATION,
        OCR_TASK_QUEUE
    )
    task_id = _safe_task_id(job_id)
    task_name = client.task_path(
        GCP_PROJECT_ID,
        OCR_TASK_LOCATION,
        OCR_TASK_QUEUE,
        task_id
    )

    body = json.dumps({
        "jobId": str(job_id)
    }).encode("utf-8")

    task = {
        "name": task_name,
        "http_request": {
            "http_method": tasks_v2.HttpMethod.POST,
            "url": OCR_TASK_TARGET_URL,
            "headers": {
                "Content-Type": "application/json",
                "X-API-Key": OCR_API_KEY,
                "X-OCR-Task-Token": OCR_TASK_TOKEN
            },
            "body": body
        },
        "dispatch_deadline": duration_pb2.Duration(
            seconds=OCR_TASK_DISPATCH_DEADLINE_SECONDS
        )
    }

    try:
        response = client.create_task(
            request={
                "parent": parent,
                "task": task
            }
        )
        final_name = response.name
    except AlreadyExists:
        final_name = task_name

    update_job(
        job_id,
        {
            "taskName": final_name
        }
    )
    return final_name


def claim_job_for_processing(
    job_id,
    delivery_name=None
):
    client = _get_firestore_client()
    transaction = client.transaction()
    document_ref = _job_ref(job_id)

    @firestore.transactional
    def claim(transaction):
        snapshot = document_ref.get(
            transaction=transaction
        )

        if not snapshot.exists:
            return {
                "claimed": False,
                "reason": "not_found",
                "job": None
            }

        job = snapshot.to_dict()
        status = str(job.get("status") or "")
        now = _utc_now()

        if status in {
            "completed",
            "failed"
        }:
            return {
                "claimed": False,
                "reason": "terminal",
                "job": job
            }

        lease_expires = job.get(
            "leaseExpiresAt"
        )

        if (
            status == "processing"
            and isinstance(lease_expires, datetime)
            and lease_expires > now
        ):
            return {
                "claimed": False,
                "reason": "active_lease",
                "job": job
            }

        attempt_count = int(
            job.get("attemptCount", 0)
            or 0
        ) + 1
        lease_until = now + timedelta(
            seconds=OCR_TASK_LEASE_SECONDS
        )

        transaction.set(
            document_ref,
            {
                "status": "processing",
                "stage": "initializing",
                "progress": max(
                    5,
                    int(job.get("progress", 0) or 0)
                ),
                "message": "OCR processing started.",
                "attemptCount": attempt_count,
                "deliveryName": str(
                    delivery_name or ""
                ),
                "leaseExpiresAt": lease_until,
                "stageStartedAt": now,
                "updatedAt": now
            },
            merge=True
        )

        job.update({
            "status": "processing",
            "stage": "initializing",
            "attemptCount": attempt_count,
            "leaseExpiresAt": lease_until,
            "updatedAt": now
        })

        return {
            "claimed": True,
            "reason": "claimed",
            "job": job
        }

    return claim(transaction)


def complete_job(
    job_id,
    public_result,
    runtime_seconds,
    artifacts=None,
    usage_summary=None
):
    now = _utc_now()
    update_job(
        job_id,
        {
            "status": "completed",
            "stage": "completed",
            "progress": 100,
            "message": "Scoreboard OCR validated successfully.",
            "publicResult": copy.deepcopy(public_result),
            "usageSummary": copy.deepcopy(usage_summary),
            "runtimeSeconds": runtime_seconds,
            "completedAt": now,
            "stageStartedAt": now,
            "leaseExpiresAt": None,
            "failureStage": None,
            "artifacts": copy.deepcopy(
                artifacts or {}
            )
        }
    )


def fail_job(
    job_id,
    message,
    failure_stage=None,
    public_result=None,
    runtime_seconds=None,
    artifacts=None,
    usage_summary=None
):
    now = _utc_now()
    update_job(
        job_id,
        {
            "status": "failed",
            "stage": str(
                failure_stage
                or "failed"
            ),
            "progress": 100,
            "message": str(
                message
                or "OCR processing failed."
            ),
            "failureStage": failure_stage,
            "publicResult": copy.deepcopy(
                public_result
            ),
            "usageSummary": copy.deepcopy(
                usage_summary
            ),
            "runtimeSeconds": runtime_seconds,
            "completedAt": now,
            "stageStartedAt": now,
            "leaseExpiresAt": None,
            "artifacts": copy.deepcopy(
                artifacts or {}
            )
        }
    )


def public_job(job):
    if not isinstance(job, dict):
        return None

    response = {
        "jobId": job.get("jobId"),
        "status": job.get("status"),
        "stage": job.get("stage"),
        "progress": int(job.get("progress", 0) or 0),
        "message": job.get("message"),
        "playersPerTeam": job.get("playersPerTeam"),
        "expectedPlayers": job.get("expectedPlayers"),
        "failureStage": job.get("failureStage"),
        "runtimeSeconds": job.get("runtimeSeconds"),
        "createdAt": job.get("createdAt"),
        "updatedAt": job.get("updatedAt"),
        "stageStartedAt": job.get("stageStartedAt"),
        "completedAt": job.get("completedAt")
    }

    public_result = job.get("publicResult")

    if isinstance(public_result, dict):
        response.update(
            copy.deepcopy(public_result)
        )
        response["jobId"] = job.get("jobId")
        response["status"] = job.get("status")
        response["stage"] = job.get("stage")
        response["progress"] = int(
            job.get("progress", 0)
            or 0
        )
        response["message"] = job.get("message")
        response["failureStage"] = job.get(
            "failureStage"
        )

    return _json_safe(response)
