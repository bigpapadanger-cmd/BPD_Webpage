import cv2
import numpy as np
import pytesseract
from itertools import combinations, permutations
from ocr_layout import (
    NUMBER_LIMITS,
    COLUMN_NAME_LEFT,
    COLUMN_NAME_RIGHT,
    COLUMN_TITLE_RIGHT,
    COLUMN_SCORE_LEFT,
    COLUMN_SCORE_RIGHT,
    COLUMN_GOALS_LEFT,
    COLUMN_GOALS_RIGHT,
    COLUMN_MIDDLE_LEFT,
    COLUMN_MIDDLE_RIGHT,
    COLUMN_SAVES_LEFT,
    COLUMN_SAVES_RIGHT,
    COLUMN_SHOTS_LEFT,
    COLUMN_SHOTS_RIGHT,
    COLUMN_PING_LEFT,
    COLUMN_PING_RIGHT,
)
from ocr_text import (
    normalize_name_for_match,
    uppercase_text,
)
from ocr_pass2 import (
    crop_safe,
    parse_identity_text,
    sanitize_identity_crop,
    preprocess_variation,
    tesseract_username,
    tesseract_number,
    detect_middle_stat,
)
from ocr_identity import (
    fuzzy_name_score,
    normalize_expected_names,
    validate_expected_roster,
)
from ocr_evidence import (
    EVIDENCE_VERSION,
    ScoreboardEvidence,
)
PREPARATION_VERSION = "preparation-v12.6-compact-ping-faded-center-snap"

# ============================================================
# PREPARATION / LOCALIZATION TUNING
# Change values here first when tuning. Detector logic below
# should consume these constants instead of embedding thresholds.
# ============================================================

# ---------- Preflight / roster ----------
PREFLIGHT_STRONG_NAME_SCORE = 85.0
PREFLIGHT_MINIMUM_HEADER_HITS = 2

# ---------- Scan / normalization ----------
# Full uploads are downscaled ONLY for the cheap localization scan.
# The longest side of that scan will not exceed this value.
PREP_SCAN_MAX_SIDE = 1200

# Detailed OCR normalization is performed on the isolated scoreboard ROI.
PREP_TARGET_WIDTH = 1700
PREP_MAX_WIDTH = 2200
PREP_MAX_UPSCALE = 2.5
PREP_MIN_SCALE = 0.35
PREP_RESIZE_NOOP_TOLERANCE = 0.05
PREP_SMALL_ROI_WIDTH = 900
PREP_MEDIUM_ROI_WIDTH = 1250
PREP_SMALL_ROI_TARGET_WIDTH = 1600
PREP_MEDIUM_ROI_MAX_UPSCALE = 1.65
PREP_ROW_SPACING_ESTIMATE_EXTRA_ROWS = 2.8
PREP_LARGE_ROW_SPACING = 92.0
PREP_LARGE_ROW_TARGET_SPACING = 72.0
PREP_LARGE_ROW_MIN_SCALE = 0.72
PREP_TARGET_ROW_SPACING = 58

# ---------- Canonical row/stat detection ----------
# Legacy hue-specific PING/crop tuners were removed; the foundation owns
# localization and PING is detected by right-most-column geometry.

# ---------- Stat-row detector ----------
PREP_STAT_MIN_HEIGHT_RATIO = 0.004
PREP_STAT_MAX_HEIGHT_RATIO = 0.050
PREP_STAT_MIN_CENTER_Y_RATIO = 0.05
PREP_STAT_MAX_CENTER_Y_RATIO = 0.95
PREP_STAT_CLUSTER_TOLERANCE_RATIO = 0.018
PREP_STAT_CLUSTER_TOLERANCE_MIN = 8.0
PREP_STAT_MIN_COLUMN_HITS = 2
PREP_STAT_MAX_CANDIDATE_MULTIPLIER = 2
PREP_STAT_REGION_RIGHT_RATIO = 0.88
# ---------- Row anchor evidence ----------
PREP_STAT_BASE_CONFIDENCE = 0.72
PREP_STAT_EXTRA_COLUMN_CONFIDENCE = 0.08
PREP_STAT_MAX_CONFIDENCE = 0.96
PREP_ANCHOR_MERGE_TOLERANCE_RATIO = 0.022
PREP_ANCHOR_MERGE_TOLERANCE_MIN = 10.0
# Reject PING/stat candidates that sit on a detected SCORE/GOALS/... header row.
# This prevents the header itself from being promoted into a fake player.
PREP_PLAYER_ROW_HEADER_EXCLUSION_PAD_RATIO = 0.014
PREP_PLAYER_ROW_HEADER_EXCLUSION_MIN_PX = 8

# A row inferred from the repeated physical spacing may replace a missing/faded
# PING row only when its local username/stat probe shows actual player content.
PREP_INFERRED_ROW_NAME_CONFIRM_SCORE = 55.0
PREP_INFERRED_ROW_NUMERIC_CONFIRM_SCORE = 0.70
PREP_INFERRED_ROW_VISUAL_CONFIRM_SCORE = 0.18
PREP_INFERRED_ROW_PING_PRESENCE_SCORE = 0.34
PREP_INFERRED_ROW_SCORE_PRESENCE_SCORE = 0.34
# A geometric single-gap score remains available for diagnostics, but is off by
# default and never confirms a row.  Bounds/color/content evidence owns recovery.
PREP_SINGLE_GAP_GEOMETRY_ENABLED = False
PREP_SINGLE_GAP_MAX_SPACING_ERROR_RATIO = 0.30

# ---------- Evidence-backed row-bound recovery ----------
# Direct rows establish a reusable horizontal frame.  The right edge is learned
# from observed PING boxes; the left probe covers the player/party icon and name
# lead-in.  Missing slots still require pixels at the projected location.
PREP_ROW_BOUND_LEFT_ICON_PAD_RATIO = 0.085
PREP_ROW_BOUND_PING_X_PAD_RATIO = 0.018
PREP_ROW_BOUND_HALF_HEIGHT_RATIO = 0.34
PREP_ROW_BOUND_LEFT_MIN_SCORE = 0.30
PREP_ROW_BOUND_RIGHT_MIN_SCORE = 0.32
PREP_ROW_COLOR_LEARN_MIN_SATURATION = 28
PREP_ROW_COLOR_LEARN_MIN_VALUE = 22
PREP_ROW_COLOR_HUE_TOLERANCE = 14
PREP_ROW_COLOR_FADED_HUE_TOLERANCE = 18
PREP_ROW_COLOR_NORMAL_MIN_COVERAGE = 0.07
PREP_ROW_COLOR_FADED_MIN_COVERAGE = 0.11
PREP_FADED_INFERRED_CENTER_UP_RATIO = 0.035
PREP_FADED_INFERRED_CENTER_UP_MAX_PX = 3

# ---------- Team-color detection ----------
PREP_COLOR_MIN_SEPARATION = 18.0
PREP_COLOR_MIN_SATURATION = 55
PREP_COLOR_MIN_VALUE = 35
PREP_COLOR_SCAN_MIN_SATURATION = 70
PREP_COLOR_SCAN_MIN_VALUE = 45
PREP_COLOR_MIN_VALID_ROW_RATIO = 0.08
PREP_COLOR_MIN_SELECTED_ROW_RATIO = 0.10
PREP_COLOR_MIN_REGION_WIDTH_RATIO = 0.24
PREP_COLOR_MAX_REGION_HEIGHT_RATIO = 0.42
PREP_COLOR_MIN_PAIR_OVERLAP = 0.32
PREP_COLOR_MAX_PAIR_VERTICAL_GAP_RATIO = 0.18
PREP_COLOR_GROUP_MAX_Y_GAP = 3
PREP_COLOR_GROUP_MAX_HUE_GAP = 2
PREP_COLOR_GROUP_MIN_OVERLAP = 0.20
PREP_COLOR_HORIZONTAL_PADDING = 0.055
PREP_COLOR_VERTICAL_PADDING = 0.065
PREP_COLOR_EXPECTED_TEAM_MIN_EXTENT_RATIO = 0.12
PREP_COLOR_EXPECTED_TEAM_MAX_EXTENT_RATIO = 0.25
PREP_COLOR_MIN_FINAL_WIDTH_RATIO = 0.30
PREP_COLOR_MIN_FINAL_HEIGHT_RATIO = 0.16
PREP_ROW_COLOR_LEFT_RATIO = 0.04
PREP_ROW_COLOR_RIGHT_RATIO = 0.78
PREP_ROW_COLOR_HALF_HEIGHT_RATIO = 0.28
PREP_ROW_COLOR_MIN_SAMPLES = 25

# ---------- Team grouping ----------
# ---------- Team grouping ----------
PREP_TEAM_COLOR_DISPERSION_FLOOR = 6.0
PREP_TEAM_COLOR_SIGNAL_RATIO_MIN = 1.10

# ---------- Header / stat-zone filtering ----------
# ---------- Match-Filter Headers ----------
PREP_HEADER_FILTER_ENABLED = True
PREP_HEADER_BOTTOM_PADDING_RATIO = 0.02
PREP_TEAM_BOUNDARY_PADDING_RATIO = 0.015
PREP_STAT_PING_MATCH_TOLERANCE_RATIO = 0.03
PREP_STAT_PING_MATCH_TOLERANCE_MIN = 10.0

# ---------- Canonical scoreboard foundation ----------
PREP_FOUNDATION_MIN_CONFIDENCE = 0.62
PREP_FOUNDATION_LEFT_PADDING_RATIO = 0.08
PREP_FOUNDATION_RIGHT_PADDING_RATIO = 0.14
PREP_FOUNDATION_REQUIRE_DIRECT_ROW_PER_TEAM = True
PREP_FOUNDATION_HEADER_MIN_KEYWORDS = 3
PREP_FOUNDATION_HEADER_Y_TOLERANCE_RATIO = 0.035
PREP_FOUNDATION_HEADER_MIN_VERTICAL_GAP_RATIO = 0.08
PREP_FOUNDATION_HEADER_MAX_VERTICAL_GAP_RATIO = 0.72
PREP_FOUNDATION_HEADER_LEFT_EXPAND_SPAN = 0.52
PREP_FOUNDATION_HEADER_RIGHT_EXPAND_SPAN = 0.08
PREP_FOUNDATION_ADAPTIVE_X_BOUNDS_ENABLED = True
PREP_FOUNDATION_ADAPTIVE_X_MIN_COLUMNS = 3
PREP_FOUNDATION_ADAPTIVE_X_LEFT_PADDING_RATIO = 0.015
PREP_FOUNDATION_ADAPTIVE_X_RIGHT_PADDING_RATIO = 0.012
PREP_FOUNDATION_ADAPTIVE_X_MIN_WIDTH_RATIO = 0.42
PREP_FOUNDATION_ADAPTIVE_X_MAX_WIDTH_RATIO = 1.10
PREP_FOUNDATION_HEADER_TOP_ROW_PADDING = 1.05
PREP_FOUNDATION_LAST_ROW_BOTTOM_PADDING = 1.05
PREP_FOUNDATION_TESSERACT_CONFIG = "--psm 11"

# Weighted foundation hierarchy.
# Two repeated headers are authoritative when their weighted pair score is strong.
# Color is computed only when the header pair needs support or as a fallback.
PREP_FOUNDATION_DUAL_HEADER_STRONG_SCORE = 0.72
PREP_FOUNDATION_DUAL_HEADER_MIN_SCORE = 0.56
PREP_FOUNDATION_SINGLE_HEADER_MIN_SCORE = 0.62
PREP_FOUNDATION_COLOR_FALLBACK_MIN_SCORE = 0.72
PREP_FOUNDATION_HEADER_PAIR_WEIGHT = 0.58
PREP_FOUNDATION_ROW_COVERAGE_WEIGHT = 0.32
PREP_FOUNDATION_COLOR_SUPPORT_WEIGHT = 0.10
PREP_FOUNDATION_HEADER_ONLY_CONFIDENCE_CAP = 0.96
PREP_FOUNDATION_SINGLE_HEADER_CONFIDENCE_CAP = 0.86
PREP_FOUNDATION_COLOR_ONLY_CONFIDENCE_CAP = 0.74
PREP_FOUNDATION_COLOR_VERTICAL_TOP_PAD_RATIO = 0.035
PREP_FOUNDATION_COLOR_VERTICAL_BOTTOM_PAD_RATIO = 0.10
PREP_FOUNDATION_COLOR_ROW_SEARCH_PAD_RATIO = 0.035
PREP_FOUNDATION_COLOR_BAND_ROW_PAD_RATIO = 0.018

PREP_IDENTITY_FROM_HEADER_ENABLED = True
PREP_IDENTITY_LEFT_PAD_RATIO = 0.010
PREP_IDENTITY_RIGHT_GAP_RATIO = 0.018

# One OCR pass; these only change lightweight token matching after Tesseract.
PREP_HEADER_OCR_TARGET_WIDTH = 1800
PREP_HEADER_OCR_MAX_UPSCALE = 2.5
PREP_HEADER_TOKEN_MIN_SIMILARITY = 0.70
PREP_HEADER_TOKEN_MAX_LENGTH_DELTA = 2
PREP_HEADER_OCR_EQUIVALENT_COST = 0.12
# Horizontal stat geometry is accepted only when these three physical headers
# are present in the current ROI. MIDDLE_STAT means ASSISTS or DEMOS.
PREP_ALIGNMENT_REQUIRED_HEADERS = (
    "SCORE",
    "MIDDLE_STAT",
    "PING",
)
PREP_HEADER_VARIANTS = {
    "SCORE": ("SCORE", "SCORES"),
    "GOALS": ("GOAL", "GOALS"),
    "MIDDLE_STAT": ("ASSIST", "ASSISTS", "DEMO", "DEMOS"),
    "SAVES": ("SAVE", "SAVES"),
    "SHOTS": ("SHOT", "SHOTS"),
    "PING": ("PING",),
}
PREP_HEADER_OCR_EQUIVALENTS = {
    "O": "O0Q", "E": "E3", "A": "A4", "S": "S5", "T": "T7",
    "B": "B8", "I": "I1L", "L": "L1I", "G": "G6", "Z": "Z2",
}

# ---------- Color-agnostic right-most PING column ----------
PREP_PING_GRAYSCALE_MIN_VALUE = 105
PREP_PING_BRIGHT_PERCENTILE = 72.0
PREP_PING_COLOR_MIN_VALUE = 82
PREP_PING_COLOR_BRIGHT_PERCENTILE = 68.0
PREP_PING_LOCAL_CONTRAST_MIN = 12
PREP_PING_LOCAL_CONTRAST_PERCENTILE = 82.0
PREP_PING_RIGHTMOST_SEARCH_RATIO = 0.76
PREP_PING_ROW_MATCH_TOLERANCE_RATIO = 0.045
PREP_PING_ROW_MATCH_TOLERANCE_MIN = 10.0
PREP_PING_GENERIC_MIN_WIDTH_RATIO = 0.006
PREP_PING_GENERIC_MAX_WIDTH_RATIO = 0.12
PREP_PING_GENERIC_MIN_HEIGHT_RATIO = 0.005
PREP_PING_GENERIC_MAX_HEIGHT_RATIO = 0.08
PREP_PING_GENERIC_MIN_ASPECT = 0.45
PREP_PING_GENERIC_MAX_ASPECT = 8.5
PREP_PING_GENERIC_TARGET_X_RATIO = 0.92
PREP_PING_GENERIC_X_TOLERANCE_RATIO = 0.18
PREP_PING_CAPTURE_LEFT_PAD_RATIO = 0.030
PREP_PING_CAPTURE_RIGHT_PAD_RATIO = 0.020
PREP_PING_CAPTURE_VERTICAL_PAD_RATIO = 0.010
PREP_PING_PROBE_LEFT_EXPAND_RATIO = 0.045
PREP_PING_PROJECTION_MIN_DISTANCE_RATIO = 0.040
PREP_PING_PROJECTION_HALF_WINDOW_RATIO = 0.018
PREP_PING_PROJECTION_MIN_STRENGTH = 2.0
PREP_PING_PROJECTION_HALF_WIDTH_RATIO = 0.050
PREP_PING_CAPTURE_MAX_WIDTH_RATIO = 0.060
PREP_PING_CAPTURE_MAX_HEIGHT_RATIO = 0.050
# ---------- Strict preflight gates ----------
PREP_REQUIRE_EXPECTED_ROSTER_MATCH = True
PREP_ROSTER_NAME_MIN_SCORE = 72.0
PREP_ROSTER_NAME_MIN_READ_LENGTH = 2
PREP_ROSTER_STRONG_MISMATCH_MAX_SCORE = 45.0
PREP_REQUIRE_TEAM_ASSIGNMENT = True
PREP_REQUIRE_ALL_DIRECT_ROWS = True
HEADER_INDEX = {
    "SCORE": 0,
    "GOALS": 1,
    "MIDDLE_STAT": 2,
    "SAVES": 3,
    "SHOTS": 4,
    "PING": 5,
}

# The required SCORE + MIDDLE_STAT + PING frame remains authoritative when its
# two inferred spacings agree. A separate three-header spacing frame may verify
# it, correct an internally inconsistent required frame, or replace it when one
# of the required headers was not read. These limits are scale-relative.
PREP_HEADER_SPACING_MIN_HEADERS = 3
PREP_HEADER_SPACING_MAX_OVERLAP_RATIO = 0.25
PREP_HEADER_SPACING_MIN_STEP_RATIO = 0.035
PREP_HEADER_SPACING_MAX_STEP_RATIO = 0.12
PREP_HEADER_SPACING_MAX_RESIDUAL_RATIO = 0.20
PREP_REQUIRED_FRAME_MAX_STEP_DISAGREEMENT_RATIO = 0.22
# ============================================================
# ROW / STAT / PING PREPARATION CORE
# ============================================================

def detect_ping_regions(
    image,
    expected_players,
    stat_regions=None
):
    """Detect the right-most PING stat without assuming a hue.

    Rocket League ping text/bars can be green, yellow, orange or red. The
    invariant is geometric: PING is the right-most stat on each player row.
    We therefore detect bright/contrasting glyph clusters in the right-most
    scoreboard column and score them against known stat-row Y positions.
    """
    if image is None or image.size == 0:
        return None, []

    height, width = image.shape[:2]
    if height <= 0 or width <= 0:
        return None, []

    # Preserve the original grayscale detector as the primary signal.  The
    # strongest color channel is supplemental only, so color-agnostic recovery
    # cannot remove a faded row that the original detector could already see.
    gray = (
        cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        if image.ndim == 3
        else image.astype(np.uint8)
    )
    intensity = (
        np.max(image, axis=2).astype(np.uint8)
        if image.ndim == 3
        else image.astype(np.uint8)
    )

    search_left = int(
        width * PREP_PING_RIGHTMOST_SEARCH_RATIO
    )
    search_left = max(0, min(width - 1, search_left))
    gray_search = gray[:, search_left:width]
    color_search = intensity[:, search_left:width]
    if gray_search.size == 0 or color_search.size == 0:
        return None, []

    grayscale_percentile = float(
        np.percentile(
            gray_search,
            PREP_PING_BRIGHT_PERCENTILE
        )
    )
    grayscale_threshold = int(
        max(
            PREP_PING_GRAYSCALE_MIN_VALUE,
            min(245.0, grayscale_percentile)
        )
    )
    _, grayscale_bright = cv2.threshold(
        gray_search,
        grayscale_threshold,
        255,
        cv2.THRESH_BINARY
    )

    color_percentile = float(
        np.percentile(
            color_search,
            PREP_PING_COLOR_BRIGHT_PERCENTILE
        )
    )
    color_threshold = int(max(
        PREP_PING_COLOR_MIN_VALUE,
        min(245.0, color_percentile)
    ))
    _, color_bright = cv2.threshold(
        color_search,
        color_threshold,
        255,
        cv2.THRESH_BINARY
    )
    local_background = cv2.GaussianBlur(
        color_search,
        (0, 0),
        3.0
    )
    residual = cv2.absdiff(
        color_search,
        local_background
    )
    contrast_threshold = int(max(
        PREP_PING_LOCAL_CONTRAST_MIN,
        np.percentile(
            residual,
            PREP_PING_LOCAL_CONTRAST_PERCENTILE
        )
    ))
    _, local_contrast = cv2.threshold(
        residual,
        contrast_threshold,
        255,
        cv2.THRESH_BINARY
    )
    local_contrast = cv2.dilate(
        local_contrast,
        cv2.getStructuringElement(
            cv2.MORPH_RECT,
            (3, 2)
        ),
        iterations=1
    )
    bright = cv2.bitwise_and(
        color_bright,
        local_contrast
    )
    bright = cv2.bitwise_or(
        grayscale_bright,
        bright
    )

    kernel = cv2.getStructuringElement(
        cv2.MORPH_RECT,
        (3, 2)
    )
    connected = cv2.dilate(
        bright,
        kernel,
        iterations=1
    )

    contours, _ = cv2.findContours(
        connected,
        cv2.RETR_EXTERNAL,
        cv2.CHAIN_APPROX_SIMPLE
    )

    row_centers = [
        float(item.get("center_y"))
        for item in (stat_regions or [])
        if item.get("center_y") is not None
    ]
    row_tolerance = max(
        PREP_PING_ROW_MATCH_TOLERANCE_MIN,
        height * PREP_PING_ROW_MATCH_TOLERANCE_RATIO
    )

    min_w = max(2, int(width * PREP_PING_GENERIC_MIN_WIDTH_RATIO))
    max_w = max(min_w + 1, int(width * PREP_PING_GENERIC_MAX_WIDTH_RATIO))
    min_h = max(4, int(width * PREP_PING_GENERIC_MIN_HEIGHT_RATIO))
    max_h = max(min_h + 1, int(width * PREP_PING_GENERIC_MAX_HEIGHT_RATIO))
    target_x = width * PREP_PING_GENERIC_TARGET_X_RATIO

    candidates = []
    for contour in contours:
        x0, y, w, h = cv2.boundingRect(contour)
        x = search_left + x0

        if w < min_w or w > max_w:
            continue
        if h < min_h or h > max_h:
            continue

        aspect = w / max(h, 1)
        if not (
            PREP_PING_GENERIC_MIN_ASPECT
            <= aspect
            <= PREP_PING_GENERIC_MAX_ASPECT
        ):
            continue

        center_x = x + w / 2.0
        center_y = y + h / 2.0
        x_score = max(
            0.0,
            1.0 - abs(center_x - target_x)
            / max(width * PREP_PING_GENERIC_X_TOLERANCE_RATIO, 1.0)
        )

        nearest_row_distance = None
        row_score = 0.0
        if row_centers:
            nearest_row_distance = min(
                abs(center_y - row_y)
                for row_y in row_centers
            )
            row_score = max(
                0.0,
                1.0 - nearest_row_distance
                / max(row_tolerance, 1.0)
            )
        stat_supported = bool(
            nearest_row_distance is not None
            and nearest_row_distance <= row_tolerance * 1.65
        )

        # A missing/faded stat row must not veto an otherwise well-positioned
        # PING candidate.  Geometry near the right-most PING column can stand
        # alone as the initial latch; score/stat probes verify the row later.
        if (
            row_centers
            and not stat_supported
            and x_score < 0.72
        ):
            continue

        score = x_score * 0.65 + row_score * 0.35
        candidates.append({
            "score": float(score),
            "region": (int(x), int(y), int(w), int(h)),
            "center_y": float(center_y),
            "row_distance": (
                None
                if nearest_row_distance is None
                else float(nearest_row_distance)
            ),
            "stat_supported": stat_supported
        })

    # Contours can fragment a faded PING value into strokes that are each too
    # small for the normal component filter.  Learn a narrow PING X-band from
    # the usable contour detections, then project only that band.  Projecting
    # the entire right quarter previously wrapped unrelated SHOTS/header/background
    # pixels into one huge rectangle and shifted the reconstructed row center.
    supported_contour_ping_regions = [
        item.get("region")
        for item in candidates
        if item.get("stat_supported") is True
        and _region_tuple(item.get("region")) is not None
    ]
    contour_ping_regions = supported_contour_ping_regions or [
        item.get("region")
        for item in candidates
        if _region_tuple(item.get("region")) is not None
    ]
    if contour_ping_regions:
        projection_center_x = float(np.median([
            region[0] + region[2] / 2.0
            for region in contour_ping_regions
        ]))
        learned_half_width = max(
            width * PREP_PING_PROJECTION_HALF_WIDTH_RATIO,
            float(np.median([
                region[2]
                for region in contour_ping_regions
            ])) * 1.35
        )
    else:
        projection_center_x = float(target_x)
        learned_half_width = width * PREP_PING_PROJECTION_HALF_WIDTH_RATIO
    projection_global_left = max(
        search_left,
        int(round(projection_center_x - learned_half_width))
    )
    projection_global_right = min(
        width,
        int(round(projection_center_x + learned_half_width))
    )
    projection_local_left = max(0, projection_global_left - search_left)
    projection_local_right = min(
        local_contrast.shape[1],
        projection_global_right - search_left
    )
    projection_source = local_contrast[
        :,
        projection_local_left:projection_local_right
    ]
    if projection_source.size == 0:
        projection_source = local_contrast
        projection_local_left = 0
        projection_local_right = local_contrast.shape[1]

    # The vertical projection preserves the row-level cluster without inventing
    # a Y coordinate: every candidate still comes from observed PING-band pixels.
    projection = np.count_nonzero(
        projection_source,
        axis=1
    ).astype(np.float32)
    projection = cv2.GaussianBlur(
        projection.reshape(-1, 1),
        (1, 9),
        0
    ).reshape(-1)
    projection_floor = max(
        PREP_PING_PROJECTION_MIN_STRENGTH,
        float(np.percentile(projection, 72.0))
    )
    peak_rows = [
        row
        for row in range(1, max(1, height - 1))
        if projection[row] >= projection_floor
        and projection[row] >= projection[row - 1]
        and projection[row] > projection[row + 1]
    ]
    minimum_peak_distance = max(
        16,
        int(round(
            height
            * PREP_PING_PROJECTION_MIN_DISTANCE_RATIO
        ))
    )
    projection_peaks = []
    for row in sorted(
        peak_rows,
        key=lambda value: float(projection[value]),
        reverse=True
    ):
        if any(
            abs(row - existing)
            < minimum_peak_distance
            for existing in projection_peaks
        ):
            continue
        projection_peaks.append(row)
        if expected_players and len(projection_peaks) >= int(expected_players) + 4:
            break

    projection_peak_max = max(
        [float(projection[row]) for row in projection_peaks],
        default=1.0
    )
    projection_half_window = max(
        5,
        int(round(
            height
            * PREP_PING_PROJECTION_HALF_WINDOW_RATIO
        ))
    )
    for row in projection_peaks:
        top = max(0, int(row - projection_half_window))
        bottom = min(height, int(row + projection_half_window + 1))
        signal_window = projection_source[top:bottom]
        signal = cv2.findNonZero(signal_window)
        if signal is None:
            continue
        signal_x, _, signal_w, _ = cv2.boundingRect(signal)
        center_y = float(row)
        nearest_row_distance = (
            min(
                abs(center_y - row_y)
                for row_y in row_centers
            )
            if row_centers
            else None
        )
        stat_supported = bool(
            nearest_row_distance is not None
            and nearest_row_distance <= row_tolerance * 1.65
        )
        strength = min(
            1.0,
            float(projection[row])
            / max(projection_peak_max, 1.0)
        )
        candidates.append({
            "score": 0.66 + strength * 0.22 + (0.12 if stat_supported else 0.0),
            "region": (
                int(
                    search_left
                    + projection_local_left
                    + signal_x
                ),
                int(top),
                int(signal_w),
                int(max(1, bottom - top))
            ),
            "center_y": center_y,
            "row_distance": (
                None
                if nearest_row_distance is None
                else float(nearest_row_distance)
            ),
            "stat_supported": stat_supported,
            "source": "ping_vertical_projection",
            "projectionStrength": round(strength, 4),
        })

    candidates.sort(
        key=lambda item: item["score"],
        reverse=True
    )

    selected = []
    selected_centers = []
    dedup_tolerance = max(
        6.0,
        height * 0.015
    )

    for item in candidates:
        cy = item["center_y"]
        if any(
            abs(cy - existing) <= dedup_tolerance
            for existing in selected_centers
        ):
            continue
        x, y, w, h = item["region"]

        pad_left = int(
            width * PREP_PING_CAPTURE_LEFT_PAD_RATIO
        )

        pad_right = int(
            width * PREP_PING_CAPTURE_RIGHT_PAD_RATIO
        )

        pad_y = int(
            height * PREP_PING_CAPTURE_VERTICAL_PAD_RATIO
        )

        expanded_region = (
            max(
                0,
                x - pad_left
            ),
            max(
                0,
                y - pad_y
            ),
            min(
                width,
                x + w + pad_right
            ) - max(
                0,
                x - pad_left
            ),
            min(
                height,
                y + h + pad_y
            ) - max(
                0,
                y - pad_y
            )
        )

        maximum_capture_width = max(
            24,
            int(round(width * PREP_PING_CAPTURE_MAX_WIDTH_RATIO))
        )
        if expanded_region[2] > maximum_capture_width:
            capture_center_x = int(round(x + w / 2.0))
            capped_left = max(
                0,
                min(
                    width - maximum_capture_width,
                    capture_center_x - maximum_capture_width // 2
                )
            )
            expanded_region = (
                int(capped_left),
                int(expanded_region[1]),
                int(min(maximum_capture_width, width - capped_left)),
                int(expanded_region[3])
            )

        maximum_capture_height = max(
            18,
            int(round(height * PREP_PING_CAPTURE_MAX_HEIGHT_RATIO))
        )
        if expanded_region[3] > maximum_capture_height:
            capture_center_y = int(round(cy))
            capped_top = max(
                0,
                min(
                    height - maximum_capture_height,
                    capture_center_y - maximum_capture_height // 2
                )
            )
            expanded_region = (
                int(expanded_region[0]),
                int(capped_top),
                int(expanded_region[2]),
                int(min(maximum_capture_height, height - capped_top))
            )

        selected.append(
            expanded_region
        )
        selected_centers.append(cy)
        # Keep a small reserve because header text and unrelated right-edge UI
        # may be removed later by the header-band and layout filters.
        selection_limit = (
            int(expected_players) + 2
            if expected_players
            else 0
        )
        if selection_limit and len(selected) >= selection_limit:
            break

    selected.sort(key=lambda region: region[1])

    mask = np.zeros((height, width), dtype=np.uint8)
    mask[:, search_left:width] = bright
    return mask, selected

def detect_raw_stat_anchor_regions(
    image
):
    """Find raw player-row candidates from repeated numeric stat columns."""

    if image is None or image.size == 0:
        return []

    height, width = image.shape[:2]

    if height <= 0 or width <= 0:
        return []

    column_ranges = [
        (
            COLUMN_SCORE_LEFT,
            COLUMN_SCORE_RIGHT
        ),
        (
            COLUMN_GOALS_LEFT,
            COLUMN_GOALS_RIGHT
        ),
        (
            COLUMN_SAVES_LEFT,
            COLUMN_SAVES_RIGHT
        ),
    ]

    min_h = max(
        6,
        int(
            width
            * PREP_STAT_MIN_HEIGHT_RATIO
        )
    )

    max_h = max(
        min_h + 1,
        int(
            width
            * PREP_STAT_MAX_HEIGHT_RATIO
        )
    )

    observations = []

    for column_index, (
        left_ratio,
        right_ratio
    ) in enumerate(
        column_ranges
    ):

        left = max(
            0,
            int(
                width
                * left_ratio
            )
        )

        right = min(
            width,
            int(
                width
                * right_ratio
            )
        )

        if right <= left:
            continue

        crop = image[
            :,
            left:right
        ]

        if crop is None or crop.size == 0:
            continue

        gray = cv2.cvtColor(
            crop,
            cv2.COLOR_BGR2GRAY
        )

        gray = cv2.GaussianBlur(
            gray,
            (3, 3),
            0
        )

        _, bright = cv2.threshold(
            gray,
            0,
            255,
            cv2.THRESH_BINARY
            + cv2.THRESH_OTSU
        )

        kernel = cv2.getStructuringElement(
            cv2.MORPH_RECT,
            (3, 2)
        )

        connected = cv2.dilate(
            bright,
            kernel,
            iterations=1
        )

        contours, _ = cv2.findContours(
            connected,
            cv2.RETR_EXTERNAL,
            cv2.CHAIN_APPROX_SIMPLE
        )

        for contour in contours:

            x, y, w, h = cv2.boundingRect(
                contour
            )

            if (
                h < min_h
                or h > max_h
            ):
                continue

            column_width = (
                right
                - left
            )

            if (
                w < 2
                or w > max(
                    8,
                    int(
                        column_width
                        * 0.95
                    )
                )
            ):
                continue

            center_y = (
                y
                + h / 2.0
            )

            if (
                center_y
                < height
                * PREP_STAT_MIN_CENTER_Y_RATIO
            ):
                continue

            if (
                center_y
                > height
                * PREP_STAT_MAX_CENTER_Y_RATIO
            ):
                continue

            observations.append({
                "center_y": float(
                    center_y
                ),
                "column": int(
                    column_index
                ),
                "region": (
                    int(left + x),
                    int(y),
                    int(w),
                    int(h)
                )
            })

    if not observations:
        return []

    observations.sort(
        key=lambda item:
        item["center_y"]
    )

    cluster_tolerance = max(
        PREP_STAT_CLUSTER_TOLERANCE_MIN,
        height
        * PREP_STAT_CLUSTER_TOLERANCE_RATIO
    )

    clusters = []

    for item in observations:

        best_cluster = None
        best_distance = None

        for cluster in clusters:

            distance = abs(
                item["center_y"]
                - cluster["center_y"]
            )

            if distance > cluster_tolerance:
                continue

            if (
                best_distance is None
                or distance < best_distance
            ):
                best_cluster = cluster
                best_distance = distance

        if best_cluster is None:

            clusters.append({
                "items": [
                    item
                ],
                "center_y": float(
                    item["center_y"]
                )
            })

            continue

        best_cluster["items"].append(
            item
        )

        best_cluster["center_y"] = float(
            np.median([
                member["center_y"]
                for member
                in best_cluster["items"]
            ])
        )

    candidates = []

    stat_left = int(
        width
        * COLUMN_SCORE_LEFT
    )

    # Intentionally stop before PING.
    # This debug/evidence region therefore covers:
    # SCORE -> GOALS -> MIDDLE -> SAVES -> SHOTS.
    stat_right = int(
        width
        * PREP_STAT_REGION_RIGHT_RATIO
    )

    for cluster in clusters:

        columns = {
            item["column"]
            for item
            in cluster["items"]
        }

        if (
            len(columns)
            < PREP_STAT_MIN_COLUMN_HITS
        ):
            continue

        ys = [
            item["region"][1]
            for item
            in cluster["items"]
        ]

        bottoms = [
            item["region"][1]
            + item["region"][3]
            for item
            in cluster["items"]
        ]

        candidates.append({
            "center_y": int(
                round(
                    cluster["center_y"]
                )
            ),

            "column_hits": int(
                len(columns)
            ),

            "component_hits": int(
                len(
                    cluster["items"]
                )
            ),

            "region": (
                stat_left,

                max(
                    0,
                    int(
                        min(ys)
                    )
                ),

                max(
                    1,
                    stat_right
                    - stat_left
                ),

                max(
                    1,
                    int(
                        max(bottoms)
                        - min(ys)
                    )
                )
            ),

            "team_hint": None,
            "ping_distance": None,
            "ping_supported": False,
            "structure_score": 0.0
        })

    candidates.sort(
        key=lambda item:
        item["center_y"]
    )

    return candidates

def detect_stat_anchor_regions(
    image,
    expected_players,
    team_header_regions=None,
    team_boundary_y=None,
    ping_regions=None
):
    """Detect and validate stat-row anchors."""

    raw_candidates = (
        detect_raw_stat_anchor_regions(
            image
        )
    )

    if not raw_candidates:
        return []

    return filter_stat_anchor_regions(
        raw_candidates,
        image.shape[0],
        expected_players,
        team_header_regions=team_header_regions,
        team_boundary_y=team_boundary_y,
        ping_regions=ping_regions
    )

def filter_stat_anchor_regions(
    candidates,
    image_height,
    expected_players,
    team_header_regions=None,
    team_boundary_y=None,
    ping_regions=None
):
    """Score/filter raw stat rows using foundation team zones and PING support."""

    if not candidates:
        return []

    candidates = [
        dict(candidate)
        for candidate in candidates
    ]

    # ============================================================
    # TEAM HEADER / FOUNDATION ZONES
    # ============================================================

    if (
        PREP_HEADER_FILTER_ENABLED
        and team_header_regions
    ):

        header_padding = int(
            image_height
            * PREP_HEADER_BOTTOM_PADDING_RATIO
        )

        boundary_padding = int(
            image_height
            * PREP_TEAM_BOUNDARY_PADDING_RATIO
        )

        team_1_header = (
            team_header_regions.get(
                "team1"
            )
            or {}
        )

        team_2_header = (
            team_header_regions.get(
                "team2"
            )
            or {}
        )

        team_1_header_bottom = (
            team_1_header.get(
                "bottom"
            )
        )

        team_2_header_bottom = (
            team_2_header.get(
                "bottom"
            )
        )

        filtered_candidates = []

        for candidate in candidates:

            candidate_y = int(
                candidate["center_y"]
            )

            accepted = False

            if (
                team_1_header_bottom
                is not None
                and team_boundary_y
                is not None
            ):

                team_1_min_y = (
                    int(
                        team_1_header_bottom
                    )
                    + header_padding
                )

                team_1_max_y = (
                    int(
                        team_boundary_y
                    )
                    - boundary_padding
                )

                if (
                    team_1_min_y
                    < candidate_y
                    < team_1_max_y
                ):
                    candidate[
                        "team_hint"
                    ] = 1

                    candidate[
                        "structure_score"
                    ] += 2.0

                    accepted = True

            if (
                not accepted
                and team_2_header_bottom
                is not None
            ):

                team_2_min_y = (
                    int(
                        team_2_header_bottom
                    )
                    + header_padding
                )

                if (
                    candidate_y
                    > team_2_min_y
                ):
                    candidate[
                        "team_hint"
                    ] = 2

                    candidate[
                        "structure_score"
                    ] += 2.0

                    accepted = True

            # If foundation header information is incomplete,
            # preserve potentially valid stat rows.
            if (
                not accepted
                and team_1_header_bottom
                is None
                and team_2_header_bottom
                is None
            ):
                accepted = True

            elif (
                not accepted
                and team_1_header_bottom
                is None
                and team_boundary_y
                is not None
                and candidate_y
                < int(
                    team_boundary_y
                )
            ):
                candidate[
                    "team_hint"
                ] = 1

                accepted = True

            elif (
                not accepted
                and team_2_header_bottom
                is None
                and team_boundary_y
                is not None
                and candidate_y
                > int(
                    team_boundary_y
                )
            ):
                candidate[
                    "team_hint"
                ] = 2

                accepted = True

            if accepted:
                filtered_candidates.append(
                    candidate
                )

        if filtered_candidates:

            minimum_safe_count = max(
                1,
                int(
                    expected_players
                    * 0.50
                )
            )

            if (
                len(filtered_candidates)
                >= minimum_safe_count
            ):
                candidates = (
                    filtered_candidates
                )

    # ============================================================
    # PING SUPPORT
    # ============================================================

    ping_centers = []

    for region in (
        ping_regions
        or []
    ):

        if (
            not region
            or len(region) < 4
        ):
            continue

        _, ping_y, _, ping_h = (
            region[:4]
        )

        ping_centers.append(
            float(
                ping_y
                + ping_h / 2.0
            )
        )

    if ping_centers:

        ping_match_tolerance = max(
            PREP_STAT_PING_MATCH_TOLERANCE_MIN,
            image_height
            * PREP_STAT_PING_MATCH_TOLERANCE_RATIO
        )

        for candidate in candidates:

            candidate_y = float(
                candidate[
                    "center_y"
                ]
            )

            nearest_ping_distance = min(
                abs(
                    candidate_y
                    - ping_y
                )
                for ping_y
                in ping_centers
            )

            candidate[
                "ping_distance"
            ] = round(
                float(
                    nearest_ping_distance
                ),
                2
            )

            if (
                nearest_ping_distance
                <= ping_match_tolerance
            ):
                candidate[
                    "ping_supported"
                ] = True

                candidate[
                    "structure_score"
                ] += 4.0

    # ============================================================
    # STRUCTURAL SCORE
    # ============================================================

    for candidate in candidates:

        candidate[
            "structure_score"
        ] += (
            float(
                candidate.get(
                    "column_hits",
                    0
                )
            )
            * 0.75
        )

        candidate[
            "structure_score"
        ] += min(
            1.5,
            float(
                candidate.get(
                    "component_hits",
                    0
                )
            )
            * 0.15
        )

        candidate[
            "structure_score"
        ] = round(
            float(
                candidate[
                    "structure_score"
                ]
            ),
            4
        )

    # If every expected player has a PING,
    # unmatched stat rows are almost certainly UI/header noise.
    if (
        expected_players
        and len(ping_centers)
        >= expected_players
    ):

        ping_supported_candidates = [
            candidate
            for candidate
            in candidates
            if candidate.get(
                "ping_supported"
            )
        ]

        if (
            len(
                ping_supported_candidates
            )
            >= expected_players
        ):
            candidates = (
                ping_supported_candidates
            )

    candidates.sort(
        key=lambda item: (
            1
            if item.get(
                "ping_supported"
            )
            else 0,

            float(
                item.get(
                    "structure_score",
                    0.0
                )
            ),

            int(
                item.get(
                    "column_hits",
                    0
                )
            ),

            int(
                item.get(
                    "component_hits",
                    0
                )
            )
        ),
        reverse=True
    )

    if expected_players:

        maximum_candidates = max(
            expected_players,
            expected_players
            * PREP_STAT_MAX_CANDIDATE_MULTIPLIER
        )

        candidates = candidates[
            :maximum_candidates
        ]

    candidates.sort(
        key=lambda item:
        item["center_y"]
    )

    return candidates

def _foundation_headers_from_alignment(alignment_info):
    foundation = (
        alignment_info.get("foundation")
        if isinstance(alignment_info, dict)
        else None
    )
    if not isinstance(foundation, dict):
        return []

    headers = []
    for team_key in ("team1", "team2"):
        header = (
            foundation.get(team_key, {})
            .get("header")
        )
        if isinstance(header, dict):
            headers.append(dict(header))

    headers.sort(
        key=lambda item: float(
            item.get("center_y", 0.0)
            or 0.0
        )
    )
    return headers

def build_roi_evidence(
    image,
    players_per_team,
    expected_names=None,
    alignment_info=None,
    evidence=None,
    use_ocr_probes=False
):
    """Compute each structural signal once for one normalized ROI.

    The returned ScoreboardEvidence is reused by preflight, debug, and full OCR.
    Empty results are cached too; an empty detector result is not recomputed just
    because it is falsey.
    """
    if evidence is None:
        evidence = ScoreboardEvidence(
            players_per_team=int(players_per_team),
            expected_names=list(expected_names or []),
            image=image,
            coordinate_space="normalized_roi",
            alignment_info=dict(alignment_info or {})
        )
    else:
        evidence.image = image
        evidence.players_per_team = int(players_per_team)
        if expected_names is not None:
            evidence.expected_names = list(expected_names or [])
        if alignment_info is not None:
            evidence.alignment_info = dict(alignment_info or {})

    expected_players = int(players_per_team) * 2

    # Header geometry is needed by both structural interpretation and identity
    # orientation. Compute it once in this ROI coordinate space before row probes.
    if not evidence.has("header_rows"):

        # Header X coordinates used by OCR must always be detected
        # directly inside the current normalized ROI coordinate space.
        header_rows = detect_scoreboard_header_rows(
            image
        )

        evidence.set_value(
            "header_rows",
            header_rows
        )

    if not evidence.has("column_geometry"):
        evidence.set_value(
            "column_geometry",
            _column_geometry_from_header_rows(
                image.shape[1],
                evidence.header_rows
            )
        )

    name_geometry = (
        evidence.column_geometry.get("name")
        if isinstance(evidence.column_geometry, dict)
        else None
    )
    identity_x_bounds = (
        (
            int(name_geometry.get("left")),
            int(name_geometry.get("right"))
        )
        if isinstance(name_geometry, dict)
        and name_geometry.get("left") is not None
        and name_geometry.get("right") is not None
        else None
    )

    if not evidence.has("raw_stat_regions"):
        evidence.set_value(
            "raw_stat_regions",
            detect_raw_stat_anchor_regions(
                image
            )
        )

    if not evidence.has("ping_regions"):
        _, ping_regions = detect_ping_regions(
            image,
            expected_players,
            stat_regions=evidence.raw_stat_regions
        )
        evidence.set_value(
            "ping_regions",
            ping_regions
        )

    if not evidence.has("stat_regions"):
        stat_regions = filter_stat_anchor_regions(
            evidence.raw_stat_regions,
            image.shape[0],
            expected_players,
            ping_regions=evidence.ping_regions
        )
        evidence.set_value(
            "stat_regions",
            stat_regions
        )

    if not evidence.has("row_anchors"):
        row_anchors = reconstruct_player_anchors(
            image,
            evidence.ping_regions,
            players_per_team,
            evidence.expected_names,
            stat_regions=evidence.stat_regions,
            use_ocr_probes=use_ocr_probes,
            identity_x_bounds=identity_x_bounds,
            header_rows=evidence.header_rows,
            column_geometry=evidence.column_geometry
        )
        evidence.set_value(
            "row_anchors",
            row_anchors
        )

    if (
        use_ocr_probes
        and not evidence.has("row_probes")
    ):
        for anchor in evidence.row_anchors:
            anchor["probe"] = quick_row_probe(
                image,
                anchor.get(
                    "center_y",
                    0
                ),
                anchor.get(
                    "row_spacing",
                    max(
                        36,
                        int(
                            image.shape[0]
                            * 0.08
                        )
                    )
                ),
                evidence.expected_names,
                identity_x_bounds=identity_x_bounds,
                row_template=anchor.get(
                    "observed_row_template"
                ),
                column_geometry=evidence.column_geometry
            )
        evidence.mark(
            "row_probes"
        )

    if not evidence.has("team_structure"):
        (
            evidence.row_anchors,
            team_structure
        ) = assign_team_groups_from_color_or_spacing(
            image,
            evidence.row_anchors,
            players_per_team
        )
        evidence.set_value(
            "team_structure",
            team_structure
        )

    # header_rows already computed above and reused here.

    if not evidence.has("header_summary"):
        evidence.set_value(
            "header_summary",
            _summarize_header_rows(
                evidence.header_rows
            )
        )

    # Only pay for the legacy two-variation middle-stat OCR when the canonical
    # header pass could not determine ASSISTS vs DEMOS. Cache the result here so
    # the main OCR orchestrator never repeats this work.
    if (
        use_ocr_probes
        and not evidence.header_summary.get("middleStat")
        and not evidence.has("middle_stat_fallback")
    ):
        middle_stat, variation_1, variation_2 = detect_middle_stat(image)
        evidence.header_summary.update({
            "middleStat": middle_stat,
            "variation1": variation_1,
            "variation2": variation_2,
            "headerText": " | ".join(
                value for value in (variation_1, variation_2) if value
            ),
        })
        evidence.mark("middle_stat_fallback")

    return evidence

def merge_row_anchor_evidence(
    ping_regions,
    stat_regions,
    image_height
):
    """Merge ping and stat detections that refer to the same player row."""
    evidence = []
    for region in ping_regions or []:
        evidence.append({
            "center_y": float(
                region[1] + region[3] / 2.0
            ),
            "type": "ping",
            "ping_region": region,
            "stat_region": None,
            "confidence": 1.0
        })
    for item in stat_regions or []:
        evidence.append({
            "center_y": float(item["center_y"]),
            "type": "stat",
            "ping_region": None,
            "stat_region": item,
            "confidence": min(
                PREP_STAT_MAX_CONFIDENCE,
                PREP_STAT_BASE_CONFIDENCE
                + PREP_STAT_EXTRA_COLUMN_CONFIDENCE
                * float(
                    item.get(
                        "column_hits",
                        PREP_STAT_MIN_COLUMN_HITS
                    )
                    - PREP_STAT_MIN_COLUMN_HITS
                )
            )
        })
    if not evidence:
        return []
    evidence.sort(
        key=lambda item: item["center_y"]
    )
    merge_tolerance = max(
        PREP_ANCHOR_MERGE_TOLERANCE_MIN,
        image_height * PREP_ANCHOR_MERGE_TOLERANCE_RATIO
    )
    merged = []
    for item in evidence:
        target = None
        for existing in reversed(merged):
            if abs(
                item["center_y"]
                - existing["center_y"]
            ) <= merge_tolerance:
                target = existing
                break
            if (
                item["center_y"]
                - existing["center_y"]
            ) > merge_tolerance:
                break
        if target is None:
            merged.append(dict(item))
            continue
        centers = [
            target["center_y"],
            item["center_y"]
        ]
        target["center_y"] = float(
            sum(centers) / len(centers)
        )
        if item.get("ping_region") is not None:
            target["ping_region"] = item["ping_region"]
        if item.get("stat_region") is not None:
            target["stat_region"] = item["stat_region"]
        if (
            target.get("ping_region") is not None
            and target.get("stat_region") is not None
        ):
            target["type"] = "ping_stat"
            target["confidence"] = 1.0
        else:
            target["confidence"] = max(
                float(target.get("confidence", 0.0)),
                float(item.get("confidence", 0.0))
            )
    return merged


def _validated_header_spacing_frame(
    image_width,
    header_rows
):
    """Infer all six stat centers from at least three clean header detections.

    Two known header positions define a possible column spacing. A third header
    verifies the sequence. Repeated header rows are combined after rejecting a
    token box that substantially overlaps another detected header in the same
    row; this removes merged OCR boxes such as ``GOALS ASSISTS`` being reported
    as the GOALS position.
    """
    if image_width <= 0:
        return None

    observations = {}

    for row in header_rows or []:
        columns = (
            row.get("columns")
            if isinstance(row, dict)
            else None
        )

        if not isinstance(columns, dict):
            continue

        entries = []

        for name, column_index in HEADER_INDEX.items():
            column = columns.get(name)

            if not isinstance(column, dict):
                continue

            center_x = column.get("center_x")

            if center_x is None:
                continue

            left = column.get("x", column.get("left"))
            width = column.get("w", column.get("width"))
            right = column.get("right")

            if left is None:
                left = float(center_x) - 1.0

            if right is None:
                if width is None:
                    right = float(center_x) + 1.0
                else:
                    right = float(left) + float(width)

            entry_width = max(
                1.0,
                float(right) - float(left)
            )

            entries.append({
                "name": name,
                "index": int(column_index),
                "center": float(center_x),
                "left": float(left),
                "right": float(right),
                "width": float(entry_width),
                "confidence": float(
                    column.get("confidence", 0.0)
                    or 0.0
                ),
            })

        rejected = set()

        for first_index, first in enumerate(entries):
            for second_index in range(
                first_index + 1,
                len(entries)
            ):
                second = entries[second_index]

                overlap = max(
                    0.0,
                    min(first["right"], second["right"])
                    - max(first["left"], second["left"])
                )

                minimum_width = max(
                    1.0,
                    min(first["width"], second["width"])
                )

                if (
                    overlap / minimum_width
                    < PREP_HEADER_SPACING_MAX_OVERLAP_RATIO
                ):
                    continue

                if first["width"] > second["width"]:
                    rejected.add(first_index)
                elif second["width"] > first["width"]:
                    rejected.add(second_index)
                elif first["confidence"] < second["confidence"]:
                    rejected.add(first_index)
                else:
                    rejected.add(second_index)

        for entry_index, entry in enumerate(entries):
            if entry_index in rejected:
                continue

            observations.setdefault(
                entry["name"],
                []
            ).append(entry["center"])

    observed_centers = {
        name: float(np.median(values))
        for name, values in observations.items()
        if values
    }

    if (
        len(observed_centers)
        < PREP_HEADER_SPACING_MIN_HEADERS
    ):
        return None

    spacing_samples = []
    observed_items = sorted(
        observed_centers.items(),
        key=lambda item: HEADER_INDEX[item[0]]
    )

    for first_position, (first_name, first_center) in enumerate(
        observed_items
    ):
        first_column_index = HEADER_INDEX[first_name]

        for second_name, second_center in observed_items[
            first_position + 1:
        ]:
            index_distance = (
                HEADER_INDEX[second_name]
                - first_column_index
            )

            if index_distance <= 0:
                continue

            spacing = (
                float(second_center)
                - float(first_center)
            ) / float(index_distance)

            if spacing > 0.0:
                spacing_samples.append(spacing)

    if not spacing_samples:
        return None

    column_spacing = float(
        np.median(spacing_samples)
    )

    minimum_spacing = (
        float(image_width)
        * PREP_HEADER_SPACING_MIN_STEP_RATIO
    )
    maximum_spacing = (
        float(image_width)
        * PREP_HEADER_SPACING_MAX_STEP_RATIO
    )

    if not (
        minimum_spacing
        <= column_spacing
        <= maximum_spacing
    ):
        return None

    score_origins = [
        float(center_x)
        - HEADER_INDEX[name] * column_spacing
        for name, center_x in observed_items
    ]
    score_center = float(
        np.median(score_origins)
    )

    centers = {
        name: float(
            score_center
            + column_index * column_spacing
        )
        for name, column_index in HEADER_INDEX.items()
    }

    residuals = [
        abs(
            float(center_x)
            - centers[name]
        )
        for name, center_x in observed_items
    ]
    residual = float(
        np.median(residuals)
    )
    maximum_residual = float(
        max(residuals)
    )
    residual_limit = max(
        6.0,
        column_spacing
        * PREP_HEADER_SPACING_MAX_RESIDUAL_RATIO
    )

    if (
        residual > residual_limit
        or maximum_residual > residual_limit * 1.5
    ):
        return None

    canonical_score_center = (
        COLUMN_SCORE_LEFT
        + COLUMN_SCORE_RIGHT
    ) / 2.0
    canonical_ping_center = (
        COLUMN_PING_LEFT
        + COLUMN_PING_RIGHT
    ) / 2.0
    canonical_span = (
        canonical_ping_center
        - canonical_score_center
    )

    if canonical_span <= 0.0:
        return None

    scoreboard_width = (
        centers["PING"]
        - centers["SCORE"]
    ) / canonical_span
    scoreboard_left = (
        centers["SCORE"]
        - canonical_score_center * scoreboard_width
    )

    minimum_width = (
        image_width
        * PREP_FOUNDATION_ADAPTIVE_X_MIN_WIDTH_RATIO
    )
    maximum_width = (
        image_width
        * PREP_FOUNDATION_ADAPTIVE_X_MAX_WIDTH_RATIO
    )

    if not (
        minimum_width
        <= scoreboard_width
        <= maximum_width
    ):
        return None

    left_padding = (
        scoreboard_width
        * PREP_FOUNDATION_ADAPTIVE_X_LEFT_PADDING_RATIO
    )
    right_padding = (
        scoreboard_width
        * PREP_FOUNDATION_ADAPTIVE_X_RIGHT_PADDING_RATIO
    )
    estimated_left = max(
        0,
        min(
            image_width - 1,
            int(round(scoreboard_left - left_padding))
        )
    )
    estimated_right = max(
        estimated_left + 1,
        min(
            image_width,
            int(round(
                scoreboard_left
                + scoreboard_width
                + right_padding
            ))
        )
    )

    return {
        "centers": centers,
        "columnSpacing": round(column_spacing, 3),
        "fitResidual": round(residual, 3),
        "maximumResidual": round(maximum_residual, 3),
        "columnsUsed": [
            name
            for name, _
            in observed_items
        ],
        "fit": {
            "left": int(estimated_left),
            "right": int(estimated_right),
            "scoreboardWidth": round(scoreboard_width, 2),
            "scoreboardLeft": round(scoreboard_left, 2),
            "fitResidual": round(residual, 3),
            "columnsUsed": [
                name
                for name, _
                in observed_items
            ],
        },
    }


def _column_geometry_from_header_rows(
    image_width,
    header_rows
):
    """Build stable numeric geometry without allowing row-level PING to stretch it.

    Preferred mode:
        SCORE + MIDDLE_STAT + PING are all physically detected.
        These three headers define a stable horizontal frame:
            SCORE -> index 0
            MIDDLE_STAT -> index 2
            PING -> index 5

        GOALS is interpolated between SCORE and MIDDLE_STAT.
        SAVES and SHOTS are interpolated between MIDDLE_STAT and PING.

    Sparse-header fallback:
        Some 1v1 screenshots do not OCR all three required headers reliably.
        In that case, retain any observed header centers that do exist and use
        the affine scoreboard fit only for missing centers.

    IMPORTANT:
        Direct per-player PING regions are never used here. They are applied
        later only to the final PING crop, so they cannot widen or shift SHOTS.
    """
    rows = [
        row
        for row in (header_rows or [])
        if isinstance(row, dict)
        and isinstance(row.get("columns"), dict)
    ]

    if not rows or image_width <= 0:
        return {}

    header_1 = rows[0]
    header_2 = (
        rows[1]
        if len(rows) > 1
        else rows[0]
    )

    original_fitted = _estimate_scoreboard_x_bounds_from_headers(
        header_1,
        header_2,
        image_width
    )

    spacing_frame = _validated_header_spacing_frame(
        image_width,
        rows
    )

    fitted = original_fitted
    fit_mode = "original_required_headers"

    if (
        not isinstance(fitted, dict)
        and isinstance(spacing_frame, dict)
        and isinstance(spacing_frame.get("fit"), dict)
    ):
        fitted = spacing_frame["fit"]
        fit_mode = "validated_header_spacing_fallback"

    if not isinstance(
        fitted,
        dict
    ):
        return {}

    scoreboard_left = float(
        fitted.get(
            "scoreboardLeft",
            fitted.get(
                "left",
                0
            )
        )
    )

    scoreboard_width = float(
        fitted.get(
            "scoreboardWidth",
            max(
                1,
                fitted.get(
                    "right",
                    image_width
                )
                - fitted.get(
                    "left",
                    0
                )
            )
        )
    )

    if scoreboard_width <= 0:
        return {}

    def observed_center(
        header_key
    ):
        values = []

        for row in rows:
            column = (
                row.get(
                    "columns",
                    {}
                )
                .get(
                    header_key
                )
            )

            if not isinstance(
                column,
                dict
            ):
                continue

            center_x = column.get(
                "center_x"
            )

            if center_x is None:
                continue

            values.append(
                float(
                    center_x
                )
            )

        if not values:
            return None

        return float(
            np.median(
                values
            )
        )

    score_anchor = observed_center(
        "SCORE"
    )

    middle_anchor = observed_center(
        "MIDDLE_STAT"
    )

    ping_anchor = observed_center(
        "PING"
    )

    use_required_anchor_frame = (
        score_anchor is not None
        and middle_anchor is not None
        and ping_anchor is not None
        and 0.0
        <= score_anchor
        < middle_anchor
        < ping_anchor
        < float(
            image_width
        )
    )

    alignment_centers = {}
    use_spacing_frame = (
        fit_mode
        == "validated_header_spacing_fallback"
    )
    spacing_verified_original = False
    required_frame_adjusted = False
    required_step_disagreement = None

    if use_required_anchor_frame:
        left_step = (
            middle_anchor
            - score_anchor
        ) / 2.0

        right_step = (
            ping_anchor
            - middle_anchor
        ) / 3.0

        if (
            left_step > 0.0
            and right_step > 0.0
        ):
            typical_step = max(
                1.0,
                float(np.median((
                    left_step,
                    right_step
                )))
            )
            required_step_disagreement = (
                abs(left_step - right_step)
                / typical_step
            )

            spacing_verified_original = (
                isinstance(spacing_frame, dict)
                and required_step_disagreement
                <= PREP_REQUIRED_FRAME_MAX_STEP_DISAGREEMENT_RATIO
            )

            if (
                isinstance(spacing_frame, dict)
                and required_step_disagreement
                > PREP_REQUIRED_FRAME_MAX_STEP_DISAGREEMENT_RATIO
            ):
                fitted = spacing_frame["fit"]
                fit_mode = "validated_header_spacing_adjustment"
                use_required_anchor_frame = False
                use_spacing_frame = True
                required_frame_adjusted = True
                scoreboard_left = float(
                    fitted.get("scoreboardLeft", 0.0)
                )
                scoreboard_width = float(
                    fitted.get("scoreboardWidth", 0.0)
                )
            else:
                alignment_centers = {
                    "SCORE": float(
                        score_anchor
                    ),
                    "GOALS": float(
                        score_anchor
                        + left_step
                    ),
                    "MIDDLE_STAT": float(
                        middle_anchor
                    ),
                    "SAVES": float(
                        middle_anchor
                        + right_step
                    ),
                    "SHOTS": float(
                        middle_anchor
                        + right_step * 2.0
                    ),
                    "PING": float(
                        ping_anchor
                    ),
                }
        else:
            use_required_anchor_frame = False

    if (
        not use_required_anchor_frame
        and isinstance(spacing_frame, dict)
    ):
        use_spacing_frame = True
        alignment_centers = dict(
            spacing_frame.get("centers")
            or {}
        )

        if fit_mode == "original_required_headers":
            fitted = spacing_frame["fit"]
            fit_mode = "validated_header_spacing_fallback"
            scoreboard_left = float(
                fitted.get("scoreboardLeft", 0.0)
            )
            scoreboard_width = float(
                fitted.get("scoreboardWidth", 0.0)
            )

    def resolve(
        left_ratio,
        right_ratio,
        header_key=None
    ):
        left = int(
            round(
                scoreboard_left
                + scoreboard_width
                * float(
                    left_ratio
                )
            )
        )

        right = int(
            round(
                scoreboard_left
                + scoreboard_width
                * float(
                    right_ratio
                )
            )
        )

        left = max(
            0,
            min(
                image_width - 1,
                left
            )
        )

        right = max(
            left + 1,
            min(
                image_width,
                right
            )
        )

        affine_center_x = (
            left + right
        ) / 2.0

        observed_center_x = (
            observed_center(
                header_key
            )
            if header_key
            else None
        )

        if (
            use_required_anchor_frame
            and header_key
            in alignment_centers
        ):
            center_x = (
                alignment_centers[
                    header_key
                ]
            )

            center_source = (
                "required_header_anchor"
                if header_key
                in {
                    "SCORE",
                    "MIDDLE_STAT",
                    "PING"
                }
                else "score_middle_ping_interpolation"
            )

        elif (
            use_spacing_frame
            and header_key
            in alignment_centers
        ):
            center_x = (
                alignment_centers[
                    header_key
                ]
            )

            center_source = (
                "validated_header_spacing"
            )

        elif observed_center_x is not None:
            center_x = (
                observed_center_x
            )

            center_source = (
                "detected_header_sparse_fallback"
            )

        else:
            center_x = (
                affine_center_x
            )

            center_source = (
                "affine_sparse_fallback"
            )

        return {
            "left": int(
                left
            ),
            "right": int(
                right
            ),
            "width": int(
                right - left
            ),
            "centerX": round(
                float(
                    center_x
                ),
                3
            ),
            "observedCenterX": (
                None
                if observed_center_x is None
                else round(
                    float(
                        observed_center_x
                    ),
                    3
                )
            ),
            "affineCenterX": round(
                float(
                    affine_center_x
                ),
                3
            ),
            "centerDeltaPx": round(
                float(
                    center_x
                    - affine_center_x
                ),
                3
            ),
            "centerSource": (
                center_source
            )
        }

    name_left_ratio = max(
        0.0,
        COLUMN_NAME_LEFT
        - PREP_IDENTITY_LEFT_PAD_RATIO
    )

    name_right_ratio = min(
        COLUMN_NAME_RIGHT,
        COLUMN_SCORE_LEFT
        - PREP_IDENTITY_RIGHT_GAP_RATIO
    )

    geometry = {
        "source": (
            "required_score_middle_ping_header_frame"
            if use_required_anchor_frame
            else fit_mode
        ),
        "fitMode": fit_mode,
        "imageWidth": int(
            image_width
        ),
        "scoreboardLeft": round(
            scoreboard_left,
            3
        ),
        "scoreboardWidth": round(
            scoreboard_width,
            3
        ),
        "fitResidual": round(
            float(
                fitted.get(
                    "fitResidual",
                    0.0
                )
                or 0.0
            ),
            3
        ),
        "columnsUsed": list(
            fitted.get(
                "columnsUsed"
            )
            or []
        ),
        "requiredHeaderAnchorsPresent": {
            "SCORE": bool(
                score_anchor is not None
            ),
            "MIDDLE_STAT": bool(
                middle_anchor is not None
            ),
            "PING": bool(
                ping_anchor is not None
            ),
        },
        "requiredAnchorFrameUsed": bool(
            use_required_anchor_frame
        ),
        "spacingFrameAvailable": bool(
            isinstance(spacing_frame, dict)
        ),
        "spacingFrameUsed": bool(
            use_spacing_frame
        ),
        "spacingVerifiedOriginal": bool(
            spacing_verified_original
        ),
        "requiredFrameAdjusted": bool(
            required_frame_adjusted
        ),
        "requiredStepDisagreementRatio": (
            None
            if required_step_disagreement is None
            else round(
                float(required_step_disagreement),
                4
            )
        ),
        "spacingFrame": (
            None
            if not isinstance(spacing_frame, dict)
            else {
                "columnSpacing": spacing_frame.get(
                    "columnSpacing"
                ),
                "fitResidual": spacing_frame.get(
                    "fitResidual"
                ),
                "maximumResidual": spacing_frame.get(
                    "maximumResidual"
                ),
                "columnsUsed": list(
                    spacing_frame.get("columnsUsed")
                    or []
                ),
            }
        ),
        "name": resolve(
            name_left_ratio,
            name_right_ratio
        ),
        "title": resolve(
            name_left_ratio,
            COLUMN_TITLE_RIGHT
        ),
        "score": resolve(
            COLUMN_SCORE_LEFT,
            COLUMN_SCORE_RIGHT,
            "SCORE"
        ),
        "goals": resolve(
            COLUMN_GOALS_LEFT,
            COLUMN_GOALS_RIGHT,
            "GOALS"
        ),
        "middle": resolve(
            COLUMN_MIDDLE_LEFT,
            COLUMN_MIDDLE_RIGHT,
            "MIDDLE_STAT"
        ),
        "saves": resolve(
            COLUMN_SAVES_LEFT,
            COLUMN_SAVES_RIGHT,
            "SAVES"
        ),
        "shots": resolve(
            COLUMN_SHOTS_LEFT,
            COLUMN_SHOTS_RIGHT,
            "SHOTS"
        ),
        "ping": resolve(
            COLUMN_PING_LEFT,
            COLUMN_PING_RIGHT,
            "PING"
        ),
    }

    required = (
        "name",
        "title",
        "score",
        "goals",
        "middle",
        "saves",
        "shots",
        "ping"
    )

    if any(
        geometry[key]["right"]
        <= geometry[key]["left"]
        for key in required
    ):
        return {}

    return geometry

def _identity_x_bounds_from_header_rows(
    image_width,
    header_rows
):
    """Compatibility wrapper backed by shared column geometry."""
    if not PREP_IDENTITY_FROM_HEADER_ENABLED:
        return None

    geometry = _column_geometry_from_header_rows(
        image_width,
        header_rows
    )
    name_geometry = geometry.get("name")
    if not isinstance(name_geometry, dict):
        return None

    left = int(name_geometry.get("left", 0))
    right = int(name_geometry.get("right", 0))
    if right - left < max(20, int(image_width * 0.10)):
        return None
    return (left, right)

def _lightweight_glyph_presence(crop):
    """Cheap text/icon-presence check used only at an expected row slot."""
    if crop is None or crop.size == 0:
        return {
            "present": False,
            "score": 0.0,
            "contrast": 0.0,
            "componentCount": 0,
            "foregroundRatio": 0.0,
            "edgeRatio": 0.0,
        }

    intensity = (
        np.max(crop, axis=2).astype(np.uint8)
        if crop.ndim == 3
        else crop.astype(np.uint8)
    )
    crop_height, crop_width = intensity.shape[:2]
    if crop_height <= 0 or crop_width <= 0:
        return {
            "present": False,
            "score": 0.0,
            "contrast": 0.0,
            "componentCount": 0,
            "foregroundRatio": 0.0,
            "edgeRatio": 0.0,
        }

    background = cv2.GaussianBlur(
        intensity,
        (0, 0),
        2.2
    )
    residual = cv2.absdiff(
        intensity,
        background
    )
    residual_threshold = int(max(
        9.0,
        np.percentile(residual, 78.0)
    ))
    _, foreground = cv2.threshold(
        residual,
        residual_threshold,
        255,
        cv2.THRESH_BINARY
    )
    foreground = cv2.morphologyEx(
        foreground,
        cv2.MORPH_CLOSE,
        cv2.getStructuringElement(
            cv2.MORPH_RECT,
            (2, 1)
        ),
        iterations=1
    )

    contours, _ = cv2.findContours(
        foreground,
        cv2.RETR_EXTERNAL,
        cv2.CHAIN_APPROX_SIMPLE
    )
    min_component_height = max(
        3,
        int(round(crop_height * 0.14))
    )
    max_component_height = max(
        min_component_height,
        int(round(crop_height * 0.94))
    )
    component_count = 0
    for contour in contours:
        _, _, component_width, component_height = cv2.boundingRect(contour)
        if not (
            min_component_height
            <= component_height
            <= max_component_height
        ):
            continue
        if component_width < 1:
            continue
        if component_width > crop_width * 0.72:
            continue
        if component_width * component_height < 5:
            continue
        component_count += 1

    contrast = float(
        np.percentile(intensity, 90.0)
        - np.percentile(intensity, 20.0)
    )
    foreground_ratio = float(
        np.count_nonzero(foreground)
    ) / max(1.0, float(foreground.size))
    edges = cv2.Canny(
        intensity,
        45,
        130
    )
    edge_ratio = float(
        np.count_nonzero(edges)
    ) / max(1.0, float(edges.size))

    presence_score = min(
        1.0,
        min(1.0, contrast / 52.0) * 0.32
        + min(1.0, foreground_ratio / 0.11) * 0.26
        + min(1.0, edge_ratio / 0.13) * 0.20
        + min(1.0, component_count / 2.0) * 0.22
    )
    present = bool(
        component_count >= 1
        and presence_score >= 0.34
    )
    return {
        "present": present,
        "score": round(presence_score, 4),
        "contrast": round(contrast, 2),
        "componentCount": int(component_count),
        "foregroundRatio": round(foreground_ratio, 4),
        "edgeRatio": round(edge_ratio, 4),
    }


def _region_tuple(region):
    """Return a normalized x/y/w/h tuple for tuple- or dict-backed regions."""
    if isinstance(region, (list, tuple)) and len(region) >= 4:
        return tuple(int(round(float(value))) for value in region[:4])
    if not isinstance(region, dict):
        return None
    nested = region.get("region")
    if nested is not None and nested is not region:
        normalized = _region_tuple(nested)
        if normalized is not None:
            return normalized
    x = region.get("x", region.get("left"))
    y = region.get("y", region.get("top"))
    width = region.get("w", region.get("width"))
    height = region.get("h", region.get("height"))
    if None in (x, y, width, height):
        return None
    return (
        int(round(float(x))),
        int(round(float(y))),
        int(round(float(width))),
        int(round(float(height))),
    )


def _learn_row_color_template(image, rows, bounds, row_spacing):
    """Learn the dominant team hue from directly observed rows.

    Bright and faded rows share hue much more reliably than saturation/value.
    We therefore learn hue from the best chromatic pixels and retain the median
    saturation/value only to scale the later faded thresholds.
    """
    if image is None or image.size == 0 or not rows or not bounds:
        return None
    height, width = image.shape[:2]
    left = max(0, min(width - 1, int(bounds.get("left", 0))))
    right = max(left + 1, min(width, int(bounds.get("right", width))))
    half_height = max(
        5,
        int(round(max(float(row_spacing), 18.0) * 0.28))
    )
    hue_parts = []
    saturation_parts = []
    value_parts = []
    for row in rows:
        center_y = int(round(float(row.get("center_y", 0.0) or 0.0)))
        top = max(0, center_y - half_height)
        bottom = min(height, center_y + half_height + 1)
        crop = image[top:bottom, left:right]
        if crop is None or crop.size == 0:
            continue
        hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
        saturation = hsv[:, :, 1]
        value = hsv[:, :, 2]
        mask = (
            (saturation >= PREP_ROW_COLOR_LEARN_MIN_SATURATION)
            & (value >= PREP_ROW_COLOR_LEARN_MIN_VALUE)
        )
        if np.count_nonzero(mask) < PREP_ROW_COLOR_MIN_SAMPLES:
            continue
        hue_parts.append(hsv[:, :, 0][mask].astype(np.int32))
        saturation_parts.append(saturation[mask].astype(np.float32))
        value_parts.append(value[mask].astype(np.float32))
    if not hue_parts:
        return None
    hues = np.concatenate(hue_parts)
    saturations = np.concatenate(saturation_parts)
    values = np.concatenate(value_parts)
    weights = np.maximum(1.0, saturations) * np.maximum(1.0, values)
    histogram = np.bincount(
        hues,
        weights=weights,
        minlength=180
    )
    dominant_hue = int(np.argmax(histogram[:180]))
    return {
        "hue": dominant_hue,
        "medianSaturation": round(float(np.median(saturations)), 2),
        "medianValue": round(float(np.median(values)), 2),
        "samples": int(hues.size),
        "directRows": int(len(rows)),
    }


def _build_layout_row_templates(
    image,
    row_evidence,
    assigned_slots,
    players_per_team,
    row_spacing,
    identity_x_bounds=None,
    column_geometry=None
):
    """Build team templates from observed bounds; never synthesize evidence."""
    height, width = image.shape[:2]
    geometry_name = (
        column_geometry.get("name")
        if isinstance(column_geometry, dict)
        else None
    )
    if (
        isinstance(geometry_name, dict)
        and geometry_name.get("left") is not None
        and geometry_name.get("right") is not None
    ):
        name_left = int(geometry_name["left"])
        name_right = int(geometry_name["right"])
    elif (
        isinstance(identity_x_bounds, (list, tuple))
        and len(identity_x_bounds) >= 2
    ):
        name_left = int(identity_x_bounds[0])
        name_right = int(identity_x_bounds[1])
    else:
        name_left = int(round(width * COLUMN_NAME_LEFT))
        name_right = int(round(width * COLUMN_NAME_RIGHT))
    name_left = max(0, min(width - 1, name_left))
    name_right = max(name_left + 1, min(width, name_right))

    paired = [
        (row_evidence[index], int(slot))
        for index, slot in enumerate(assigned_slots)
        if index < len(row_evidence)
    ]
    all_ping_bounds = []
    for evidence, _ in paired:
        region = _region_tuple(evidence.get("ping_region"))
        if region is not None:
            all_ping_bounds.append(region)

    templates = {}
    for team_index in (1, 2):
        team_pairs = [
            (evidence, slot)
            for evidence, slot in paired
            if (
                1 if slot < int(players_per_team) else 2
            ) == team_index
        ]
        team_rows = [item[0] for item in team_pairs]
        team_ping_bounds = [
            region
            for region in (
                _region_tuple(item.get("ping_region"))
                for item in team_rows
            )
            if region is not None
        ]
        ping_bounds = team_ping_bounds or all_ping_bounds
        if ping_bounds:
            ping_left = int(round(float(np.median([
                item[0] for item in ping_bounds
            ]))))
            ping_right = int(round(float(np.median([
                item[0] + item[2] for item in ping_bounds
            ]))))
        else:
            geometry_ping = (
                column_geometry.get("ping")
                if isinstance(column_geometry, dict)
                else None
            )
            if (
                isinstance(geometry_ping, dict)
                and geometry_ping.get("left") is not None
                and geometry_ping.get("right") is not None
            ):
                ping_left = int(geometry_ping["left"])
                ping_right = int(geometry_ping["right"])
            else:
                ping_left = int(round(
                    width * max(0.0, COLUMN_PING_LEFT - 0.015)
                ))
                ping_right = int(round(width * COLUMN_PING_RIGHT))
        ping_pad = max(4, int(round(width * PREP_ROW_BOUND_PING_X_PAD_RATIO)))
        ping_left = max(0, ping_left - ping_pad)
        ping_right = min(width, ping_right + ping_pad)
        left = max(
            0,
            name_left - int(round(width * PREP_ROW_BOUND_LEFT_ICON_PAD_RATIO))
        )
        right = max(name_right, ping_right)
        bounds = {
            "left": int(left),
            "right": int(min(width, right)),
            "nameLeft": int(name_left),
            "nameRight": int(name_right),
            "pingLeft": int(ping_left),
            "pingRight": int(max(ping_left + 1, ping_right)),
            "source": (
                "team_ping_bounds"
                if team_ping_bounds
                else (
                    "shared_ping_bounds"
                    if all_ping_bounds
                    else "canonical_ping_fallback"
                )
            ),
            "observedPingRows": int(len(team_ping_bounds)),
        }
        templates[team_index] = {
            "bounds": bounds,
            "color": _learn_row_color_template(
                image,
                team_rows,
                bounds,
                row_spacing
            ),
            "directRows": int(len(team_rows)),
        }
    return templates


def _probe_team_color(image, center_y, row_spacing, bounds, color_template):
    if not isinstance(bounds, dict) or not isinstance(color_template, dict):
        return {
            "present": False,
            "score": 0.0,
            "normalCoverage": 0.0,
            "fadedCoverage": 0.0,
            "mode": "unavailable",
        }
    height, width = image.shape[:2]
    half_height = max(
        5,
        int(round(max(float(row_spacing), 18.0) * 0.28))
    )
    top = max(0, int(round(float(center_y))) - half_height)
    bottom = min(height, int(round(float(center_y))) + half_height + 1)
    left = max(0, min(width - 1, int(bounds.get("left", 0))))
    right = max(left + 1, min(width, int(bounds.get("right", width))))
    crop = image[top:bottom, left:right]
    if crop is None or crop.size == 0:
        return {
            "present": False,
            "score": 0.0,
            "normalCoverage": 0.0,
            "fadedCoverage": 0.0,
            "mode": "empty",
        }
    hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
    hue = hsv[:, :, 0].astype(np.int16)
    saturation = hsv[:, :, 1]
    value = hsv[:, :, 2]
    target_hue = int(color_template.get("hue", 0) or 0)
    hue_distance = np.minimum(
        np.mod(hue - target_hue, 180),
        np.mod(target_hue - hue, 180)
    )
    reference_saturation = float(
        color_template.get("medianSaturation", 0.0) or 0.0
    )
    reference_value = float(
        color_template.get("medianValue", 0.0) or 0.0
    )
    normal = (
        (hue_distance <= PREP_ROW_COLOR_HUE_TOLERANCE)
        & (saturation >= max(40.0, reference_saturation * 0.30))
        & (value >= max(28.0, reference_value * 0.26))
    )
    faded = (
        (hue_distance <= PREP_ROW_COLOR_FADED_HUE_TOLERANCE)
        & (saturation >= max(18.0, reference_saturation * 0.11))
        & (value >= max(16.0, reference_value * 0.15))
    )
    pixel_count = max(1.0, float(hue.size))
    normal_coverage = float(np.count_nonzero(normal)) / pixel_count
    faded_coverage = float(np.count_nonzero(faded)) / pixel_count
    normal_pass = normal_coverage >= PREP_ROW_COLOR_NORMAL_MIN_COVERAGE
    faded_pass = faded_coverage >= PREP_ROW_COLOR_FADED_MIN_COVERAGE
    matched_saturation = (
        float(np.median(saturation[faded]))
        if np.count_nonzero(faded)
        else 0.0
    )
    matched_value = (
        float(np.median(value[faded]))
        if np.count_nonzero(faded)
        else 0.0
    )
    faded_variant = bool(
        (normal_pass or faded_pass)
        and (
            matched_saturation < max(24.0, reference_saturation * 0.82)
            or matched_value < max(20.0, reference_value * 0.72)
        )
    )
    score = min(
        1.0,
        max(
            normal_coverage / max(PREP_ROW_COLOR_NORMAL_MIN_COVERAGE, 1e-6),
            faded_coverage / max(PREP_ROW_COLOR_FADED_MIN_COVERAGE, 1e-6)
        )
    )
    return {
        "present": bool(normal_pass or faded_pass),
        "score": round(score, 4),
        "normalCoverage": round(normal_coverage, 4),
        "fadedCoverage": round(faded_coverage, 4),
        "mode": (
            "faded"
            if faded_variant
            else ("normal" if normal_pass else ("faded" if faded_pass else "none"))
        ),
        "targetHue": int(target_hue),
        "matchedSaturation": round(matched_saturation, 2),
        "matchedValue": round(matched_value, 2),
    }


def quick_row_probe(
    image,
    center_y,
    row_spacing,
    expected_names=None,
    identity_x_bounds=None,
    use_text_ocr=True,
    row_template=None,
    column_geometry=None
):
    height, width = image.shape[:2]
    half_height = max(
        22,
        int(row_spacing * 0.40)
    )
    row_top = max(
        0,
        int(center_y - half_height)
    )
    row_bottom = min(
        height,
        int(center_y + half_height)
    )
    if (
        isinstance(
            identity_x_bounds,
            (list, tuple)
        )
        and len(
            identity_x_bounds
        ) >= 2
    ):
        name_left = int(
            identity_x_bounds[0]
        )
        name_right = int(
            identity_x_bounds[1]
        )
    else:
        name_left = int(
            width
            * COLUMN_NAME_LEFT
        )
        name_right = int(
            width
            * COLUMN_NAME_RIGHT
        )

    username_reads = []
    if use_text_ocr:
        username_crop = crop_safe(
            image,
            name_left,
            row_top,
            name_right,
            row_top + int(
                (row_bottom - row_top) * 0.66
            )
        )
        username_crop = sanitize_identity_crop(
            username_crop
        )
        for variation in (
            1,
            2
        ):
            processed = preprocess_variation(
                username_crop,
                variation,
                scale=get_tesseract_probe_scale(
                    username_crop
                )
            )
            username_reads.append(
                parse_identity_text(
                    tesseract_username(
                        processed
                    )
                )["username"]
            )
    username_reads = [
        uppercase_text(
            value
        )
        for value in username_reads
        if normalize_name_for_match(
            value
        )
    ]
    username_score = 0.0
    best_name_match = 0.0
    if username_reads:
        username_score = 1.0
        if expected_names:
            best_name_match = max(
                fuzzy_name_score(
                    username,
                    expected_name
                )
                for username in username_reads
                for expected_name in expected_names
            )
            username_score += (
                best_name_match / 100.0
            ) * 2.0
        elif max(
            len(
                normalize_name_for_match(
                    username
                )
            )
            for username in username_reads
        ) >= 4:
            username_score += 0.75
    numeric_score = 0.0
    numeric_hit_count = 0
    numeric_presence_count = 0
    score_value = None
    score_confidence = 0.0
    score_presence = {
        "present": False,
        "score": 0.0,
    }
    numeric_reads = {}
    numeric_presence = {}
    numeric_probe_skipped = (
        not use_text_ocr
        or (
            bool(expected_names)
            and best_name_match
            >= PREFLIGHT_STRONG_NAME_SCORE
        )
    )
    probe_columns = [
        (
            COLUMN_SCORE_LEFT,
            COLUMN_SCORE_RIGHT,
            "score",
            "score"
        ),
        (
            COLUMN_GOALS_LEFT,
            COLUMN_GOALS_RIGHT,
            "goals",
            "goals"
        ),
        (
            COLUMN_SAVES_LEFT,
            COLUMN_SAVES_RIGHT,
            "saves",
            "saves"
        )
    ]
    for left, right, field_name, geometry_key in probe_columns:
        field_geometry = (
            column_geometry.get(geometry_key)
            if isinstance(column_geometry, dict)
            else None
        )
        if (
            isinstance(field_geometry, dict)
            and field_geometry.get("left") is not None
            and field_geometry.get("right") is not None
        ):
            field_left = int(field_geometry["left"])
            field_right = int(field_geometry["right"])
        else:
            field_left = width * left
            field_right = width * right
        field_crop = crop_safe(
            image,
            field_left,
            row_top,
            field_right,
            row_bottom
        )
        presence = _lightweight_glyph_presence(
            field_crop
        )
        numeric_presence[field_name] = presence
        if presence.get("present"):
            numeric_presence_count += 1
        if field_name == "score":
            score_presence = presence

        if use_text_ocr and not numeric_probe_skipped:
            value, confidence, raw = tesseract_number(
                preprocess_variation(
                    field_crop,
                    1,
                    scale=get_tesseract_probe_scale(
                        field_crop
                    )
                )
            )
            minimum, maximum = NUMBER_LIMITS[field_name]
            numeric_reads[field_name] = {
                "value": value,
                "confidence": round(float(confidence or 0.0), 2),
                "raw": str(raw or ""),
            }
            if (
                value is not None
                and minimum <= value <= maximum
            ):
                numeric_hit_count += 1
                numeric_score += 0.7
                if confidence >= 70:
                    numeric_score += 0.3
                if field_name == "score":
                    score_value = int(value)
                    score_confidence = float(confidence or 0.0)

    if numeric_probe_skipped and use_text_ocr:
        numeric_score = 2.4

    template_bounds = (
        row_template.get("bounds")
        if isinstance(row_template, dict)
        and isinstance(row_template.get("bounds"), dict)
        else None
    )
    if template_bounds is not None:
        ping_left = int(template_bounds.get("pingLeft", 0))
        ping_right = int(template_bounds.get("pingRight", width))
    else:
        ping_geometry = (
            column_geometry.get("ping")
            if isinstance(column_geometry, dict)
            else None
        )
        if (
            isinstance(ping_geometry, dict)
            and ping_geometry.get("left") is not None
            and ping_geometry.get("right") is not None
        ):
            ping_left = int(ping_geometry["left"])
            ping_right = int(ping_geometry["right"])
        else:
            ping_left = int(width * max(
                0.0,
                COLUMN_PING_LEFT - PREP_PING_PROBE_LEFT_EXPAND_RATIO
            ))
            ping_right = int(width * COLUMN_PING_RIGHT)
    ping_crop = crop_safe(
        image,
        ping_left,
        row_top,
        ping_right,
        row_bottom
    )
    ping_presence = _lightweight_glyph_presence(
        ping_crop
    )

    left_icon_presence = {
        "present": False,
        "score": 0.0,
    }
    left_name_presence = {
        "present": False,
        "score": 0.0,
    }
    team_color_match = {
        "present": False,
        "score": 0.0,
        "mode": "unavailable",
    }
    bounds_confirmation = False
    if template_bounds is not None:
        template_left = int(template_bounds.get("left", 0))
        template_name_left = int(
            template_bounds.get("nameLeft", name_left)
        )
        template_name_right = int(
            template_bounds.get("nameRight", name_right)
        )
        content_bottom = row_top + int(
            max(1, row_bottom - row_top) * 0.72
        )
        left_icon_presence = _lightweight_glyph_presence(
            crop_safe(
                image,
                template_left,
                row_top,
                max(template_left + 1, template_name_left),
                content_bottom
            )
        )
        left_name_presence = _lightweight_glyph_presence(
            crop_safe(
                image,
                template_name_left,
                row_top,
                max(template_name_left + 1, template_name_right),
                content_bottom
            )
        )
        team_color_match = _probe_team_color(
            image,
            center_y,
            row_spacing,
            template_bounds,
            row_template.get("color")
        )
        left_alignment_present = bool(
            float(left_icon_presence.get("score", 0.0) or 0.0)
            >= PREP_ROW_BOUND_LEFT_MIN_SCORE
            or float(left_name_presence.get("score", 0.0) or 0.0)
            >= PREP_ROW_BOUND_LEFT_MIN_SCORE
        )
        right_alignment_present = bool(
            ping_presence.get("present")
            and float(ping_presence.get("score", 0.0) or 0.0)
            >= PREP_ROW_BOUND_RIGHT_MIN_SCORE
        )
        score_alignment_present = bool(score_presence.get("present"))
        bounds_confirmation = bool(
            team_color_match.get("present")
            and (
                (left_alignment_present and right_alignment_present)
                or (left_alignment_present and score_alignment_present)
                or (right_alignment_present and score_alignment_present)
            )
        )
    else:
        left_alignment_present = False
        right_alignment_present = bool(ping_presence.get("present"))
    gray = cv2.cvtColor(
        image[
            row_top:row_bottom,
            int(width * 0.07):int(width * 0.90)
        ],
        cv2.COLOR_BGR2GRAY
    )
    visual_score = 0.0
    if gray.size:
        visual_score = min(
            1.0,
            float(
                np.std(
                    gray
                )
            ) / 55.0
        )
    structural_score = (
        float((ping_presence or {}).get("score", 0.0) or 0.0)
        * 1.45
        + float((score_presence or {}).get("score", 0.0) or 0.0)
        * 1.35
        + min(1.0, numeric_presence_count / 3.0)
        * 0.55
        + max(
            float(left_icon_presence.get("score", 0.0) or 0.0),
            float(left_name_presence.get("score", 0.0) or 0.0)
        ) * 0.55
        + float(team_color_match.get("score", 0.0) or 0.0) * 0.70
        + (0.55 if bounds_confirmation else 0.0)
    )
    return {
        "score": round(
            username_score
            + numeric_score
            + structural_score
            + visual_score * 0.10,
            4
        ),
        "usernames": username_reads,
        "numeric_score": round(
            numeric_score,
            4
        ),
        "numeric_hit_count": int(numeric_hit_count),
        "numeric_presence_count": int(numeric_presence_count),
        "numeric_reads": numeric_reads,
        "numeric_presence": numeric_presence,
        "score_value": score_value,
        "score_confidence": round(score_confidence, 2),
        "score_presence": score_presence,
        "ping_presence": ping_presence,
        "left_alignment": {
            "present": bool(left_alignment_present),
            "icon": left_icon_presence,
            "name": left_name_presence,
        },
        "right_alignment": {
            "present": bool(right_alignment_present),
            "ping": ping_presence,
        },
        "team_color_match": team_color_match,
        "row_bounds": dict(template_bounds or {}),
        "bounds_confirmation": bool(bounds_confirmation),
        "structural_score": round(
            structural_score,
            4
        ),
        "numeric_probe_skipped": numeric_probe_skipped,
        "text_ocr_used": bool(use_text_ocr),
        "best_name_match": round(
            best_name_match,
            2
        ),
        "visual_score": round(
            visual_score,
            4
        )
    }

def build_slot_coefficients(
    slot_index,
    players_per_team
):
    if slot_index < players_per_team:
        return (
            1.0,
            float(slot_index),
            0.0
        )
    return (
        1.0,
        float(
            players_per_team - 1
            + slot_index
            - players_per_team
        ),
        1.0
    )


def _probe_confirms_row(probe):
    """Return True only when a projected slot contains real row evidence."""
    if not isinstance(probe, dict):
        return False
    if float(probe.get("best_name_match", 0.0) or 0.0) >= (
        PREP_INFERRED_ROW_NAME_CONFIRM_SCORE
    ):
        return True
    if probe.get("bounds_confirmation") is True:
        return True
    color_present = bool(
        (probe.get("team_color_match") or {}).get("present")
    )
    if not color_present:
        return False
    ping = probe.get("ping_presence") or {}
    score = probe.get("score_presence") or {}
    ping_present = bool(
        ping.get("present")
        and float(ping.get("score", 0.0) or 0.0)
        >= PREP_INFERRED_ROW_PING_PRESENCE_SCORE
    )
    score_present = bool(
        (
            score.get("present")
            and float(score.get("score", 0.0) or 0.0)
            >= PREP_INFERRED_ROW_SCORE_PRESENCE_SCORE
        )
        or probe.get("score_value") is not None
    )
    stat_present = bool(
        int(probe.get("numeric_hit_count", 0) or 0) >= 2
        or int(probe.get("numeric_presence_count", 0) or 0) >= 2
    )
    return bool(
        ping_present
        and (
            score_present
            or stat_present
        )
    )

def solve_layout_from_assignment(
    detected_centers,
    assigned_slots,
    players_per_team,
    image_height
):
    if not detected_centers:
        return None
    rows = [
        build_slot_coefficients(
            slot,
            players_per_team
        )
        for slot in assigned_slots
    ]
    matrix = np.array(
        rows,
        dtype=float
    )
    targets = np.array(
        detected_centers,
        dtype=float
    )
    if len(detected_centers) >= 3:
        params, _, _, _ = np.linalg.lstsq(
            matrix,
            targets,
            rcond=None
        )
        start_y, spacing, team_gap = [
            float(value)
            for value in params
        ]
    elif len(detected_centers) == 2:
        first_slot, second_slot = assigned_slots
        first_y, second_y = detected_centers
        if (
            first_slot < players_per_team
            and second_slot < players_per_team
        ) or (
            first_slot >= players_per_team
            and second_slot >= players_per_team
        ):
            slot_distance = max(
                1,
                second_slot - first_slot
            )
            spacing = (
                second_y - first_y
            ) / slot_distance
            team_gap = max(
                spacing * 1.55,
                40.0
            )
        else:
            spacing = max(
                28.0,
                min(
                    180.0,
                    (second_y - first_y) / max(
                        players_per_team + 0.6,
                        1.6
                    )
                )
            )
            first_coeff = build_slot_coefficients(
                first_slot,
                players_per_team
            )
            second_coeff = build_slot_coefficients(
                second_slot,
                players_per_team
            )
            team_gap = (
                second_y
                - first_y
                - (
                    second_coeff[1]
                    - first_coeff[1]
                ) * spacing
            )
        first_coeff = build_slot_coefficients(
            first_slot,
            players_per_team
        )
        start_y = (
            first_y
            - first_coeff[1] * spacing
            - first_coeff[2] * team_gap
        )
    else:
        spacing = max(
            36.0,
            min(
                120.0,
                image_height * 0.08
            )
        )
        team_gap = max(
            spacing * 1.65,
            48.0
        )
        coeff = build_slot_coefficients(
            assigned_slots[0],
            players_per_team
        )
        start_y = (
            detected_centers[0]
            - coeff[1] * spacing
            - coeff[2] * team_gap
        )
    minimum_spacing = 26.0
    maximum_spacing = max(
        minimum_spacing,
        min(
            190.0,
            image_height * 0.28
        )
    )
    if not (
        minimum_spacing
        <= spacing
        <= maximum_spacing
    ):
        return None
    minimum_team_gap = max(
        spacing * 1.05,
        36.0
    )
    maximum_team_gap = max(
        minimum_team_gap,
        spacing * 4.2
    )
    if not (
        minimum_team_gap
        <= team_gap
        <= maximum_team_gap
    ):
        return None
    expected_players = (
        players_per_team * 2
    )
    centers = []
    for slot in range(
        expected_players
    ):
        base, spacing_coeff, gap_coeff = build_slot_coefficients(
            slot,
            players_per_team
        )
        center = (
            start_y
            + spacing_coeff * spacing
            + gap_coeff * team_gap
        )
        centers.append(
            int(
                round(
                    center
                )
            )
        )
    if (
        min(centers) < 0
        or max(centers) >= image_height
    ):
        return None
    predicted_detected = [
        centers[slot]
        for slot in assigned_slots
    ]
    alignment_error = float(
        np.mean([
            abs(
                predicted - actual
            )
            for predicted, actual
            in zip(
                predicted_detected,
                detected_centers
            )
        ])
    )
    return {
        "centers": centers,
        "spacing": float(spacing),
        "team_gap": float(team_gap),
        "alignment_error": alignment_error,
        "assigned_slots": list(
            assigned_slots
        )
    }

def _empty_row_probe():
    return {
        "score": 0.0,
        "usernames": [],
        "numeric_score": 0.0,
        "numeric_hit_count": 0,
        "numeric_presence_count": 0,
        "numeric_reads": {},
        "numeric_presence": {},
        "score_value": None,
        "score_confidence": 0.0,
        "score_presence": {
            "present": False,
            "score": 0.0,
        },
        "ping_presence": {
            "present": False,
            "score": 0.0,
        },
        "left_alignment": {
            "present": False,
        },
        "right_alignment": {
            "present": False,
        },
        "team_color_match": {
            "present": False,
            "score": 0.0,
            "mode": "unavailable",
        },
        "row_bounds": {},
        "bounds_confirmation": False,
        "numeric_probe_skipped": True,
        "best_name_match": 0.0,
        "visual_score": 0.0
    }

def reconstruct_player_anchors(
    image,
    ping_regions,
    players_per_team,
    expected_names=None,
    stat_regions=None,
    use_ocr_probes=True,
    identity_x_bounds=None,
    header_rows=None,
    column_geometry=None
):
    height, width = image.shape[:2]
    expected_players = (
        players_per_team * 2
    )
    row_evidence = merge_row_anchor_evidence(
        ping_regions,
        stat_regions,
        height
    )

    # ============================================================
    # HEADER ROWS ARE NOT PLAYER ROWS
    # ============================================================
    # The PING/stat detectors can occasionally see the header labels themselves
    # as a complete row (for example the false Y≈81 row in the 3v3 sample).
    # Remove any merged candidate whose center falls inside/just below a detected
    # scoreboard-header band. This is geometric and does not depend on PING color.
    header_exclusion_pad = max(
        PREP_PLAYER_ROW_HEADER_EXCLUSION_MIN_PX,
        int(
            round(
                height
                * PREP_PLAYER_ROW_HEADER_EXCLUSION_PAD_RATIO
            )
        )
    )

    header_bands = []

    for header in header_rows or []:
        if not isinstance(header, dict):
            continue

        top = header.get(
            "top"
        )

        bottom = header.get(
            "bottom"
        )

        if (
            top is None
            or bottom is None
        ):
            continue

        header_bands.append((
            float(top)
            - header_exclusion_pad,
            float(bottom)
            + header_exclusion_pad
        ))

    if header_bands:
        row_evidence = [
            item
            for item in row_evidence
            if not any(
                band_top
                <= float(
                    item.get(
                        "center_y",
                        -1
                    )
                )
                <= band_bottom
                for band_top, band_bottom
                in header_bands
            )
        ]

    if len(row_evidence) > expected_players:
        # Select the complete physical sequence, not merely the strongest six
        # blobs.  This prevents unrelated bright UI from displacing a faded row.
        ordered_headers = sorted(
            [
                item
                for item in (header_rows or [])
                if isinstance(item, dict)
                and item.get("top") is not None
                and item.get("bottom") is not None
            ],
            key=lambda item: float(item.get("center_y", 0.0) or 0.0)
        )
        best_subset = None
        for chosen in combinations(
            row_evidence,
            expected_players
        ):
            chosen = sorted(
                chosen,
                key=lambda item: float(item.get("center_y", 0.0) or 0.0)
            )
            centers = [
                float(item.get("center_y", 0.0) or 0.0)
                for item in chosen
            ]
            if len(ordered_headers) >= 2:
                first_header = ordered_headers[0]
                second_header = ordered_headers[1]
                team_1 = centers[:players_per_team]
                team_2 = centers[players_per_team:]
                if not (
                    team_1
                    and team_2
                    and min(team_1) > float(first_header["bottom"])
                    and max(team_1) < float(second_header["top"])
                    and min(team_2) > float(second_header["bottom"])
                ):
                    continue
            layout = solve_layout_from_assignment(
                centers,
                list(range(expected_players)),
                players_per_team,
                height
            )
            if layout is None:
                continue
            direct_quality = sum(
                (
                    1.25
                    if item.get("type") == "ping_stat"
                    else 0.82
                )
                * float(item.get("confidence", 0.0) or 0.0)
                for item in chosen
            )
            key = (
                -float(layout.get("alignment_error", 9999.0) or 9999.0),
                direct_quality
            )
            if best_subset is None or key > best_subset[0]:
                best_subset = (key, chosen)
        if best_subset is not None:
            row_evidence = list(best_subset[1])
        else:
            row_evidence = sorted(
                row_evidence,
                key=lambda item: (
                    1 if item.get("type") == "ping_stat" else 0,
                    float(item.get("confidence", 0.0))
                ),
                reverse=True
            )[:expected_players]
            row_evidence.sort(
                key=lambda item: item["center_y"]
            )
    detected_centers = [
        int(round(item["center_y"]))
        for item in row_evidence
    ]
    if not detected_centers:
        # No real PING/stat evidence means there is no safe frame to extend.
        # Returning no anchors deliberately fails foundation rather than
        # manufacturing rows in blank space.
        return []
    candidate_layouts = []
    all_evidence_indices = tuple(range(len(row_evidence)))
    evidence_index_sets = [all_evidence_indices]
    # When the nominally complete sequence is geometrically inconsistent, test
    # one-row demotions.  A demoted detection is accepted only if the projected
    # slot is independently confirmed by learned bounds/color/content evidence.
    if len(row_evidence) >= max(3, expected_players - 1):
        evidence_index_sets.extend(
            combinations(
                range(len(row_evidence)),
                len(row_evidence) - 1
            )
        )

    for evidence_indices in evidence_index_sets:
        selected_evidence = [
            row_evidence[index]
            for index in evidence_indices
        ]
        selected_centers = [
            int(round(item["center_y"]))
            for item in selected_evidence
        ]
        if not selected_centers or len(selected_centers) > expected_players:
            continue
        for assigned_slots in combinations(
            range(expected_players),
            len(selected_centers)
        ):
            layout = solve_layout_from_assignment(
                selected_centers,
                assigned_slots,
                players_per_team,
                height
            )
            if layout is None:
                continue
            inferred_slots = [
                slot
                for slot in range(expected_players)
                if slot not in assigned_slots
            ]
            row_templates = _build_layout_row_templates(
                image,
                selected_evidence,
                assigned_slots,
                players_per_team,
                layout["spacing"],
                identity_x_bounds=identity_x_bounds,
                column_geometry=column_geometry
            )
            probes = {}
            probe_score = 0.0
            confirmed_probe_count = 0
            for slot in inferred_slots:
                team_index = (
                    1
                    if slot < int(players_per_team)
                    else 2
                )
                probe = quick_row_probe(
                    image,
                    layout["centers"][slot],
                    layout["spacing"],
                    expected_names,
                    identity_x_bounds=identity_x_bounds,
                    # Layout search may test several one-row demotions.  Keep
                    # this structural; full OCR runs once after the frame wins.
                    use_text_ocr=False,
                    row_template=row_templates.get(team_index),
                    column_geometry=column_geometry
                )
                probes[slot] = probe
                confirmed = _probe_confirms_row(probe)
                if confirmed:
                    confirmed_probe_count += 1
                probe_score += (
                    float(probe.get("structural_score", 0.0) or 0.0)
                    + min(
                        1.0,
                        float(probe.get("best_name_match", 0.0) or 0.0)
                        / 100.0
                    )
                    + (1.15 if probe.get("bounds_confirmation") else 0.0)
                    - (0.85 if not confirmed else 0.0)
                )
            gap_ratio = (
                layout["team_gap"]
                / max(layout["spacing"], 1.0)
            )
            gap_score = max(
                0.0,
                1.0 - abs(gap_ratio - 1.7) / 1.7
            )
            alignment_score = max(
                0.0,
                1.0
                - layout["alignment_error"]
                / max(layout["spacing"] * 0.28, 1.0)
            )
            evidence_score = sum(
                float(item.get("confidence", 0.0) or 0.0)
                for item in selected_evidence
            )
            dropped_indices = [
                index
                for index in all_evidence_indices
                if index not in evidence_indices
            ]
            if (
                dropped_indices
                and confirmed_probe_count < len(inferred_slots)
            ):
                # Never discard a measured row merely to improve spacing.  The
                # replacement slot must first be confirmed in the image.
                continue
            dropped_penalty = sum(
                1.45
                if row_evidence[index].get("type") == "ping_stat"
                else 0.55
                for index in dropped_indices
            )
            unconfirmed_probe_count = max(
                0,
                len(inferred_slots) - confirmed_probe_count
            )
            layout_score = (
                probe_score * 2.4
                + alignment_score * 3.0
                + gap_score * 0.75
                + evidence_score * 1.25
                - dropped_penalty
                - unconfirmed_probe_count * 4.0
            )
            layout["probes"] = probes
            layout["row_templates"] = row_templates
            layout["layout_score"] = layout_score
            layout["evidence_indices"] = list(evidence_indices)
            layout["dropped_evidence_indices"] = dropped_indices
            layout["confirmed_probe_count"] = confirmed_probe_count
            candidate_layouts.append(layout)
    if not candidate_layouts:
        spacing = max(48, int(height * 0.11))
        first = detected_centers[0]
        centers = [
            first + slot * spacing
            for slot in range(expected_players)
        ]
        best_layout = {
            "centers": centers,
            "spacing": spacing,
            "assigned_slots": list(
                range(min(len(detected_centers), expected_players))
            ),
            "probes": {},
            "row_templates": {},
            "evidence_indices": list(
                range(min(len(detected_centers), expected_players))
            ),
            "dropped_evidence_indices": [],
            "confirmed_probe_count": 0,
            "layout_score": 0.0
        }
    else:
        best_layout = max(
            candidate_layouts,
            key=lambda item: item["layout_score"]
        )
    assigned_slots = best_layout["assigned_slots"]
    selected_evidence_indices = best_layout.get(
        "evidence_indices",
        list(range(len(assigned_slots)))
    )
    slot_to_evidence = {
        slot: row_evidence[selected_evidence_indices[index]]
        for index, slot in enumerate(assigned_slots)
        if (
            index < len(selected_evidence_indices)
            and selected_evidence_indices[index] < len(row_evidence)
        )
    }
    anchors = []
    for slot, predicted_center_y in enumerate(best_layout["centers"]):
        team_index = 1 if slot < int(players_per_team) else 2
        row_template = (
            best_layout.get("row_templates", {}).get(team_index)
            or {}
        )
        evidence = slot_to_evidence.get(slot)
        detected = evidence is not None
        # For a directly detected row, the detector's measured Y coordinate is
        # authoritative. The solved layout predicts missing slots and supplies
        # spacing, but it must never move a real ping/stat anchor away from its
        # actual glyph row.
        center_y = (
            float(evidence.get("center_y"))
            if evidence is not None
            else float(predicted_center_y)
        )
        probe = best_layout.get("probes", {}).get(slot)
        if detected:
            evidence_type = evidence.get("type", "inferred")
            if evidence_type == "ping_stat":
                orientation = "direct_ping_stat"
            elif evidence_type == "ping":
                orientation = "direct_ping"
            else:
                orientation = "direct_stat"
            confidence = float(
                evidence.get("confidence", 0.80)
            )
        else:
            previous_detected = any(
                assigned < slot
                for assigned in assigned_slots
            )
            next_detected = any(
                assigned > slot
                for assigned in assigned_slots
            )
            if previous_detected and next_detected:
                orientation = "between_anchors"
                confidence = 0.90
            elif next_detected:
                orientation = "before_first_anchor"
                confidence = 0.82
            elif previous_detected:
                orientation = "after_last_anchor"
                confidence = 0.82
            else:
                orientation = "inferred"
                confidence = 0.70
            if probe is not None:
                confidence = min(
                    0.96,
                    confidence + min(
                        0.12,
                        probe["score"] * 0.025
                    )
                )
        probe = (
            probe
            if isinstance(
                probe,
                dict
            )
            else _empty_row_probe()
        )

        center_refinement = {
            "applied": False,
            "source": "layout_prediction",
            "originalCenterY": round(float(center_y), 2),
            "refinedCenterY": round(float(center_y), 2),
            "shiftPx": 0,
        }
        if (
            not detected
            and orientation == "between_anchors"
            and slot - 1 in slot_to_evidence
            and slot + 1 in slot_to_evidence
            and (slot - 1) // players_per_team
            == slot // players_per_team
            == (slot + 1) // players_per_team
        ):
            previous_center = float(
                slot_to_evidence[slot - 1].get("center_y", center_y)
            )
            next_center = float(
                slot_to_evidence[slot + 1].get("center_y", center_y)
            )
            midpoint = (previous_center + next_center) / 2.0
            faded_variant = (
                (probe.get("team_color_match") or {}).get("mode")
                == "faded"
            )
            upward_shift = (
                min(
                    PREP_FADED_INFERRED_CENTER_UP_MAX_PX,
                    max(
                        1,
                        int(round(
                            float(best_layout["spacing"])
                            * PREP_FADED_INFERRED_CENTER_UP_RATIO
                        ))
                    )
                )
                if faded_variant
                else 0
            )
            refined_center = midpoint - upward_shift
            center_refinement = {
                "applied": True,
                "source": (
                    "same_team_midpoint_faded_up"
                    if faded_variant
                    else "same_team_midpoint"
                ),
                "originalCenterY": round(float(center_y), 2),
                "midpointCenterY": round(float(midpoint), 2),
                "refinedCenterY": round(float(refined_center), 2),
                "shiftPx": round(float(refined_center - center_y), 2),
            }
            center_y = refined_center

        # ------------------------------------------------------------
        # SINGLE MISSING ROW: GEOMETRIC CONFIRMATION
        # ------------------------------------------------------------
        geometric_gap_confirmed = False

        if (
            PREP_SINGLE_GAP_GEOMETRY_ENABLED
            and not detected
            and len(row_evidence)
            == expected_players - 1
            and slot - 1 in slot_to_evidence
            and slot + 1 in slot_to_evidence
        ):
            previous_evidence = slot_to_evidence[
                slot - 1
            ]

            next_evidence = slot_to_evidence[
                slot + 1
            ]

            previous_y = float(
                previous_evidence.get(
                    "center_y",
                    0.0
                )
                or 0.0
            )

            next_y = float(
                next_evidence.get(
                    "center_y",
                    0.0
                )
                or 0.0
            )

            expected_double_gap = (
                float(
                    best_layout["spacing"]
                )
                * 2.0
            )

            observed_double_gap = (
                next_y
                - previous_y
            )

            spacing_error = abs(
                observed_double_gap
                - expected_double_gap
            )

            spacing_tolerance = max(
                6.0,
                float(
                    best_layout["spacing"]
                )
                * PREP_SINGLE_GAP_MAX_SPACING_ERROR_RATIO
            )

            predicted_midpoint = (
                previous_y
                + next_y
            ) / 2.0

            midpoint_error = abs(
                float(
                    predicted_center_y
                )
                - predicted_midpoint
            )

            midpoint_tolerance = max(
                5.0,
                float(
                    best_layout["spacing"]
                )
                * 0.20
            )

            same_team_gap = (
                (slot - 1) // players_per_team
                == slot // players_per_team
                == (slot + 1) // players_per_team
            )

            geometric_gap_confirmed = bool(
                same_team_gap
                and observed_double_gap > 0
                and spacing_error
                <= spacing_tolerance
                and midpoint_error
                <= midpoint_tolerance
            )

        ping_probe_score = float(
            (probe.get("ping_presence") or {}).get(
                "score",
                0.0
            )
            or 0.0
        )
        score_probe_score = float(
            (probe.get("score_presence") or {}).get(
                "score",
                0.0
            )
            or 0.0
        )
        ping_probe_present = bool(
            (probe.get("ping_presence") or {}).get("present")
            and ping_probe_score
            >= PREP_INFERRED_ROW_PING_PRESENCE_SCORE
        )
        score_probe_present = bool(
            (
                (probe.get("score_presence") or {}).get("present")
                and score_probe_score
                >= PREP_INFERRED_ROW_SCORE_PRESENCE_SCORE
            )
            or probe.get("score_value") is not None
        )
        stat_probe_present = bool(
            int(probe.get("numeric_hit_count", 0) or 0) >= 2
            or int(probe.get("numeric_presence_count", 0) or 0) >= 2
        )
        ping_score_confirmed = bool(
            ping_probe_present
            and score_probe_present
        )
        ping_stat_confirmed = bool(
            ping_probe_present
            and stat_probe_present
        )
        ping_anchor_confirmed = bool(
            ping_probe_present
            and (
                ping_probe_score >= 0.42
                or int(
                    (probe.get("ping_presence") or {}).get(
                        "componentCount",
                        0
                    )
                    or 0
                ) >= 2
            )
        )
        score_anchor_confirmed = bool(
            score_probe_present
            and (
                probe.get("score_value") is not None
                or (
                    score_probe_score >= 0.46
                    and int(
                        (probe.get("score_presence") or {}).get(
                            "componentCount",
                            0
                        )
                        or 0
                    ) >= 2
                )
            )
        )

        probe_confirmed = _probe_confirms_row(probe)

        inferred_row_confirmed = bool(
            not detected
            and probe_confirmed
        )

        anchors.append({
            "player_index": slot + 1,
            "center_y": int(center_y),
            "type": (
                evidence.get("type")
                if evidence is not None
                else "inferred"
            ),
            "confidence": round(confidence, 3),
            "ping_region": (
                evidence.get("ping_region")
                if evidence is not None
                else None
            ),
            "stat_region": (
                evidence.get("stat_region")
                if evidence is not None
                else None
            ),
            "row_spacing": int(round(best_layout["spacing"])),
            "center_refinement": center_refinement,
            "orientation": orientation,
            "has_ping_anchor": bool(
                evidence is not None
                and evidence.get("ping_region") is not None
            ),
            "has_ping_probe": bool(
                ping_probe_present
            ),
            "has_stat_anchor": bool(
                evidence is not None
                and evidence.get("stat_region") is not None
            ),
            "ping_state": (
                "present"
                if (
                    evidence is not None
                    and evidence.get("ping_region") is not None
                )
                else (
                    "probe_present"
                    if ping_probe_present
                    else (
                        "missing_anchor"
                        if (
                            evidence is not None
                            and evidence.get("stat_region") is not None
                        )
                        else "unknown"
                    )
                )
            ),
            "probe": probe,
            "inferred_row_confirmed": bool(
                inferred_row_confirmed
            ),
            "geometric_gap_confirmed": bool(
                geometric_gap_confirmed
            ),
            "probe_confirmed": bool(
                probe_confirmed
            ),
            "ping_score_confirmed": bool(
                ping_score_confirmed
            ),
            "ping_stat_confirmed": bool(
                ping_stat_confirmed
            ),
            "ping_anchor_confirmed": bool(
                ping_anchor_confirmed
            ),
            "score_anchor_confirmed": bool(
                score_anchor_confirmed
            ),
            "bounds_confirmation": bool(
                probe.get("bounds_confirmation")
            ),
            "observed_row_template": row_template,
            "row_presence_source": (
                "direct_anchor"
                if detected
                else (
                    (
                        "spacing_plus_bounds_color"
                        if probe.get("bounds_confirmation")
                        else (
                            "spacing_plus_color_ping_score"
                            if (
                                ping_score_confirmed
                                and (probe.get("team_color_match") or {}).get("present")
                            )
                            else (
                                "spacing_plus_color_ping_stats"
                                if (
                                    ping_stat_confirmed
                                    and (probe.get("team_color_match") or {}).get("present")
                                )
                                else "spacing_plus_name_probe"
                            )
                        )
                    )
                    if inferred_row_confirmed
                    else "unconfirmed_spacing"
                )
            ),
            "layout_score": round(
                best_layout.get("layout_score", 0.0),
                4
            ),
            "discarded_direct_rows": [
                {
                    "centerY": round(
                        float(row_evidence[index].get("center_y", 0.0) or 0.0),
                        2
                    ),
                    "type": row_evidence[index].get("type")
                }
                for index in best_layout.get(
                    "dropped_evidence_indices",
                    []
                )
                if 0 <= index < len(row_evidence)
            ]
        })
    return anchors

def get_tesseract_probe_scale(
    crop
):
    if crop is None or crop.size == 0:
        return 2
    crop_height = crop.shape[0]
    if crop_height < 34:
        return 4
    if crop_height < 52:
        return 3
    if crop_height < 82:
        return 2
    return 1

def _row_color_signature(
    image,
    center_y,
    row_spacing
):
    height, width = image.shape[:2]
    half_height = max(
        4,
        int(
            max(row_spacing, 18)
            * PREP_ROW_COLOR_HALF_HEIGHT_RATIO
        )
    )
    top = max(
        0,
        int(center_y) - half_height
    )
    bottom = min(
        height,
        int(center_y) + half_height + 1
    )
    left = int(
        width * PREP_ROW_COLOR_LEFT_RATIO
    )
    right = int(
        width * PREP_ROW_COLOR_RIGHT_RATIO
    )
    crop = image[
        top:bottom,
        left:right
    ]
    if crop is None or crop.size == 0:
        return None

    hsv = cv2.cvtColor(
        crop,
        cv2.COLOR_BGR2HSV
    )
    lab = cv2.cvtColor(
        crop,
        cv2.COLOR_BGR2LAB
    )

    saturation = hsv[:, :, 1]
    value = hsv[:, :, 2]
    mask = (
        (saturation >= PREP_COLOR_MIN_SATURATION)
        & (value >= PREP_COLOR_MIN_VALUE)
    )

    if (
        np.count_nonzero(mask)
        < PREP_ROW_COLOR_MIN_SAMPLES
    ):
        return None

    a_values = lab[:, :, 1][mask].astype(
        np.float32
    )
    b_values = lab[:, :, 2][mask].astype(
        np.float32
    )

    return {
        "labA": float(
            np.median(a_values)
        ),
        "labB": float(
            np.median(b_values)
        ),
        "samples": int(
            len(a_values)
        )
    }

def assign_team_groups_from_color_or_spacing(
    image,
    row_anchors,
    players_per_team
):
    """Lock physical rows to teams.

    Primary: chromatic separation between the first and second physical row
    groups.  Fallback: the known players-per-team count plus the team-boundary
    vertical gap.  Names are never allowed to reorder these rows later.
    """
    expected_players = (
        players_per_team * 2
    )
    anchors = sorted(
        row_anchors,
        key=lambda anchor: int(
            anchor.get(
                "center_y",
                0
            )
        )
    )

    if len(anchors) != expected_players:
        return anchors, {
            "method": "unresolved",
            "colorSeparation": 0.0,
            "spacingRatio": 0.0
        }

    signatures = []
    for anchor in anchors:
        signature = _row_color_signature(
            image,
            anchor.get(
                "center_y",
                0
            ),
            anchor.get(
                "row_spacing",
                0
            )
        )
        signatures.append(
            signature
        )

    first_signatures = [
        item
        for item in signatures[
            :players_per_team
        ]
        if item is not None
    ]
    second_signatures = [
        item
        for item in signatures[
            players_per_team:
        ]
        if item is not None
    ]

    color_separation = 0.0
    within_team_dispersion = 0.0
    color_signal_ratio = 0.0
    color_pass = False
    if (
        len(first_signatures)
        == players_per_team
        and len(second_signatures)
        == players_per_team
    ):
        first_center = np.array([
            np.mean([
                item["labA"]
                for item in first_signatures
            ]),
            np.mean([
                item["labB"]
                for item in first_signatures
            ])
        ])
        second_center = np.array([
            np.mean([
                item["labA"]
                for item in second_signatures
            ]),
            np.mean([
                item["labB"]
                for item in second_signatures
            ])
        ])
        color_separation = float(
            np.linalg.norm(
                first_center
                - second_center
            )
        )
        first_dispersion = float(
            np.mean([
                np.linalg.norm(
                    np.array([item["labA"], item["labB"]])
                    - first_center
                )
                for item in first_signatures
            ])
        )
        second_dispersion = float(
            np.mean([
                np.linalg.norm(
                    np.array([item["labA"], item["labB"]])
                    - second_center
                )
                for item in second_signatures
            ])
        )
        within_team_dispersion = (
            first_dispersion + second_dispersion
        ) / 2.0
        color_signal_ratio = (
            color_separation
            / max(
                PREP_TEAM_COLOR_DISPERSION_FLOOR,
                within_team_dispersion
            )
        )
        color_pass = (
            color_separation >= PREP_COLOR_MIN_SEPARATION
            and color_signal_ratio
            >= PREP_TEAM_COLOR_SIGNAL_RATIO_MIN
        )

    centers = [
        int(anchor.get(
            "center_y",
            0
        ))
        for anchor in anchors
    ]
    gaps = [
        centers[index + 1]
        - centers[index]
        for index in range(
            len(centers) - 1
        )
    ]
    boundary_index = (
        players_per_team - 1
    )
    boundary_gap = (
        gaps[boundary_index]
        if (
            0 <= boundary_index
            < len(gaps)
        )
        else 0
    )
    within_gaps = [
        gap
        for index, gap in enumerate(
            gaps
        )
        if index != boundary_index
        and gap > 0
    ]
    typical_within_gap = (
        float(
            np.median(
                within_gaps
            )
        )
        if within_gaps
        else float(
            max(
                boundary_gap,
                1
            )
        )
    )
    spacing_ratio = (
        boundary_gap
        / max(
            typical_within_gap,
            1.0
        )
    )

    grouping_method = (
        "color"
        if color_pass
        else "vertical_spacing"
    )

    for index, anchor in enumerate(
        anchors
    ):
        anchor[
            "physical_row_index"
        ] = index + 1
        anchor[
            "team_index"
        ] = (
            1
            if index < players_per_team
            else 2
        )
        anchor[
            "team_grouping_method"
        ] = grouping_method
        anchor[
            "row_color_signature"
        ] = signatures[index]

    return anchors, {
        "method": grouping_method,
        "colorSeparation": round(
            color_separation,
            2
        ),
        "colorThreshold": PREP_COLOR_MIN_SEPARATION,
        "withinTeamColorDispersion": round(
            within_team_dispersion,
            2
        ),
        "colorSignalRatio": round(
            color_signal_ratio,
            3
        ),
        "spacingRatio": round(
            spacing_ratio,
            3
        ),
        "boundaryGap": int(
            boundary_gap
        ),
        "typicalWithinTeamGap": round(
            typical_within_gap,
            2
        )
    }

def _clean_header_token(value):
    return "".join(
        ch for ch in uppercase_text(str(value or ""))
        if ch.isalnum()
    )

def _header_similarity(observed, expected):
    """OCR-aware similarity for the small known header vocabulary."""
    observed = _clean_header_token(observed)
    expected = _clean_header_token(expected)
    if (
        len(observed) < 3
        or not expected
        or abs(len(observed) - len(expected)) > PREP_HEADER_TOKEN_MAX_LENGTH_DELTA
    ):
        return 0.0

    previous = [float(i) for i in range(len(expected) + 1)]
    for row, seen in enumerate(observed, 1):
        current = [float(row)]
        for col, wanted in enumerate(expected, 1):
            sub_cost = (
                0.0 if seen == wanted
                else PREP_HEADER_OCR_EQUIVALENT_COST
                if seen in PREP_HEADER_OCR_EQUIVALENTS.get(wanted, wanted)
                else 1.0
            )
            current.append(min(
                previous[col] + 1.0,
                current[col - 1] + 1.0,
                previous[col - 1] + sub_cost
            ))
        previous = current

    return max(
        0.0,
        1.0 - previous[-1] / max(len(observed), len(expected), 1)
    )

def _match_header_token(value):
    raw = _clean_header_token(value)
    best = None
    for canonical, variants in PREP_HEADER_VARIANTS.items():
        for variant in variants:
            score = _header_similarity(raw, variant)
            candidate = (score, -abs(len(raw) - len(variant)), canonical, variant)
            if best is None or candidate[:2] > best[:2]:
                best = candidate

    if best is None or best[0] < PREP_HEADER_TOKEN_MIN_SIMILARITY:
        return None

    score, _, canonical, variant = best
    middle_stat = None
    if canonical == "MIDDLE_STAT":
        middle_stat = "assists" if variant.startswith("ASSIST") else "demos"

    return {
        "token": canonical,
        "variant": variant,
        "raw": raw,
        "score": float(score),
        "middleStat": middle_stat
    }

def detect_scoreboard_header_rows(
    image
):
    """Detect repeated Rocket League stat-header rows.

    Canonical layout:

        SCORE | GOALS | MIDDLE_STAT | SAVES | SHOTS | PING

    MIDDLE_STAT may be ASSISTS or DEMOS.

    Detection remains tolerant of OCR substitutions handled by
    _match_header_token(), such as:

        SCORE  -> SC0RE / 5CORE
        GOALS  -> G0ALS
        ASSISTS -> A55ISTS
        DEMOS  -> DEM0S / D3MOS
        SAVES  -> SAV3S
        SHOTS  -> SH0TS
        PING   -> P1NG

    Only one Tesseract image_to_data() call is performed.
    """

    # ============================================================
    # INPUT GUARD
    # ============================================================

    if image is None or image.size == 0:
        return []

    height, width = image.shape[:2]

    if height <= 0 or width <= 0:
        return []

    # ============================================================
    # LIGHT OCR UPSCALE
    # ============================================================

    scale = 1.0

    if width < PREP_HEADER_OCR_TARGET_WIDTH:
        scale = min(
            PREP_HEADER_OCR_MAX_UPSCALE,
            PREP_HEADER_OCR_TARGET_WIDTH
            / max(
                width,
                1
            )
        )

    if scale > 1.05:

        working = cv2.resize(
            image,
            (
                int(
                    round(
                        width
                        * scale
                    )
                ),
                int(
                    round(
                        height
                        * scale
                    )
                )
            ),
            interpolation=cv2.INTER_LANCZOS4
        )

    else:
        working = image

    # ============================================================
    # OCR PREPROCESS
    # ============================================================

    gray = cv2.cvtColor(
        working,
        cv2.COLOR_BGR2GRAY
    )

    gray = cv2.GaussianBlur(
        gray,
        (3, 3),
        0
    )

    gray = cv2.convertScaleAbs(
        gray,
        alpha=1.25,
        beta=8
    )

    # ============================================================
    # SINGLE TESSERACT PASS
    # ============================================================

    data = pytesseract.image_to_data(
        gray,
        config=PREP_FOUNDATION_TESSERACT_CONFIG,
        output_type=pytesseract.Output.DICT
    )

    text_values = data.get(
        "text",
        []
    )

    count = len(
        text_values
    )

    if count <= 0:
        return []

    inverse_scale = (
        1.0
        / max(
            scale,
            1e-6
        )
    )

    # ============================================================
    # CANONICAL HEADER ORDER
    # ============================================================

    column_order = {
        "SCORE": 0,
        "GOALS": 1,
        "MIDDLE_STAT": 2,
        "SAVES": 3,
        "SHOTS": 4,
        "PING": 5
    }

    # ============================================================
    # COLLECT HEADER-LIKE TOKENS
    # ============================================================

    tokens = []

    confidences = data.get(
        "conf",
        []
    )

    left_values = data.get(
        "left",
        []
    )

    top_values = data.get(
        "top",
        []
    )

    width_values = data.get(
        "width",
        []
    )

    height_values = data.get(
        "height",
        []
    )

    for index in range(
        count
    ):

        raw_text = str(
            text_values[index]
            or ""
        ).strip()

        if not raw_text:
            continue

        match = _match_header_token(
            raw_text
        )

        if match is None:
            continue

        token_name = match.get(
            "token"
        )

        if token_name not in column_order:
            continue

        try:
            confidence = float(
                confidences[index]
            )

        except (
            TypeError,
            ValueError,
            IndexError
        ):
            confidence = 0.0

        try:
            x = int(
                round(
                    int(
                        left_values[index]
                    )
                    * inverse_scale
                )
            )

            y = int(
                round(
                    int(
                        top_values[index]
                    )
                    * inverse_scale
                )
            )

            token_width = max(
                1,
                int(
                    round(
                        int(
                            width_values[index]
                        )
                        * inverse_scale
                    )
                )
            )

            token_height = max(
                1,
                int(
                    round(
                        int(
                            height_values[index]
                        )
                        * inverse_scale
                    )
                )
            )

        except (
            TypeError,
            ValueError,
            IndexError
        ):
            continue

        center_y = (
            y
            + token_height
            / 2.0
        )

        tokens.append({
            "token": token_name,

            "variant": match.get(
                "variant"
            ),

            "raw": raw_text,

            "matchScore": round(
                float(
                    match.get(
                        "score",
                        0.0
                    )
                    or 0.0
                ),
                4
            ),

            "middleStat": match.get(
                "middleStat"
            ),

            "x": int(
                x
            ),

            "y": int(
                y
            ),

            "w": int(
                token_width
            ),

            "h": int(
                token_height
            ),

            "center_x": float(
                x
                + token_width
                / 2.0
            ),

            "center_y": float(
                center_y
            ),

            "confidence": float(
                confidence
            )
        })

    if not tokens:
        return []

    # ============================================================
    # CLUSTER TOKENS INTO PHYSICAL HEADER ROWS
    # ============================================================

    y_tolerance = max(
        6.0,
        height
        * PREP_FOUNDATION_HEADER_Y_TOLERANCE_RATIO
    )

    clusters = []

    for item in sorted(
        tokens,
        key=lambda value: (
            value["center_y"],
            value["x"]
        )
    ):

        best_cluster = None
        best_distance = None

        for cluster in clusters:

            distance = abs(
                item["center_y"]
                - cluster["center_y"]
            )

            if distance > y_tolerance:
                continue

            if (
                best_distance is None
                or distance
                < best_distance
            ):
                best_cluster = cluster
                best_distance = distance

        if best_cluster is None:

            clusters.append({
                "items": [
                    item
                ],

                "center_y": float(
                    item[
                        "center_y"
                    ]
                )
            })

            continue

        best_cluster[
            "items"
        ].append(
            item
        )

        best_cluster[
            "center_y"
        ] = float(
            np.median([
                value[
                    "center_y"
                ]
                for value
                in best_cluster[
                    "items"
                ]
            ])
        )

    # ============================================================
    # TURN CLUSTERS INTO HEADER-ROW CANDIDATES
    # ============================================================

    rows = []

    for cluster in clusters:

        # --------------------------------------------------------
        # Keep only the strongest occurrence of each canonical
        # header token inside this physical row.
        # --------------------------------------------------------

        best_by_token = {}

        for item in cluster[
            "items"
        ]:

            token_name = item[
                "token"
            ]

            current = best_by_token.get(
                token_name
            )

            if current is None:

                best_by_token[
                    token_name
                ] = item

                continue

            current_quality = (
                float(
                    current.get(
                        "matchScore",
                        0.0
                    )
                ),
                float(
                    current.get(
                        "confidence",
                        0.0
                    )
                )
            )

            candidate_quality = (
                float(
                    item.get(
                        "matchScore",
                        0.0
                    )
                ),
                float(
                    item.get(
                        "confidence",
                        0.0
                    )
                )
            )

            if (
                candidate_quality
                > current_quality
            ):
                best_by_token[
                    token_name
                ] = item

        if (
            len(
                best_by_token
            )
            < PREP_FOUNDATION_HEADER_MIN_KEYWORDS
        ):
            continue

        # --------------------------------------------------------
        # Physical left-to-right order must resemble:
        #
        # SCORE
        # GOALS
        # MIDDLE
        # SAVES
        # SHOTS
        # PING
        #
        # Missing columns are allowed.
        # --------------------------------------------------------

        items = sorted(
            best_by_token.values(),
            key=lambda value:
            value["x"]
        )

        ordered_columns = [
            column_order[
                item["token"]
            ]
            for item in items
        ]

        if len(
            ordered_columns
        ) >= 2:

            forward_pairs = sum(
                1
                for first, second
                in zip(
                    ordered_columns,
                    ordered_columns[
                        1:
                    ]
                )
                if second > first
            )

            required_forward_pairs = max(
                1,
                len(
                    ordered_columns
                )
                - 2
            )

            if (
                forward_pairs
                < required_forward_pairs
            ):
                continue

        # --------------------------------------------------------
        # Require meaningful horizontal spread.
        #
        # This prevents three unrelated nearby words from becoming
        # a fake SCOREBOARD header merely because their text
        # vaguely resembles header words.
        # --------------------------------------------------------

        row_left = min(
            item["x"]
            for item in items
        )

        row_right = max(
            item["x"]
            + item["w"]
            for item in items
        )

        row_width = (
            row_right
            - row_left
        )

        if (
            row_width
            < width * 0.18
        ):
            continue

        # --------------------------------------------------------
        # Identify which middle-stat header we actually saw.
        # --------------------------------------------------------

        middle_item = next(
            (
                item
                for item in items
                if item[
                    "token"
                ]
                == "MIDDLE_STAT"
            ),
            None
        )

        middle_stat = (
            middle_item.get(
                "middleStat"
            )
            if middle_item
            else None
        )

        middle_stat_score = (
            float(
                middle_item.get(
                    "matchScore",
                    0.0
                )
            )
            if middle_item
            else 0.0
        )

        # --------------------------------------------------------
        # Overall row quality
        # --------------------------------------------------------

        average_match_score = (
            sum(
                float(
                    item.get(
                        "matchScore",
                        0.0
                    )
                )
                for item in items
            )
            / max(
                len(
                    items
                ),
                1
            )
        )

        average_ocr_confidence = (
            sum(
                max(
                    0.0,
                    float(
                        item.get(
                            "confidence",
                            0.0
                        )
                    )
                )
                for item in items
            )
            / max(
                len(
                    items
                ),
                1
            )
        )

        keyword_ratio = (
            len(
                items
            )
            / 6.0
        )

        row_score = (
            average_match_score
            * 0.50
            + keyword_ratio
            * 0.35
            + min(
                1.0,
                average_ocr_confidence
                / 100.0
            )
            * 0.15
        )

        rows.append({
            "top": min(
                item["y"]
                for item in items
            ),

            "bottom": max(
                item["y"]
                + item["h"]
                for item in items
            ),

            "left": int(
                row_left
            ),

            "right": int(
                row_right
            ),

            "center_y": float(
                cluster[
                    "center_y"
                ]
            ),

            "keywords": [
                item[
                    "token"
                ]
                for item in items
            ],

            "keywordCount": int(
                len(
                    items
                )
            ),

            "headerText": " ".join(
                item[
                    "raw"
                ]
                for item in items
            ),

            "columns": {
                item["token"]: {
                    "x": int(item["x"]),
                    "y": int(item["y"]),
                    "w": int(item["w"]),
                    "h": int(item["h"]),
                    "center_x": float(item["center_x"]),
                    "confidence": float(item["confidence"]),
                    "matchScore": float(item["matchScore"])
                }
                for item in items
            },

            "middleStat": (
                middle_stat
            ),

            "middleStatScore": round(
                middle_stat_score,
                4
            ),

            "averageMatchScore": round(
                average_match_score,
                4
            ),

            "averageOcrConfidence": round(
                average_ocr_confidence,
                2
            ),

            "headerScore": round(
                float(
                    row_score
                ),
                4
            )
        })

    # ============================================================
    # DEDUP NEAR-IDENTICAL HEADER ROWS
    # ============================================================

    if not rows:
        return []

    rows.sort(
        key=lambda row: (
            row[
                "center_y"
            ],
            -row.get(
                "headerScore",
                0.0
            )
        )
    )

    dedup_tolerance = max(
        5.0,
        height
        * PREP_FOUNDATION_HEADER_Y_TOLERANCE_RATIO
        * 0.60
    )

    deduplicated = []

    for row in rows:

        duplicate_index = None

        for index, existing in enumerate(
            deduplicated
        ):

            if (
                abs(
                    row[
                        "center_y"
                    ]
                    - existing[
                        "center_y"
                    ]
                )
                <= dedup_tolerance
            ):
                duplicate_index = index
                break

        if duplicate_index is None:

            deduplicated.append(
                row
            )

            continue

        existing = deduplicated[
            duplicate_index
        ]

        if (
            float(
                row.get(
                    "headerScore",
                    0.0
                )
            )
            > float(
                existing.get(
                    "headerScore",
                    0.0
                )
            )
        ):
            deduplicated[
                duplicate_index
            ] = row

    deduplicated.sort(
        key=lambda row:
        row[
            "center_y"
        ]
    )

    return deduplicated

def _summarize_header_rows(rows):
    rows = [row for row in (rows or []) if isinstance(row, dict)]
    if not rows:
        return {
            "headerHits": 0, "headerText": "", "middleStat": None,
            "variation1": "", "variation2": ""
        }

    middle_rows = [row for row in rows if row.get("middleStat")]
    middle_stat = (
        max(
            middle_rows,
            key=lambda row: (
                float(row.get("middleStatScore", 0.0) or 0.0),
                int(row.get("keywordCount", 0) or 0)
            )
        ).get("middleStat")
        if middle_rows
        else None
    )
    texts = [
        str(row.get("headerText", "") or "").strip()
        for row in rows
        if str(row.get("headerText", "") or "").strip()
    ]
    return {
        "headerHits": max(int(row.get("keywordCount", 0) or 0) for row in rows),
        "headerText": " | ".join(texts),
        "middleStat": middle_stat,
        "variation1": texts[0] if texts else "",
        "variation2": texts[1] if len(texts) > 1 else ""
    }

def _estimate_scoreboard_x_bounds_from_headers(
    header_1,
    header_2,
    image_width
):
    """Estimate complete scoreboard X bounds from detected stat-header columns.

    The repeated header tells us where canonical SCORE/GOALS/.../PING columns
    physically landed. Fit a single affine transform:

        screen_x = scoreboard_left + canonical_ratio * scoreboard_width

    This recovers the username/icon side of the scoreboard instead of deriving
    the left edge from the SCORE header span alone.
    """

    if not PREP_FOUNDATION_ADAPTIVE_X_BOUNDS_ENABLED:
        return None

    canonical_centers = {
        "SCORE": (
            COLUMN_SCORE_LEFT
            + COLUMN_SCORE_RIGHT
        ) / 2.0,

        "GOALS": (
            COLUMN_GOALS_LEFT
            + COLUMN_GOALS_RIGHT
        ) / 2.0,

        "MIDDLE_STAT": (
            COLUMN_MIDDLE_LEFT
            + COLUMN_MIDDLE_RIGHT
        ) / 2.0,

        "SAVES": (
            COLUMN_SAVES_LEFT
            + COLUMN_SAVES_RIGHT
        ) / 2.0,

        "SHOTS": (
            COLUMN_SHOTS_LEFT
            + COLUMN_SHOTS_RIGHT
        ) / 2.0,

        "PING": (
            COLUMN_PING_LEFT
            + COLUMN_PING_RIGHT
        ) / 2.0,
    }

    observations = {}

    for header in (
        header_1,
        header_2
    ):
        if not isinstance(
            header,
            dict
        ):
            continue

        columns = (
            header.get(
                "columns"
            )
            or {}
        )

        for name in PREP_ALIGNMENT_REQUIRED_HEADERS:
            column = columns.get(
                name
            )

            if not isinstance(
                column,
                dict
            ):
                continue

            center_x = column.get(
                "center_x"
            )

            if center_x is None:
                continue

            observations.setdefault(
                name,
                []
            ).append(
                float(
                    center_x
                )
            )

    pairs = []

    for name, values in observations.items():
        if not values:
            continue

        pairs.append((
            float(
                canonical_centers[
                    name
                ]
            ),
            float(
                np.median(
                    values
                )
            )
        ))

    if (
        len(
            pairs
        )
        < PREP_FOUNDATION_ADAPTIVE_X_MIN_COLUMNS
    ):
        return None

    canonical_x = np.array(
        [
            item[0]
            for item in pairs
        ],
        dtype=np.float64
    )

    observed_x = np.array(
        [
            item[1]
            for item in pairs
        ],
        dtype=np.float64
    )

    design = np.column_stack((
        canonical_x,
        np.ones_like(
            canonical_x
        )
    ))

    try:
        solution, _, _, _ = np.linalg.lstsq(
            design,
            observed_x,
            rcond=None
        )

    except Exception:
        return None

    scoreboard_width = float(
        solution[0]
    )

    scoreboard_left = float(
        solution[1]
    )

    if not np.isfinite(
        scoreboard_width
    ):
        return None

    if not np.isfinite(
        scoreboard_left
    ):
        return None

    minimum_width = (
        image_width
        * PREP_FOUNDATION_ADAPTIVE_X_MIN_WIDTH_RATIO
    )

    maximum_width = (
        image_width
        * PREP_FOUNDATION_ADAPTIVE_X_MAX_WIDTH_RATIO
    )

    if not (
        minimum_width
        <= scoreboard_width
        <= maximum_width
    ):
        return None

    predicted = (
        scoreboard_left
        + canonical_x
        * scoreboard_width
    )

    residual = float(
        np.sqrt(
            np.mean(
                np.square(
                    predicted
                    - observed_x
                )
            )
        )
    )

    # A wildly inconsistent transform is less trustworthy than the conservative
    # legacy span expansion.
    residual_limit = max(
        6.0,
        scoreboard_width
        * 0.025
    )

    if residual > residual_limit:
        return None

    left_padding = (
        scoreboard_width
        * PREP_FOUNDATION_ADAPTIVE_X_LEFT_PADDING_RATIO
    )

    right_padding = (
        scoreboard_width
        * PREP_FOUNDATION_ADAPTIVE_X_RIGHT_PADDING_RATIO
    )

    estimated_left = int(
        round(
            scoreboard_left
            - left_padding
        )
    )

    estimated_right = int(
        round(
            scoreboard_left
            + scoreboard_width
            + right_padding
        )
    )

    estimated_left = max(
        0,
        min(
            image_width - 1,
            estimated_left
        )
    )

    estimated_right = max(
        estimated_left + 1,
        min(
            image_width,
            estimated_right
        )
    )

    return {
        "left": estimated_left,
        "right": estimated_right,
        "scoreboardWidth": round(
            scoreboard_width,
            2
        ),
        "scoreboardLeft": round(
            scoreboard_left,
            2
        ),
        "fitResidual": round(
            residual,
            3
        ),
        "columnsUsed": [
            item[0]
            for item in sorted(
                observations.items()
            )
            if item[1]
        ],
    }
