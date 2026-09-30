# DomainData System Map

Snapshot: 2026-09-29

## Runtime overview

- `public/` is the browser-delivered site and calls the same-origin Pages API.
- `functions/api/` contains Cloudflare Pages routes; reusable server logic is
  under `functions/services/`.
- `workers/` contains independently configured Cloudflare Workers.
- `ocr_cloudData/` is a separate Google Cloud Run Python OCR service and is
  ignored by Git as intended.

## OCR execution

Browser -> Pages OCR submission -> R2 + queue -> `workers/ocr-job-consumer/`
-> Pages `functions/api/ocr/jobs/process_job.js` -> internal Pages binding
`OCR_GOOGLE_TRANSPORT` -> `workers/ocr-cloud-run-proxy/` -> Google mTLS STS
-> IAM Credentials `generateIdToken` -> fixed Cloud Run OCR endpoint
-> Pages result persistence and progress -> browser polling.

The synchronous `/api/ocr` handler uses the same internal transport after
Pages-side session, Epic, and ownership validation. Google credentials remain
inside the transport Worker and are not returned to Pages or the browser.
`workers/google-mtls-diagnostic/` remains temporary/reference-only. The
authenticated `/api/ocr/compare` endpoint remains a separate Pages auth caller
because it has a second, not-yet-documented Cloud Run test target. The
admin-only `/api/ocr/debug/mtls-probe` remains a diagnostic-only direct binding
probe and is not used for normal processing.

## Configuration ownership

- Root `wrangler.jsonc` owns Pages bindings, including
  `OCR_GOOGLE_TRANSPORT -> bpd-ocr-cloud-run-proxy`.
- `workers/ocr-cloud-run-proxy/wrangler.jsonc` owns its fixed Cloud Run target,
  Google WIF identifiers, mTLS binding, timeout, and secret-gated custom domain.
  `OCR_GCP_X509_CERT_CHAIN`, `OCR_API_KEY`, and
  `OCR_GOOGLE_TRANSPORT_SECRET` are Worker secrets, not repository values. The
  transport secret is also configured as a Pages secret.
- `workers/ocr-job-consumer/wrangler.jsonc` owns OCR queue consumption and
  continues to call the Pages process endpoint. Its queue, retry, and cleanup
  behavior is unchanged.
- `workers/google-mtls-diagnostic/` is not part of production job execution.

See [OCR authentication sub-map](system_sub_map/ocr-auth-transport.md) for the
transport contract, boundaries, and operator sequence.

## Review and operational status

- OCR result review keeps header team goals separate from player SCORE. Team
  totals and uncertain OCR names can be explicitly reviewed and written to the
  existing R2 match report with human-verification provenance. Roster matching
  is a suggestion source only; all candidate matches require reviewer selection
  because no player/account identity store is present. Initial confidence bands
  (0.90 high, 0.70 review floor) are centralized and should be calibrated from
  reviewed samples before adjustment. A roster candidate keeps the job in the
  existing review state; it is never silently auto-accepted as identity.
- `/Admin/WorkerStatus` is the unified System Status page; the old
  `/Admin/PageSettings` route is a compatibility alias to the same screen. It
  uses `ADMIN_SETTINGS_MANAGE`, shows compact health rows plus collapsed route,
  connection, and findings diagnostics. It calls
  `/api/admin/system-status` for service health and
  `/api/admin/page-settings/route-health` for the read-only page inventory.
  The Pages aggregator caches the normalized
  seven-service response for 45 seconds and deduplicates concurrent checks.
  Routine refreshes make bounded RL, OCR transport, and MMR checks; Cloud Run
  and Supabase use last-known state, while the OCR queue is read from a
  per-invocation heartbeat. Service-specific actions use an explicit allowlist;
  only RL presence has `Run Now`, while MMR/PsyNet has `Reconnect` and
  `Check Rocket League Version`. The MMR details remain secret-free and include
  build state, safe build metadata, validation/check timestamps, auth/failure
  stages, recent request outcomes, backoff, reconnect results, latency, and
  counters. The check is an explicit admin action routed Pages -> MMR Worker;
  no browser-held admin secret or direct Worker call is used.
  Runtime Build ID/Feature Set updates use the same protected MMR admin key,
  validate in the singleton Durable Object, persist only on success, and
  reconnect without deployment. Production code redeploys use the dedicated
  `admin.mmr.deploy` permission and fixed
  `/api/admin/system-status/mmr-deploy` route, which dispatches only
  `bigpapadanger-cmd/mmr-api-v3` / `main` /
  `deploy-production.yml` and tracks the run in `RL_STATS_CACHE`.
- OCR transport and RL presence record safe operational state in the existing
  `RL_STATS_CACHE` namespace through their `SERVICE_STATUS` bindings. Queue
  status writes once per queue invocation. Cloud Run readiness is an explicit
  secret-gated transport action; routine page refresh never mints credentials
  or calls Cloud Run. Supabase is checked only when an admin requests Recheck.
- See [Worker Status sub-map](system_sub_map/worker-status.md) and
  [request-frequency inventory](request-frequency-inventory.md) for contracts,
  action limits, and dependency semantics.
- See [request-frequency inventory](request-frequency-inventory.md) for audited
  callers, controls, and known measurement gaps.
