# Admin Worker Status

## Request and trust path

`/Admin/WorkerStatus` → same-origin `/api/admin/system-status` →
`ADMIN_SETTINGS_MANAGE` authorization → 45-second shared `RL_STATS_CACHE`
snapshot → fixed service adapters. The browser does not fan out to Workers.
Action requests use the same route, same-origin enforcement, a 1 KiB body cap,
and an explicit service/action allowlist. No action accepts a URL, hostname,
Worker name, HTTP method, shell command, or credential from the caller.

## Health sources

| Service | Routine source | Explicit Recheck | Last-known state |
| --- | --- | --- | --- |
| Pages | Current authorized Pages request | Marks current Pages route healthy | Not persisted |
| RL Presence | Secret-gated `/admin/health`; never runs jobs | Same protected read | Existing `RL_STATS_CACHE` namespace; presence runs only |
| OCR Transport | Secret-gated Service Binding `/health`; no Google calls | Same bounded config/liveness request | `SERVICE_STATUS`; OCR request writes throttled per isolate to 30 seconds |
| OCR Queue Consumer | Queue-only heartbeat; no HTTP liveness route | Reads heartbeat only | `SERVICE_STATUS`; once after each queue invocation |
| Cloud Run OCR | Cached result from last explicit recheck | Secret-gated fixed transport route → cached WIF credential → authenticated `/api/ocr/health`; 30-second outer/6-second health request bound | `SERVICE_STATUS`; no OCR inference |
| Supabase | Last explicit result; no routine network call | `HEAD /rest/v1/` with server-side API key, 2-second timeout | `RL_STATS_CACHE` |
| MMR API/PsyNet | Existing protected `/health/ready` | Existing readiness check | Existing implementation preserved |

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
| MMR API/PsyNet | Existing | Existing explicit reconnect | No |

All controls remain behind the admin permission. No periodic browser refresh is
installed. See `request-frequency-inventory.md` for call rates and cooldowns.

## Status semantics and limits

Statuses are `healthy`, `degraded`, `down`, or `unknown`. An idle queue is not
Down; a queue with no heartbeat is Unknown. Cloud Run is Unknown until an
operator explicitly rechecks it. Supabase is Unknown until an operator
explicitly rechecks it. Pages Recheck proves the current authorized route only,
not a separate recursive network probe. KV writes are best-effort; if telemetry
storage is unavailable, the relevant last-known state may be Unknown/stale.
