# BPD OCR v16.1 — Isolated Cells + Debug Cutout Refinement

## What changed

The foundation/bounding box and row anchors remain authoritative and unchanged.

After foundation passes:

1. Header-fitted column centers are reused.
2. Adjacent header-center midpoints create hard, non-overlapping numeric cells.
3. A small inner gutter prevents neighboring stat glyphs from leaking into a cell.
4. PING uses the direct detected ping region whenever available, with modest padding.
5. Username/title OCR starts to the right of rank/avatar UI while retaining clan/name text.
6. Pass 1 and Pass 2 treat a valid OCR digit as positive evidence of content, including thin zeros.
7. Paddle's content check is advisory; requested fields are skipped only when the coordinate is genuinely blank and there is no earlier OCR evidence.
8. Paddle runtime errors are now exposed in `validation.paddle_ocr.errorsByPlayer`.
9. Debug mode 4 now includes exact cutouts plus the actual expanded/shifted variants used by Pass 3A, Pass 3B, and Paddle.

## New mode-4 visual files

- `03_coordinate_references.jpg`
- `stage_pass1_raw_refs.jpg`
- `stage_pass2_raw_refs.jpg`
- `stage_pass3a_raw_refs.jpg`
- `stage_pass3a_variants.jpg`
- `stage_pass3b_raw_refs.jpg`
- `stage_pass3b_variants.jpg`
- `stage_paddle_raw_refs.jpg`
- `stage_paddle_variants.jpg`
- `03_final_layout.jpg`

Each cutout is labeled with player, field, exact pixel coordinates, and coordinate source.

## Regression result on EIS/KANG sample

With Paddle unavailable in the build environment:

- EIS score: 11925
- EIS goals: 99
- EIS assists: 0
- EIS shots: 107
- EIS ping: 80
- KANG score/goals/assists/saves/shots: 0
- KANG ping: 32
- KANG identity matched at 100%

EIS saves remained a Tesseract conflict (4 vs 0) and was correctly routed to Paddle.
Paddle did not run locally because the build environment does not have the `paddleocr` package.
The new result explicitly reports that runtime error instead of silently showing zero calls.

## Main versions

- main: `main-v16.1-isolated-cells-debug-cutouts`
- layout: `layout-v2.1-isolated-midpoint-cells`
- pass1: `pass1-v1.1-isolated-midpoint-cells`
- pass2: `pass2-v5.1-ocr-confirmed-presence`
- pass3: `pass3-v15.1-shared-sweep-specs`
- paddle: `paddle-v13.1-presence-advisory-isolated-best-fit`
- config: `config-v3.1-debug-cutout-sheets`
