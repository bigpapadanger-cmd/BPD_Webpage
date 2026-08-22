# BPD OCR v16 — foundation coordinate pipeline

## Execution contract

1. **Foundation / bounding box**
   - Localization, header geometry, row structure, team structure and resolved column geometry are established first.
   - Structural pass/fail completes before report-data OCR begins.
   - Preflight name/number OCR probes are disabled; ambiguous roster identity is deferred to OCR stages.

2. **Coordinate freeze**
   - Each physical player row gets one `numberCenterY`.
   - Direct PING center is preferred; a matching stat-region center is averaged with it.
   - If PING is absent, the direct stat region owns Y; row-spacing is only the fallback.
   - Every username/title/stat/ping field is stored as a raw pixel `coordinateRef`.
   - Later stages may make small sweeps around that reference but may not rediscover scoreboard orientation.

3. **OCR Pass 1**
   - Cheap baseline Tesseract read from the frozen reference.
   - Establishes provisional values and visual-presence evidence.
   - Does not independently search the scoreboard.

4. **OCR Pass 2**
   - Slightly deeper OTSU/channel validation using the exact same references.
   - Locks clean Pass1/Pass2 agreement.

5. **OCR Pass 3A**
   - Runs only on unlocked fields.
   - Small horizontal sweep around the same reference.

6. **OCR Pass 3B**
   - Runs only when 3A cannot lock a field.
   - Deeper preprocessing/PSM sweep with modest expansion around the same reference.
   - The existing zero/seven topology specialist remains a cheap local specialist.

7. **Paddle**
   - Runs only on unresolved/conflicting report fields or weak identity.
   - Paddle recrops the raw prepared scoreboard from `coordinateRef`; it never receives Pass-1 sanitized images.
   - Each region is checked for visual content before inference.
   - Exact and modestly expanded isolated variants are batched together.
   - Paddle candidates are compared against Pass1/2/3 candidates by confidence and agreement before locking.
   - PING is included in the same batch only when Paddle is already needed elsewhere; PING alone does not load Paddle.

## Debug modes

`debug_localize_test.py --debug-mode N`

- `1`: quick summary
- `2`: medium structural summary
- `3`: full structural JSON
- `4`: full JSON + localization/foundation/coordinate/stage image snippets. With a complete roster it also runs the full OCR pipeline.

`ocr_manual_test.py` also accepts `--debug-mode 1..4` and writes full output to `output/ocr_debug/<trace>/result.json` instead of dumping JSON into the terminal.

## 1v1 regression used during refactor

Expected image values:

- EIS: `11925 / 99 / 0 / 0 / 107 / 80`
- KANG: `0 / 0 / 0 / 0 / 0 / 32`

Local Tesseract-only result after the refactor correctly locks EIS score/goals/assists/shots/ping and KANG goals/assists/saves/ping. It routes only the genuinely unresolved cells to Paddle:

- EIS: saves
- KANG: username, score, shots

The local environment used for packaging does not have the Paddle runtime/model installed, so final Paddle inference was not claimed as passed.
