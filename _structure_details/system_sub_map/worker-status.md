# Admin Worker Status

## Request and trust path

`/Admin/WorkerStatus` (also served by legacy `/Admin/PageSettings`) →
same-origin `/api/admin/system-status` for service health and
`/api/admin/page-settings/route-health` for the read-only route/configuration
inventory →
`ADMIN_SETTINGS_MANAGE` authorization → 45-second shared `RL_STATS_CACHE`
snapshot → fixed service adapters. The browser does not fan out to Workers.
Action requests use the same route, same-origin enforcement, a 1 KiB body cap,
and an explicit service/action allowlist. No action accepts a URL, hostname,
Worker name, HTTP method, shell command, or credential from the caller.

MMR production deployment uses a separate protected route and the dedicated
`admin.mmr.deploy` permission. The route accepts only `{ "confirm": true }`.
Repository, branch, workflow, and Worker are fixed server-side. It dispatches
the existing MMR repository workflow and stores sanitized run state in
`RL_STATS_CACHE`; `MMR_DEPLOY_GITHUB_TOKEN` never reaches the browser.

## Health sources

| Service | Routine source | Explicit Recheck | Last-known state |
| --- | --- | --- | --- |
| Pages | Current authorized Pages request | Marks current Pages route healthy | Not persisted |
| RL Presence | Secret-gated `/admin/health`; never runs jobs | Same protected read | Existing `RL_STATS_CACHE` namespace; presence runs only |
| OCR Transport | Secret-gated Service Binding `/health`; no Google calls | Same bounded config/liveness request | `SERVICE_STATUS`; OCR request writes throttled per isolate to 30 seconds |
| OCR Queue Consumer | Queue-only heartbeat; no HTTP liveness route | Reads heartbeat only | `SERVICE_STATUS`; once after each queue invocation |
| Cloud Run OCR | Cached result from last explicit recheck | Secret-gated fixed transport route → cached WIF credential → authenticated `/api/ocr/health`; 30-second outer/6-second health request bound | `SERVICE_STATUS`; no OCR inference |
| Supabase | Last explicit result; no routine network call | `HEAD /rest/v1/` with server-side API key, 2-second timeout | `RL_STATS_CACHE` |
| MMR API/PsyNet | Protected `/health/ready` | 45-second aggregate cache plus explicit Recheck or Check Rocket League Version | Safe config/build state, auth stage, recent-failure, backoff, reconnect, latency, and aggregate traffic state |

Worker `SERVICE_STATUS` bindings reuse the existing `RL_STATS_CACHE` KV
namespace; no new namespace or cloud resource is introduced. Presence run
summaries contain counts/status only, no player/account identifiers. OCR queue
heartbeats contain invocation counts, timestamps, bounded duration, and a
stable generic error code; no job IDs or image data.

## Action matrix

| Service | Recheck | Reconnect | Run Now |
| --- | --- | --- | --- |
| Pages | Yes | No | No |
| RL Presence | Yes | No | Yes: existing protected presence-only run |
| OCR Transport | Yes | No | No |
| OCR Queue Consumer | Yes: read heartbeat | No | No |
| Cloud Run OCR | Yes: explicit readiness-only probe | No | No |
| Supabase | Yes: bounded API availability check | No | No |
| MMR API/PsyNet | Recheck | Explicit reconnect; Check Rocket League Version through the same protected Pages allowlist | No |

MMR Details also contains two manual operations: Update Build Configuration
and Redeploy MMR Worker. Build update validates with PsyNet, persists the
runtime override, and reconnects without deploying. Redeploy requires an
explicit production confirmation, has a five-minute server cooldown, and polls
GitHub every seven seconds only while queued or running. On success the server
checks `/health` and protected `/health/ready`; deployment success and MMR
operational readiness remain separate states.

All controls remain behind the admin permission. No periodic browser refresh is
installed. See `request-frequency-inventory.md` for call rates and cooldowns.

The version action uses the fixed Pages-to-MMR server-side route and a
60-second action cooldown; the MMR Durable Object applies its own shared
manual/scheduled lock and cooldown. The MMR Worker checks once Saturday at
12:00 UTC, skipping recently validated builds. `VersionMismatch` marks build
metadata stale but does not start discovery from user requests. Since no
authoritative first-party build-discovery source is available, a check reports
`RL_VERSION_SOURCE_UNAVAILABLE`, preserves current configuration, and leaves
readiness degraded until a successful PsyNet authentication validates it.
Build ID/FeatureSet/source/timestamps are shown in Details; raw User-Agent,
credentials, and provider response content are not exposed.

The main view uses compact status-icon rows; per-service metadata is collapsed
under Details. Route, connection, and known-finding diagnostics share the same
page in collapsed groups. The sidebar and Admin home provide one System Status
entry; `/Admin/PageSettings` remains only as a bookmark-compatible alias.

## Status semantics and limits

Statuses are `healthy`, `degraded`, `down`, or `unknown`. An idle queue is not
Down; a queue with no heartbeat is Unknown. Cloud Run is Unknown until an
operator explicitly rechecks it. Supabase is Unknown until an operator
explicitly rechecks it. Pages Recheck proves the current authorized route only,
not a separate recursive network probe. KV writes are best-effort; if telemetry
storage is unavailable, the relevant last-known state may be Unknown/stale.
