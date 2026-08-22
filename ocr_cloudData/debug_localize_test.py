"""Local foundation/preflight debugger with explicit debug modes 1-4.

1 = quick summary
2 = medium structural summary
3 = full structural JSON
4 = full JSON + key image snippets; with a complete roster it also runs the
    full OCR pipeline so Pass1/2/3/Paddle coordinate snippets are generated.
"""

import argparse
import json
import os
import sys
from pathlib import Path
from uuid import uuid4

# Config is import-time, so set requested numeric level first.
if "--debug-mode" in sys.argv:
    try:
        os.environ["OCR_DEBUG_LEVEL"] = str(sys.argv[sys.argv.index("--debug-mode") + 1])
    except Exception:
        pass

import cv2

from ocr_config import OCR_DEBUG_LOCAL_DIR
from ocr_debug import begin_debug_context, clear_debug_context, save_localization_overlay, save_structure_overlay
from preparation import localize_scoreboard, prepare_scoreboard


def parse_names(raw):
    return [item.strip() for item in str(raw or "").split(",") if item.strip()]


def _quick(localization, preflight=None):
    payload = {
        "localizationPass": bool(localization.get("pass")),
        "locator": localization.get("locator"),
        "confidence": localization.get("boundsConfidence"),
        "detectedRows": localization.get("detectedRows"),
        "sourceBounds": localization.get("sourceBounds"),
    }
    if isinstance(preflight, dict):
        payload["preflightPass"] = bool(preflight.get("pass"))
        payload["preflightStage"] = preflight.get("stage")
        payload["preflightConfidence"] = preflight.get("preflightConfidence")
    return payload


def _medium(localization, preflight=None):
    payload = {"localization": _quick(localization)}
    if isinstance(preflight, dict):
        prepared = preflight.get("preparedData") if isinstance(preflight.get("preparedData"), dict) else {}
        payload["preflight"] = {
            "pass": preflight.get("pass"),
            "reason": preflight.get("reason"),
            "stage": preflight.get("stage"),
            "detectedPingRegions": preflight.get("detectedPingRegions"),
            "detectedStatRows": preflight.get("detectedStatRows"),
            "detectedRows": preflight.get("detectedRows"),
            "directAnchorRows": preflight.get("directAnchorRows"),
            "middleStat": preflight.get("middleStat"),
            "teamStructure": preflight.get("teamStructure"),
            "columnGeometry": prepared.get("columnGeometry"),
            "rowAnchors": prepared.get("rowAnchors"),
            "evidenceReuse": prepared.get("evidenceReuse"),
        }
    return payload


def main():
    parser = argparse.ArgumentParser(description="Debug BPD foundation/localization locally.")
    parser.add_argument("--image", required=True)
    parser.add_argument("--players-per-team", required=True, type=int, choices=[1, 2, 3, 4])
    parser.add_argument("--names", default="", help="Optional complete roster, Team 1 then Team 2.")
    parser.add_argument("--trace-id", default="")
    parser.add_argument("--debug-mode", type=int, choices=[1, 2, 3, 4], default=2)
    args = parser.parse_args()

    image_path = Path(args.image).expanduser().resolve()
    image = cv2.imread(str(image_path))
    if image is None:
        raise SystemExit(f"Could not read image: {image_path}")

    trace_id = args.trace_id.strip() or f"local-{uuid4().hex[:12]}"
    output_dir = OCR_DEBUG_LOCAL_DIR / trace_id
    output_dir.mkdir(parents=True, exist_ok=True)
    begin_debug_context(trace_id)

    localization = localize_scoreboard(image, args.players_per_team)
    if args.debug_mode >= 4:
        save_localization_overlay(trace_id, image, localization)

    names = parse_names(args.names)
    expected_players = args.players_per_team * 2
    preflight = None
    prepared_image = None
    if localization.get("pass") is True and len(names) == expected_players:
        bounds = localization["sourceBounds"]
        x, y = int(bounds["x"]), int(bounds["y"])
        w, h = int(bounds["width"]), int(bounds["height"])
        roi = image[y:y + h, x:x + w]
        preflight = prepare_scoreboard(roi, args.players_per_team, names)
        prepared_image = preflight.get("_preparedImage")
        if args.debug_mode >= 4:
            save_structure_overlay(prepared_image if prepared_image is not None else roi, preflight, args.players_per_team)
    elif names:
        preflight = {
            "pass": False,
            "stage": "test_input",
            "reason": (
                "localization_failed" if localization.get("pass") is not True
                else f"expected_{expected_players}_names_received_{len(names)}"
            ),
        }

    if args.debug_mode == 1:
        summary = _quick(localization, preflight)
    elif args.debug_mode == 2:
        summary = _medium(localization, preflight)
    else:
        clean_preflight = dict(preflight or {})
        clean_preflight.pop("_evidenceContext", None)
        clean_preflight.pop("_preparedImage", None)
        clean_preflight.pop("_debugImage", None)
        summary = {
            "traceId": trace_id,
            "image": str(image_path),
            "playersPerTeam": args.players_per_team,
            "localization": localization,
            "preflight": clean_preflight,
        }

    summary_path = output_dir / "debug_summary.json"
    summary_path.write_text(json.dumps(summary, indent=2, ensure_ascii=False, default=str), encoding="utf-8")

    full_result_path = None
    if args.debug_mode == 4 and len(names) == expected_players and localization.get("pass") is True:
        # Full OCR is deliberately imported only for mode 4 after debug config is set.
        from ocr import read_scoreboard_image
        full_result = read_scoreboard_image(str(image_path), args.players_per_team, names)
        full_result_path = output_dir / "ocr_result.json"
        full_result_path.write_text(json.dumps(full_result, indent=2, ensure_ascii=False, default=str), encoding="utf-8")

    clear_debug_context(delete_files=False)
    print(f"Debug mode: {args.debug_mode}")
    print(f"Debug folder: {output_dir}")
    print(f"Summary: {summary_path}")
    if full_result_path:
        print(f"OCR result: {full_result_path}")
    print(json.dumps(_quick(localization, preflight), indent=2))


if __name__ == "__main__":
    main()
