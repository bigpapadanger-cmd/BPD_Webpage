"""Local production-pipeline runner. Full JSON is written to output/ocr_debug."""

import argparse
import json
import os
import sys
from datetime import datetime

# Set debug mode before importing OCR/config modules.
if "--debug-mode" in sys.argv:
    try:
        os.environ["OCR_DEBUG_LEVEL"] = str(sys.argv[sys.argv.index("--debug-mode") + 1])
    except Exception:
        pass

from ocr import read_scoreboard_image
from ocr_config import OCR_DEBUG_LOCAL_DIR
from ocr_debug import begin_debug_context, clear_debug_context


def _parse_names(value):
    return [item.strip() for item in str(value or "").split(",") if item.strip()]


def main():
    parser = argparse.ArgumentParser(description="Run BPD scoreboard OCR locally and save output to the debug folder.")
    parser.add_argument("--image", required=True)
    parser.add_argument("--players-per-team", required=True, type=int, choices=[1, 2, 3, 4])
    parser.add_argument("--names", required=True, help="Team 1 names first, then Team 2, comma-separated.")
    parser.add_argument("--debug-mode", type=int, choices=[1, 2, 3, 4], default=3)
    parser.add_argument("--trace-id", default="")
    args = parser.parse_args()

    trace_id = args.trace_id.strip() or datetime.now().strftime("manual_%Y%m%d_%H%M%S")
    output_dir = OCR_DEBUG_LOCAL_DIR / trace_id
    output_dir.mkdir(parents=True, exist_ok=True)
    begin_debug_context(trace_id)
    try:
        result = read_scoreboard_image(
            args.image,
            args.players_per_team,
            _parse_names(args.names),
        )
        result_path = output_dir / "result.json"
        result_path.write_text(json.dumps(result, indent=2, ensure_ascii=False, default=str), encoding="utf-8")
    finally:
        clear_debug_context(delete_files=False)

    print(f"OCR success: {bool(result.get('success'))}")
    print(f"Debug folder: {output_dir}")
    print(f"Result JSON: {result_path}")
    return 0 if result.get("success") else 1


if __name__ == "__main__":
    raise SystemExit(main())
