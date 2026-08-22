import re
import shutil
import threading
import cv2
import numpy as np
from ocr_config import (
    OCR_DEBUG_IMAGE_MAX_SIDE,
    OCR_DEBUG_JPEG_QUALITY,
    OCR_DEBUG_KEEP_LOCAL_FILES,
    OCR_DEBUG_LOCAL_DIR,
    OCR_DEBUG_MAX_IMAGES_PER_JOB,
    debug_enabled
)


DEBUG_VISUAL_VERSION = "debug-visual-v3.1-fixed-expanded-name"
_STATE = threading.local()


def _safe_token(value, fallback="debug"):
    cleaned = re.sub(
        r"[^A-Za-z0-9._-]+",
        "_",
        str(value or "")
    ).strip("._-")
    return cleaned or fallback


def _state():
    if not hasattr(_STATE, "context"):
        _STATE.context = {
            "traceId": None,
            "saved": [],
            "savedCount": 0
        }
    return _STATE.context


def begin_debug_context(trace_id):
    context = {
        "traceId": _safe_token(trace_id, "job"),
        "saved": [],
        "savedCount": 0
    }
    _STATE.context = context
    return dict(context)


def current_debug_trace_id():
    return _state().get("traceId")


def _resize_for_debug(image):
    if image is None or image.size == 0:
        return None, 1.0
    height, width = image.shape[:2]
    longest = max(height, width, 1)
    if longest <= OCR_DEBUG_IMAGE_MAX_SIDE:
        return image.copy(), 1.0
    scale = OCR_DEBUG_IMAGE_MAX_SIDE / float(longest)
    resized = cv2.resize(
        image,
        (
            max(1, int(round(width * scale))),
            max(1, int(round(height * scale)))
        ),
        interpolation=cv2.INTER_AREA
    )
    return resized, scale


def _put_label(image, text, x, y, scale=0.52):
    if image is None or image.size == 0:
        return
    text = str(text or "")
    if not text:
        return
    x = max(4, int(x))
    y = max(18, int(y))
    cv2.putText(
        image,
        text,
        (x + 1, y + 1),
        cv2.FONT_HERSHEY_SIMPLEX,
        scale,
        (0, 0, 0),
        3,
        cv2.LINE_AA
    )
    cv2.putText(
        image,
        text,
        (x, y),
        cv2.FONT_HERSHEY_SIMPLEX,
        scale,
        (255, 255, 255),
        1,
        cv2.LINE_AA
    )


def _write_image(trace_id, filename, image, count_against_budget=True):
    if not debug_enabled("images"):
        return None
    if image is None or image.size == 0:
        return None

    context = _state()
    trace_id = _safe_token(
        trace_id or context.get("traceId"),
        "job"
    )

    if count_against_budget:
        if context.get("savedCount", 0) >= OCR_DEBUG_MAX_IMAGES_PER_JOB:
            return None
        context["savedCount"] = int(
            context.get("savedCount", 0)
        ) + 1

    safe_name = _safe_token(filename, "debug")
    if not safe_name.lower().endswith(".jpg"):
        safe_name += ".jpg"

    output_dir = OCR_DEBUG_LOCAL_DIR / trace_id
    output_dir.mkdir(parents=True, exist_ok=True)
    path = output_dir / safe_name

    cv2.imwrite(
        str(path),
        image,
        [
            int(cv2.IMWRITE_JPEG_QUALITY),
            int(OCR_DEBUG_JPEG_QUALITY)
        ]
    )

    item = {
        "name": path.stem,
        "filename": path.name,
        "path": str(path),
        "bytes": int(path.stat().st_size) if path.exists() else 0
    }
    context.setdefault("saved", []).append(item)
    return item


def save_localization_overlay(trace_id, source_image, localization):
    if not debug_enabled("images"):
        return None
    if source_image is None or source_image.size == 0:
        return None

    canvas, scale = _resize_for_debug(source_image)
    if canvas is None:
        return None

    bounds = (
        localization.get("sourceBounds", {})
        if isinstance(localization, dict)
        else {}
    )
    x = int(round(float(bounds.get("x", 0) or 0) * scale))
    y = int(round(float(bounds.get("y", 0) or 0) * scale))
    w = int(round(float(bounds.get("width", 0) or 0) * scale))
    h = int(round(float(bounds.get("height", 0) or 0) * scale))

    if w > 0 and h > 0:
        cv2.rectangle(
            canvas,
            (x, y),
            (x + w, y + h),
            (80, 255, 80),
            3
        )

    color_candidate = (
        localization.get("colorCandidate")
        if isinstance(localization, dict)
        else None
    )
    if isinstance(color_candidate, dict):
        scan_scale = float(
            localization.get("scanScale", 1.0)
            or 1.0
        )
        band_scale = scale / max(scan_scale, 1e-6)
        for label, key, color in (
            ("TEAM COLOR A", "teamColorA", (255, 190, 80)),
            ("TEAM COLOR B", "teamColorB", (80, 190, 255))
        ):
            band = color_candidate.get(key)
            if not isinstance(band, dict):
                continue
            left = int(round(float(band.get("left", 0) or 0) * band_scale))
            right = int(round(float(band.get("right", 0) or 0) * band_scale))
            top = int(round(float(band.get("top", 0) or 0) * band_scale))
            bottom = int(round(float(band.get("bottom", 0) or 0) * band_scale))
            if right > left and bottom > top:
                cv2.rectangle(
                    canvas,
                    (left, top),
                    (right, bottom),
                    color,
                    2
                )
                _put_label(
                    canvas,
                    label,
                    left,
                    max(18, top - 5),
                    scale=0.45
                )

    confidence = float(
        localization.get("boundsConfidence", 0.0)
        if isinstance(localization, dict)
        else 0.0
    )
    method = (
        localization.get("locator", "unknown")
        if isinstance(localization, dict)
        else "unknown"
    )
    _put_label(
        canvas,
        f"LOCALIZER={method} CONF={confidence * 100:.1f}%",
        10,
        24,
        scale=0.55
    )
    _put_label(
        canvas,
        (
            f"ROWS={localization.get('detectedRows', 0)} "
            f"PING={localization.get('detectedPingRegions', 0)} "
            f"STAT={localization.get('detectedStatRows', 0)}"
        ),
        10,
        48,
        scale=0.5
    )

    foundation = (
        localization.get("foundation")
        if isinstance(localization, dict)
        else None
    )
    if isinstance(foundation, dict):
        mode = str(
            foundation.get(
                "mode",
                "unknown"
            )
            or "unknown"
        )
        pair_score = float(
            foundation.get(
                "headerPairScore",
                0.0
            )
            or 0.0
        )
        color_support = float(
            foundation.get(
                "colorSupportScore",
                0.0
            )
            or 0.0
        )
        _put_label(
            canvas,
            (
                f"FOUNDATION={mode} "
                f"HEADER={pair_score * 100:.1f}% "
                f"COLOR={color_support * 100:.1f}%"
            ),
            10,
            70,
            scale=0.43
        )
    _put_label(
        canvas,
        f"TRACE={_safe_token(trace_id, 'localize')}",
        10,
        max(24, canvas.shape[0] - 12),
        scale=0.42
    )

    # Localization is its own request, so it does not consume the later OCR
    # job's two-image budget.
    return _write_image(
        trace_id,
        "01_localization_bounds.jpg",
        canvas,
        count_against_budget=False
    )


def _stat_region_tuple(stat_region):
    if isinstance(stat_region, dict):
        value = stat_region.get("region")
        if isinstance(value, (list, tuple)) and len(value) == 4:
            return value
    if isinstance(stat_region, (list, tuple)) and len(stat_region) == 4:
        return stat_region
    return None


def save_structure_overlay(image, preflight, players_per_team):
    if not debug_enabled("images"):
        return None
    if image is None or image.size == 0:
        return None

    canvas, scale = _resize_for_debug(image)
    if canvas is None:
        return None

    prepared = (
        preflight.get("preparedData", {})
        if isinstance(preflight, dict)
        else {}
    )
    if not prepared and isinstance(preflight, dict):
        prepared = preflight.get("debugEvidence", {}) or {}
    anchors = list(prepared.get("rowAnchors", []) or [])
    anchors.sort(
        key=lambda item: int(item.get("center_y", 0) or 0)
    )

    for index, anchor in enumerate(anchors):
        center_y = int(round(
            float(anchor.get("center_y", 0) or 0)
            * scale
        ))
        team = int(anchor.get("team_index", 0) or 0)
        physical = int(
            anchor.get("physical_row_index", index + 1)
            or index + 1
        )
        anchor_type = str(anchor.get("type", "inferred"))
        confidence = float(anchor.get("confidence", 0.0) or 0.0)

        line_color = (
            (255, 180, 60)
            if team == 1
            else (60, 180, 255)
        )
        cv2.line(
            canvas,
            (0, center_y),
            (canvas.shape[1] - 1, center_y),
            line_color,
            2
        )
        _put_label(
            canvas,
            (
                f"T{team}-R{physical} {anchor_type} "
                f"{confidence * 100:.0f}%"
            ),
            8,
            max(18, center_y - 5),
            scale=0.46
        )

        ping = anchor.get("ping_region")
        if isinstance(ping, (list, tuple)) and len(ping) == 4:
            px, py, pw, ph = [
                int(round(float(v) * scale))
                for v in ping
            ]
            cv2.rectangle(
                canvas,
                (px, py),
                (px + pw, py + ph),
                (80, 255, 80),
                2
            )

        stat = _stat_region_tuple(
            anchor.get("stat_region")
        )
        if stat is not None:
            sx, sy, sw, sh = [
                int(round(float(v) * scale))
                for v in stat
            ]
            cv2.rectangle(
                canvas,
                (sx, sy),
                (sx + sw, sy + sh),
                (255, 255, 80),
                1
            )

    if (
        len(anchors) >= int(players_per_team) + 1
        and int(players_per_team) > 0
    ):
        first = float(
            anchors[int(players_per_team) - 1].get("center_y", 0)
            or 0
        )
        second = float(
            anchors[int(players_per_team)].get("center_y", 0)
            or 0
        )
        boundary = int(round(
            ((first + second) / 2.0) * scale
        ))
        cv2.line(
            canvas,
            (0, boundary),
            (canvas.shape[1] - 1, boundary),
            (255, 255, 255),
            2
        )
        _put_label(
            canvas,
            "TEAM BOUNDARY",
            8,
            max(18, boundary - 5),
            scale=0.45
        )

    team_structure = prepared.get(
        "teamStructure",
        preflight.get("teamStructure", {})
        if isinstance(preflight, dict)
        else {}
    )
    _put_label(
        canvas,
        (
            f"TEAM METHOD={team_structure.get('method', 'unknown')} "
            f"COLOR SEP={team_structure.get('colorSeparation', 0)} "
            f"SPACING={team_structure.get('spacingRatio', 0)}"
        ),
        10,
        24,
        scale=0.50
    )

    return _write_image(
        current_debug_trace_id(),
        "02_team_anchors.jpg",
        canvas,
        count_against_budget=True
    )


def save_final_layout_overlay(image, row_anchors, players):
    if not debug_enabled("images"):
        return None
    if image is None or image.size == 0:
        return None

    canvas, scale = _resize_for_debug(image)
    if canvas is None:
        return None

    anchors = list(row_anchors or [])
    players = list(players or [])
    for index, anchor in enumerate(anchors):
        y = int(round(
            float(anchor.get("center_y", 0) or 0) * scale
        ))
        player = players[index] if index < len(players) else {}
        team = int(
            player.get(
                "teamIndex",
                anchor.get("team_index", 0)
            )
            or 0
        )
        name = str(
            player.get("matchedName")
            or player.get("username")
            or "?"
        )
        status = str(player.get("matchStatus", ""))
        cv2.line(
            canvas,
            (0, y),
            (canvas.shape[1] - 1, y),
            (190, 190, 190),
            1
        )
        _put_label(
            canvas,
            f"T{team} {name} {status}".strip(),
            8,
            max(18, y - 5),
            scale=0.46
        )

    return _write_image(
        current_debug_trace_id(),
        "03_final_layout.jpg",
        canvas,
        count_against_budget=True
    )


def collect_debug_files():
    return [
        dict(item)
        for item in _state().get("saved", [])
    ]


def debug_manifest():
    context = _state()
    return {
        "version": DEBUG_VISUAL_VERSION,
        "traceId": context.get("traceId"),
        "imageBudget": int(OCR_DEBUG_MAX_IMAGES_PER_JOB),
        "savedImages": collect_debug_files()
    }


def clear_debug_context(delete_files=None):
    context = _state()
    trace_id = context.get("traceId")
    if delete_files is None:
        delete_files = not OCR_DEBUG_KEEP_LOCAL_FILES

    if delete_files and trace_id:
        path = OCR_DEBUG_LOCAL_DIR / _safe_token(trace_id, "job")
        shutil.rmtree(
            path,
            ignore_errors=True
        )

    _STATE.context = {
        "traceId": None,
        "saved": [],
        "savedCount": 0
    }



def save_coordinate_reference_overlay(image, row_references):
    """Mode 4: show frozen field boxes plus the new horizontal orientation.

    Visual conventions:
    - White rectangle: final OCR crop.
    - Yellow vertical tick: physical/header anchor center.
    - Cyan vertical tick: final crop center.
    - Purple vertical tick: original/foundation center when different.
    - PARTY/MVP rectangles: optional identity icons excluded from OCR.
    """
    if not debug_enabled("images") or image is None or image.size == 0:
        return None

    canvas, scale = _resize_for_debug(image)

    if canvas is None:
        return None

    for row in row_references or []:
        player_index = int(
            row.get(
                "playerIndex",
                0
            )
            or 0
        )

        center_y = int(
            round(
                float(
                    row.get(
                        "numberCenterY",
                        0
                    )
                    or 0
                )
                * scale
            )
        )

        cv2.line(
            canvas,
            (0, center_y),
            (
                canvas.shape[1] - 1,
                center_y
            ),
            (180, 180, 180),
            1,
            cv2.LINE_AA
        )

        _put_label(
            canvas,
            (
                f"P{player_index} Y={row.get('numberCenterY')} "
                f"{row.get('centerSource')}"
            ),
            8,
            max(
                20,
                center_y - 5
            ),
            0.40
        )

        fields = (
            row.get("fields")
            or {}
        )

        numeric_isolation = (
            row.get("numericIsolation")
            or {}
        )

        # --------------------------------------------------------
        # Final OCR rectangles
        # --------------------------------------------------------
        for field_name, ref in fields.items():
            if not isinstance(
                ref,
                dict
            ):
                continue

            x1 = int(
                round(
                    float(
                        ref.get(
                            "left",
                            0
                        )
                        or 0
                    )
                    * scale
                )
            )

            x2 = int(
                round(
                    float(
                        ref.get(
                            "right",
                            0
                        )
                        or 0
                    )
                    * scale
                )
            )

            y1 = int(
                round(
                    float(
                        ref.get(
                            "top",
                            0
                        )
                        or 0
                    )
                    * scale
                )
            )

            y2 = int(
                round(
                    float(
                        ref.get(
                            "bottom",
                            0
                        )
                        or 0
                    )
                    * scale
                )
            )

            cv2.rectangle(
                canvas,
                (x1, y1),
                (x2, y2),
                (255, 255, 255),
                1
            )

            actual_center = (
                x1 + x2
            ) // 2

            # Cyan = center of final box.
            cv2.line(
                canvas,
                (
                    actual_center,
                    max(
                        0,
                        y1 - 7
                    )
                ),
                (
                    actual_center,
                    min(
                        canvas.shape[0] - 1,
                        y2 + 7
                    )
                ),
                (255, 255, 0),
                1,
                cv2.LINE_AA
            )

            if field_name in {
                "username",
                "score",
                "shots",
                "ping"
            }:
                _put_label(
                    canvas,
                    f"P{player_index}:{field_name}",
                    x1 + 2,
                    max(
                        18,
                        y1 - 3
                    ),
                    0.34
                )

        # --------------------------------------------------------
        # Numeric anchor centers
        # --------------------------------------------------------
        for field_name, item in numeric_isolation.items():
            if not isinstance(
                item,
                dict
            ):
                continue

            ref = fields.get(
                field_name
            )

            # "middle" is stored under assists/demos in fields.
            if (
                ref is None
                and field_name == "middle"
            ):
                for candidate_name in (
                    "assists",
                    "demos"
                ):
                    if candidate_name in fields:
                        ref = fields[
                            candidate_name
                        ]
                        break

            if not isinstance(
                ref,
                dict
            ):
                continue

            y1 = int(
                round(
                    float(
                        ref.get(
                            "top",
                            0
                        )
                        or 0
                    )
                    * scale
                )
            )

            y2 = int(
                round(
                    float(
                        ref.get(
                            "bottom",
                            0
                        )
                        or 0
                    )
                    * scale
                )
            )

            anchor_x = item.get(
                "anchorCenterX"
            )

            foundation_x = item.get(
                "foundationCenterX"
            )

            actual_x = item.get(
                "centerX"
            )

            if anchor_x is not None:
                anchor_px = int(
                    round(
                        float(anchor_x)
                        * scale
                    )
                )

                # Yellow = physical/header/direct-PING anchor.
                cv2.line(
                    canvas,
                    (
                        anchor_px,
                        max(
                            0,
                            y1 - 13
                        )
                    ),
                    (
                        anchor_px,
                        min(
                            canvas.shape[0] - 1,
                            y2 + 13
                        )
                    ),
                    (0, 255, 255),
                    2,
                    cv2.LINE_AA
                )

            if (
                foundation_x is not None
                and anchor_x is not None
                and abs(
                    float(foundation_x)
                    - float(anchor_x)
                ) >= 1.0
            ):
                foundation_px = int(
                    round(
                        float(
                            foundation_x
                        )
                        * scale
                    )
                )

                # Purple = prior/foundation center when it differs.
                cv2.line(
                    canvas,
                    (
                        foundation_px,
                        max(
                            0,
                            y1 - 10
                        )
                    ),
                    (
                        foundation_px,
                        min(
                            canvas.shape[0] - 1,
                            y2 + 10
                        )
                    ),
                    (255, 80, 255),
                    1,
                    cv2.LINE_AA
                )

            if field_name in {
                "score",
                "shots",
                "ping"
            }:
                center_error = item.get(
                    "centerErrorPx"
                )

                if (
                    center_error is None
                    and actual_x is not None
                    and anchor_x is not None
                ):
                    center_error = (
                        float(actual_x)
                        - float(anchor_x)
                    )

                label_x = int(
                    round(
                        float(
                            item.get(
                                "left",
                                ref.get(
                                    "left",
                                    0
                                )
                            )
                        )
                        * scale
                    )
                )

                _put_label(
                    canvas,
                    (
                        f"{field_name.upper()} "
                        f"A={float(anchor_x):.1f} "
                        f"B={float(actual_x):.1f} "
                        f"E={float(center_error or 0.0):+.1f}"
                    ),
                    label_x,
                    min(
                        canvas.shape[0] - 4,
                        y2 + 22
                    ),
                    0.29
                )

        # --------------------------------------------------------
        # Relative identity targets / title mode
        # --------------------------------------------------------
        identity_layout = (
            row.get(
                "identityLayout"
            )
            or {}
        )

        username_ref = fields.get(
            "username"
        )

        if isinstance(
            username_ref,
            dict
        ):
            uy1 = int(
                round(
                    float(
                        username_ref.get(
                            "top",
                            0
                        )
                        or 0
                    )
                    * scale
                )
            )

            uy2 = int(
                round(
                    float(
                        username_ref.get(
                            "bottom",
                            0
                        )
                        or 0
                    )
                    * scale
                )
            )

            for target_label, target_key, target_color in (
                (
                    "PARTY TARGET",
                    "partyExpectedX",
                    (80, 255, 80)
                ),
                (
                    "MVP TARGET",
                    "mvpExpectedX",
                    (80, 180, 255)
                ),
            ):
                target_x = identity_layout.get(
                    target_key
                )

                if target_x is None:
                    continue

                target_px = int(
                    round(
                        float(
                            target_x
                        )
                        * scale
                    )
                )

                cv2.line(
                    canvas,
                    (
                        target_px,
                        max(
                            0,
                            uy1 - 10
                        )
                    ),
                    (
                        target_px,
                        min(
                            canvas.shape[0] - 1,
                            uy2 + 10
                        )
                    ),
                    target_color,
                    1,
                    cv2.LINE_AA
                )

                _put_label(
                    canvas,
                    target_label,
                    target_px + 2,
                    max(
                        18,
                        uy1 - 12
                    ),
                    0.25
                )

            title_label = (
                "NAME ALIGN="
                + str(identity_layout.get("usernameAlignment") or "center").upper()
                + " / FIXED EXPANDED BOX"
            )

            _put_label(
                canvas,
                title_label,
                int(
                    round(
                        float(
                            username_ref.get(
                                "left",
                                0
                            )
                            or 0
                        )
                        * scale
                    )
                ),
                min(
                    canvas.shape[0] - 4,
                    uy2 + 16
                ),
                0.27
            )

            text_detection = identity_layout.get("textLineDetection") or {}
            scan_bounds = text_detection.get("scanBounds") or {}
            if scan_bounds:
                cv2.rectangle(
                    canvas,
                    (
                        int(round(float(scan_bounds.get("left", 0)) * scale)),
                        int(round(float(scan_bounds.get("top", 0)) * scale)),
                    ),
                    (
                        int(round(float(scan_bounds.get("right", 0)) * scale)),
                        int(round(float(scan_bounds.get("bottom", 0)) * scale)),
                    ),
                    (255, 160, 40),
                    1,
                    cv2.LINE_AA,
                )

            for line_index, line in enumerate(
                identity_layout.get("detectedTextLines") or [],
                start=1,
            ):
                cv2.rectangle(
                    canvas,
                    (
                        int(round(float(line.get("left", 0)) * scale)),
                        int(round(float(line.get("top", 0)) * scale)),
                    ),
                    (
                        int(round(float(line.get("right", 0)) * scale)),
                        int(round(float(line.get("bottom", 0)) * scale)),
                    ),
                    (255, 255, 40) if line_index == 1 else (180, 80, 255),
                    1,
                    cv2.LINE_AA,
                )

        # --------------------------------------------------------
        # Identity icon search windows are retained in metadata but are not
        # drawn: they were visually confused with actual icon detections.
        # PARTY/MVP TARGET lines show prediction; PARTY/MVP FOUND boxes show
        # confirmed contours.
        # --------------------------------------------------------
        # --------------------------------------------------------
        # Identity icon exclusions / actual detections
        # --------------------------------------------------------
        exclusions = (
            row.get(
                "identityIconExclusions"
            )
            or {}
        )

        identity_layout = (
            row.get(
                "identityLayout"
            )
            or {}
        )

        for label, key, color in (
            (
                "PARTY FOUND",
                "partyIcon",
                (80, 255, 80)
            ),
            (
                "MVP FOUND",
                "mvpIcon",
                (80, 180, 255)
            ),
        ):
            icon = exclusions.get(
                key
            )

            if not isinstance(
                icon,
                dict
            ):
                continue

            x1 = int(
                round(
                    float(
                        icon.get(
                            "left",
                            0
                        )
                        or 0
                    )
                    * scale
                )
            )

            x2 = int(
                round(
                    float(
                        icon.get(
                            "right",
                            0
                        )
                        or 0
                    )
                    * scale
                )
            )

            y1 = int(
                round(
                    float(
                        icon.get(
                            "top",
                            0
                        )
                        or 0
                    )
                    * scale
                )
            )

            y2 = int(
                round(
                    float(
                        icon.get(
                            "bottom",
                            0
                        )
                        or 0
                    )
                    * scale
                )
            )

            cv2.rectangle(
                canvas,
                (x1, y1),
                (x2, y2),
                color,
                2
            )

            _put_label(
                canvas,
                label,
                x1,
                max(
                    18,
                    y1 - 4
                ),
                0.28
            )

    _put_label(
        canvas,
        "YELLOW=ANCHOR  CYAN=BOX CENTER  PURPLE=FOUNDATION",
        8,
        max(
            22,
            canvas.shape[0] - 10
        ),
        0.36
    )

    return _write_image(
        current_debug_trace_id(),
        "03_coordinate_references.jpg",
        canvas
    )



def save_pass1_sharpen_comparison(
    image,
    row_references,
    sharpen_fields,
    amount=1.30,
    blur_sigma=0.90,
):
    """Mode 4: side-by-side RAW vs SHARPENED exact Pass-1 coordinate crops."""
    if not debug_enabled("images") or image is None or image.size == 0:
        return None

    sharpen_fields = set(sharpen_fields or [])
    tiles = []

    for row in row_references or []:
        player_index = int(row.get("playerIndex", 0) or 0)
        fields = row.get("fields") or {}

        for field_name, ref in fields.items():
            if field_name not in sharpen_fields:
                continue
            if not isinstance(ref, dict):
                continue

            x1 = max(0, int(ref.get("left", 0) or 0))
            y1 = max(0, int(ref.get("top", 0) or 0))
            x2 = min(image.shape[1], int(ref.get("right", 0) or 0))
            y2 = min(image.shape[0], int(ref.get("bottom", 0) or 0))

            if x2 <= x1 or y2 <= y1:
                continue

            raw = image[y1:y2, x1:x2].copy()
            if raw is None or raw.size == 0:
                continue

            blurred = cv2.GaussianBlur(
                raw,
                (0, 0),
                float(blur_sigma)
            )
            sharpened = cv2.addWeighted(
                raw,
                float(amount),
                blurred,
                -(float(amount) - 1.0),
                0
            )

            for label, crop in (
                ("RAW", raw),
                ("SHARP", sharpened),
            ):
                target_h = 92
                scale = target_h / max(1, crop.shape[0])
                target_w = max(
                    90,
                    min(
                        380,
                        int(round(crop.shape[1] * scale))
                    )
                )
                tile = cv2.resize(
                    crop,
                    (target_w, target_h),
                    interpolation=cv2.INTER_CUBIC
                )
                tile = cv2.copyMakeBorder(
                    tile,
                    42,
                    8,
                    4,
                    4,
                    cv2.BORDER_CONSTANT,
                    value=(18, 18, 18)
                )
                _put_label(
                    tile,
                    f"P{player_index} {field_name} {label}",
                    5,
                    17,
                    0.36
                )
                _put_label(
                    tile,
                    f"[{x1},{y1}]-[{x2},{y2}] a={amount:.2f} s={blur_sigma:.2f}",
                    5,
                    34,
                    0.28
                )
                tiles.append(tile)

    if not tiles:
        return None

    # Keep RAW/SHARP pairs beside each other.
    columns = 4 if len(tiles) >= 4 else 2
    cell_w = max(tile.shape[1] for tile in tiles)
    cell_h = max(tile.shape[0] for tile in tiles)
    rows = (len(tiles) + columns - 1) // columns

    sheet = np.zeros(
        (rows * cell_h, columns * cell_w, 3),
        dtype=np.uint8
    )

    for index, tile in enumerate(tiles):
        row_index = index // columns
        column_index = index % columns
        sheet[
            row_index * cell_h:row_index * cell_h + tile.shape[0],
            column_index * cell_w:column_index * cell_w + tile.shape[1]
        ] = tile

    return _write_image(
        current_debug_trace_id(),
        "stage_pass1_raw_vs_sharpened.jpg",
        sheet
    )

def save_stage_crop_sheet(image, row_references, stage_name, requested_by_player=None):
    """Mode 4: contact sheet of the exact raw locations a stage is allowed to read."""
    if not debug_enabled("images") or image is None or image.size == 0:
        return None
    tiles = []
    requested_by_player = requested_by_player or {}
    for row in row_references or []:
        player_index = int(row.get("playerIndex", 0) or 0)
        fields = row.get("fields") or {}
        requested = requested_by_player.get(player_index)
        if requested is None:
            requested = list(fields.keys())
        for field_name in requested:
            ref = fields.get(field_name)
            if not isinstance(ref, dict):
                continue
            x1 = max(0, int(ref.get("left", 0) or 0))
            y1 = max(0, int(ref.get("top", 0) or 0))
            x2 = min(image.shape[1], int(ref.get("right", 0) or 0))
            y2 = min(image.shape[0], int(ref.get("bottom", 0) or 0))
            if x2 <= x1 or y2 <= y1:
                continue
            crop = image[y1:y2, x1:x2].copy()
            if crop is None or crop.size == 0:
                continue
            target_h = 82
            scale = target_h / max(1, crop.shape[0])
            target_w = max(80, min(360, int(round(crop.shape[1] * scale))))
            crop = cv2.resize(crop, (target_w, target_h), interpolation=cv2.INTER_CUBIC)
            crop = cv2.copyMakeBorder(
                crop,
                38,
                8,
                4,
                4,
                cv2.BORDER_CONSTANT,
                value=(18, 18, 18)
            )
            _put_label(
                crop,
                f"P{player_index} {field_name} [{x1},{y1}]-[{x2},{y2}]",
                5,
                17,
                0.36
            )
            _put_label(
                crop,
                str(ref.get("source") or "coordinate_ref"),
                5,
                33,
                0.30
            )
            tiles.append(crop)
    if not tiles:
        return None
    columns = min(4, max(1, len(tiles)))
    cell_w = max(tile.shape[1] for tile in tiles)
    cell_h = max(tile.shape[0] for tile in tiles)
    rows = (len(tiles) + columns - 1) // columns
    sheet = np.zeros((rows * cell_h, columns * cell_w, 3), dtype=np.uint8)
    for index, tile in enumerate(tiles):
        row = index // columns
        col = index % columns
        sheet[row * cell_h:row * cell_h + tile.shape[0], col * cell_w:col * cell_w + tile.shape[1]] = tile
    safe_stage = _safe_token(stage_name, "stage")
    return _write_image(current_debug_trace_id(), f"stage_{safe_stage}_raw_refs.jpg", sheet)


def save_stage_variant_crop_sheet(
    image,
    row_references,
    stage_name,
    requested_by_player,
    variant_specs,
):
    """Mode 4: show the exact expanded/shifted variants a recovery stage reads."""
    if not debug_enabled("images") or image is None or image.size == 0:
        return None

    tiles = []
    requested_by_player = requested_by_player or {}
    variant_specs = list(variant_specs or [])

    for row in row_references or []:
        player_index = int(row.get("playerIndex", 0) or 0)
        fields = row.get("fields") or {}
        requested = requested_by_player.get(player_index) or []

        for field_name in requested:
            ref = fields.get(field_name)
            if not isinstance(ref, dict):
                continue

            x1 = float(ref.get("left", 0) or 0)
            y1 = float(ref.get("top", 0) or 0)
            x2 = float(ref.get("right", 0) or 0)
            y2 = float(ref.get("bottom", 0) or 0)
            ref_width = max(1.0, x2 - x1)
            ref_height = max(1.0, y2 - y1)

            for spec in variant_specs:
                label = str(spec.get("label") or "variant")
                expand_x = float(spec.get("expandX", 0.0) or 0.0)
                expand_y = float(spec.get("expandY", 0.0) or 0.0)
                shift_x = float(spec.get("shiftX", 0.0) or 0.0)
                shift_y = float(spec.get("shiftY", 0.0) or 0.0)

                dx = ref_width * expand_x
                dy = ref_height * expand_y
                sx = ref_width * shift_x
                sy = ref_height * shift_y

                rx1 = max(0, int(round(x1 - dx + sx)))
                ry1 = max(0, int(round(y1 - dy + sy)))
                rx2 = min(image.shape[1], int(round(x2 + dx + sx)))
                ry2 = min(image.shape[0], int(round(y2 + dy + sy)))

                if rx2 <= rx1 or ry2 <= ry1:
                    continue

                crop = image[ry1:ry2, rx1:rx2].copy()
                if crop is None or crop.size == 0:
                    continue

                target_h = 92
                scale = target_h / max(1, crop.shape[0])
                target_w = max(
                    90,
                    min(
                        380,
                        int(round(crop.shape[1] * scale)),
                    ),
                )
                crop = cv2.resize(
                    crop,
                    (target_w, target_h),
                    interpolation=cv2.INTER_CUBIC,
                )
                crop = cv2.copyMakeBorder(
                    crop,
                    42,
                    8,
                    4,
                    4,
                    cv2.BORDER_CONSTANT,
                    value=(18, 18, 18),
                )
                _put_label(
                    crop,
                    f"P{player_index} {field_name} {label}",
                    5,
                    17,
                    0.36,
                )
                _put_label(
                    crop,
                    f"[{rx1},{ry1}]-[{rx2},{ry2}] ex={expand_x:.3f} sx={shift_x:.3f}",
                    5,
                    34,
                    0.28,
                )
                tiles.append(crop)

    if not tiles:
        return None

    columns = min(4, max(1, len(tiles)))
    cell_w = max(tile.shape[1] for tile in tiles)
    cell_h = max(tile.shape[0] for tile in tiles)
    rows = (len(tiles) + columns - 1) // columns
    sheet = np.zeros(
        (rows * cell_h, columns * cell_w, 3),
        dtype=np.uint8,
    )

    for index, tile in enumerate(tiles):
        row = index // columns
        col = index % columns
        sheet[
            row * cell_h:row * cell_h + tile.shape[0],
            col * cell_w:col * cell_w + tile.shape[1],
        ] = tile

    safe_stage = _safe_token(stage_name, "stage")
    return _write_image(
        current_debug_trace_id(),
        f"stage_{safe_stage}_variants.jpg",
        sheet,
    )
