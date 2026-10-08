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

An Admin-only `Force Rocket League Refresh` panel accepts a BPD account UUID
(never an Epic ID) and requires browser confirmation. Its dedicated
`/api/admin/rocketleague/force-refresh` route requires
`admin.rocketleague.force-refresh`, which is granted to Admin only, not
moderators or league staff. The server re-resolves the account/player/Epic
link and verifies active state plus fresh Epic authorization before invoking
the existing MMR and provider refresh services. It bypasses their normal BPD
freshness gates only. The MMR Worker continues to enforce its existing
upstream limits; complete stats may require six PsyNet requests. MMR, provider
profile, stats, and unsupported history outcomes are shown separately. A
per-isolate in-flight map prevents duplicate simultaneous requests for the
same account in that isolate, not as a global lock.

## Health sources

| Service | Routine source | Explicit Recheck | Last-known state |
| --- | --- | --- | --- |
| Pages | Current authorized Pages request | Marks current Pages route healthy | Not persisted |
| RL Presence | Secret-gated `/admin/health`; never runs jobs | Same protected read | Existing `RL_STATS_CACHE` namespace; presence runs only |
| OCR Transport | Secret-gated Service Binding `/health`; no Google calls | Same bounded config/liveness request | `SERVICE_STATUS`; OCR request writes throttled per isolate to 30 seconds |
| OCR Queue Consumer | Queue-only heartbeat; no HTTP liveness route | Reads heartbeat only | `SERVICE_STATUS`; once after each queue invocation |
| Cloud Run OCR | Cached result from last explicit recheck | Secret-gated fixed transport route → cached WIF credential → authenticated `/api/ocr/health`; 30-second outer/6-second health request bound | `SERVICE_STATUS`; no OCR inference |
| Supabase | Last scheduled or explicit result; no page-load network call | Existing read-only `api.get_rl_featured_player()` RPC with server-side service-role authorization and bounded response validation | `RL_STATS_CACHE` |
| MMR API/PsyNet | Protected `/health/ready` | 45-second aggregate cache plus explicit Recheck or Check Rocket League Version | Safe config/build state, auth stage, recent-failure, backoff, reconnect, latency, and aggregate traffic state |
| Provider runtime | Private authenticated `/internal/health` | Same bounded read | Worker liveness, not provider/DO instance health |
| Discord communications | Signed private `/internal/health`, unless explicitly disabled | Same read-only route | Worker reachability; no delivery/receipt instance is tested |
| Custom Match runtime | Private authenticated `/internal/health`, unless explicitly disabled | Same read-only route | Worker reachability and required namespace/data configuration |
| CustomMatchSession availability | Derived from runtime check | No instance probe | Disabled/unavailable as applicable; individual instance health remains Unknown |
| Discord bots | Last recorded connection result; no routine Discord request | Existing bounded credential/membership checks | Allowlisted statuses/timestamps/codes only |
| Google mTLS diagnostic | No probe; diagnostic-only retirement candidate | None | No current production caller configured; live retirement needs operator verification |

Worker `SERVICE_STATUS` bindings reuse the existing `RL_STATS_CACHE` KV
namespace; no new namespace or cloud resource is introduced. The hourly
Rocket League cron runs the same Supabase, MMR readiness, provider-runtime, and
MatchBot checkers used by Admin Recheck, then persists their normalized results
under the service keys read by the Admin page. Operational results older than
two hours are presented as Unknown/stale while retaining their prior state for
diagnostics. Presence run
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
| Supabase | Yes: bounded read-only readiness RPC | No | No |
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

Separately, `bpd-rl-presence-monitor` runs an hourly due-aware Rocket League
refresh for at most 20 candidates per invocation. Supabase due flags govern
MMR/profile/club/career-stat calls; normal page reads do not wake that work.
Presence remains on its independent 15-minute opt-in schedule. The new refresh
cycle rejects same-isolate overlap but has no distributed lock.

The hourly trigger also starts an independent global Shop refresh. It calls the
protected MMR Worker's `/get-shop-data` once (two PsyNet reads), hashes the
normalized snapshot, saves through `api.save_rl_shop_snapshot`, and checkpoints
the `shop` global refresh result. The public Shop page reads the cached DomainData
endpoint only; it does not call the provider. Old or expired snapshots are
labeled potentially out of date.

The main view groups services into Healthy, Degraded, Unavailable, Disabled, and Unknown
accordions using the backend's canonical status classification; Unavailable and
Degraded groups open automatically when populated, while the other groups
start collapsed. Each service retains its existing status row, actions, and
Details. Each status group contains Application, Data, Provider Services, Rocket
League, Custom Matches, OCR, Discord or Diagnostics headings as applicable.
Rows show the last check time and sanitized reason. Route, connection, and known-finding diagnostics share the same page
in collapsed groups. The sidebar and Admin home provide one System Status
entry; `/Admin/PageSettings` remains only as a bookmark-compatible alias.

## Status semantics and limits

Canonical statuses are `healthy`, `degraded`, `unavailable`, `disabled`, or `unknown`.
Legacy `down`/`repairing` status values remain compatible and map to
Unavailable/Degraded. Only explicit false configuration means intentionally
Disabled; absent enablement is Unknown. Application and Worker flag mismatches
are reported without enabling anything. A configured DO namespace is not an
instance health claim; no health route selects or creates a DO instance.

Routine adapters have a 2-second fetch/body budget and a 2.1-second complete
adapter deadline including decoding/validation and last-known KV reads. One
failed or stalled adapter cannot reject the whole sweep. Cache reads/writes are
bounded separately to 2 seconds. The existing 45-second cache and request
coalescing remain; no browser polling was added. Ordinary browser health reads
use the shared 12-second fetch/body decoding helper. Explicit Cloud Run readiness
uses its existing 30-second budget plus a 100ms adapter margin; Supabase explicit
and scheduled checks retain a 10-second complete bound. Health projections
allow only known statuses, bounded counts, normalized timestamps and sanitized
codes/configuration facts; raw payloads and identifiers are discarded.

An idle queue is not Unavailable; a queue with no heartbeat is Unknown. Cloud Run is Unknown until an
operator explicitly rechecks it. Supabase is checked hourly and by explicit
Recheck through the existing read-only Featured Player RPC. Previously checked
operational state becomes Unknown/stale after two hours rather than remaining
green indefinitely. Pages Recheck proves the current authorized route only,
not a separate recursive network probe. KV writes are best-effort; if telemetry
storage is unavailable, the relevant last-known state may be Unknown/stale.
