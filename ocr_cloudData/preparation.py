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
PREPARATION_VERSION = "preparation-v12.3-compact-ping-faded-center-snap"

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
# If exactly one row is missing, allow a faded/departed row to be restored from
# physical spacing when it is sandwiched between two direct anchors occupying
# adjacent logical slots.
PREP_SINGLE_GAP_GEOMETRY_ENABLED = True
PREP_SINGLE_GAP_MAX_SPACING_ERROR_RATIO = 0.30

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
# ---------- Strict preflight gates ----------
PREP_REQUIRE_EXPECTED_ROSTER_MATCH = True
PREP_ROSTER_NAME_MIN_SCORE = 72.0
PREP_ROSTER_NAME_MIN_READ_LENGTH = 2
PREP_ROSTER_STRONG_MISMATCH_MAX_SCORE = 45.0
PREP_REQUIRE_TEAM_ASSIGNMENT = True
PREP_REQUIRE_ALL_DIRECT_ROWS = True

# ============================================================
# ROW / STAT / PING IMPORTS
# Only row-core entry points are imported. Shared/private header helpers
# remain defined locally to avoid partial-module/private-name import errors.
# ============================================================
from preparation_rows import (
    _column_geometry_from_header_rows,
    _empty_row_probe,
    _foundation_headers_from_alignment,
    _identity_x_bounds_from_header_rows,
    build_roi_evidence,
    build_slot_coefficients,
    detect_ping_regions,
    detect_raw_stat_anchor_regions,
    detect_stat_anchor_regions,
    filter_stat_anchor_regions,
    merge_row_anchor_evidence,
    quick_row_probe,
    reconstruct_player_anchors,
    solve_layout_from_assignment,
)

# ============================================================
# NORMALIZATION / LOCALIZATION / FOUNDATION / PREFLIGHT
# ============================================================

def get_preflight_dimension_limits(
    players_per_team
):
    return {
        1: {
            "min_width": 420,
            "min_height": 120,
            "min_aspect": 1.35,
            "max_aspect": 6.50
        },
        2: {
            "min_width": 480,
            "min_height": 180,
            "min_aspect": 1.30,
            "max_aspect": 5.80
        },
        3: {
            "min_width": 520,
            "min_height": 240,
            "min_aspect": 1.20,
            "max_aspect": 5.20
        },
        4: {
            "min_width": 560,
            "min_height": 300,
            "min_aspect": 1.10,
            "max_aspect": 4.80
        }
    }[
        players_per_team
    ]

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

def resize_for_preflight_scan(
    image
):
    height, width = image.shape[:2]
    longest_side = max(
        height,
        width
    )
    if longest_side <= PREP_SCAN_MAX_SIDE:
        return image, 1.0
    scale = (
        PREP_SCAN_MAX_SIDE
        / float(
            longest_side
        )
    )
    resized = cv2.resize(
        image,
        (
            max(
                1,
                int(round(width * scale))
            ),
            max(
                1,
                int(round(height * scale))
            )
        ),
        interpolation=cv2.INTER_AREA
    )
    return resized, scale

def normalize_scoreboard_image(
    image,
    players_per_team=None,
    row_anchors=None
):
    """Resize only the isolated scoreboard ROI.

    The full upload/localization image should never be enlarged for OCR.
    Scale is chosen from the actual scoreboard width plus player-row spacing,
    then capped so we only resample once.
    """
    if image is None or image.size == 0:
        return image, 1.0

    height, width = image.shape[:2]
    if width <= 0 or height <= 0:
        return image, 1.0

    expected_players = (
        int(players_per_team) * 2
        if players_per_team
        else 0
    )

    spacing_values = []
    if row_anchors:
        ordered_centers = sorted([
            int(anchor.get("center_y", -1))
            for anchor in row_anchors
            if int(anchor.get("center_y", -1)) >= 0
        ])
        spacing_values = [
            ordered_centers[index + 1] - ordered_centers[index]
            for index in range(len(ordered_centers) - 1)
            if ordered_centers[index + 1] > ordered_centers[index]
        ]

    if spacing_values:
        row_spacing = float(np.median(spacing_values))
    elif expected_players:
        # The scoreboard includes team-score/header space as well as player rows.
        row_spacing = (
            height
            / max(
                expected_players
                + PREP_ROW_SPACING_ESTIMATE_EXTRA_ROWS,
                1.0
            )
        )
    else:
        row_spacing = 0.0

    scale_from_width = 1.0
    if width < PREP_SMALL_ROI_WIDTH:
        scale_from_width = min(
            PREP_MAX_UPSCALE,
            PREP_SMALL_ROI_TARGET_WIDTH
            / float(width)
        )
    elif width < PREP_MEDIUM_ROI_WIDTH:
        scale_from_width = min(
            PREP_MEDIUM_ROI_MAX_UPSCALE,
            PREP_TARGET_WIDTH / float(width)
        )
    elif width > PREP_MAX_WIDTH:
        scale_from_width = (
            PREP_MAX_WIDTH / float(width)
        )

    scale_from_rows = 1.0
    if 0.0 < row_spacing < PREP_TARGET_ROW_SPACING:
        scale_from_rows = min(
            PREP_MAX_UPSCALE,
            PREP_TARGET_ROW_SPACING / row_spacing
        )
    elif (
        row_spacing > PREP_LARGE_ROW_SPACING
        and width > PREP_TARGET_WIDTH
    ):
        scale_from_rows = max(
            PREP_LARGE_ROW_MIN_SCALE,
            PREP_LARGE_ROW_TARGET_SPACING
            / row_spacing
        )

    if scale_from_width < 1.0:
        scale = min(
            scale_from_width,
            scale_from_rows
            if scale_from_rows < 1.0
            else 1.0
        )
    else:
        scale = max(
            scale_from_width,
            scale_from_rows
        )

    scale = max(
        PREP_MIN_SCALE,
        min(
            PREP_MAX_UPSCALE,
            scale
        )
    )

    # PREP_MAX_WIDTH is a hard ceiling for detailed OCR. The earlier minimum
    # scale protects quality, but it must never override the requested maximum
    # normalized width for very large screenshots.
    if width > PREP_MAX_WIDTH:
        scale = min(
            scale,
            PREP_MAX_WIDTH / float(width)
        )

    if abs(scale - 1.0) < PREP_RESIZE_NOOP_TOLERANCE:
        return image, 1.0

    interpolation = (
        cv2.INTER_AREA
        if scale < 1.0
        else cv2.INTER_LANCZOS4
    )

    resized = cv2.resize(
        image,
        (
            max(1, int(round(width * scale))),
            max(1, int(round(height * scale)))
        ),
        interpolation=interpolation
    )

    return resized, scale

def _circular_hue_distance(
    first,
    second,
    bins=18
):
    difference = abs(
        int(first) - int(second)
    )
    return min(
        difference,
        bins - difference
    )

def _horizontal_overlap_ratio(
    first_left,
    first_right,
    second_left,
    second_right
):
    overlap = max(
        0,
        min(first_right, second_right)
        - max(first_left, second_left)
    )
    smaller = max(
        1,
        min(
            first_right - first_left,
            second_right - second_left
        )
    )
    return overlap / float(smaller)

def detect_scoreboard_color_candidate(
    image,
    players_per_team
):
    """Find a coarse scoreboard region from the two horizontal team-color families.

    This is intentionally a localization detector, not a final crop.  It works on
    the small scan image and returns a generous region that later ping/name/row
    geometry can tighten.
    """
    if image is None or image.size == 0:
        return None

    height, width = image.shape[:2]
    if width < 320 or height < 180:
        return None

    hsv = cv2.cvtColor(
        image,
        cv2.COLOR_BGR2HSV
    )
    hue, saturation, value = cv2.split(
        hsv
    )
    hue_bins = (
        hue // 10
    ).astype(
        np.int16
    )

    row_descriptors = []
    for y in range(height):
        valid = (
            (
                saturation[y]
                >= PREP_COLOR_SCAN_MIN_SATURATION
            )
            & (
                value[y]
                >= PREP_COLOR_SCAN_MIN_VALUE
            )
        )
        valid_count = int(
            np.count_nonzero(valid)
        )
        if valid_count < int(
            width * PREP_COLOR_MIN_VALID_ROW_RATIO
        ):
            continue

        histogram = np.bincount(
            hue_bins[y][valid],
            minlength=18
        )
        dominant_bin = int(
            np.argmax(histogram)
        )

        distances = np.minimum(
            (
                hue_bins[y] - dominant_bin
            ) % 18,
            (
                dominant_bin - hue_bins[y]
            ) % 18
        )
        selected = (
            valid
            & (distances <= 1)
        )
        x_values = np.flatnonzero(
            selected
        )
        if len(x_values) < int(
            width * PREP_COLOR_MIN_SELECTED_ROW_RATIO
        ):
            continue

        left = int(
            np.percentile(
                x_values,
                6
            )
        )
        right = int(
            np.percentile(
                x_values,
                94
            )
        )
        if right - left < int(
            width * PREP_COLOR_MIN_REGION_WIDTH_RATIO
        ):
            continue

        row_descriptors.append({
            "y": y,
            "hueBin": dominant_bin,
            "left": left,
            "right": right,
            "coverage": (
                len(x_values)
                / float(width)
            )
        })

    if not row_descriptors:
        return None

    groups = []
    current = []
    for descriptor in row_descriptors:
        if not current:
            current = [descriptor]
            continue

        previous = current[-1]
        y_gap = (
            descriptor["y"]
            - previous["y"]
        )
        hue_gap = _circular_hue_distance(
            descriptor["hueBin"],
            previous["hueBin"]
        )
        horizontal_overlap = _horizontal_overlap_ratio(
            descriptor["left"],
            descriptor["right"],
            previous["left"],
            previous["right"]
        )

        if (
            y_gap <= PREP_COLOR_GROUP_MAX_Y_GAP
            and hue_gap <= PREP_COLOR_GROUP_MAX_HUE_GAP
            and horizontal_overlap
            >= PREP_COLOR_GROUP_MIN_OVERLAP
        ):
            current.append(
                descriptor
            )
        else:
            if len(current) >= 4:
                groups.append(
                    current
                )
            current = [
                descriptor
            ]

    if len(current) >= 4:
        groups.append(
            current
        )

    regions = []
    for group in groups:
        ys = [
            item["y"]
            for item in group
        ]
        left = int(
            np.median([
                item["left"]
                for item in group
            ])
        )
        right = int(
            np.median([
                item["right"]
                for item in group
            ])
        )
        hue_values = [
            item["hueBin"]
            for item in group
        ]
        dominant_hue = max(
            set(hue_values),
            key=hue_values.count
        )
        region_height = (
            max(ys) - min(ys) + 1
        )

        if (
            right - left
            < width * PREP_COLOR_MIN_REGION_WIDTH_RATIO
            or region_height
            > height * PREP_COLOR_MAX_REGION_HEIGHT_RATIO
        ):
            continue

        regions.append({
            "top": min(ys),
            "bottom": max(ys) + 1,
            "left": left,
            "right": right,
            "hueBin": int(dominant_hue),
            "coverage": round(
                float(np.mean([
                    item["coverage"]
                    for item in group
                ])),
                4
            )
        })

    best_pair = None
    for first_index in range(len(regions)):
        for second_index in range(
            first_index + 1,
            len(regions)
        ):
            first = regions[first_index]
            second = regions[second_index]

            if second["top"] <= first["top"]:
                first, second = second, first

            hue_separation = _circular_hue_distance(
                first["hueBin"],
                second["hueBin"]
            )
            if hue_separation < 2:
                continue

            overlap = _horizontal_overlap_ratio(
                first["left"],
                first["right"],
                second["left"],
                second["right"]
            )
            if overlap < PREP_COLOR_MIN_PAIR_OVERLAP:
                continue

            vertical_gap = max(
                0,
                second["top"] - first["bottom"]
            )
            if (
                vertical_gap
                > height
                * PREP_COLOR_MAX_PAIR_VERTICAL_GAP_RATIO
            ):
                continue

            first_width = (
                first["right"] - first["left"]
            )
            second_width = (
                second["right"] - second["left"]
            )
            width_similarity = (
                min(first_width, second_width)
                / max(first_width, second_width, 1)
            )

            score = (
                overlap * 50.0
                + width_similarity * 24.0
                + min(
                    hue_separation / 9.0,
                    1.0
                ) * 18.0
                + (
                    first["coverage"]
                    + second["coverage"]
                ) * 12.0
            )

            if (
                best_pair is None
                or score > best_pair["score"]
            ):
                best_pair = {
                    "score": score,
                    "first": first,
                    "second": second,
                    "hueSeparationBins": hue_separation
                }

    if best_pair is None:
        return None

    first = best_pair["first"]
    second = best_pair["second"]
    horizontal_padding = int(
        width * PREP_COLOR_HORIZONTAL_PADDING
    )
    vertical_padding = int(
        height * PREP_COLOR_VERTICAL_PADDING
    )

    left = max(
        0,
        min(
            first["left"],
            second["left"]
        ) - horizontal_padding
    )
    right = min(
        width,
        max(
            first["right"],
            second["right"]
        ) + horizontal_padding
    )

    first_height = (
        first["bottom"]
        - first["top"]
    )
    second_height = (
        second["bottom"]
        - second["top"]
    )
    expected_team_extent = max(
        int(
            height
            * PREP_COLOR_EXPECTED_TEAM_MIN_EXTENT_RATIO
        ),
        min(
            max(first_height, second_height),
            int(
                height
                * PREP_COLOR_EXPECTED_TEAM_MAX_EXTENT_RATIO
            )
        )
    )

    top = max(
        0,
        first["top"] - vertical_padding
    )
    bottom = min(
        height,
        second["top"]
        + expected_team_extent
        + vertical_padding
    )

    if (
        right - left
        < width * PREP_COLOR_MIN_FINAL_WIDTH_RATIO
        or bottom - top
        < height * PREP_COLOR_MIN_FINAL_HEIGHT_RATIO
    ):
        return None

    return {
        "left": int(left),
        "top": int(top),
        "right": int(right),
        "bottom": int(bottom),
        "score": round(
            float(best_pair["score"]),
            2
        ),
        "colorSeparation": round(
            min(
                best_pair["hueSeparationBins"]
                / 9.0,
                1.0
            ),
            3
        ),
        "teamColorA": first,
        "teamColorB": second
    }

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

def normalize_header_token(value):
    """Compatibility wrapper returning SCORE/GOALS/MIDDLE_STAT/... or None."""
    match = _match_header_token(value)
    return match["token"] if match else None

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

def detect_foundation_row_candidates(image, left, right, header_columns=None):
    """Find player-value rows, preferring X geometry learned from the headers."""
    if image is None or image.size == 0:
        return []

    height, width = image.shape[:2]
    left = max(0, min(width - 1, int(left)))
    right = max(left + 1, min(width, int(right)))

    columns = []
    if isinstance(header_columns, dict):
        centers = [
            (name, float(header_columns[name]["center_x"]))
            for name in ("SCORE", "GOALS", "MIDDLE_STAT", "SAVES", "SHOTS")
            if isinstance(header_columns.get(name), dict)
            and header_columns[name].get("center_x") is not None
        ]
        centers.sort(key=lambda item: item[1])

        for index, (name, center_x) in enumerate(centers):
            gaps = []
            if index:
                gaps.append(center_x - centers[index - 1][1])
            if index + 1 < len(centers):
                gaps.append(centers[index + 1][1] - center_x)
            typical_gap = min(gaps) if gaps else max(28.0, (right - left) * 0.12)
            half_width = max(10, int(round(typical_gap * 0.42)))
            column_left = max(left, int(round(center_x)) - half_width)
            column_right = min(right, int(round(center_x)) + half_width)
            if column_right - column_left >= 6:
                columns.append((name, column_left, column_right))

    # Color-only fallback has no learned stat columns yet.
    if not columns:
        columns = [("BROAD", left, right)]

    min_h = max(4, int(width * 0.004))
    max_h = max(min_h + 1, int(width * 0.045))
    observations = []

    for column_index, (column_name, column_left, column_right) in enumerate(columns):
        crop = image[:, column_left:column_right]
        if crop is None or crop.size == 0:
            continue

        gray = cv2.GaussianBlur(
            cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY),
            (3, 3),
            0
        )
        _, otsu = cv2.threshold(
            gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU
        )
        adaptive = cv2.adaptiveThreshold(
            gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv2.THRESH_BINARY, 21, -3
        )
        connected = cv2.dilate(
            cv2.bitwise_or(otsu, adaptive),
            cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2)),
            iterations=1
        )
        contours, _ = cv2.findContours(
            connected, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
        )

        column_width = max(1, column_right - column_left)
        max_width_ratio = 0.85 if column_name != "BROAD" else 0.30

        for contour in contours:
            x, y, w, h = cv2.boundingRect(contour)
            if h < min_h or h > max_h:
                continue
            if w < 2 or w > column_width * max_width_ratio:
                continue
            observations.append({
                "center_y": float(y + h / 2.0),
                "column": column_index,
                "region": (column_left + x, y, w, h)
            })

    if not observations:
        return []

    tolerance = max(6.0, height * 0.012)
    clusters = []

    for item in sorted(observations, key=lambda value: value["center_y"]):
        nearby = [
            cluster for cluster in clusters
            if abs(item["center_y"] - cluster["center_y"]) <= tolerance
        ]
        if not nearby:
            clusters.append({"center_y": item["center_y"], "items": [item]})
            continue
        target = min(
            nearby,
            key=lambda cluster: abs(item["center_y"] - cluster["center_y"])
        )
        target["items"].append(item)
        target["center_y"] = float(np.median([
            value["center_y"] for value in target["items"]
        ]))

    minimum_column_hits = 2 if len(columns) >= 2 else 1
    rows = []

    for cluster in clusters:
        unique_columns = {item["column"] for item in cluster["items"]}
        if len(unique_columns) < minimum_column_hits:
            continue

        ys = [item["region"][1] for item in cluster["items"]]
        bottoms = [
            item["region"][1] + item["region"][3]
            for item in cluster["items"]
        ]
        rows.append({
            "center_y": int(round(cluster["center_y"])),
            "column_hits": len(unique_columns),
            "component_hits": len(cluster["items"]),
            "region": (
                left,
                max(0, min(ys)),
                right - left,
                max(1, max(bottoms) - min(ys))
            )
        })

    rows.sort(key=lambda item: item["center_y"])
    return rows


def detect_foundation_score_candidates(image, header_columns=None):
    """Find real large SCORE glyph rows without requiring other stat columns."""
    if image is None or image.size == 0:
        return []
    if not isinstance(header_columns, dict):
        return []
    score_header = header_columns.get("SCORE")
    if not isinstance(score_header, dict):
        return []
    score_center = score_header.get("center_x")
    if score_center is None:
        return []

    height, width = image.shape[:2]
    header_centers = sorted(
        float(item.get("center_x"))
        for item in header_columns.values()
        if isinstance(item, dict)
        and item.get("center_x") is not None
    )
    gaps = [
        second - first
        for first, second in zip(header_centers, header_centers[1:])
        if second > first
    ]
    typical_gap = (
        float(np.median(gaps))
        if gaps
        else width * 0.095
    )
    half_width = max(
        14,
        int(round(typical_gap * 0.46))
    )
    left = max(0, int(round(float(score_center))) - half_width)
    right = min(width, int(round(float(score_center))) + half_width)
    if right - left < 8:
        return []

    crop = image[:, left:right]
    intensity = (
        np.max(crop, axis=2).astype(np.uint8)
        if crop.ndim == 3
        else crop.astype(np.uint8)
    )
    background = cv2.GaussianBlur(
        intensity,
        (0, 0),
        2.2
    )
    residual = cv2.absdiff(
        intensity,
        background
    )
    threshold = int(max(
        8.0,
        np.percentile(residual, 78.0)
    ))
    _, foreground = cv2.threshold(
        residual,
        threshold,
        255,
        cv2.THRESH_BINARY
    )
    projection = np.count_nonzero(
        foreground,
        axis=1
    ).astype(np.float32)
    projection = cv2.GaussianBlur(
        projection.reshape(-1, 1),
        (1, 9),
        0
    ).reshape(-1)
    floor = max(
        2.0,
        float(np.percentile(projection, 72.0))
    )
    peak_rows = [
        row
        for row in range(1, max(1, height - 1))
        if projection[row] >= floor
        and projection[row] >= projection[row - 1]
        and projection[row] > projection[row + 1]
    ]
    minimum_distance = max(
        16,
        int(round(height * 0.040))
    )
    selected = []
    for row in sorted(
        peak_rows,
        key=lambda value: float(projection[value]),
        reverse=True
    ):
        if any(
            abs(row - existing) < minimum_distance
            for existing in selected
        ):
            continue
        selected.append(row)
        if len(selected) >= 10:
            break

    strongest = max(
        [float(projection[row]) for row in selected],
        default=1.0
    )
    half_height = max(5, int(round(height * 0.018)))
    rows = []
    for center_y in selected:
        top = max(0, center_y - half_height)
        bottom = min(height, center_y + half_height + 1)
        local = foreground[top:bottom]
        contours, _ = cv2.findContours(
            local,
            cv2.RETR_EXTERNAL,
            cv2.CHAIN_APPROX_SIMPLE
        )
        components = [
            cv2.boundingRect(contour)
            for contour in contours
            if cv2.contourArea(contour) >= 2.0
        ]
        if not components:
            continue
        rows.append({
            "center_y": int(center_y),
            "column_hits": 1,
            "component_hits": len(components),
            "region": (
                int(left),
                int(top),
                int(right - left),
                int(max(1, bottom - top))
            ),
            "signal_sources": ["score"],
            "score_signal_strength": round(
                min(
                    1.0,
                    float(projection[center_y])
                    / max(strongest, 1.0)
                ),
                4
            )
        })
    return sorted(rows, key=lambda item: item["center_y"])


def merge_foundation_row_signals(
    image_height,
    stat_rows=None,
    ping_regions=None,
    score_rows=None
):
    """Merge only observed row signals; this function never creates slots."""
    signals = []
    for row in stat_rows or []:
        item = dict(row)
        item["signal_sources"] = list(dict.fromkeys(
            list(item.get("signal_sources") or [])
            + ["stats"]
        ))
        signals.append(item)
    for region in ping_regions or []:
        x, y, w, h = region
        signals.append({
            "center_y": float(y + h / 2.0),
            "column_hits": 1,
            "component_hits": 1,
            "region": tuple(region),
            "signal_sources": ["ping"],
        })
    for row in score_rows or []:
        signals.append(dict(row))

    tolerance = max(7.0, float(image_height) * 0.014)
    merged = []
    for item in sorted(
        signals,
        key=lambda value: float(value.get("center_y", 0.0) or 0.0)
    ):
        target = next(
            (
                existing
                for existing in reversed(merged)
                if abs(
                    float(existing.get("center_y", 0.0) or 0.0)
                    - float(item.get("center_y", 0.0) or 0.0)
                ) <= tolerance
            ),
            None
        )
        if target is None:
            merged.append(dict(item))
            continue
        target["center_y"] = float(np.median([
            float(target.get("center_y", 0.0) or 0.0),
            float(item.get("center_y", 0.0) or 0.0)
        ]))
        target["column_hits"] = max(
            int(target.get("column_hits", 0) or 0),
            int(item.get("column_hits", 0) or 0)
        )
        target["component_hits"] = (
            int(target.get("component_hits", 0) or 0)
            + int(item.get("component_hits", 0) or 0)
        )
        target["signal_sources"] = list(dict.fromkeys(
            list(target.get("signal_sources") or [])
            + list(item.get("signal_sources") or [])
        ))
    return merged

def _select_foundation_team_rows(
    stat_regions,
    zone_top,
    zone_bottom,
    players_per_team
):
    """Choose the most physically consistent player-row sequence in one team zone."""
    candidates = sorted(
        (
            item
            for item in (stat_regions or [])
            if zone_top < int(item.get("center_y", -1)) < zone_bottom
        ),
        key=lambda item: int(item.get("center_y", 0))
    )
    if len(candidates) < players_per_team:
        return []

    def evidence_quality(item):
        sources = set(item.get("signal_sources") or [])
        source_score = min(
            1.0,
            (0.55 if "ping" in sources else 0.0)
            + (0.45 if "score" in sources else 0.0)
            + (0.35 if "stats" in sources else 0.0)
        )
        return (
            min(1.0, float(item.get("column_hits", 0) or 0) / 5.0),
            min(1.0, float(item.get("component_hits", 0) or 0) / 8.0),
            source_score
        )

    if players_per_team == 1:
        zone_height = max(1.0, float(zone_bottom - zone_top))

        def single_score(item):
            column_score, component_score, source_score = evidence_quality(item)
            distance = max(0.0, float(item.get("center_y", 0) or 0) - zone_top)
            proximity = max(0.0, 1.0 - distance / (zone_height * 0.55))
            return (
                column_score * 0.30
                + component_score * 0.15
                + source_score * 0.30
                + proximity * 0.25
            )

        return [max(candidates, key=single_score)]

    best = None
    for chosen in combinations(candidates, players_per_team):
        chosen = list(chosen)
        centers = [float(item.get("center_y", 0) or 0) for item in chosen]
        differences = [
            second - first
            for first, second in zip(centers, centers[1:])
        ]
        if not differences or min(differences) <= 8.0:
            continue

        spacing = float(np.median(differences))
        if spacing <= 0:
            continue

        spacing_error = float(np.mean([
            abs(value - spacing)
            for value in differences
        ]))
        spacing_consistency = max(
            0.0,
            1.0 - spacing_error / max(spacing * 0.45, 1.0)
        )
        first_offset_ratio = (centers[0] - float(zone_top)) / max(spacing, 1.0)
        offset_score = max(
            0.0,
            1.0 - abs(first_offset_ratio - 0.72) / 1.10
        )
        quality = [evidence_quality(item) for item in chosen]
        column_quality = float(np.mean([item[0] for item in quality]))
        component_quality = float(np.mean([item[1] for item in quality]))
        source_quality = float(np.mean([item[2] for item in quality]))
        score = (
            spacing_consistency * 0.44
            + offset_score * 0.18
            + source_quality * 0.20
            + column_quality * 0.12
            + component_quality * 0.06
        )
        key = (score, spacing_consistency, column_quality, -centers[0])
        if best is None or key > best[0]:
            best = (key, chosen)

    return list(best[1]) if best is not None else []

def _foundation_header_quality(row):
    return max(0.0, min(1.0, float((row or {}).get("headerScore", 0.0) or 0.0)))

def _score_foundation_header_pair(first, second, image_height):
    gap = float(second["center_y"] - first["center_y"])
    if not (
        image_height * PREP_FOUNDATION_HEADER_MIN_VERTICAL_GAP_RATIO
        <= gap
        <= image_height * PREP_FOUNDATION_HEADER_MAX_VERTICAL_GAP_RATIO
    ):
        return None

    span_1 = max(1, int(first["right"]) - int(first["left"]))
    span_2 = max(1, int(second["right"]) - int(second["left"]))
    overlap = _horizontal_overlap_ratio(
        first["left"], first["right"], second["left"], second["right"]
    )
    width_similarity = min(span_1, span_2) / max(span_1, span_2)
    keyword_ratio = min(
        1.0,
        (
            int(first.get("keywordCount", 0) or 0)
            + int(second.get("keywordCount", 0) or 0)
        ) / 12.0
    )
    ocr_quality = (
        _foundation_header_quality(first)
        + _foundation_header_quality(second)
    ) / 2.0
    middle_1 = str(first.get("middleStat") or "")
    middle_2 = str(second.get("middleStat") or "")
    middle_consistency = (
        1.0
        if middle_1 and middle_2 and middle_1 == middle_2
        else 0.65
        if not middle_1 or not middle_2
        else 0.25
    )
    return max(
        0.0,
        min(
            1.0,
            ocr_quality * 0.34
            + overlap * 0.24
            + width_similarity * 0.16
            + keyword_ratio * 0.16
            + middle_consistency * 0.10
        )
    )

def _best_foundation_header_pair(header_rows, image_height):
    scored = []
    for first, second in combinations(header_rows or [], 2):
        score = _score_foundation_header_pair(first, second, image_height)
        if score is not None:
            scored.append((score, first, second))
    return max(scored, key=lambda item: item[0]) if scored else None

def _ordered_foundation_color_bands(color_candidate):
    color_a = (color_candidate or {}).get("teamColorA") or {}
    color_b = (color_candidate or {}).get("teamColorB") or {}
    required = ("top", "bottom")
    if not (
        all(key in color_a for key in required)
        and all(key in color_b for key in required)
    ):
        return None
    if int(color_b["top"]) < int(color_a["top"]):
        color_a, color_b = color_b, color_a
    return color_a, color_b

def _foundation_color_header_support(header_1, header_2, color_bands, image_height):
    if not color_bands:
        return 0.0
    color_a, color_b = color_bands
    tolerance = max(1.0, image_height * 0.18)
    distance = (
        abs(float(header_1["center_y"]) - float(color_a["top"]))
        + abs(float(header_2["center_y"]) - float(color_b["top"]))
    )
    return max(0.0, min(1.0, 1.0 - distance / (tolerance * 2.0)))

def _shift_foundation_header(header, delta):
    shifted = dict(header)
    for key in ("top", "bottom", "center_y"):
        shifted[key] = shifted[key] + delta
    shifted["inferredFromTeamColor"] = True
    return shifted

def _color_only_foundation_header(color_band, color_candidate, image_width):
    band_height = max(4, int(color_band["bottom"]) - int(color_band["top"]))
    return {
        "top": int(color_band["top"]),
        "bottom": int(color_band["top"] + max(2, band_height * 0.18)),
        "left": int(color_band.get("left", (color_candidate or {}).get("left", 0))),
        "right": int(
            color_band.get(
                "right",
                (color_candidate or {}).get("right", image_width)
            )
        ),
        "center_y": float(color_band["top"]),
        "keywords": [],
        "keywordCount": 0,
        "headerText": "",
        "middleStat": None,
        "headerScore": 0.0,
        "inferredFromColorOnly": True
    }

def _foundation_column_centers(header_1, header_2):
    maps = [
        value
        for value in (header_1.get("columns"), header_2.get("columns"))
        if isinstance(value, dict)
    ]
    result = {}
    for column_name in ("SCORE", "GOALS", "MIDDLE_STAT", "SAVES", "SHOTS"):
        values = [
            mapping[column_name]
            for mapping in maps
            if isinstance(mapping.get(column_name), dict)
        ]
        if values:
            result[column_name] = {
                "center_x": float(np.mean([
                    float(item["center_x"])
                    for item in values
                ]))
            }
    return result

def _foundation_row_spacing(team_1_rows, team_2_rows, header_1, header_2):
    differences = []
    for group in (team_1_rows, team_2_rows):
        centers = [int(item["center_y"]) for item in group]
        differences.extend([
            second - first
            for first, second in zip(centers, centers[1:])
            if second > first
        ])
    if differences:
        return max(18.0, float(np.median(differences)))

    offsets = [
        max(1, int(team_1_rows[0]["center_y"]) - int(header_1["bottom"])),
        max(1, int(team_2_rows[0]["center_y"]) - int(header_2["bottom"]))
    ]
    return max(18.0, float(np.median(offsets)))

def _foundation_confidence(mode, pair_score, row_coverage, color_support):
    if mode == "dual_header":
        value = (
            pair_score
            * (
                PREP_FOUNDATION_HEADER_PAIR_WEIGHT
                + PREP_FOUNDATION_COLOR_SUPPORT_WEIGHT
            )
            + row_coverage * PREP_FOUNDATION_ROW_COVERAGE_WEIGHT
        )
        return min(PREP_FOUNDATION_HEADER_ONLY_CONFIDENCE_CAP, value)

    value = (
        pair_score * PREP_FOUNDATION_HEADER_PAIR_WEIGHT
        + row_coverage * PREP_FOUNDATION_ROW_COVERAGE_WEIGHT
        + color_support * PREP_FOUNDATION_COLOR_SUPPORT_WEIGHT
    )
    if mode == "single_header_color":
        value = min(PREP_FOUNDATION_SINGLE_HEADER_CONFIDENCE_CAP, value)
    elif mode == "color_row_fallback":
        value = min(PREP_FOUNDATION_COLOR_ONLY_CONFIDENCE_CAP, value)
    return value

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
            canonical_ratio = canonical_centers[
                name
            ]

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

def detect_scoreboard_foundation(
    image,
    players_per_team,
    evidence=None
):
    """Build one weighted canonical frame, with headers primary and color lazy."""
    if image is None or image.size == 0:
        return None

    height, width = image.shape[:2]
    players_per_team = int(players_per_team)
    expected_players = players_per_team * 2

    if evidence is None:
        evidence = ScoreboardEvidence(
            players_per_team=players_per_team,
            image=image,
            coordinate_space="localization_scan"
        )
    else:
        evidence.image = image
        evidence.players_per_team = players_per_team

    if not evidence.has("header_rows"):
        evidence.set_value(
            "header_rows",
            detect_scoreboard_header_rows(image)
        )
    header_rows = sorted(
        list(evidence.header_rows or []),
        key=lambda row: float(row.get("center_y", 0.0) or 0.0)
    )

    best_pair = _best_foundation_header_pair(header_rows, height)
    header_1 = header_2 = None
    pair_score = 0.0
    mode = None
    color_support = 0.0

    if best_pair is not None:
        pair_score = float(best_pair[0])
        header_1, header_2 = dict(best_pair[1]), dict(best_pair[2])
        if pair_score >= PREP_FOUNDATION_DUAL_HEADER_STRONG_SCORE:
            mode = "dual_header"
        elif pair_score >= PREP_FOUNDATION_DUAL_HEADER_MIN_SCORE:
            mode = "dual_header_needs_support"

    # Color is lazy. A strong repeated-header pair never pays this cost.
    coarse_color = None
    if mode != "dual_header":
        if not evidence.has("color_candidate"):
            evidence.set_value(
                "color_candidate",
                detect_scoreboard_color_candidate(image, players_per_team)
            )
        coarse_color = evidence.color_candidate
    elif evidence.has("color_candidate"):
        coarse_color = evidence.color_candidate

    color_bands = _ordered_foundation_color_bands(coarse_color)

    if header_1 is not None and header_2 is not None and mode == "dual_header_needs_support":
        color_support = _foundation_color_header_support(
            header_1, header_2, color_bands, height
        )
        if color_support < 0.35:
            header_1 = header_2 = None
            mode = None
        else:
            mode = "dual_header_color_supported"

    # One header may be mirrored to the other team only when two color bands agree.
    if (header_1 is None or header_2 is None) and header_rows and color_bands:
        confirmed = max(
            header_rows,
            key=lambda row: (
                _foundation_header_quality(row),
                int(row.get("keywordCount", 0) or 0)
            )
        )
        confirmed_quality = _foundation_header_quality(confirmed)
        if confirmed_quality >= PREP_FOUNDATION_SINGLE_HEADER_MIN_SCORE:
            color_a, color_b = color_bands
            team_1_target = int(color_a["top"])
            team_2_target = int(color_b["top"])
            delta = team_2_target - team_1_target
            if delta > 0:
                if (
                    abs(float(confirmed["center_y"]) - team_1_target)
                    <= abs(float(confirmed["center_y"]) - team_2_target)
                ):
                    header_1 = dict(confirmed)
                    header_2 = _shift_foundation_header(confirmed, delta)
                else:
                    header_2 = dict(confirmed)
                    header_1 = _shift_foundation_header(confirmed, -delta)
                pair_score = confirmed_quality * 0.78
                color_support = 1.0
                mode = "single_header_color"

    # Last resort: strong color panels plus exact row structure.
    if header_1 is None or header_2 is None:
        color_score = float((coarse_color or {}).get("score", 0.0) or 0.0) / 100.0
        if (
            not color_bands
            or color_score < PREP_FOUNDATION_COLOR_FALLBACK_MIN_SCORE
        ):
            return None
        color_a, color_b = color_bands
        header_1 = _color_only_foundation_header(color_a, coarse_color, width)
        header_2 = _color_only_foundation_header(color_b, coarse_color, width)
        pair_score = color_score * 0.55
        color_support = color_score
        mode = "color_row_fallback"

    header_left = min(int(header_1["left"]), int(header_2["left"]))
    header_right = max(int(header_1["right"]), int(header_2["right"]))
    header_span = max(1, header_right - header_left)

    header_based_left = int(round(
        header_left
        - header_span
        * PREP_FOUNDATION_HEADER_LEFT_EXPAND_SPAN
    ))

    header_based_right = int(round(
        header_right
        + header_span
        * PREP_FOUNDATION_HEADER_RIGHT_EXPAND_SPAN
    ))

    adaptive_x_bounds = (
        _estimate_scoreboard_x_bounds_from_headers(
            header_1,
            header_2,
            width
        )
    )

    if adaptive_x_bounds is not None:
        left = min(
            header_based_left,
            int(
                adaptive_x_bounds[
                    "left"
                ]
            )
        )

        right = max(
            header_based_right,
            int(
                adaptive_x_bounds[
                    "right"
                ]
            )
        )

    else:
        left = header_based_left
        right = header_based_right

    if (
        coarse_color is not None
        and mode != "dual_header"
    ):
        left = min(
            left,
            int(
                coarse_color.get(
                    "left",
                    left
                )
            )
            - int(
                width
                * PREP_FOUNDATION_LEFT_PADDING_RATIO
            )
        )

        right = max(
            right,
            int(
                coarse_color.get(
                    "right",
                    right
                )
            )
            + int(
                width
                * PREP_FOUNDATION_RIGHT_PADDING_RATIO
            )
        )

    left = max(0, left)
    right = min(width, right)
    if right <= left:
        return None

    header_columns = _foundation_column_centers(header_1, header_2)
    if not evidence.has("foundation_rows"):
        evidence.set_value(
            "foundation_rows",
            detect_foundation_row_candidates(
                image,
                max(left, header_left - int(header_span * 0.12)),
                right,
                header_columns=header_columns or None
            )
        )
    foundation_rows = list(evidence.foundation_rows or [])
    if not evidence.has("foundation_ping_regions"):
        _, foundation_ping_regions = detect_ping_regions(
            image,
            expected_players,
            stat_regions=foundation_rows
        )
        evidence.set_value(
            "foundation_ping_regions",
            foundation_ping_regions
        )
    if not evidence.has("foundation_score_rows"):
        evidence.set_value(
            "foundation_score_rows",
            detect_foundation_score_candidates(
                image,
                header_columns=header_columns or None
            )
        )
    foundation_signals = merge_foundation_row_signals(
        height,
        stat_rows=foundation_rows,
        ping_regions=evidence.foundation_ping_regions,
        score_rows=evidence.foundation_score_rows
    )

    if (
        mode == "single_header_color"
        and color_bands
    ):
        # The second header is inferred from color, so do not require a player
        # row to begin below that synthetic header. In sparse 1v1 layouts the
        # real player row can overlap the inferred header Y-band.
        color_a, color_b = color_bands

        band_pad = int(
            height
            * PREP_FOUNDATION_COLOR_BAND_ROW_PAD_RATIO
        )

        team_1_rows = _select_foundation_team_rows(
            foundation_signals,
            max(
                0,
                int(
                    color_a["top"]
                )
                - band_pad
            ),
            min(
                height,
                int(
                    color_a["bottom"]
                )
                + band_pad
            ),
            players_per_team
        )

        team_2_rows = _select_foundation_team_rows(
            foundation_signals,
            max(
                0,
                int(
                    color_b["top"]
                )
                - band_pad
            ),
            min(
                height,
                int(
                    color_b["bottom"]
                )
                + band_pad
            ),
            players_per_team
        )

    else:
        team_1_rows = _select_foundation_team_rows(
            foundation_signals,
            int(
                header_1[
                    "bottom"
                ]
            ),
            int(
                header_2[
                    "top"
                ]
            ),
            players_per_team
        )

        team_2_zone_bottom = height

        if (
            coarse_color is not None
            and mode == "color_row_fallback"
        ):
            team_2_zone_bottom = min(
                height,
                int(
                    coarse_color.get(
                        "bottom",
                        height
                    )
                )
                + int(
                    height
                    * PREP_FOUNDATION_COLOR_ROW_SEARCH_PAD_RATIO
                )
            )

        team_2_rows = _select_foundation_team_rows(
            foundation_signals,
            int(
                header_2[
                    "bottom"
                ]
            ),
            team_2_zone_bottom,
            players_per_team
        )
    if (
        len(team_1_rows) != players_per_team
        or len(team_2_rows) != players_per_team
    ):
        return None

    row_centers = [
        int(item["center_y"])
        for item in team_1_rows + team_2_rows
    ]
    row_spacing = _foundation_row_spacing(
        team_1_rows, team_2_rows, header_1, header_2
    )
    top = max(
        0,
        int(round(
            float(header_1["top"])
            - row_spacing
            * PREP_FOUNDATION_HEADER_TOP_ROW_PADDING
        ))
    )

    bottom = min(
        height,
        int(round(
            max(
                row_centers
            )
            + row_spacing
            * PREP_FOUNDATION_LAST_ROW_BOTTOM_PADDING
        ))
    )

    if (
        coarse_color is not None
        and mode in {
            "single_header_color",
            "color_row_fallback"
        }
    ):
        color_top = int(
            coarse_color.get(
                "top",
                top
            )
        )

        color_bottom = int(
            coarse_color.get(
                "bottom",
                bottom
            )
        )

        top = max(
            0,
            min(
                int(
                    header_1.get(
                        "top",
                        color_top
                    )
                ),
                color_top
            )
            - int(
                height
                * PREP_FOUNDATION_COLOR_VERTICAL_TOP_PAD_RATIO
            )
        )

        bottom = min(
            height,
            max(
                color_bottom
                + int(
                    height
                    * PREP_FOUNDATION_COLOR_VERTICAL_BOTTOM_PAD_RATIO
                ),
                max(
                    row_centers
                )
                + int(
                    max(
                        8.0,
                        row_spacing
                        * 0.45
                    )
                )
            )
        )
    if bottom <= top:
        return None

    row_coverage = min(1.0, len(row_centers) / max(expected_players, 1))
    confidence = _foundation_confidence(
        mode, pair_score, row_coverage, color_support
    )
    foundation = {
        "left": int(left),
        "top": int(top),
        "right": int(right),
        "bottom": int(bottom),
        "confidence": round(max(0.0, min(1.0, float(confidence))), 4),
        "mode": mode,
        "headerPairScore": round(float(pair_score), 4),
        "colorSupportScore": round(float(color_support), 4),
        "rowCoverage": round(float(row_coverage), 4),
        "teamBoundaryY": int(round(
            (float(header_1["bottom"]) + float(header_2["top"])) / 2.0
        )),
        "team1": {
            "header": header_1,
            "rowCenters": [int(item["center_y"]) for item in team_1_rows]
        },
        "team2": {
            "header": header_2,
            "rowCenters": [int(item["center_y"]) for item in team_2_rows]
        },
        "rowSpacing": round(float(row_spacing), 2),
        "detectedFoundationRows": len(row_centers),
        "foundationStatSignals": len(foundation_rows),
        "foundationPingSignals": len(
            evidence.foundation_ping_regions or []
        ),
        "foundationScoreSignals": len(
            evidence.foundation_score_rows or []
        ),
        "foundationSignalRows": [
            {
                "centerY": round(
                    float(item.get("center_y", 0.0) or 0.0),
                    2
                ),
                "sources": list(item.get("signal_sources") or [])
            }
            for item in foundation_signals
        ],
        "expectedPlayers": expected_players,
        "headerRowsDetected": len(header_rows),
        "headerRows": header_rows,
        "colorCandidate": coarse_color,
        "adaptiveXBounds": adaptive_x_bounds,
        "evidenceVersion": EVIDENCE_VERSION
    }
    evidence.set_value("foundation", foundation)
    return foundation

def auto_align_scoreboard(
    image,
    players_per_team,
    expected_names=None
):
    """Locate once, normalize once, and reuse one ROI evidence graph."""
    if image is None or image.size == 0:
        return None

    original_height, original_width = image.shape[:2]

    scan_image, scan_scale = resize_for_preflight_scan(
        image
    )
    scan_evidence = ScoreboardEvidence(
        players_per_team=int(players_per_team),
        expected_names=list(expected_names or []),
        image=scan_image,
        coordinate_space="localization_scan"
    )

    foundation = detect_scoreboard_foundation(
        scan_image,
        players_per_team,
        evidence=scan_evidence
    )

    if foundation is None:
        return None

    if (
        float(
            foundation.get(
                "confidence",
                0.0
            )
            or 0.0
        )
        < PREP_FOUNDATION_MIN_CONFIDENCE
    ):
        return None

    left = int(
        foundation["left"]
    )
    right = int(
        foundation["right"]
    )
    top = int(
        foundation["top"]
    )
    bottom = int(
        foundation["bottom"]
    )

    candidate_image = scan_image[
        top:bottom,
        left:right
    ]

    if (
        candidate_image is None
        or candidate_image.size == 0
    ):
        return None

    normalized, normalize_scale = normalize_scoreboard_image(
        candidate_image,
        players_per_team=players_per_team
    )

    alignment_info = {
        "mode": "canonical_foundation",
        "scanScale": scan_scale,
        "normalizeScale": normalize_scale,
        "foundation": foundation
    }

    roi_evidence = ScoreboardEvidence(
        players_per_team=int(players_per_team),
        expected_names=list(expected_names or []),
        image=normalized,
        coordinate_space="normalized_localized_roi",
        normalize_scale=normalize_scale,
        alignment_info=alignment_info
    )

    roi_evidence = build_roi_evidence(
        normalized,
        players_per_team,
        expected_names=expected_names,
        alignment_info=alignment_info,
        evidence=roi_evidence,
        use_ocr_probes=False
    )

    expected_players = int(
        players_per_team
    ) * 2

    direct_anchor_count = sum(
        1
        for anchor in roi_evidence.row_anchors
        if anchor.get(
            "type"
        )
        != "inferred"
    )
    confirmed_anchor_count = sum(
        1
        for anchor in roi_evidence.row_anchors
        if (
            anchor.get("type") != "inferred"
            or anchor.get("inferred_row_confirmed") is True
        )
    )
    direct_teams = {
        int(
            anchor.get("team_index")
            or (
                1
                if int(anchor.get("player_index", 1) or 1)
                <= int(players_per_team)
                else 2
            )
        )
        for anchor in roi_evidence.row_anchors
        if anchor.get("type") != "inferred"
    }
    stat_count = sum(
        1
        for anchor in roi_evidence.row_anchors
        if anchor.get(
            "has_stat_anchor"
        )
        is True
    )
    ping_count = sum(
        1
        for anchor in roi_evidence.row_anchors
        if anchor.get(
            "has_ping_anchor"
        )
        is True
    )

    if (
        PREP_FOUNDATION_REQUIRE_DIRECT_ROW_PER_TEAM
        and (
            confirmed_anchor_count != expected_players
            or direct_anchor_count < 2
            or not {1, 2}.issubset(direct_teams)
        )
    ):
        return None

    inverse_scan_scale = (
        1.0
        / max(
            scan_scale,
            1e-6
        )
    )

    source_left = max(
        0,
        min(
            original_width - 1,
            int(
                round(
                    left
                    * inverse_scan_scale
                )
            )
        )
    )
    source_right = max(
        source_left + 1,
        min(
            original_width,
            int(
                round(
                    right
                    * inverse_scan_scale
                )
            )
        )
    )
    source_top = max(
        0,
        min(
            original_height - 1,
            int(
                round(
                    top
                    * inverse_scan_scale
                )
            )
        )
    )
    source_bottom = max(
        source_top + 1,
        min(
            original_height,
            int(
                round(
                    bottom
                    * inverse_scan_scale
                )
            )
        )
    )

    validator_ratio = min(
        1.0,
        (
            direct_anchor_count * 0.70
            + confirmed_anchor_count * 0.30
        )
        / max(
            expected_players,
            1
        )
    )

    bounds_confidence = max(
        0.0,
        min(
            1.0,
            float(
                foundation.get(
                    "confidence",
                    0.0
                )
                or 0.0
            )
            * 0.68
            + validator_ratio
            * 0.32
        )
    )

    return {
        "score": round(
            bounds_confidence
            * 1000.0,
            3
        ),
        "image": normalized,
        "_evidence": roi_evidence,
        "sourceBounds": {
            "x": source_left,
            "y": source_top,
            "width": (
                source_right
                - source_left
            ),
            "height": (
                source_bottom
                - source_top
            )
        },
        "scanScale": scan_scale,
        "normalizeScale": normalize_scale,
        "confirmedRows": confirmed_anchor_count,
        "directRows": direct_anchor_count,
        "detectedRows": len(
            roi_evidence.row_anchors
        ),
        "detectedPingRegions": ping_count,
        "detectedStatRows": stat_count,
        "boundsConfidence": round(
            float(
                bounds_confidence
            ),
            4
        ),
        "teamStructure": dict(
            roi_evidence.team_structure
            or {}
        ),
        "locator": "canonical_foundation",
        "foundation": foundation,
        "colorCandidate": foundation.get(
            "colorCandidate"
        ),
        "evidenceReuse": {
            "scan": dict(
                scan_evidence.compute_counts
            ),
            "roi": dict(
                roi_evidence.compute_counts
            )
        }
    }

def localize_scoreboard(
    image,
    players_per_team
):
    if image is None or image.size == 0:
        return {
            "pass": False,
            "stage": "image",
            "reason": "No image was provided."
        }

    if players_per_team not in {1, 2, 3, 4}:
        return {
            "pass": False,
            "stage": "match_size",
            "reason": "players_per_team must be 1, 2, 3, or 4."
        }

    height, width = image.shape[:2]
    aligned = auto_align_scoreboard(
        image,
        players_per_team,
        expected_names=None
    )

    if aligned is None:
        return {
            "pass": False,
            "stage": "localization",
            "reason": (
                "The canonical scoreboard foundation could not be confirmed from both team panels and player-row structure. Use the manual crop box."
            )
        }

    bounds = aligned["sourceBounds"]
    normalized_bounds = {
        "x": bounds["x"] / max(width, 1),
        "y": bounds["y"] / max(height, 1),
        "width": bounds["width"] / max(width, 1),
        "height": bounds["height"] / max(height, 1)
    }

    return {
        "pass": True,
        "stage": "complete",
        "locator": aligned.get(
            "locator",
            "structural_geometry"
        ),
        "bounds": {
            key: round(float(value), 6)
            for key, value in normalized_bounds.items()
        },
        "sourceBounds": bounds,
        "boundsConfidence": aligned.get(
            "boundsConfidence",
            0.0
        ),
        "detectedRows": aligned.get(
            "detectedRows",
            0
        ),
        "detectedPingRegions": aligned.get(
            "detectedPingRegions",
            0
        ),
        "detectedStatRows": aligned.get(
            "detectedStatRows",
            0
        ),
        "teamStructure": aligned.get(
            "teamStructure",
            {}
        ),
        "colorCandidate": aligned.get(
            "colorCandidate"
        ),
        "foundation": aligned.get(
            "foundation"
        ),
        "scanScale": aligned.get(
            "scanScale",
            1.0
        )
    }

def _validate_team_constrained_preflight_names(
    row_anchors,
    expected_names,
    players_per_team
):
    if not PREP_REQUIRE_EXPECTED_ROSTER_MATCH:
        return {"pass": True, "matches": []}

    expected = normalize_expected_names(expected_names)
    if len(expected) != players_per_team * 2:
        return {"pass": False, "reason": "expected_roster_count_mismatch"}

    anchors = sorted(
        row_anchors or [],
        key=lambda item: int(item.get("physical_row_index", item.get("player_index", 0)))
    )
    if len(anchors) != len(expected):
        return {"pass": False, "reason": "row_count_mismatch"}

    all_matches = []
    for team_index in (1, 2):
        team_anchors = [
            item for item in anchors
            if int(item.get("team_index", 0) or 0) == team_index
        ]
        team_expected = expected[
            (team_index - 1) * players_per_team:
            team_index * players_per_team
        ]
        if len(team_anchors) != players_per_team:
            return {"pass": False, "reason": "team_row_count_mismatch", "team": team_index}

        score_matrix = []
        read_matrix = []
        for anchor in team_anchors:
            probe = anchor.get("probe") or {}
            reads = [
                str(value).strip()
                for value in (probe.get("usernames") or [])
                if len(normalize_name_for_match(value)) >= PREP_ROSTER_NAME_MIN_READ_LENGTH
            ]
            read_matrix.append(reads)
            scores = []
            for expected_name in team_expected:
                score = 0.0
                for read in reads:
                    score = max(
                        score,
                        fuzzy_name_score(read, expected_name)
                    )
                scores.append(float(score))
            score_matrix.append(scores)

        if any(not reads for reads in read_matrix):
            return {
                "pass": True,
                "deferred": True,
                "reason": "insufficient_preflight_name_reads",
                "team": team_index,
                "expectedNames": team_expected,
                "reads": read_matrix
            }

        best = None
        for assignment in permutations(range(players_per_team)):
            scores = [
                score_matrix[row_index][expected_index]
                for row_index, expected_index in enumerate(assignment)
            ]
            minimum = min(scores) if scores else 0.0
            total = sum(scores)
            key = (minimum, total)
            if best is None or key > best[0]:
                best = (key, assignment, scores)

        if best is None:
            return {
                "pass": True,
                "deferred": True,
                "reason": "preflight_name_assignment_unavailable",
                "team": team_index,
                "expectedNames": team_expected,
                "reads": read_matrix
            }

        minimum_score = min(best[2], default=0.0)
        if minimum_score < PREP_ROSTER_NAME_MIN_SCORE:
            # Only reject at preflight when readable OCR is strongly inconsistent
            # with every expected name on that team. Ambiguous OCR is deferred to
            # the full Tesseract/Paddle pipeline, whose final roster gate remains
            # authoritative.
            if minimum_score <= PREP_ROSTER_STRONG_MISMATCH_MAX_SCORE:
                return {
                    "pass": False,
                    "reason": "strong_expected_player_name_mismatch",
                    "team": team_index,
                    "expectedNames": team_expected,
                    "reads": read_matrix,
                    "bestScores": [round(float(v), 2) for v in best[2]]
                }
            return {
                "pass": True,
                "deferred": True,
                "reason": "ambiguous_preflight_name_match",
                "team": team_index,
                "expectedNames": team_expected,
                "reads": read_matrix,
                "bestScores": [round(float(v), 2) for v in best[2]]
            }

        for row_index, expected_index in enumerate(best[1]):
            all_matches.append({
                "team": team_index,
                "row": row_index + 1,
                "expected": team_expected[expected_index],
                "reads": read_matrix[row_index],
                "score": round(float(best[2][row_index]), 2)
            })

    return {"pass": True, "matches": all_matches}

def _run_preflight_on_aligned_image(
    image,
    players_per_team,
    expected_names,
    alignment_info=None,
    evidence=None
):
    """Structural preflight. Names are not a hard gate here."""
    height, width = image.shape[:2]
    expected_players = players_per_team * 2
    dimension_limits = get_preflight_dimension_limits(
        players_per_team
    )

    if (
        width < dimension_limits["min_width"]
        or height < dimension_limits["min_height"]
    ):
        return {
            "pass": False,
            "reason": (
                "The scoreboard region is too small for reliable OCR. "
                "Use the manual crop box and keep every player row visible."
            ),
            "stage": "dimensions",
            "width": width,
            "height": height,
            "requiredMinimum": {
                "width": dimension_limits["min_width"],
                "height": dimension_limits["min_height"]
            },
            "autoAlignment": alignment_info
        }

    aspect_ratio = width / max(height, 1)

    if (
        aspect_ratio < dimension_limits["min_aspect"]
        or aspect_ratio > dimension_limits["max_aspect"]
    ):
        return {
            "pass": False,
            "reason": (
                "The detected scoreboard region has an unusual shape. "
                "Use the manual crop box around the complete scoreboard."
            ),
            "stage": "dimensions",
            "aspectRatio": round(aspect_ratio, 3),
            "expectedRange": [
                dimension_limits["min_aspect"],
                dimension_limits["max_aspect"]
            ],
            "autoAlignment": alignment_info
        }

    # Build/reuse one evidence graph for this normalized ROI.
    evidence = build_roi_evidence(
        image,
        players_per_team,
        expected_names=expected_names,
        alignment_info=alignment_info,
        evidence=evidence,
        use_ocr_probes=False
    )
    stat_regions = evidence.stat_regions
    ping_regions = evidence.ping_regions
    row_anchors = evidence.row_anchors
    team_structure = evidence.team_structure

    # Strict structural contract: every expected row must be directly supported,
    # assigned to the correct physical team, and the submitted roster must match
    # within that team. A later OCR pass may refine fields, but it may not repair
    # a wrong scoreboard/player/team selection.
    if PREP_REQUIRE_TEAM_ASSIGNMENT:
        team_counts = {
            1: sum(1 for a in row_anchors if int(a.get("team_index", 0) or 0) == 1),
            2: sum(1 for a in row_anchors if int(a.get("team_index", 0) or 0) == 2)
        }
        if team_counts.get(1) != players_per_team or team_counts.get(2) != players_per_team:
            return {
                "pass": False,
                "reason": "The detected player rows could not be locked to the expected two-team layout.",
                "stage": "team_assignment",
                "teamCounts": team_counts,
                "expectedPerTeam": players_per_team,
                "teamStructure": team_structure,
                "autoAlignment": alignment_info
            }

    roster_validation = _validate_team_constrained_preflight_names(
        row_anchors,
        expected_names,
        players_per_team
    )
    if roster_validation.get("pass") is not True:
        return {
            "pass": False,
            "reason": "The scoreboard player names do not match the submitted roster for the detected teams.",
            "stage": "expected_roster_match",
            "rosterValidation": roster_validation,
            "teamStructure": team_structure,
            "autoAlignment": alignment_info
        }

    direct_anchor_count = sum(
        1
        for anchor in row_anchors
        if anchor.get("type") != "inferred"
    )

    confirmed_player_row_count = sum(
        1
        for anchor in row_anchors
        if (
            anchor.get(
                "type"
            )
            != "inferred"
            or anchor.get(
                "inferred_row_confirmed"
            )
            is True
        )
    )
    ping_stat_count = sum(
        1
        for anchor in row_anchors
        if anchor.get("type") == "ping_stat"
    )
    ping_anchor_count = sum(
        1
        for anchor in row_anchors
        if anchor.get("has_ping_anchor") is True
    )

    if (
        PREP_REQUIRE_ALL_DIRECT_ROWS
        and confirmed_player_row_count
        != expected_players
    ):
        return {
            "pass": False,
            "reason": (
                "One or more expected player rows had neither a direct "
                "PING/stat anchor nor a probe-confirmed player row."
            ),
            "stage": "player_rows",
            "directAnchorRows": direct_anchor_count,
            "confirmedPlayerRows": confirmed_player_row_count,
            "expectedRows": expected_players,
            "teamStructure": team_structure,
            "rosterValidation": roster_validation,
            "autoAlignment": alignment_info
        }
    stat_anchor_count = sum(
        1
        for anchor in row_anchors
        if anchor.get("has_stat_anchor") is True
    )

    if len(row_anchors) != expected_players:
        return {
            "pass": False,
            "reason": (
                "The expected physical player-row layout could not be "
                "reconstructed from ping/stat geometry."
            ),
            "stage": "player_rows",
            "generatedRows": len(row_anchors),
            "expectedRows": expected_players,
            "directAnchorRows": direct_anchor_count,
            "detectedPingRegions": len(ping_regions),
            "detectedStatRows": len(stat_regions),
            "teamStructure": team_structure,
            "autoAlignment": alignment_info,
            "debugEvidence": {
                "rowAnchors": row_anchors,
                "pingRegions": ping_regions,
                "statRegions": stat_regions
            }
        }

    header_rows = evidence.header_rows
    header_summary = evidence.header_summary
    middle_stat_name = header_summary["middleStat"]
    header_1 = header_summary["variation1"]
    header_2 = header_summary["variation2"]
    combined_header = header_summary["headerText"]
    header_hits = header_summary["headerHits"]

    color_grouping = (
        team_structure.get("method") == "color"
    )
    structural_evidence_pass = (
        direct_anchor_count >= max(
            1,
            players_per_team
        )
        or (
            color_grouping
            and direct_anchor_count >= 1
        )
        or (
            header_hits >= PREFLIGHT_MINIMUM_HEADER_HITS
            and direct_anchor_count >= 1
        )
    )

    if not structural_evidence_pass:
        return {
            "pass": False,
            "reason": (
                "The row layout was inferable, but there was not enough direct "
                "scoreboard evidence to safely start full OCR."
            ),
            "stage": "player_rows",
            "generatedRows": len(row_anchors),
            "expectedRows": expected_players,
            "directAnchorRows": direct_anchor_count,
            "detectedPingRegions": len(ping_regions),
            "detectedStatRows": len(stat_regions),
            "headerHits": header_hits,
            "teamStructure": team_structure,
            "autoAlignment": alignment_info,
            "debugEvidence": {
                "rowAnchors": row_anchors,
                "pingRegions": ping_regions,
                "statRegions": stat_regions
            }
        }

    anchor_confidences = [
        float(anchor.get("confidence", 0.0) or 0.0) * 100.0
        for anchor in row_anchors
    ]
    average_anchor_score = (
        sum(anchor_confidences) / len(anchor_confidences)
        if anchor_confidences
        else 0.0
    )
    minimum_anchor_score = (
        min(anchor_confidences)
        if anchor_confidences
        else 0.0
    )
    ping_confidence = min(
        100.0,
        ping_anchor_count / max(expected_players, 1) * 100.0
    )
    stat_confidence = min(
        100.0,
        stat_anchor_count / max(expected_players, 1) * 100.0
    )
    header_confidence = min(
        100.0,
        header_hits / max(PREFLIGHT_MINIMUM_HEADER_HITS, 1) * 100.0
    )
    team_confidence = (
        100.0
        if color_grouping
        else min(
            90.0,
            float(team_structure.get("spacingRatio", 0.0) or 0.0)
            / 1.6
            * 90.0
        )
    )
    preflight_confidence = round(
        average_anchor_score * 0.30
        + minimum_anchor_score * 0.15
        + ping_confidence * 0.15
        + stat_confidence * 0.20
        + team_confidence * 0.15
        + header_confidence * 0.05,
        2
    )

    warnings = []
    if ping_anchor_count < expected_players:
        warnings.append(
            "one_or_more_ping_anchors_missing"
        )
    if not color_grouping:
        warnings.append(
            "team_grouping_used_vertical_spacing"
        )
    if header_hits < PREFLIGHT_MINIMUM_HEADER_HITS:
        warnings.append(
            "header_text_not_strongly_confirmed"
        )

    return {
        "pass": True,
        "reason": "structural_preflight_passed",
        "stage": "complete",
        "matchSize": f"{players_per_team}v{players_per_team}",
        "width": width,
        "height": height,
        "aspectRatio": round(aspect_ratio, 3),
        "detectedPingRegions": len(ping_regions),
        "detectedStatRows": len(stat_regions),
        "detectedRows": len(row_anchors),
        "directAnchorRows": direct_anchor_count,
        "pingStatRows": ping_stat_count,
        "preflightConfidence": preflight_confidence,
        "preflightConfidenceComponents": {
            "averageAnchorScore": round(average_anchor_score, 2),
            "minimumAnchorScore": round(minimum_anchor_score, 2),
            "pingConfidence": round(ping_confidence, 2),
            "statConfidence": round(stat_confidence, 2),
            "teamConfidence": round(team_confidence, 2),
            "headerConfidence": round(header_confidence, 2)
        },
        "warnings": warnings,
        "headerHits": header_hits,
        "headerText": combined_header,
        "middleStat": middle_stat_name,
        "autoAlignment": alignment_info,
        "teamStructure": team_structure,
        "rosterValidation": roster_validation,
        "preparedData": evidence.prepared_data(),
        "_evidenceContext": evidence
    }

def high_level_img_chk(
    image,
    players_per_team,
    expected_player_names=None
):
    if image is None or image.size == 0:
        return {
            "pass": False,
            "reason": (
                "No image was provided. Upload a Rocket League scoreboard and try again."
            ),
            "stage": "image"
        }

    if players_per_team not in {1, 2, 3, 4}:
        return {
            "pass": False,
            "reason": "Incorrect number of players per team.",
            "stage": "match_size"
        }

    roster_contract = validate_expected_roster(
        expected_player_names,
        players_per_team
    )
    expected_players = roster_contract[
        "expectedPlayers"
    ]
    expected_names = roster_contract[
        "names"
    ]

    if not roster_contract["valid"]:
        return {
            "pass": False,
            "reason": (
                "The submitted expected-player roster is missing, duplicated, "
                "or does not match the selected match size."
            ),
            "stage": "expected_roster",
            "expectedPlayers": expected_players,
            "submittedExpectedNames": expected_names,
            "submittedExpectedNameCount": len(expected_names)
        }

    # The browser normally sends a scoreboard ROI. Try that coordinate space
    # first so detailed row anchors are generated against the same image later.
    normalized, normalize_scale = normalize_scoreboard_image(
        image,
        players_per_team=players_per_team
    )
    direct_alignment = {
        "mode": "submitted_roi",
        "normalizeScale": normalize_scale,
        "sourceBounds": {
            "x": 0,
            "y": 0,
            "width": int(image.shape[1]),
            "height": int(image.shape[0])
        }
    }
    direct_evidence = ScoreboardEvidence(
        players_per_team=int(players_per_team),
        expected_names=list(expected_names),
        image=normalized,
        coordinate_space="normalized_submitted_roi",
        normalize_scale=normalize_scale,
        alignment_info=direct_alignment
    )
    direct_result = _run_preflight_on_aligned_image(
        normalized,
        players_per_team,
        expected_names,
        direct_alignment,
        evidence=direct_evidence
    )

    if direct_result.get("pass") is True:
        direct_result["preparedImageSize"] = {
            "width": int(normalized.shape[1]),
            "height": int(normalized.shape[0])
        }
        direct_result["_preparedImage"] = normalized
        return direct_result

    # Compatibility fallback for direct API users that still submit a full
    # screenshot or a loose manual crop. This localization remains structural.
    auto_alignment = auto_align_scoreboard(
        image,
        players_per_team,
        expected_names=expected_names
    )

    if auto_alignment is None:
        direct_result["fallbackAttempted"] = True
        direct_result["fallbackAvailable"] = False
        direct_result["_debugImage"] = normalized
        return direct_result

    aligned_image = auto_alignment["image"]
    aligned_evidence = auto_alignment.get(
        "_evidence"
    )
    alignment_info = {
        key: value
        for key, value in auto_alignment.items()
        if key not in {
            "image",
            "_evidence"
        }
    }
    alignment_info["mode"] = "structural_auto_align_fallback"

    result = _run_preflight_on_aligned_image(
        aligned_image,
        players_per_team,
        expected_names,
        alignment_info,
        evidence=aligned_evidence
    )
    result["preparedImageSize"] = {
        "width": int(aligned_image.shape[1]),
        "height": int(aligned_image.shape[0])
    }

    if result.get("pass") is True:
        result["_preparedImage"] = aligned_image
    else:
        result["_debugImage"] = aligned_image
        result["submittedRoiFailure"] = {
            key: value
            for key, value in direct_result.items()
            if not str(key).startswith("_")
        }

    return result

def prepare_scoreboard(
    image,
    players_per_team,
    expected_player_names=None
):
    return high_level_img_chk(
        image,
        players_per_team,
        expected_player_names
    )
