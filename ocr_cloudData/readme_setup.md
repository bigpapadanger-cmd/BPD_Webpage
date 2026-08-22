# BPD OCR Durable v13.2 — Conservative Visual Debug Build

This package is the coordinated OCR rewrite discussed in chat. It keeps the existing Tesseract/Paddle recovery logic where it was useful, but changes the orchestration so localization, team/row structure, durable background processing, and debug output have one consistent contract.

## Runtime flow

1. Browser creates a small localization JPEG and POSTs it to `/api/ocr/localize`.
2. Localization uses team-color bands + ping/stat geometry. It does not run Paddle and does not use repeated Tesseract candidate probes.
3. Browser maps normalized localization bounds back to the original screenshot and crops the original high-resolution scoreboard ROI.
4. Browser POSTs that ROI to `/api/ocr` with the expected roster ordered Team 1 first, Team 2 second.
5. Cloud Run uploads the temporary ROI to Cloud Storage, creates a Firestore job, enqueues Cloud Tasks, and immediately returns the durable job ID.
6. Cloud Tasks calls `/api/ocr/process`; the entire CPU-heavy OCR run stays inside this active request.
7. Firestore owns durable stage/progress/result state, so the browser can close/reopen and resume from the real backend stage.
8. Source ROI is deleted after a deterministic terminal result. Firestore TTL and bucket lifecycle clean stale leftovers.

## Structural rules

- Submitted roster remains mandatory.
- The first N expected names belong to Team 1 and the next N to Team 2.
- Preflight does **not** require exact name recognition.
- Physical row geometry owns team assignment.
- Final name assignment is constrained inside the physical team and cannot swap players across teams.
- Detailed OCR recomputes anchors on the submitted high-resolution ROI.
- Ping/stat evidence is represented directly on each row anchor.
- A real stat-supported row with no credible ping can be treated as a departed-player / unavailable-ping row.
- Paddle is an expected recovery stage, not an exceptional failure path.

# Debug system

There is now one server-side master switch:

```text
OCR_DEBUG_LEVEL=off
OCR_DEBUG_LEVEL=summary
OCR_DEBUG_LEVEL=usage
OCR_DEBUG_LEVEL=full
OCR_DEBUG_LEVEL=images
```

`usage` currently has the same collection level as `summary`; it is retained as a readable alias.

## `off`

- No process profiler.
- No debug JSON.
- No debug images.
- Minimum diagnostic overhead.

## `summary` — recommended production default

- Runtime/resource profiling is available.
- Compact usage summary is stored in the existing Firestore terminal job update.
- No result JSON is created in Cloud Storage.
- No debug images are created.
- The temporary source ROI remains the only mandatory Cloud Storage object create per normal OCR job and is deleted after terminal processing.

## `full`

Everything in `summary`, plus:

- One `debug.json` object in Cloud Storage.
- `/api/ocr/detail/<jobId>` and `/api/ocr/debug/<jobId>` can derive detailed diagnostics from that single stored JSON.
- No individual OCR crop images are generated.

## `images` — testing mode

Everything in `full`, plus a deliberately small visual audit trail:

1. `01_localization_bounds.jpg`
   - full localization input
   - selected scoreboard box
   - color-family candidate boxes
   - localizer/method/confidence/row/ping/stat counts

2. `02_team_anchors.jpg`
   - final high-resolution OCR ROI
   - Team 1 / Team 2 boundary
   - every physical row anchor
   - anchor type (`ping_stat`, `ping`, `stat`, `inferred`)
   - ping rectangles
   - stat evidence rectangles
   - color/spacing team-grouping diagnostics

3. `03_final_layout.jpg`
   - final physical rows
   - assigned team
   - recognized/matched player identity/status

The OCR-job image budget defaults to **2 composite images**. Localization is a separate lightweight request and may create one localization composite. The old Pass 2 and Paddle per-crop PNG systems are disabled; they no longer create dozens/hundreds of files.

### Conservative storage behavior in `images`

A normal visual-debug test creates at most approximately:

- 1 temporary source ROI object
- 1 localization JPEG
- up to 2 OCR-job composite JPEGs
- 1 debug JSON

The source ROI is deleted after terminal processing. The included bucket lifecycle deletes `ocr_debug/` objects after 2 days and leaves an 8-day safety cleanup for `ocr_jobs/` objects.

Local development writes the same composites to:

```text
backend/output/ocr_debug/<trace-or-job-id>/
```

On Cloud Run, local debug files are removed after upload by default because the filesystem is ephemeral.

## Debug endpoints

When `OCR_DEBUG_LEVEL=full` or `images`:

```text
GET /api/ocr/debug/<jobId>
GET /api/ocr/detail/<jobId>
```

Usage remains available from Firestore even in `summary`:

```text
GET /api/ocr/usage/<jobId>
```

In `images`, `/api/ocr/debug/<jobId>` includes `visualArtifacts` routes. Individual images can be retrieved through:

```text
GET /api/ocr/debug/<jobId>/image/localizationOverlay
GET /api/ocr/debug/<jobId>/image/02_team_anchors
GET /api/ocr/debug/<jobId>/image/03_final_layout
```

All `/api/ocr/*` routes remain protected by the existing private API key injected by the Cloudflare Worker.

# Files

## Backend

- `server.py` — Flask API, durable submission, Cloud Tasks processing, status/debug routes.
- `ocr_store.py` — Firestore, Cloud Storage, Cloud Tasks.
- `ocr_debug.py` — centralized, budgeted composite visual debugger.
- `preparation.py` — structural localization/preflight and physical row/team reconstruction.
- `ocr_identity.py` — shared identity normalization/fuzzy/team-constrained assignment.
- `ocr.py` — main orchestrator/final validation.
- `ocr_pass2.py` — Tesseract baseline/second pass. Legacy per-crop debug output removed.
- `ocr_pass3.py` — recovery logic and Paddle routing.
- `zero_seven.py` — dedicated 0/7 specialist.
- `paddleocr_validation.py` — Paddle validation/recovery. Legacy per-crop debug output removed.
- `paddle_runtime.py` — single-flight Paddle model runtime.
- `paddle_prefetch.py` — build-time Paddle model acquisition.
- `ocr_field_state.py` — progressive field locks.
- `ocr_confidence.py` — final confidence/report-ready model.
- `ocr_diagnostics.py` — runtime/resource profiler using the same master debug level.
- `ocr_results.py` — public/detail/usage result shaping.
- `ocr_config.py` — all environment/config/debug limits.
- `Dockerfile`
- `requirements.txt`

## Frontend

- `submit_core.js` — crop/image state and durable localization debug correlation.
- `submit_img.js` — localization, high-resolution ROI submit, durable polling/resume.
- `submit_onpage_items.js`

# Conservative progress persistence

Firestore progress writes are rate-limited. A progress change is persisted when the stage changes, or when both:

- at least `OCR_PROGRESS_WRITE_MIN_INTERVAL_SECONDS` has passed, and
- progress advanced by at least `OCR_PROGRESS_WRITE_MIN_DELTA` percentage points.

Defaults:

```text
OCR_PROGRESS_WRITE_MIN_INTERVAL_SECONDS=1
OCR_PROGRESS_WRITE_MIN_DELTA=2
```

The browser can animate smoothly between backend milestones without forcing Firestore to receive one write per displayed percentage point.

# Local structural debug before Google Cloud setup

You can test the crop/team/anchor logic locally without Cloud Storage, Firestore, Cloud Tasks, or Paddle:

```powershell
cd backend
python debug_localize_test.py `
  --image "C:\path\to\scoreboard.png" `
  --players-per-team 2 `
  --names "TEAM1PLAYER1,TEAM1PLAYER2,TEAM2PLAYER1,TEAM2PLAYER2"
```

This creates only local files under:

```text
backend/output/ocr_debug/<trace-id>/
```

Typical outputs are `01_localization_bounds.jpg`, `02_team_anchors.jpg`, and `debug_summary.json`. This local structural test does not initialize Paddle and does not consume Google Cloud storage/task/database operations.

# Google Cloud initialization — PowerShell

Do these after you are ready to initialize the durable backend.

## 1. Variables / project

```powershell
$PROJECT_ID = "bpd-ocr-cloud"
$REGION = "us-central1"
$SERVICE = "bpd-ocr"
$QUEUE = "bpd-ocr"
$BUCKET = "$PROJECT_ID-ocr-jobs"
$RUNTIME_SA_NAME = "bpd-ocr-runtime"
$RUNTIME_SA = "$RUNTIME_SA_NAME@$PROJECT_ID.iam.gserviceaccount.com"

gcloud config set project $PROJECT_ID
```

## 2. Enable APIs

```powershell
gcloud services enable `
  run.googleapis.com `
  cloudbuild.googleapis.com `
  artifactregistry.googleapis.com `
  cloudtasks.googleapis.com `
  firestore.googleapis.com `
  storage.googleapis.com `
  secretmanager.googleapis.com
```

## 3. Firestore

Check first:

```powershell
gcloud firestore databases describe --database="(default)"
```

If the default database does not exist:

```powershell
gcloud firestore databases create `
  --database="(default)" `
  --location=$REGION `
  --edition=standard `
  --type=firestore-native
```

Enable TTL on `ocr_jobs.expiresAt`:

```powershell
gcloud firestore fields ttls update expiresAt `
  --collection-group=ocr_jobs `
  --database="(default)" `
  --enable-ttl
```

## 4. Private Cloud Storage bucket

```powershell
gcloud storage buckets create "gs://$BUCKET" `
  --location=$REGION `
  --uniform-bucket-level-access
```

From the backend folder:

```powershell
gcloud storage buckets update "gs://$BUCKET" `
  --lifecycle-file=../storage_lifecycle.json
```

Lifecycle in this package:

- `ocr_debug/` → delete after 2 days.
- `ocr_jobs/` → delete after 8 days as a safety net.

## 5. Cloud Tasks queue

```powershell
gcloud tasks queues create $QUEUE `
  --location=$REGION

gcloud tasks queues update $QUEUE `
  --location=$REGION `
  --max-concurrent-dispatches=1 `
  --max-dispatches-per-second=1 `
  --max-attempts=3 `
  --min-backoff=10s `
  --max-backoff=60s `
  --max-doublings=3
```

The heavy queue stays at one OCR task at a time. Cloud Run itself uses concurrency 2 so a second request slot remains available for status/localization/submission while the OCR task is active.

## 6. Runtime service account

```powershell
gcloud iam service-accounts create $RUNTIME_SA_NAME `
  --display-name="BPD OCR Runtime"
```

Firestore:

```powershell
gcloud projects add-iam-policy-binding $PROJECT_ID `
  --member="serviceAccount:$RUNTIME_SA" `
  --role="roles/datastore.user"
```

Cloud Tasks enqueue permission:

```powershell
gcloud tasks queues add-iam-policy-binding $QUEUE `
  --location=$REGION `
  --member="serviceAccount:$RUNTIME_SA" `
  --role="roles/cloudtasks.enqueuer"
```

Storage access only on the OCR bucket:

```powershell
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" `
  --member="serviceAccount:$RUNTIME_SA" `
  --role="roles/storage.objectAdmin"
```

## 7. Secrets

Use the existing Cloudflare → OCR API key if you already have one. Do not paste it into source code.

```powershell
gcloud secrets create ocr-api-key --replication-policy=automatic
gcloud secrets create ocr-task-token --replication-policy=automatic
```

Add your current API key:

```powershell
$OCR_API_KEY_VALUE = Read-Host "Enter existing OCR API key"
$OCR_API_KEY_VALUE | gcloud secrets versions add ocr-api-key --data-file=-
```

Generate a separate task-only token:

```powershell
$OCR_TASK_TOKEN_VALUE = ([guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N"))
$OCR_TASK_TOKEN_VALUE | gcloud secrets versions add ocr-task-token --data-file=-
```

Grant runtime access:

```powershell
gcloud secrets add-iam-policy-binding ocr-api-key `
  --member="serviceAccount:$RUNTIME_SA" `
  --role="roles/secretmanager.secretAccessor"

gcloud secrets add-iam-policy-binding ocr-task-token `
  --member="serviceAccount:$RUNTIME_SA" `
  --role="roles/secretmanager.secretAccessor"
```

## 8. First deploy — use `summary` by default

Run from the `backend` folder.

```powershell
$TEMP_TASK_TARGET = "https://example.invalid/api/ocr/process"

gcloud run deploy $SERVICE `
  --source . `
  --region $REGION `
  --service-account $RUNTIME_SA `
  --cpu 2 `
  --memory 2Gi `
  --concurrency 2 `
  --max-instances 1 `
  --min-instances 0 `
  --timeout 900 `
  --cpu-throttling `
  --allow-unauthenticated `
  --set-env-vars "GCP_PROJECT_ID=$PROJECT_ID,OCR_REGION=$REGION,OCR_FIRESTORE_COLLECTION=ocr_jobs,OCR_STORAGE_BUCKET=$BUCKET,OCR_STORAGE_PREFIX=ocr_jobs,OCR_DEBUG_STORAGE_PREFIX=ocr_debug,OCR_TASK_QUEUE=$QUEUE,OCR_TASK_LOCATION=$REGION,OCR_TASK_TARGET_URL=$TEMP_TASK_TARGET,OCR_TASK_DISPATCH_DEADLINE_SECONDS=900,OCR_TASK_LEASE_SECONDS=1080,OCR_PROCESS_MAX_ATTEMPTS=3,OCR_JOB_RETENTION_SECONDS=604800,OCR_PROGRESS_WRITE_MIN_INTERVAL_SECONDS=1,OCR_PROGRESS_WRITE_MIN_DELTA=2,OCR_DEBUG_LEVEL=summary,OCR_DEBUG_IMAGE_MAX_SIDE=1400,OCR_DEBUG_JPEG_QUALITY=78,OCR_DEBUG_MAX_IMAGES_PER_JOB=2,OCR_CPU_LIMIT=2,OCR_MEMORY_LIMIT_MB=2048,OCR_METRICS_INTERVAL_SECONDS=0.5,OCR_PADDLE_CPU_THREADS=2,OCR_PADDLE_ENABLE_MKLDNN=true,OCR_PADDLE_WARM_MODE=off" `
  --set-secrets "OCR_API_KEY=ocr-api-key:latest,OCR_TASK_TOKEN=ocr-task-token:latest"
```

## 9. Set real Cloud Tasks target

```powershell
$SERVICE_URL = gcloud run services describe $SERVICE `
  --region $REGION `
  --format="value(status.url)"

$TASK_TARGET = "$SERVICE_URL/api/ocr/process"

gcloud run services update $SERVICE `
  --region $REGION `
  --update-env-vars "OCR_TASK_TARGET_URL=$TASK_TARGET"
```

## 10. Health check

```powershell
Invoke-RestMethod "$SERVICE_URL/health"
```

You want:

```text
durableStoreReady = true
debug.level = summary
```

## 11. Turn visual debug ON for testing

```powershell
gcloud run services update $SERVICE `
  --region $REGION `
  --update-env-vars "OCR_DEBUG_LEVEL=images"
```

Health should then report:

```text
debug.level = images
debug.visualImagesPersisted = true
```

After a test job:

```text
/api/ocr/debug/<jobId>
```

will expose the visual artifact routes.

## 12. Return to conservative production mode

When visual testing is finished:

```powershell
gcloud run services update $SERVICE `
  --region $REGION `
  --update-env-vars "OCR_DEBUG_LEVEL=summary"
```

No per-crop image flags need to be toggled anywhere else.

# Validation performed on this package

- Python `compileall` passes for the full backend.
- All frontend JS files pass `node --check`.
- No unused imports were found by the package static checker.
- No duplicate top-level Python function/class names were found.
- Structural localization was run against the supplied 1536×1152 test scoreboard.
- It returned `team_color_bands`, 4 rows, 4 ping regions, 2 stat rows, and 0.925 bounds confidence.
- The generated localization composite was ~212 KB at JPEG quality 78.
- The generated team/anchor composite was ~117 KB at JPEG quality 78.
- On that 2v2 ROI, structural preflight found:
  - Team grouping = color
  - 4 physical rows
  - Team 1 rows 1–2
  - Team 2 rows 3–4
  - first two rows = `ping_stat`
  - last two rows = `ping`

A complete live Paddle execution was not run in this packaging environment because PaddleOCR is not installed here. The Docker image installs Paddle 3.3.0/PaddleOCR 3.3.0 and runs `paddle_prefetch.py` during image build.
