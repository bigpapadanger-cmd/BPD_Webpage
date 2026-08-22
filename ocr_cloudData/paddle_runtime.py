import copy
import threading
import time
from datetime import datetime, timezone

from ocr_config import (
    PADDLE_CPU_THREADS,
    PADDLE_ENABLE_MKLDNN,
    PADDLE_MKLDNN_CACHE_CAPACITY,
    PADDLE_MODEL_DIR,
    PADDLE_MODEL_NAME,
    PADDLE_WARM_MODE,
    PADDLE_WARM_WAIT_SECONDS,
    PADDLE_MAX_LOAD_ATTEMPTS,
    PADDLE_LOAD_RETRY_COOLDOWN_SECONDS
)

PADDLE_RUNTIME_VERSION = "paddle-runtime-v1.2-eager-warm-single-flight"
_MODEL = None
_MODEL_LOCK = threading.Lock()
_STATE_LOCK = threading.Lock()
_READY_EVENT = threading.Event()
_WARM_THREAD = None
_STATE = {
    "version": PADDLE_RUNTIME_VERSION,
    "model": PADDLE_MODEL_NAME,
    "modelDir": PADDLE_MODEL_DIR or None,
    "warmMode": PADDLE_WARM_MODE,
    "state": "cold",
    "loaded": False,
    "warming": False,
    "trigger": None,
    "startedAt": None,
    "readyAt": None,
    "loadSeconds": None,
    "error": None,
    "cpuThreads": PADDLE_CPU_THREADS,
    "mkldnnEnabled": PADDLE_ENABLE_MKLDNN,
    "mkldnnCacheCapacity": PADDLE_MKLDNN_CACHE_CAPACITY,
    "loadAttempts": 0,
    "maxLoadAttempts": PADDLE_MAX_LOAD_ATTEMPTS,
    "lastFailureMonotonic": None,
    "retryCooldownSeconds": PADDLE_LOAD_RETRY_COOLDOWN_SECONDS,
    "scheduledAt": None,
    "warmThreadStartedAt": None
}


def _utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _update_state(**changes):
    with _STATE_LOCK:
        _STATE.update(changes)
        return copy.deepcopy(_STATE)


def get_runtime_status():
    with _STATE_LOCK:
        return copy.deepcopy(_STATE)


def model_loaded():
    return _MODEL is not None


def _build_model(trigger):
    global _MODEL
    started_at = time.perf_counter()
    with _STATE_LOCK:
        _STATE["loadAttempts"] = int(
            _STATE.get("loadAttempts", 0)
            or 0
        ) + 1
        current_attempt = _STATE["loadAttempts"]
    _update_state(
        state="warming",
        warming=True,
        loaded=False,
        trigger=str(trigger or "unknown"),
        startedAt=_utc_now(),
        readyAt=None,
        loadSeconds=None,
        error=None
    )
    try:
        from paddleocr import TextRecognition
        options = {
            "model_name": PADDLE_MODEL_NAME,
            "device": "cpu",
            "enable_mkldnn": PADDLE_ENABLE_MKLDNN,
            "mkldnn_cache_capacity": PADDLE_MKLDNN_CACHE_CAPACITY,
            "cpu_threads": PADDLE_CPU_THREADS
        }
        if PADDLE_MODEL_DIR:
            options["model_dir"] = PADDLE_MODEL_DIR
        _MODEL = TextRecognition(
            **options
        )
        load_seconds = round(
            time.perf_counter() - started_at,
            4
        )
        _READY_EVENT.set()
        _update_state(
            state="ready",
            warming=False,
            loaded=True,
            readyAt=_utc_now(),
            loadSeconds=load_seconds,
            error=None,
            lastFailureMonotonic=None
        )
        return _MODEL
    except Exception as error:
        _READY_EVENT.set()
        _update_state(
            state="failed",
            warming=False,
            loaded=False,
            readyAt=_utc_now(),
            loadSeconds=round(
                time.perf_counter() - started_at,
                4
            ),
            error=str(error),
            lastFailureMonotonic=time.monotonic()
        )
        raise


def get_model(trigger="ocr_request"):
    global _MODEL
    if _MODEL is not None:
        return _MODEL

    with _MODEL_LOCK:
        if _MODEL is not None:
            return _MODEL

        with _STATE_LOCK:
            attempts = int(_STATE.get("loadAttempts", 0) or 0)
            last_failure = _STATE.get("lastFailureMonotonic")
            error_text = _STATE.get("error")

        if last_failure is not None:
            elapsed = max(0.0, time.monotonic() - float(last_failure))
            if (
                attempts >= PADDLE_MAX_LOAD_ATTEMPTS
                and elapsed < PADDLE_LOAD_RETRY_COOLDOWN_SECONDS
            ):
                raise RuntimeError(
                    "Paddle model initialization is in retry cooldown "
                    f"after {attempts} failed attempts: {error_text or 'unknown error'}"
                )
            if elapsed >= PADDLE_LOAD_RETRY_COOLDOWN_SECONDS:
                with _STATE_LOCK:
                    _STATE["loadAttempts"] = 0
                    _STATE["lastFailureMonotonic"] = None

        _READY_EVENT.clear()
        return _build_model(trigger)


def warm_model(trigger="manual"):
    already_loaded = model_loaded()
    started_at = time.perf_counter()
    model = get_model(trigger=trigger)
    status = get_runtime_status()
    status.update({
        "success": model is not None,
        "alreadyLoaded": bool(already_loaded),
        "requestSeconds": round(
            time.perf_counter() - started_at,
            4
        )
    })
    return status


def _background_warm_target(trigger):
    _update_state(
        warmThreadStartedAt=_utc_now()
    )
    try:
        warm_model(trigger=trigger)
    except Exception:
        return


def start_background_warm(trigger="container_startup"):
    global _WARM_THREAD
    if model_loaded():
        return get_runtime_status()
    with _STATE_LOCK:
        if _STATE.get("warming"):
            return copy.deepcopy(_STATE)
        if (
            _WARM_THREAD is not None
            and _WARM_THREAD.is_alive()
        ):
            return copy.deepcopy(_STATE)
        _STATE.update({
            "state": "scheduled",
            "warming": True,
            "trigger": str(trigger),
            "scheduledAt": _utc_now(),
            "error": None
        })
    _WARM_THREAD = threading.Thread(
        target=_background_warm_target,
        args=(trigger,),
        name="paddle-background-warmer",
        daemon=True
    )
    _WARM_THREAD.start()
    return get_runtime_status()


def wait_until_ready(timeout=None):
    if model_loaded():
        return True
    timeout = (
        PADDLE_WARM_WAIT_SECONDS
        if timeout is None
        else max(0.0, float(timeout))
    )
    _READY_EVENT.wait(timeout=timeout)
    return model_loaded()


def ensure_ready_for_ocr(timeout=None):
    """
    Start warming immediately if needed, then wait for the existing single
    warm operation to finish before OCR work is queued.

    This prevents the expensive Paddle model load from competing with
    Tesseract on the same 2-vCPU container. If the configured timeout expires,
    OCR may still continue and the existing lazy-load path remains available.
    """
    if model_loaded():
        status = get_runtime_status()
        status["readyForOcr"] = True
        status["waitTimedOut"] = False
        return status

    start_background_warm(
        trigger="ocr_request_eager_warm"
    )

    started_at = time.perf_counter()
    ready = wait_until_ready(
        timeout=timeout
    )
    status = get_runtime_status()
    status["readyForOcr"] = bool(ready)
    status["waitTimedOut"] = not bool(ready)
    status["ocrWarmWaitSeconds"] = round(
        time.perf_counter() - started_at,
        4
    )
    return status


def ensure_configured_warmup():
    if PADDLE_WARM_MODE == "off":
        return get_runtime_status()
    if PADDLE_WARM_MODE == "blocking":
        try:
            warm_model(trigger="container_startup_blocking")
        except Exception:
            pass
        return get_runtime_status()
    return start_background_warm(
        trigger="container_startup_background"
    )
