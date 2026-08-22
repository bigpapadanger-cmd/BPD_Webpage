"""Small shared helpers used by multiple OCR modules."""

UTILS_VERSION = "utils-v1.0-shared"


def safe_float(value, default=0.0):
    try:
        return float(value)
    except (TypeError, ValueError):
        return float(default)


def safe_int(value, default=0):
    try:
        return int(value)
    except (TypeError, ValueError):
        return int(default)


def clamp(value, minimum, maximum):
    return max(minimum, min(maximum, value))
