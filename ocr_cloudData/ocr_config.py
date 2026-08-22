import os
from pathlib import Path


CONFIG_VERSION = "config-v3.1-debug-cutout-sheets"

BASE_DIR = Path(__file__).resolve().parent
OUTPUT_DIR = BASE_DIR / "output"
OUTPUT_DIR.mkdir(exist_ok=True)


def env_bool(name, default=False):
    value = os.getenv(name)
    if value is None:
        return bool(default)
    return str(value).strip().lower() in {
        "1",
        "true",
        "yes",
        "on"
    }


def env_int(name, default, minimum=None, maximum=None):
    try:
        value = int(os.getenv(name, str(default)) or default)
    except (TypeError, ValueError):
        value = int(default)
    if minimum is not None:
        value = max(int(minimum), value)
    if maximum is not None:
        value = min(int(maximum), value)
    return value


def env_float(name, default, minimum=None, maximum=None):
    try:
        value = float(os.getenv(name, str(default)) or default)
    except (TypeError, ValueError):
        value = float(default)
    if minimum is not None:
        value = max(float(minimum), value)
    if maximum is not None:
        value = min(float(maximum), value)
    return value


def env_text(name, default=""):
    return str(os.getenv(name, default) or default).strip()


# ============================================================
# DEBUG MODE
# 0=off, 1=quick, 2=medium, 3=full JSON, 4=full + image snippets.
# Named values remain accepted for Cloud Run/backward compatibility.
# ============================================================

DEBUG_LEVELS = {
    "off": 0,
    "0": 0,
    "quick": 1,
    "summary": 1,
    "1": 1,
    "medium": 2,
    "usage": 2,
    "2": 2,
    "full": 3,
    "3": 3,
    "images": 4,
    "4": 4,
}

OCR_DEBUG_LEVEL = env_text(
    "OCR_DEBUG_LEVEL",
    "summary"
).lower()

if OCR_DEBUG_LEVEL not in DEBUG_LEVELS:
    OCR_DEBUG_LEVEL = "summary"

OCR_DEBUG_MODE = DEBUG_LEVELS[OCR_DEBUG_LEVEL]


def debug_enabled(minimum="summary"):
    minimum = str(minimum or "summary").lower()
    required = DEBUG_LEVELS.get(minimum, 1)
    return OCR_DEBUG_MODE >= required


OCR_DEBUG_IMAGE_MAX_SIDE = env_int(
    "OCR_DEBUG_IMAGE_MAX_SIDE",
    1600,
    minimum=640,
    maximum=2600
)
OCR_DEBUG_JPEG_QUALITY = env_int(
    "OCR_DEBUG_JPEG_QUALITY",
    82,
    minimum=45,
    maximum=95
)
OCR_DEBUG_MAX_IMAGES_PER_JOB = env_int(
    "OCR_DEBUG_MAX_IMAGES_PER_JOB",
    18 if OCR_DEBUG_MODE >= 4 else 3,
    minimum=1,
    maximum=24
)
OCR_DEBUG_STORAGE_PREFIX = env_text(
    "OCR_DEBUG_STORAGE_PREFIX",
    "ocr_debug"
).strip("/")
OCR_DEBUG_LOCAL_DIR = OUTPUT_DIR / "ocr_debug"
OCR_DEBUG_LOCAL_DIR.mkdir(parents=True, exist_ok=True)
OCR_DEBUG_KEEP_LOCAL_FILES = env_bool(
    "OCR_DEBUG_KEEP_LOCAL_FILES",
    not bool(os.getenv("K_SERVICE"))
)

# ============================================================
# CORE OCR / API
# ============================================================

OCR_API_KEY = env_text("OCR_API_KEY")
OCR_TASK_TOKEN = env_text("OCR_TASK_TOKEN")
OCR_MAX_UPLOAD_SIZE_MB = env_int(
    "OCR_MAX_UPLOAD_SIZE_MB",
    12,
    minimum=1,
    maximum=50
)
OCR_JOB_RETENTION_SECONDS = env_int(
    "OCR_JOB_RETENTION_SECONDS",
    604800,
    minimum=3600,
    maximum=2592000
)
OCR_PROCESS_MAX_ATTEMPTS = env_int(
    "OCR_PROCESS_MAX_ATTEMPTS",
    3,
    minimum=1,
    maximum=10
)
OCR_PROGRESS_WRITE_MIN_INTERVAL_SECONDS = env_float(
    "OCR_PROGRESS_WRITE_MIN_INTERVAL_SECONDS",
    1.0,
    minimum=0.25,
    maximum=10.0
)
OCR_PROGRESS_WRITE_MIN_DELTA = env_int(
    "OCR_PROGRESS_WRITE_MIN_DELTA",
    2,
    minimum=1,
    maximum=10
)

OCR_CPU_LIMIT = env_float(
    "OCR_CPU_LIMIT",
    2.0,
    minimum=0.1,
    maximum=8.0
)
OCR_MEMORY_LIMIT_MB = env_int(
    "OCR_MEMORY_LIMIT_MB",
    2048,
    minimum=128,
    maximum=32768
)
OCR_METRICS_INTERVAL_SECONDS = env_float(
    "OCR_METRICS_INTERVAL_SECONDS",
    0.5,
    minimum=0.1,
    maximum=2.0
)

LOW_CONFIDENCE_THRESHOLD = env_float(
    "OCR_LOW_CONFIDENCE_THRESHOLD",
    66.0,
    minimum=0.0,
    maximum=100.0
)
AMBIGUOUS_MARGIN_THRESHOLD = env_float(
    "OCR_AMBIGUOUS_MARGIN_THRESHOLD",
    7.0,
    minimum=0.0,
    maximum=100.0
)


# ============================================================
# DURABLE GOOGLE CLOUD JOB STORE
# ============================================================

GCP_PROJECT_ID = (
    env_text("GCP_PROJECT_ID")
    or env_text("GOOGLE_CLOUD_PROJECT")
)
OCR_REGION = env_text(
    "OCR_REGION",
    "us-central1"
)
OCR_FIRESTORE_COLLECTION = env_text(
    "OCR_FIRESTORE_COLLECTION",
    "ocr_jobs"
)
OCR_STORAGE_BUCKET = env_text(
    "OCR_STORAGE_BUCKET"
)
OCR_STORAGE_PREFIX = env_text(
    "OCR_STORAGE_PREFIX",
    "ocr_jobs"
).strip("/")
OCR_TASK_QUEUE = env_text(
    "OCR_TASK_QUEUE",
    "bpd-ocr"
)
OCR_TASK_LOCATION = env_text(
    "OCR_TASK_LOCATION",
    OCR_REGION
)
OCR_TASK_TARGET_URL = env_text(
    "OCR_TASK_TARGET_URL"
)
OCR_TASK_DISPATCH_DEADLINE_SECONDS = env_int(
    "OCR_TASK_DISPATCH_DEADLINE_SECONDS",
    900,
    minimum=60,
    maximum=1800
)
OCR_TASK_LEASE_SECONDS = env_int(
    "OCR_TASK_LEASE_SECONDS",
    1080,
    minimum=120,
    maximum=3600
)


# ============================================================
# PADDLE RUNTIME
# Paddle is treated as a normal recovery stage, but still loaded once.
# ============================================================

PADDLE_MODEL_NAME = env_text(
    "OCR_PADDLE_MODEL_NAME",
    "PP-OCRv5_server_rec"
)
PADDLE_MODEL_DIR = env_text(
    "OCR_PADDLE_MODEL_DIR",
    ""
)
PADDLE_MODEL_SOURCE = env_text(
    "PADDLE_PDX_MODEL_SOURCE",
    ""
)
PADDLE_CPU_THREADS = env_int(
    "OCR_PADDLE_CPU_THREADS",
    2,
    minimum=1,
    maximum=8
)
PADDLE_ENABLE_MKLDNN = env_bool(
    "OCR_PADDLE_ENABLE_MKLDNN",
    True
)
PADDLE_MKLDNN_CACHE_CAPACITY = env_int(
    "OCR_PADDLE_MKLDNN_CACHE_CAPACITY",
    10,
    minimum=1,
    maximum=100
)
PADDLE_WARM_MODE = env_text(
    "OCR_PADDLE_WARM_MODE",
    "off"
).lower()
if PADDLE_WARM_MODE not in {
    "off",
    "background",
    "blocking"
}:
    PADDLE_WARM_MODE = "off"
PADDLE_WARM_WAIT_SECONDS = env_float(
    "OCR_PADDLE_WARM_WAIT_SECONDS",
    90.0,
    minimum=1.0,
    maximum=300.0
)
PADDLE_MAX_LOAD_ATTEMPTS = env_int(
    "OCR_PADDLE_MAX_LOAD_ATTEMPTS",
    2,
    minimum=1,
    maximum=5
)
PADDLE_LOAD_RETRY_COOLDOWN_SECONDS = env_float(
    "OCR_PADDLE_LOAD_RETRY_COOLDOWN_SECONDS",
    120.0,
    minimum=5.0,
    maximum=900.0
)
