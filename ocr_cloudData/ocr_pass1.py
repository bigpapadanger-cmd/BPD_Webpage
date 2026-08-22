import os
import re
import shutil

import cv2
import numpy as np
import pytesseract
from pytesseract import Output

from ocr_layout import (
    NUMBER_LIMITS,
    ROW_NUMERIC_FALLBACK_HALF_RATIO,
    ROW_NUMERIC_MIN_HALF_PX,
    ROW_STAT_REGION_PAD_RATIO,
    ROW_STAT_REGION_MIN_PAD_PX,
    ROW_USERNAME_TOP_RATIO,
    ROW_USERNAME_BOTTOM_RATIO,
    ROW_TITLE_TOP_RATIO,
    ROW_TITLE_BOTTOM_RATIO,
    NUMERIC_CELL_INNER_GUTTER_RATIO,
    NUMERIC_CELL_MIN_GUTTER_PX,
    NUMERIC_CELL_MIN_WIDTH_PX,
    IDENTITY_TEXT_LEFT_INSET_RATIO,
    IDENTITY_TEXT_LEFT_EXTRA_SHIFT_SPACING_RATIO,
    IDENTITY_FIXED_USERNAME_TOP_RATIO,
    IDENTITY_FIXED_USERNAME_BOTTOM_RATIO,
    IDENTITY_TEXT_RIGHT_GAP_RATIO,
    PING_DIRECT_PAD_X_RATIO,
    PING_DIRECT_PAD_Y_RATIO,
    PING_DIRECT_MIN_PAD_X_PX,
    PING_DIRECT_MIN_PAD_Y_PX,
    SHOTS_CELL_INNER_SHRINK_RATIO,
    IDENTITY_TITLE_RIGHT_SHRINK_RATIO,
    SHOTS_CELL_X_SHIFT_RATIO,
    IDENTITY_PARTY_ICON_EXCLUDE_ENABLED,
    IDENTITY_PARTY_ICON_HUE_MIN,
    IDENTITY_PARTY_ICON_HUE_MAX,
    IDENTITY_PARTY_ICON_SAT_MIN,
    IDENTITY_PARTY_ICON_VALUE_MIN,
    IDENTITY_PARTY_ICON_MIN_AREA_RATIO,
    IDENTITY_PARTY_ICON_MAX_AREA_RATIO,
    IDENTITY_MVP_ICON_EXCLUDE_ENABLED,
    IDENTITY_MVP_ICON_HUE_MIN,
    IDENTITY_MVP_ICON_HUE_MAX,
    IDENTITY_MVP_ICON_SAT_MIN,
    IDENTITY_MVP_ICON_VALUE_MIN,
    IDENTITY_MVP_ICON_MIN_AREA_RATIO,
    IDENTITY_MVP_ICON_MAX_AREA_RATIO,
    IDENTITY_ICON_EDGE_PAD_RATIO,
    IDENTITY_ICON_EDGE_PAD_MIN_PX,
    IDENTITY_ICON_SEARCH_HALF_SPACING_RATIO,
    IDENTITY_PARTY_ICON_SEARCH_HALF_SPACING_RATIO,
    IDENTITY_MVP_ICON_SEARCH_HALF_SPACING_RATIO,
    IDENTITY_MVP_ICON_MAX_WIDTH_SPACING_RATIO,
    IDENTITY_PARTY_ICON_MAX_WIDTH_SPACING_RATIO,
    IDENTITY_ICON_SEARCH_MIN_HALF_PX,
    IDENTITY_MVP_MAX_TARGET_DISTANCE_SPACING_RATIO,
    IDENTITY_MVP_MIN_SIZE_SPACING_RATIO,
    IDENTITY_PARTY_TARGET_NAME_RATIO,
    IDENTITY_MVP_TARGET_RIGHT_SHIFT_RATIO,
    IDENTITY_TITLE_PROBE_TOP_INSET_RATIO,
    IDENTITY_TITLE_PROBE_BOTTOM_INSET_RATIO,
    IDENTITY_TITLE_RESIDUAL_THRESHOLD,
    IDENTITY_TITLE_MIN_GLYPH_COMPONENTS,
    IDENTITY_TITLE_MIN_GLYPH_HEIGHT_RATIO,
    IDENTITY_TITLE_MAX_GLYPH_HEIGHT_RATIO,
    IDENTITY_TITLE_MAX_GLYPH_WIDTH_RATIO,
    IDENTITY_TITLE_MIN_GLYPH_AREA_PX,
    IDENTITY_TITLE_MIN_FOREGROUND_RATIO,
    IDENTITY_NO_TITLE_USERNAME_HALF_HEIGHT_RATIO,
    IDENTITY_NO_TITLE_USERNAME_MIN_HALF_PX,
    IDENTITY_ROW_HALF_HEIGHT_RATIO,
    IDENTITY_CENTER_USERNAME_HALF_HEIGHT_RATIO,
    IDENTITY_TEXT_LINE_RESIDUAL_THRESHOLD,
    IDENTITY_TEXT_LINE_MIN_COMPONENTS,
    IDENTITY_TEXT_LINE_MIN_HEIGHT_SPACING_RATIO,
    IDENTITY_TEXT_LINE_MAX_HEIGHT_SPACING_RATIO,
    IDENTITY_TEXT_LINE_MAX_COMPONENT_WIDTH_RATIO,
    IDENTITY_TEXT_LINE_MIN_SPAN_RATIO,
    IDENTITY_TEXT_LINE_CLUSTER_GAP_SPACING_RATIO,
    IDENTITY_TEXT_LINE_CROP_PAD_SPACING_RATIO,
    STAT_VALUE_LEFT_SHIFT_RATIOS,
    IDENTITY_USERNAME_NUMBER_BAND_PAD_RATIO,
    IDENTITY_MVP_MIN_NUMBER_BAND_RATIO,
    IDENTITY_INFERRED_USERNAME_TOP_EXTRA_RATIO,
    IDENTITY_INFERRED_NUMERIC_EXTRA_PAD_RATIO
)
from ocr_text import clean_text, uppercase_text, parse_clan_username

PASS1_VERSION = "pass1-v2.5-mvp-shape-guard-username-only"

TESSERACT_PATH = (
    os.getenv("TESSERACT_CMD")
    or shutil.which("tesseract")
    or r"C:\Program Files\Tesseract-OCR\tesseract.exe"
)
pytesseract.pytesseract.tesseract_cmd = TESSERACT_PATH


# ============================================================
# OPTIONAL PASS 1 SHARPENING
# Conservative local unsharp mask applied only to isolated OCR
# coordinate crops. The original crop is still read unchanged.
# ============================================================

OCR_CROP_SHARPEN_ENABLED = True
OCR_CROP_SHARPEN_AMOUNT = 1.25
OCR_CROP_SHARPEN_SIGMA = 1.1

OCR_SHARPEN_FIELDS = {
    "username",
    "score",
    "goals",
    "assists",
    "demos",
    "saves",
    "shots",
}


def sharpen_crop(image, amount=OCR_CROP_SHARPEN_AMOUNT, blur_sigma=OCR_CROP_SHARPEN_SIGMA):
    if image is None or image.size == 0:
        return image

    blurred = cv2.GaussianBlur(
        image,
        (0, 0),
        float(blur_sigma)
    )

    return cv2.addWeighted(
        image,
        float(amount),
        blurred,
        -(float(amount) - 1.0),
        0
    )


def crop_safe(image, x1, y1, x2, y2):
    if image is None or image.size == 0:
        return None
    height, width = image.shape[:2]
    x1 = max(0, min(width, int(round(x1))))
    y1 = max(0, min(height, int(round(y1))))
    x2 = max(0, min(width, int(round(x2))))
    y2 = max(0, min(height, int(round(y2))))
    if x2 <= x1 or y2 <= y1:
        return None
    return image[y1:y2, x1:x2]


def crop_from_ref(image, coordinate_ref, expand_x=0.0, expand_y=0.0, shift_x=0.0, shift_y=0.0):
    ref = coordinate_ref if isinstance(coordinate_ref, dict) else {}
    x1 = float(ref.get("left", 0))
    x2 = float(ref.get("right", 0))
    y1 = float(ref.get("top", 0))
    y2 = float(ref.get("bottom", 0))
    width = max(1.0, x2 - x1)
    height = max(1.0, y2 - y1)
    dx = width * float(expand_x)
    dy = height * float(expand_y)
    sx = width * float(shift_x)
    sy = height * float(shift_y)
    return crop_safe(image, x1 - dx + sx, y1 - dy + sy, x2 + dx + sx, y2 + dy + sy)


def region_has_content(crop):
    """Cheap visual check used before any OCR engine is invoked."""
    if crop is None or crop.size == 0:
        return {
            "present": False,
            "contrast": 0.0,
            "edgeRatio": 0.0,
            "brightRatio": 0.0,
            "score": 0.0,
        }
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY) if crop.ndim == 3 else crop
    p10, p90 = np.percentile(gray, [10, 90])
    contrast = float(p90 - p10)
    edges = cv2.Canny(gray, 70, 160)
    edge_ratio = float(np.count_nonzero(edges)) / max(1, edges.size)
    bright_cut = max(145.0, float(np.percentile(gray, 78)))
    bright_ratio = float(np.count_nonzero(gray >= bright_cut)) / max(1, gray.size)
    score = min(1.0, contrast / 75.0) * 0.50 + min(1.0, edge_ratio / 0.08) * 0.35 + min(1.0, bright_ratio / 0.10) * 0.15
    return {
        "present": bool(score >= 0.22 and (contrast >= 18 or edge_ratio >= 0.012)),
        "contrast": round(contrast, 2),
        "edgeRatio": round(edge_ratio, 4),
        "brightRatio": round(bright_ratio, 4),
        "score": round(score, 4),
    }


def _numeric_band_from_anchor(image_height, row_anchor):
    center_y = float(row_anchor.get("center_y", 0.0) or 0.0)
    row_spacing = max(36.0, float(row_anchor.get("row_spacing", 58.0) or 58.0))
    center_source = "row_anchor"

    ping_region = row_anchor.get("ping_region")
    if isinstance(ping_region, (list, tuple)) and len(ping_region) >= 4:
        ping_center = float(ping_region[1]) + float(ping_region[3]) / 2.0
        # Ping is the preferred baseline because it is the right-most stat in the
        # same physical row and is usually visually isolated.
        center_y = ping_center
        center_source = "ping_region"

    stat_region = row_anchor.get("stat_region")
    stat_box = stat_region.get("region") if isinstance(stat_region, dict) else None
    if isinstance(stat_box, (list, tuple)) and len(stat_box) >= 4:
        stat_top = float(stat_box[1])
        stat_height = max(1.0, float(stat_box[3]))
        stat_center = stat_top + stat_height / 2.0
        # If ping and stat agree, average them to reduce one-pixel detector noise.
        if center_source == "ping_region" and abs(stat_center - center_y) <= max(8.0, row_spacing * 0.10):
            center_y = (center_y + stat_center) / 2.0
            center_source = "ping_stat_average"
        else:
            center_y = stat_center
            center_source = "stat_region"
        pad = max(ROW_STAT_REGION_MIN_PAD_PX, int(round(stat_height * ROW_STAT_REGION_PAD_RATIO)))
        top = int(round(stat_top)) - pad
        bottom = int(round(stat_top + stat_height)) + pad
    else:
        half = max(ROW_NUMERIC_MIN_HALF_PX, int(round(row_spacing * ROW_NUMERIC_FALLBACK_HALF_RATIO)))
        top = int(round(center_y)) - half
        bottom = int(round(center_y)) + half

    top = max(0, min(image_height - 1, int(top)))
    bottom = max(top + 1, min(image_height, int(bottom)))
    return int(round(center_y)), center_source, top, bottom, row_spacing



def _column_center(column_geometry, key):
    item = column_geometry.get(key) or {}
    left = float(item.get("left", 0.0) or 0.0)
    right = float(item.get("right", 0.0) or 0.0)
    center = item.get("centerX")
    if center is None:
        center = (left + right) / 2.0
    return float(center)


def _isolated_numeric_x_bounds(
    image_width,
    column_geometry,
    ping_region=None
):
    """Build non-overlapping numeric cells from physical header centers.

    Detected header centers define horizontal orientation.

    Report-stat value boxes are shifted left relative to those header centers,
    because Rocket League's numeric values sit left of the visual center of
    their corresponding header labels.

    SCORE, MIDDLE_STAT and PING header centers define a fixed horizontal frame.
    A direct player-row PING region is used only for the final PING crop and
    never changes midpoint geometry for SHOTS or any earlier stat.
    """

    keys = (
        "score",
        "goals",
        "middle",
        "saves",
        "shots",
        "ping"
    )

    centers = [
        _column_center(
            column_geometry,
            key
        )
        for key in keys
    ]

    foundation_centers = list(
        centers
    )

    direct_ping_used = False
    direct_ping_center = None

    # ============================================================
    # DIRECT PING OBSERVATION
    # ============================================================
    #
    # IMPORTANT:
    # The SCORE / MIDDLE_STAT / PING HEADER frame is already frozen
    # in column_geometry. A row-level PING detection must never replace
    # centers[-1], because doing so changes the SHOTS/PING midpoint and
    # stretches the SHOTS cell.
    #
    # The direct PING region is retained only for the final PING crop.
    # ============================================================

    if (
        isinstance(
            ping_region,
            (list, tuple)
        )
        and len(ping_region) >= 4
    ):
        ping_x = float(
            ping_region[0]
        )

        ping_width = float(
            ping_region[2]
        )

        direct_ping_center = (
            ping_x
            + ping_width / 2.0
        )

        if (
            direct_ping_center
            > centers[-2]
            and direct_ping_center
            < float(image_width)
        ):
            direct_ping_used = True

    # ============================================================
    # GEOMETRY SAFETY
    # ============================================================

    if any(
        centers[index + 1]
        <= centers[index]
        for index in range(
            len(centers) - 1
        )
    ):
        return {
            key: {
                "left": int(
                    (
                        column_geometry.get(key)
                        or {}
                    ).get(
                        "left",
                        0
                    )
                    or 0
                ),

                "right": int(
                    (
                        column_geometry.get(key)
                        or {}
                    ).get(
                        "right",
                        image_width
                    )
                    or image_width
                ),

                "centerX": round(
                    centers[index],
                    2
                ),

                "foundationCenterX": round(
                    foundation_centers[index],
                    2
                ),

                "anchorCenterX": round(
                    centers[index],
                    2
                ),

                "centerErrorPx": 0.0,

                "source": (
                    "foundation_column_fallback"
                )
            }

            for index, key
            in enumerate(keys)
        }

    # ============================================================
    # MIDPOINT BOUNDARIES BETWEEN HEADER CENTERS
    # ============================================================

    boundaries = [
        (
            centers[index]
            + centers[index + 1]
        ) / 2.0

        for index
        in range(
            len(centers) - 1
        )
    ]

    first_half_gap = (
        centers[1]
        - centers[0]
    ) / 2.0

    last_half_gap = (
        centers[-1]
        - centers[-2]
    ) / 2.0

    outer_left = (
        centers[0]
        - first_half_gap
    )

    outer_right = (
        centers[-1]
        + last_half_gap
    )

    cells = {}

    # ============================================================
    # BUILD CELLS
    # ============================================================

    for index, key in enumerate(keys):

        raw_left = (
            outer_left
            if index == 0
            else boundaries[
                index - 1
            ]
        )

        raw_right = (
            outer_right
            if index == len(keys) - 1
            else boundaries[index]
        )

        raw_left = max(
            0.0,
            raw_left
        )

        raw_right = min(
            float(image_width),
            raw_right
        )

        raw_width = max(
            1.0,
            raw_right - raw_left
        )

        # ========================================================
        # GENERAL INNER GUTTER
        # ========================================================

        gutter = max(
            float(
                NUMERIC_CELL_MIN_GUTTER_PX
            ),

            raw_width
            * float(
                NUMERIC_CELL_INNER_GUTTER_RATIO
            )
        )

        left = int(
            round(
                raw_left
                + gutter
            )
        )

        right = int(
            round(
                raw_right
                - gutter
            )
        )

        # ========================================================
        # HEADER -> VALUE LEFT SHIFT
        #
        # Header positions define orientation, but the actual numeric
        # value sits left of the header's visual center.
        #
        # PING is excluded when a direct physical ping anchor exists.
        # ========================================================

        should_shift_left = (
            key in {
                "score",
                "goals",
                "middle",
                "saves",
                "shots"
            }
        )

        if (
            key == "ping"
            and not direct_ping_used
        ):
            should_shift_left = True

        if should_shift_left:

            cell_width = max(
                1,
                right - left
            )

            shift_ratio = float(
                STAT_VALUE_LEFT_SHIFT_RATIOS.get(
                    key,
                    0.0
                )
            )

            value_shift = int(
                round(
                    cell_width
                    * shift_ratio
                )
            )

            left -= value_shift
            right -= value_shift

        # ========================================================
        # SHOTS-SPECIFIC REFINEMENT
        # ========================================================

        if key == "shots":

            cell_width = max(
                1,
                right - left
            )

            shots_shrink = int(
                round(
                    cell_width
                    * SHOTS_CELL_INNER_SHRINK_RATIO
                )
            )

            left += shots_shrink
            right -= shots_shrink

            cell_width = max(
                1,
                right - left
            )

            shots_shift = int(
                round(
                    cell_width
                    * SHOTS_CELL_X_SHIFT_RATIO
                )
            )

            left += shots_shift
            right += shots_shift

        # ========================================================
        # MINIMUM WIDTH SAFETY
        # ========================================================

        if (
            right - left
            < NUMERIC_CELL_MIN_WIDTH_PX
        ):
            center = (
                centers[index]
            )

            # Preserve the same left-shift behavior if minimum-width
            # reconstruction is required.
            if should_shift_left:
                center -= (
                    NUMERIC_CELL_MIN_WIDTH_PX
                    * STAT_VALUE_LEFT_SHIFT_RATIOS.get(key,0.0)
                )

            half_width = max(
                NUMERIC_CELL_MIN_WIDTH_PX
                / 2.0,

                raw_width
                * 0.40
            )

            left = int(
                round(
                    max(
                        0.0,
                        center - half_width
                    )
                )
            )

            right = int(
                round(
                    min(
                        float(image_width),
                        center + half_width
                    )
                )
            )

        # ========================================================
        # FINAL CLAMP
        # ========================================================

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

        actual_center = (
            left + right
        ) / 2.0

        anchor_center = (
            centers[index]
        )

        source = (
            "score_middle_ping_header_frame"
        )

        if (
            key == "ping"
            and direct_ping_used
        ):
            source = (
                "header_ping_frame_direct_crop_separate"
            )

        # ========================================================
        # FINAL DEBUG / COORDINATE DATA
        # ========================================================

        cells[key] = {
            "left": int(
                left
            ),

            "right": int(
                right
            ),

            "centerX": round(
                actual_center,
                2
            ),

            "foundationCenterX": round(
                foundation_centers[index],
                2
            ),

            "anchorCenterX": round(
                anchor_center,
                2
            ),

            "centerErrorPx": round(
                actual_center
                - anchor_center,
                2
            ),

            "valueShiftPx": round(
                anchor_center
                - actual_center,
                2
            ),

            "source": source
        }

    return cells


def _direct_ping_ref(image, row_anchor, fallback_ref, number_top, number_bottom, center_y):
    """Use the detected physical ping region when available."""
    height, width = image.shape[:2]
    ping_region = row_anchor.get("ping_region")
    if not (
        isinstance(ping_region, (list, tuple))
        and len(ping_region) >= 4
    ):
        return fallback_ref

    x, y, w, h = [float(v) for v in ping_region[:4]]
    pad_x = max(PING_DIRECT_MIN_PAD_X_PX, int(round(w * PING_DIRECT_PAD_X_RATIO)))
    pad_y = max(PING_DIRECT_MIN_PAD_Y_PX, int(round(h * PING_DIRECT_PAD_Y_RATIO)))

    left = max(0, int(round(x)) - pad_x)
    right = min(width, int(round(x + w)) + pad_x)
    top = max(0, min(number_top, int(round(y)) - pad_y))
    bottom = min(height, max(number_bottom, int(round(y + h)) + pad_y))

    return {
        "field": "ping",
        "left": left,
        "top": top,
        "right": max(left + 1, right),
        "bottom": max(top + 1, bottom),
        "centerX": round((left + right) / 2.0, 2),
        "centerY": int(center_y),
        "source": "direct_ping_region",
    }



def _largest_icon_candidate(
    image,
    left,
    top,
    right,
    bottom,
    hue_min,
    hue_max,
    sat_min,
    value_min,
    min_area_ratio,
    max_area_ratio,
    expected_center_x=None,
    max_target_distance_px=None,
    min_size_px=None,
    min_fill_ratio=None,
    min_solidity=None,
    aspect_min=0.35,
    aspect_max=2.8,
    morphology="close",
):
    """Return the strongest compact colored icon inside a tightly predicted window.

    When expected_center_x is supplied, proximity to that predicted physical
    location is authoritative before area. This prevents ordinary colored row
    content from being mistaken for party/MVP icons.
    """
    height, width = image.shape[:2]

    left = max(
        0,
        min(
            width - 1,
            int(round(left))
        )
    )

    right = max(
        left + 1,
        min(
            width,
            int(round(right))
        )
    )

    top = max(
        0,
        min(
            height - 1,
            int(round(top))
        )
    )

    bottom = max(
        top + 1,
        min(
            height,
            int(round(bottom))
        )
    )

    crop = image[
        top:bottom,
        left:right
    ]

    if (
        crop is None
        or crop.size == 0
    ):
        return None

    hsv = cv2.cvtColor(
        crop,
        cv2.COLOR_BGR2HSV
    )

    mask = cv2.inRange(
        hsv,
        np.array([
            int(hue_min),
            int(sat_min),
            int(value_min)
        ], dtype=np.uint8),
        np.array([
            int(hue_max),
            255,
            255
        ], dtype=np.uint8)
    )

    kernel = cv2.getStructuringElement(
        cv2.MORPH_ELLIPSE,
        (3, 3)
    )

    # PARTY benefits from closing small gaps in its green silhouette.
    # MVP sits on an orange/gold row; closing can merge the icon with the
    # background. For MVP use a light OPEN instead so the bright-gold icon
    # remains an isolated contour.
    if morphology == "close":
        mask = cv2.morphologyEx(
            mask,
            cv2.MORPH_CLOSE,
            kernel,
            iterations=1
        )
    elif morphology == "open":
        mask = cv2.morphologyEx(
            mask,
            cv2.MORPH_OPEN,
            kernel,
            iterations=1
        )

    contours, _ = cv2.findContours(
        mask,
        cv2.RETR_EXTERNAL,
        cv2.CHAIN_APPROX_SIMPLE
    )

    crop_area = max(
        1,
        crop.shape[0]
        * crop.shape[1]
    )

    minimum_area = (
        crop_area
        * float(
            min_area_ratio
        )
    )

    maximum_area = (
        crop_area
        * float(
            max_area_ratio
        )
    )

    candidates = []

    for contour in contours:
        x, y, w, h = cv2.boundingRect(
            contour
        )

        area = float(
            w * h
        )

        if (
            area < minimum_area
            or area > maximum_area
        ):
            continue

        if (
            w < 3
            or h < 3
        ):
            continue

        if (
            min_size_px is not None
            and (
                w < float(min_size_px)
                or h < float(min_size_px)
            )
        ):
            continue

        aspect = (
            w
            / max(
                h,
                1
            )
        )

        if not (
            float(aspect_min)
            <= aspect
            <= float(aspect_max)
        ):
            continue

        absolute_left = int(
            left + x
        )

        absolute_right = int(
            left + x + w
        )

        center_x = (
            absolute_left
            + absolute_right
        ) / 2.0

        target_distance = (
            None
            if expected_center_x is None
            else abs(center_x - float(expected_center_x))
        )

        if (
            max_target_distance_px is not None
            and target_distance is not None
            and target_distance > float(max_target_distance_px)
        ):
            continue

        contour_area = float(
            cv2.contourArea(
                contour
            )
        )

        fill_ratio = (
            contour_area
            / max(
                1.0,
                area
            )
        )

        hull = cv2.convexHull(contour)
        hull_area = float(cv2.contourArea(hull))
        solidity = contour_area / max(1.0, hull_area)
        if min_fill_ratio is not None and fill_ratio < float(min_fill_ratio):
            continue
        if min_solidity is not None and solidity < float(min_solidity):
            continue

        candidates.append({
            "left": absolute_left,
            "top": int(
                top + y
            ),
            "right": absolute_right,
            "bottom": int(
                top + y + h
            ),
            "centerX": round(
                center_x,
                2
            ),
            "area": area,
            "contourArea": round(
                contour_area,
                2
            ),
            "fillRatio": round(
                fill_ratio,
                3
            ),
            "solidity": round(solidity, 3),
            "targetDistancePx": (
                None
                if target_distance is None
                else round(
                    target_distance,
                    2
                )
            )
        })

    if not candidates:
        return None

    if expected_center_x is not None:
        return min(
            candidates,
            key=lambda item: (
                float(
                    item.get(
                        "targetDistancePx",
                        1e9
                    )
                    or 0.0
                ),
                -float(
                    item.get(
                        "area",
                        0.0
                    )
                    or 0.0
                )
            )
        )

    return max(
        candidates,
        key=lambda item: (
            item["area"],
            item["right"]
        )
    )


def _detect_title_presence(
    image,
    left,
    right,
    top,
    bottom
):
    """Detect whether the lower identity line contains title glyphs.

    This deliberately avoids OCR. The prospective title crop is locally
    background-subtracted, then evaluated for compact text-like components.
    Large row gradients, borders and team-color backgrounds therefore do not
    count as title evidence by themselves.
    """
    crop = crop_safe(
        image,
        left,
        top,
        right,
        bottom
    )

    if (
        crop is None
        or crop.size == 0
    ):
        return {
            "present": False,
            "glyphCount": 0,
            "foregroundRatio": 0.0,
            "probeHeight": 0,
            "probeWidth": 0,
        }

    gray = (
        cv2.cvtColor(
            crop,
            cv2.COLOR_BGR2GRAY
        )
        if crop.ndim == 3
        else crop.copy()
    )

    crop_height, crop_width = gray.shape[:2]

    top_inset = int(
        round(
            crop_height
            * IDENTITY_TITLE_PROBE_TOP_INSET_RATIO
        )
    )

    bottom_inset = int(
        round(
            crop_height
            * IDENTITY_TITLE_PROBE_BOTTOM_INSET_RATIO
        )
    )

    probe_top = max(
        0,
        min(
            crop_height - 1,
            top_inset
        )
    )

    probe_bottom = max(
        probe_top + 1,
        min(
            crop_height,
            crop_height - bottom_inset
        )
    )

    probe = gray[
        probe_top:probe_bottom,
        :
    ]

    probe_height, probe_width = probe.shape[:2]

    if (
        probe_height <= 0
        or probe_width <= 0
    ):
        return {
            "present": False,
            "glyphCount": 0,
            "foregroundRatio": 0.0,
            "probeHeight": int(
                probe_height
            ),
            "probeWidth": int(
                probe_width
            ),
        }

    # Remove smooth row/background illumination while preserving small glyph strokes.
    local_background = cv2.GaussianBlur(
        probe,
        (0, 0),
        2.0
    )

    residual = cv2.absdiff(
        probe,
        local_background
    )

    _, foreground = cv2.threshold(
        residual,
        int(
            IDENTITY_TITLE_RESIDUAL_THRESHOLD
        ),
        255,
        cv2.THRESH_BINARY
    )

    # Remove isolated single-pixel noise but do not join neighboring characters.
    foreground = cv2.morphologyEx(
        foreground,
        cv2.MORPH_OPEN,
        cv2.getStructuringElement(
            cv2.MORPH_RECT,
            (2, 2)
        ),
        iterations=1
    )

    contours, _ = cv2.findContours(
        foreground,
        cv2.RETR_EXTERNAL,
        cv2.CHAIN_APPROX_SIMPLE
    )

    min_glyph_height = max(
        2,
        int(
            round(
                probe_height
                * IDENTITY_TITLE_MIN_GLYPH_HEIGHT_RATIO
            )
        )
    )

    max_glyph_height = max(
        min_glyph_height,
        int(
            round(
                probe_height
                * IDENTITY_TITLE_MAX_GLYPH_HEIGHT_RATIO
            )
        )
    )

    max_glyph_width = max(
        3,
        int(
            round(
                probe_width
                * IDENTITY_TITLE_MAX_GLYPH_WIDTH_RATIO
            )
        )
    )

    glyphs = []

    for contour in contours:
        x, y, w, h = cv2.boundingRect(
            contour
        )

        area = int(
            w * h
        )

        if (
            area
            < IDENTITY_TITLE_MIN_GLYPH_AREA_PX
        ):
            continue

        if (
            h < min_glyph_height
            or h > max_glyph_height
        ):
            continue

        if (
            w < 1
            or w > max_glyph_width
        ):
            continue

        # Reject very long horizontal row/border fragments.
        aspect = (
            w
            / max(
                h,
                1
            )
        )

        if aspect > 4.0:
            continue

        glyphs.append({
            "left": int(x),
            "top": int(y),
            "right": int(
                x + w
            ),
            "bottom": int(
                y + h
            ),
            "area": area,
        })

    foreground_ratio = (
        float(
            np.count_nonzero(
                foreground
            )
        )
        / max(
            1,
            foreground.size
        )
    )

    glyph_centers_x = [
        (
            glyph["left"]
            + glyph["right"]
        ) / 2.0
        for glyph in glyphs
    ]

    glyph_bottoms = [
        int(
            glyph["bottom"]
        )
        for glyph in glyphs
    ]

    glyph_span_ratio = (
        0.0
        if len(glyph_centers_x) < 2
        else (
            max(
                glyph_centers_x
            )
            - min(
                glyph_centers_x
            )
        )
        / max(
            1.0,
            float(
                probe_width
            )
        )
    )

    baseline_spread = (
        999.0
        if not glyph_bottoms
        else float(
            max(
                glyph_bottoms
            )
            - min(
                glyph_bottoms
            )
        )
    )

    baseline_tolerance = max(
        3.0,
        probe_height
        * 0.45
    )

    has_title = bool(
        len(glyphs)
        >= int(
            IDENTITY_TITLE_MIN_GLYPH_COMPONENTS
        )
        and foreground_ratio
        >= float(
            IDENTITY_TITLE_MIN_FOREGROUND_RATIO
        )
        and glyph_span_ratio
        >= 0.08
        and baseline_spread
        <= baseline_tolerance
    )

    return {
        "present": has_title,
        "glyphCount": int(
            len(glyphs)
        ),
        "foregroundRatio": round(
            foreground_ratio,
            4
        ),
        "probeHeight": int(
            probe_height
        ),
        "probeWidth": int(
            probe_width
        ),
        "residualThreshold": int(
            IDENTITY_TITLE_RESIDUAL_THRESHOLD
        ),
        "glyphSpanRatio": round(
            glyph_span_ratio,
            4
        ),
        "baselineSpreadPx": round(
            baseline_spread,
            2
        ),
    }



def _detect_identity_text_lines(
    image,
    left,
    right,
    top,
    bottom,
    row_spacing,
):
    """Locate horizontal text lines across the complete identity area.

    This is a visual layout test, not OCR. It finds compact high-frequency
    glyph components, clusters them by vertical position, and returns either
    one username line or an upper username line plus a lower discarded line.
    """
    crop = crop_safe(image, left, top, right, bottom)
    if crop is None or crop.size == 0:
        return {
            "lines": [],
            "lineCount": 0,
            "componentCount": 0,
            "foregroundRatio": 0.0,
        }

    gray = (
        cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
        if crop.ndim == 3
        else crop.copy()
    )
    crop_height, crop_width = gray.shape[:2]

    local_background = cv2.GaussianBlur(gray, (0, 0), 2.0)
    residual = cv2.absdiff(gray, local_background)
    _, foreground = cv2.threshold(
        residual,
        int(IDENTITY_TEXT_LINE_RESIDUAL_THRESHOLD),
        255,
        cv2.THRESH_BINARY,
    )

    # Join broken strokes within a character without joining separate lines.
    foreground = cv2.morphologyEx(
        foreground,
        cv2.MORPH_CLOSE,
        cv2.getStructuringElement(cv2.MORPH_RECT, (2, 1)),
        iterations=1,
    )

    contours, _ = cv2.findContours(
        foreground,
        cv2.RETR_EXTERNAL,
        cv2.CHAIN_APPROX_SIMPLE,
    )

    min_height = max(
        2,
        int(round(row_spacing * IDENTITY_TEXT_LINE_MIN_HEIGHT_SPACING_RATIO)),
    )
    max_height = max(
        min_height,
        int(round(row_spacing * IDENTITY_TEXT_LINE_MAX_HEIGHT_SPACING_RATIO)),
    )
    max_width = max(
        3,
        int(round(crop_width * IDENTITY_TEXT_LINE_MAX_COMPONENT_WIDTH_RATIO)),
    )

    components = []
    for contour in contours:
        x, y, w, h = cv2.boundingRect(contour)
        if h < min_height or h > max_height:
            continue
        if w < 1 or w > max_width:
            continue
        if w * h < IDENTITY_TITLE_MIN_GLYPH_AREA_PX:
            continue
        if w / max(h, 1) > 4.0:
            continue
        components.append({
            "left": int(left + x),
            "top": int(top + y),
            "right": int(left + x + w),
            "bottom": int(top + y + h),
            "centerY": float(top + y + h / 2.0),
        })

    cluster_gap = max(
        3.0,
        float(row_spacing) * IDENTITY_TEXT_LINE_CLUSTER_GAP_SPACING_RATIO,
    )
    clusters = []
    for component in sorted(components, key=lambda item: item["centerY"]):
        best_cluster = None
        best_distance = None
        for cluster in clusters:
            cluster_center = sum(
                item["centerY"] for item in cluster
            ) / max(1, len(cluster))
            distance = abs(component["centerY"] - cluster_center)
            if distance <= cluster_gap and (
                best_distance is None or distance < best_distance
            ):
                best_cluster = cluster
                best_distance = distance
        if best_cluster is None:
            clusters.append([component])
        else:
            best_cluster.append(component)

    lines = []
    for cluster in clusters:
        line_left = min(item["left"] for item in cluster)
        line_right = max(item["right"] for item in cluster)
        line_top = min(item["top"] for item in cluster)
        line_bottom = max(item["bottom"] for item in cluster)
        span_ratio = (line_right - line_left) / max(1.0, float(crop_width))
        if len(cluster) < int(IDENTITY_TEXT_LINE_MIN_COMPONENTS):
            continue
        if span_ratio < float(IDENTITY_TEXT_LINE_MIN_SPAN_RATIO):
            continue
        lines.append({
            "left": int(line_left),
            "top": int(line_top),
            "right": int(line_right),
            "bottom": int(line_bottom),
            "centerY": round((line_top + line_bottom) / 2.0, 2),
            "componentCount": int(len(cluster)),
            "spanRatio": round(float(span_ratio), 4),
        })

    lines.sort(key=lambda item: item["centerY"])
    return {
        "lines": lines,
        "lineCount": int(len(lines)),
        "componentCount": int(len(components)),
        "foregroundRatio": round(
            float(np.count_nonzero(foreground)) / max(1, foreground.size),
            4,
        ),
        "scanBounds": {
            "left": int(left),
            "top": int(top),
            "right": int(right),
            "bottom": int(bottom),
        },
    }


def _refine_identity_bounds_around_icons(
    image,
    raw_name_left,
    raw_name_right,
    identity_left,
    identity_right,
    username_top,
    title_bottom,
    row_spacing,
    column_geometry,
    number_top=None,
    number_bottom=None,
):
    """Confirm party/MVP icons only near geometry-predicted physical locations.

    Predicted locations:
        party = far-left name-column anchor
        MVP   = SCORE - (GOALS - SCORE)

    The formulas provide a target only. No crop is changed unless the expected
    icon color/shape is actually found inside the narrow target window.
    """
    height, width = image.shape[:2]

    identity_left = int(
        identity_left
    )

    identity_right = int(
        identity_right
    )

    search_top = max(
        0,
        int(
            round(username_top - row_spacing * 0.25)
        )
    )

    search_bottom = min(
        height,
        int(
            round(title_bottom + row_spacing * 0.25)
        )
    )

    score_center = _column_center(
        column_geometry,
        "score"
    )

    goals_center = _column_center(
        column_geometry,
        "goals"
    )

    saves_center = _column_center(
        column_geometry,
        "saves"
    )

    stat_spacing = max(
        1.0,
        abs(
            goals_center
            - score_center
        )
    )

    party_search_half_width = max(
        int(
            IDENTITY_ICON_SEARCH_MIN_HALF_PX
        ),
        int(
            round(
                stat_spacing
                * IDENTITY_PARTY_ICON_SEARCH_HALF_SPACING_RATIO
            )
        )
    )

    mvp_search_half_width = max(
        int(
            IDENTITY_ICON_SEARCH_MIN_HALF_PX
        ),
        int(
            round(
                stat_spacing
                * IDENTITY_MVP_ICON_SEARCH_HALF_SPACING_RATIO
            )
        )
    )

    raw_name_width = max(
        1.0,
        float(raw_name_right) - float(raw_name_left)
    )

    party_expected_x = (
        float(raw_name_left)
        + raw_name_width
        * IDENTITY_PARTY_TARGET_NAME_RATIO
    )

    mvp_expected_x = (
        score_center
        - (
            goals_center
            - score_center
        )
        + stat_spacing
        * IDENTITY_MVP_TARGET_RIGHT_SHIFT_RATIO
    )

    pad = max(
        IDENTITY_ICON_EDGE_PAD_MIN_PX,
        int(
            round(
                row_spacing
                * IDENTITY_ICON_EDGE_PAD_RATIO
            )
        )
    )

    party_icon = None
    party_search = None

    if (
        IDENTITY_PARTY_ICON_EXCLUDE_ENABLED
        and identity_right
        > identity_left
    ):
        party_search_left = max(
            0,
            int(
                round(
                    party_expected_x
                    - party_search_half_width
                )
            )
        )

        party_search_right = min(
            width,
            int(
                round(
                    party_expected_x
                    + party_search_half_width
                )
            )
        )

        party_search = {
            "left": int(
                party_search_left
            ),
            "top": int(
                search_top
            ),
            "right": int(
                party_search_right
            ),
            "bottom": int(
                search_bottom
            ),
            "centerX": round(
                float(
                    party_expected_x
                ),
                2
            )
        }

        party_icon = _largest_icon_candidate(
            image,
            party_search_left,
            search_top,
            party_search_right,
            search_bottom,
            IDENTITY_PARTY_ICON_HUE_MIN,
            IDENTITY_PARTY_ICON_HUE_MAX,
            IDENTITY_PARTY_ICON_SAT_MIN,
            IDENTITY_PARTY_ICON_VALUE_MIN,
            IDENTITY_PARTY_ICON_MIN_AREA_RATIO,
            IDENTITY_PARTY_ICON_MAX_AREA_RATIO,
            expected_center_x=party_expected_x,
            morphology="none",
        )
        if (
            party_icon is not None
            and (
                float(party_icon.get("fillRatio", 0.0) or 0.0) < 0.08
                or float(party_icon.get("solidity", 0.0) or 0.0) < 0.20
            )
        ):
            party_icon = None
        if party_icon is not None:
            max_party_width = max(
                8,
                int(
                    round(
                        stat_spacing
                        * IDENTITY_PARTY_ICON_MAX_WIDTH_SPACING_RATIO
                    )
                )
            )

            if (
                int(
                    party_icon["right"]
                )
                - int(
                    party_icon["left"]
                )
                > max_party_width
            ):
                half_width = max(
                    4,
                    max_party_width // 2
                )

                party_icon["left"] = max(
                    party_search_left,
                    int(
                        round(
                            party_expected_x
                        )
                    )
                    - half_width
                )

                party_icon["right"] = min(
                    party_search_right,
                    int(
                        round(
                            party_expected_x
                        )
                    )
                    + half_width
                )

                party_icon["widthClamped"] = True

            identity_left = max(
                identity_left,
                int(
                    party_icon["right"]
                    + pad
                )
            )

    mvp_icon = None
    mvp_search = None
    mvp_min_size_px = (
        stat_spacing
        * IDENTITY_MVP_MIN_SIZE_SPACING_RATIO
    )
    mvp_size_reference = "stat_spacing"

    if (
        IDENTITY_MVP_ICON_EXCLUDE_ENABLED
        and score_center
        > identity_left
    ):
        mvp_search_left = max(
            identity_left,
            int(
                round(
                    mvp_expected_x
                    - mvp_search_half_width
                )
            )
        )

        mvp_search_right = min(
            width,
            int(
                round(
                    mvp_expected_x
                    + mvp_search_half_width
                )
            )
        )

        mvp_search = {
            "left": int(
                mvp_search_left
            ),
            "top": int(
                search_top
            ),
            "right": int(
                mvp_search_right
            ),
            "bottom": int(
                search_bottom
            ),
            "centerX": round(
                float(
                    mvp_expected_x
                ),
                2
            )
        }

        # A stat digit can share the MVP hue and shape characteristics.  Keep
        # the existing spacing-based floor, then strengthen it with the
        # measured height of the numeric boxes when those bounds are supplied.
        # Requiring both candidate dimensions to clear this floor prevents a
        # score digit or narrow "x" from being accepted as the MVP emblem.
        if (
            number_top is not None
            and number_bottom is not None
            and int(number_bottom) > int(number_top)
        ):
            number_band_height = max(
                1,
                int(number_bottom) - int(number_top)
            )
            mvp_min_size_px = max(
                mvp_min_size_px,
                number_band_height * 0.70
            )
            mvp_size_reference = "stat_spacing+number_band"

        mvp_icon = _largest_icon_candidate(
            image,
            mvp_search_left,
            search_top,
            mvp_search_right,
            search_bottom,
            IDENTITY_MVP_ICON_HUE_MIN,
            IDENTITY_MVP_ICON_HUE_MAX,
            IDENTITY_MVP_ICON_SAT_MIN,
            IDENTITY_MVP_ICON_VALUE_MIN,
            IDENTITY_MVP_ICON_MIN_AREA_RATIO,
            IDENTITY_MVP_ICON_MAX_AREA_RATIO,
            expected_center_x=mvp_expected_x,
            max_target_distance_px=(
                stat_spacing
                * IDENTITY_MVP_MAX_TARGET_DISTANCE_SPACING_RATIO
            ),
            min_size_px=mvp_min_size_px,
            min_fill_ratio=0.24,
            min_solidity=0.52,
            aspect_min=0.60,
            aspect_max=1.65,
            morphology="open",
        )

        if mvp_icon is not None:
            max_mvp_width = max(
                10,
                int(
                    round(
                        stat_spacing
                        * IDENTITY_MVP_ICON_MAX_WIDTH_SPACING_RATIO
                    )
                )
            )

            if (
                int(
                    mvp_icon["right"]
                )
                - int(
                    mvp_icon["left"]
                )
                > max_mvp_width
            ):
                half_width = max(
                    5,
                    max_mvp_width // 2
                )

                mvp_icon["left"] = max(
                    mvp_search_left,
                    int(
                        round(
                            mvp_expected_x
                        )
                    )
                    - half_width
                )

                mvp_icon["right"] = min(
                    mvp_search_right,
                    int(
                        round(
                            mvp_expected_x
                        )
                    )
                    + half_width
                )

                mvp_icon["widthClamped"] = True

            identity_right = min(
                identity_right,
                int(
                    mvp_icon["left"]
                    - pad
                )
            )

    identity_left = max(
        0,
        min(
            width - 1,
            identity_left
        )
    )

    identity_right = max(
        identity_left + 1,
        min(
            width,
            identity_right
        )
    )

    return (
        identity_left,
        identity_right,
        {
            "partyIcon": party_icon,
            "mvpIcon": mvp_icon,
            "partyExpectedX": round(
                float(
                    party_expected_x
                ),
                2
            ),
            "mvpExpectedX": round(
                float(
                    mvp_expected_x
                ),
                2
            ),
            "partySearch": party_search,
            "mvpSearch": mvp_search,
            "partySearchHalfWidthPx": int(
                party_search_half_width
            ),
            "mvpSearchHalfWidthPx": int(
                mvp_search_half_width
            ),
            "mvpMinSizePx": round(
                float(mvp_min_size_px),
                2
            ),
            "mvpSizeReference": mvp_size_reference,
            "paddingPx": int(
                pad
            ),
            "finalIdentityLeft": int(
                identity_left
            ),
            "finalIdentityRight": int(
                identity_right
            )
        }
    )

def build_row_coordinate_reference(
    image,
    row_anchor,
    column_geometry,
    middle_stat_name,
    player_index
):
    """Freeze every field location before OCR Pass 1 starts.

    Identity behavior:
    - party/MVP searches are tied to SCORE/GOALS/SAVES geometry;
    - icon searches only confirm optional icons near predicted targets;
    - title presence is checked visually without OCR;
    - title-less usernames are vertically centered on the numeric row baseline.
    """
    height, width = image.shape[:2]

    (
        center_y,
        center_source,
        number_top,
        number_bottom,
        row_spacing
    ) = _numeric_band_from_anchor(
        height,
        row_anchor
    )

    ping_region = row_anchor.get(
        "ping_region"
    )

    numeric_cells = _isolated_numeric_x_bounds(
        width,
        column_geometry,
        ping_region=ping_region
    )

    # ============================================================
    # PROSPECTIVE TWO-LINE IDENTITY LAYOUT
    # ============================================================

    username_top = max(
        0,
        int(
            round(
                center_y
                - row_spacing
                * ROW_USERNAME_TOP_RATIO
            )
        )
    )

    username_bottom = min(
        height,
        max(
            username_top + 1,
            int(
                round(
                    center_y
                    + row_spacing
                    * ROW_USERNAME_BOTTOM_RATIO
                )
            )
        )
    )

    title_top = max(
        0,
        int(
            round(
                center_y
                + row_spacing
                * ROW_TITLE_TOP_RATIO
            )
        )
    )

    title_bottom = min(
        height,
        max(
            title_top + 1,
            int(
                round(
                    center_y
                    + row_spacing
                    * ROW_TITLE_BOTTOM_RATIO
                )
            )
        )
    )

    name_column = (
        column_geometry.get(
            "name"
        )
        or {}
    )

    title_column = (
        column_geometry.get(
            "title"
        )
        or {}
    )

    score_cell = (
        numeric_cells.get(
            "score"
        )
        or {}
    )

    raw_name_left = int(
        name_column.get(
            "left",
            0
        )
        or 0
    )

    raw_name_right = int(
        name_column.get(
            "right",
            width
        )
        or width
    )

    raw_name_width = max(
        1,
        raw_name_right
        - raw_name_left
    )

    identity_left = int(
        round(
            raw_name_left
            + raw_name_width
            * IDENTITY_TEXT_LEFT_INSET_RATIO
        )
    )

    identity_right = int(
        round(
            float(
                score_cell.get(
                    "left",
                    raw_name_right
                )
            )
            - raw_name_width
            * IDENTITY_TEXT_RIGHT_GAP_RATIO
        )
    )

    identity_left = max(
        0,
        min(
            width - 1,
            identity_left
        )
    )

    identity_right = max(
        identity_left + 1,
        min(
            width,
            identity_right
        )
    )

    # ============================================================
    # OPTIONAL PARTY / MVP ICON CONFIRMATION
    # ============================================================

    (
        identity_left,
        identity_right,
        icon_exclusions
    ) = _refine_identity_bounds_around_icons(
        image,
        raw_name_left,
        raw_name_right,
        identity_left,
        identity_right,
        username_top,
        title_bottom,
        row_spacing,
        column_geometry,
        number_top=number_top,
        number_bottom=number_bottom
    )

    # Move the final username crop a few pixels right so it clears the party
    # icon and its glow while preserving nearly all available name width.
    identity_left_shift = max(
        2,
        int(round(
            row_spacing
            * IDENTITY_TEXT_LEFT_EXTRA_SHIFT_SPACING_RATIO
        )),
    )
    identity_left = min(
        identity_right - 1,
        identity_left + identity_left_shift,
    )
    icon_exclusions["finalIdentityLeft"] = int(identity_left)
    icon_exclusions["nameLeftShiftPx"] = int(identity_left_shift)

    title_right = max(
        identity_left + 1,
        min(
            identity_right,
            int(
                title_column.get(
                    "right",
                    identity_right
                )
                or identity_right
            )
        )
    )

    title_width = max(
        1,
        title_right
        - identity_left
    )

    title_right = int(
        round(
            title_right
            - title_width
            * IDENTITY_TITLE_RIGHT_SHRINK_RATIO
        )
    )

    title_right = max(
        identity_left + 1,
        min(
            identity_right,
            title_right
        )
    )

    # ============================================================
    # FIXED EXPANDED USERNAME GEOMETRY
    # ============================================================
    username_alignment = "fixed_expanded"
    number_band_height = max(
        1,
        int(number_bottom)
        - int(number_top)
    )

    username_vertical_pad = max(
        2,
        int(round(
            number_band_height
            * IDENTITY_USERNAME_NUMBER_BAND_PAD_RATIO
        ))
    )

    # Departed/faded players are commonly restored as inferred rows. Their
    # estimated numeric baseline can sit a few pixels lower than a directly
    # detected row, so give only those rows additional room above the name.
    # This remains proportional to row spacing and does not alter normal rows.
    is_inferred_row = bool(
        str(row_anchor.get("type", "")).lower() == "inferred"
        or row_anchor.get("inferred_row_confirmed") is True
        or row_anchor.get("inferredFromTeamColor") is True
    )

    inferred_username_top_extra_ratio = (
        IDENTITY_INFERRED_USERNAME_TOP_EXTRA_RATIO
        if is_inferred_row
        else 0.0
    )
    inferred_username_top_extra_px = int(round(
        row_spacing
        * inferred_username_top_extra_ratio
    ))

    username_center_top = max(
        0,
        int(number_top)
        - username_vertical_pad
        - inferred_username_top_extra_px
    )

    username_center_bottom = min(
        height,
        max(
            username_center_top + 1,
            int(number_bottom)
            + username_vertical_pad
        )
    )
    username_upper_top = int(username_center_top)
    username_upper_bottom = int(username_center_bottom)
    detected_text_lines = []
    detected_name_line = None
    text_line_detection = {
        "enabled": False,
        "mode": "fixed_expanded_username_crop",
        "lines": [],
        "lineCount": 0,
        "scanBounds": {
            "left": int(identity_left),
            "top": int(username_center_top),
            "right": int(identity_right),
            "bottom": int(username_center_bottom),
        },
    }

    def ref_for_bounds(
        left,
        right,
        top,
        bottom,
        field_name,
        source
    ):
        left = max(
            0,
            min(
                width - 1,
                int(
                    round(
                        left
                    )
                )
            )
        )

        right = max(
            left + 1,
            min(
                width,
                int(
                    round(
                        right
                    )
                )
            )
        )

        return {
            "field": field_name,
            "left": left,
            "top": int(
                top
            ),
            "right": right,
            "bottom": int(
                bottom
            ),
            "centerX": round(
                (
                    left
                    + right
                ) / 2.0,
                2
            ),
            "centerY": int(
                center_y
            ),
            "source": source
        }

    identity_source = (
        "relative_identity"
        "+predicted_icons"
        "+fixed_expanded_username"
    )

    username_center_ref = ref_for_bounds(
        identity_left,
        identity_right,
        username_center_top,
        username_center_bottom,
        "username",
        identity_source + "+center"
    )

    username_upper_ref = ref_for_bounds(
        identity_left,
        identity_right,
        username_upper_top,
        username_upper_bottom,
        "username",
        identity_source + "+upper"
    )

    selected_username_ref = username_center_ref

    fields = {
        "username": selected_username_ref
    }

    numeric_field_map = {
        "score": "score",
        "goals": "goals",
        middle_stat_name: "middle",
        "saves": "saves",
        "shots": "shots",
        "ping": "ping"
    }

    for (
        field_name,
        geometry_key
    ) in numeric_field_map.items():
        cell = (
            numeric_cells.get(
                geometry_key
            )
            or {}
        )

        fields[field_name] = ref_for_bounds(
            cell.get(
                "left",
                0
            ),
            cell.get(
                "right",
                width
            ),
            number_top,
            number_bottom,
            field_name,
            cell.get(
                "source",
                "detected_header_center_midpoint"
            )
        )

    # Direct PING is the final PING crop only; it never stretches the stat frame.
    fields["ping"] = _direct_ping_ref(
        image,
        row_anchor,
        fields["ping"],
        number_top,
        number_bottom,
        center_y
    )

    return {
        "playerIndex": int(
            player_index
        ),
        "teamIndex": int(
            row_anchor.get(
                "team_index",
                0
            )
            or 0
        ),
        "physicalRowIndex": int(
            row_anchor.get(
                "physical_row_index",
                player_index
            )
            or player_index
        ),
        "numberCenterY": int(
            center_y
        ),
        "centerSource": center_source,
        "numberBand": {
            "top": int(
                number_top
            ),
            "bottom": int(
                number_bottom
            )
        },
        "rowSpacing": round(
            float(
                row_spacing
            ),
            2
        ),
        "numericIsolation": {
            key: dict(
                value
            )
            for key, value
            in numeric_cells.items()
        },
        "identityIconExclusions": (
            icon_exclusions
        ),
        "identityLayout": {
            "hasTitle": False,
            "titlePresence": {
                "present": len(detected_text_lines) >= 2
            },
            "textLineDetection": text_line_detection,
            "detectedTextLines": detected_text_lines,
            "detectedNameLine": detected_name_line,
            "detectedTextLineCount": len(detected_text_lines),
            "discardedLowerLineCount": max(0, len(detected_text_lines) - 1),
            "usernameAlignment": username_alignment,
            "usernameVerticallyCentered": len(detected_text_lines) <= 1,
            "usernameReadOrder": [username_alignment],
            "usernameSelectedRef": dict(selected_username_ref),
            "usernameCenteredRef": dict(
                username_center_ref
            ),
            "usernameUpperRef": dict(
                username_upper_ref
            ),
            "titleVisualAdvisoryOnly": False,
            "partyExpectedX": (
                icon_exclusions.get(
                    "partyExpectedX"
                )
            ),
            "mvpExpectedX": (
                icon_exclusions.get(
                    "mvpExpectedX"
                )
            )
        },
        "fields": fields
    }


def build_coordinate_references(image, row_anchors, column_geometry, middle_stat_name):
    return [
        build_row_coordinate_reference(image, anchor, column_geometry, middle_stat_name, index)
        for index, anchor in enumerate(row_anchors or [], start=1)
    ]


def _focus_numeric(crop, field_name):
    # The foundation coordinate reference is already the field crop. Keep it
    # intact for every field, including ping; trimming can remove left-aligned
    # digits such as the 80/32 ping values.
    return crop


def preprocess_numeric_pass1(
    crop,
    field_name
):
    crop = _focus_numeric(
        crop,
        field_name
    )

    if crop is None or crop.size == 0:
        return None

    gray = cv2.cvtColor(
        crop,
        cv2.COLOR_BGR2GRAY
    )

    scale = (
        4.0
        if str(field_name) == "score"
        else 5.0
    )

    gray = cv2.resize(
        gray,
        None,
        fx=scale,
        fy=scale,
        interpolation=cv2.INTER_LANCZOS4
    )

    gray = cv2.createCLAHE(
        clipLimit=2.0,
        tileGridSize=(4, 4)
    ).apply(gray)

    return gray
def read_digits(processed, field_name, stage="pass1", family="baseline", psm=7):
    result = {
        "stage": stage,
        "engine": "tesseract",
        "family": family,
        "psm": int(psm),
        "value": None,
        "confidence": 0.0,
        "raw": "",
        "plausible": False,
    }
    if processed is None or processed.size == 0:
        return result
    data = pytesseract.image_to_data(
        processed,
        config=f"--oem 3 --psm {int(psm)} -c tessedit_char_whitelist=0123456789",
        output_type=Output.DICT,
    )
    tokens = []
    confidences = []
    for text, confidence in zip(data.get("text", []), data.get("conf", [])):
        cleaned = re.sub(r"[^0-9]", "", str(text or ""))
        if not cleaned:
            continue
        tokens.append(cleaned)
        try:
            confidence = float(confidence)
        except (TypeError, ValueError):
            confidence = -1.0
        if confidence >= 0:
            confidences.append(confidence)
    raw = "".join(tokens)
    if not raw:
        return result
    try:
        value = int(raw)
    except ValueError:
        return result
    minimum, maximum = NUMBER_LIMITS.get(str(field_name), (0, 99999))
    plausible = minimum <= value <= maximum
    confidence = sum(confidences) / max(1, len(confidences)) if confidences else 0.0
    # Tesseract sometimes reports 0 confidence for a visually clean Rocket League
    # glyph. Repeated stages still have to agree before this floor can lock a field.
    if plausible and confidence <= 0.0:
        confidence = 38.0
    result.update({
        "value": value,
        "confidence": round(confidence, 2),
        "raw": raw,
        "plausible": bool(plausible),
    })
    return result


def read_numeric_pass1(image, coordinate_ref, field_name):
    raw_crop = crop_from_ref(
        image,
        coordinate_ref
    )
    presence = region_has_content(
        raw_crop
    )

    baseline_candidate = read_digits(
        preprocess_numeric_pass1(
            raw_crop,
            field_name
        ),
        field_name,
        stage="pass1",
        family="baseline_gray",
        psm=7
    )

    candidates = [
        baseline_candidate
    ]

    if (
        OCR_CROP_SHARPEN_ENABLED
        and field_name in OCR_SHARPEN_FIELDS
        and raw_crop is not None
        and raw_crop.size
    ):
        sharpened_crop = sharpen_crop(
            raw_crop
        )

        sharpened_candidate = read_digits(
            preprocess_numeric_pass1(
                sharpened_crop,
                field_name
            ),
            field_name,
            stage="pass1",
            family="baseline_sharpened",
            psm=7
        )

        candidates.append(
            sharpened_candidate
        )

    valid_candidates = [
        candidate
        for candidate in candidates
        if candidate.get("value") is not None
    ]

    if valid_candidates:
        candidate = max(
            valid_candidates,
            key=lambda item: float(
                item.get(
                    "confidence",
                    0.0
                )
                or 0.0
            )
        )
    else:
        candidate = baseline_candidate

    candidate["pass1Alternates"] = [
        {
            "family": item.get("family"),
            "value": item.get("value"),
            "confidence": item.get("confidence"),
            "raw": item.get("raw")
        }
        for item in candidates
    ]

    if candidate.get("value") is not None:
        presence = dict(
            presence
        )
        presence["present"] = True
        presence["confirmedByOCR"] = True
        presence["ocrValue"] = candidate.get(
            "value"
        )

    candidate["presence"] = presence
    return candidate, presence


def _read_text(crop, psm=7):
    if crop is None or crop.size == 0:
        return {"text": "", "confidence": 0.0}
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    gray = cv2.resize(gray, None, fx=3.0, fy=3.0, interpolation=cv2.INTER_LANCZOS4)
    gray = cv2.createCLAHE(2.0, (4, 4)).apply(gray)
    data = pytesseract.image_to_data(gray, config=f"--oem 3 --psm {int(psm)}", output_type=Output.DICT)
    texts = []
    confidences = []
    for text, confidence in zip(data.get("text", []), data.get("conf", [])):
        text = clean_text(text)
        if not text:
            continue
        texts.append(text)
        try:
            confidence = float(confidence)
        except (TypeError, ValueError):
            confidence = -1.0
        if confidence >= 0:
            confidences.append(confidence)
    return {
        "text": uppercase_text(" ".join(texts)),
        "confidence": round(sum(confidences) / max(1, len(confidences)), 2) if texts else 0.0,
    }



def normalize_identity_candidate(value):
    return re.sub(
        r"[^A-Z0-9]",
        "",
        uppercase_text(value)
    )


def strip_leading_bracket_prefix(value):
    """Remove a short leading OCR/clan fragment ending in `]`.

    The closing bracket must be near the start and followed by whitespace, so
    a bracket occurring inside the actual username is preserved.
    """
    value = uppercase_text(value).strip()
    match = re.match(
        r"^\s*[^\s\]]{0,12}\]\s+(.+?)\s*$",
        value,
    )
    if match is None:
        return value
    suffix = str(match.group(1) or "").strip()
    return suffix if normalize_identity_candidate(suffix) else value


def read_identity_pass1(image, row_reference):
    fields = row_reference.get("fields") or {}

    identity_layout = (
        row_reference.get(
            "identityLayout"
        )
        or {}
    )

    selected_ref = (
        identity_layout.get(
            "usernameSelectedRef"
        )
        or fields.get(
            "username"
        )
    )

    username_candidates = []

    def append_username_family(
        family_prefix,
        coordinate_ref
    ):
        crop = crop_from_ref(
            image,
            coordinate_ref
        )

        normal_read = _read_text(
            crop,
            psm=7
        )

        clan, username = parse_clan_username(
            normal_read.get(
                "text",
                ""
            )
        )
        username = strip_leading_bracket_prefix(username)

        username_candidates.append({
            "family": (
                family_prefix
                + "_gray"
            ),
            "alignment": family_prefix,
            "clan": clan,
            "username": username,
            "confidence": float(
                normal_read.get(
                    "confidence",
                    0.0
                )
                or 0.0
            ),
            "raw": normal_read.get(
                "text",
                ""
            )
        })

        if (
            OCR_CROP_SHARPEN_ENABLED
            and "username"
            in OCR_SHARPEN_FIELDS
            and crop is not None
            and crop.size
        ):
            sharp_read = _read_text(
                sharpen_crop(
                    crop
                ),
                psm=7
            )

            sharp_clan, sharp_username = (
                parse_clan_username(
                    sharp_read.get(
                        "text",
                        ""
                    )
                )
            )
            sharp_username = strip_leading_bracket_prefix(sharp_username)

            username_candidates.append({
                "family": (
                    family_prefix
                    + "_sharpened"
                ),
                "alignment": family_prefix,
                "clan": sharp_clan,
                "username": sharp_username,
                "confidence": float(
                    sharp_read.get(
                        "confidence",
                        0.0
                    )
                    or 0.0
                ),
                "raw": sharp_read.get(
                    "text",
                    ""
                )
            })

    selected_alignment = str(
        identity_layout.get("usernameAlignment")
        or "center"
    )

    append_username_family(
        selected_alignment,
        selected_ref
    )

    valid_username_candidates = [
        candidate
        for candidate
        in username_candidates
        if normalize_identity_candidate(
            candidate.get(
                "username"
            )
        )
    ]

    username_candidate = max(
        valid_username_candidates or username_candidates,
        key=lambda item: float(
            item.get("confidence", 0.0)
            or 0.0
        )
    )

    return {
        "clan": uppercase_text(
            username_candidate.get("clan", "")
        ),
        "username": uppercase_text(
            username_candidate.get("username", "")
        ),
        "username_support": (
            1
            if username_candidate.get("username")
            else 0
        ),
        "usernameAlignment": (
            username_candidate.get(
                "alignment"
            )
        ),
        "visualTitleAdvisory": False,
        "reads": [
            {
                "stage": "pass1",
                "family": candidate.get("family"),
                "alignment": candidate.get("alignment"),
                "username": uppercase_text(
                    candidate.get("username", "")
                ),
                "clan": uppercase_text(
                    candidate.get("clan", "")
                ),
                "confidence": round(
                    float(
                        candidate.get(
                            "confidence",
                            0.0
                        )
                        or 0.0
                    ),
                    2
                ),
                "raw": candidate.get("raw", "")
            }
            for candidate in username_candidates
        ],
        "username_confidence": round(
            float(
                username_candidate.get(
                    "confidence",
                    0.0
                )
                or 0.0
            ),
            2
        ),
        "stage": "pass1"
    }
