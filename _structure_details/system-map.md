# DomainData System Map

Snapshot: 2026-10-02

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

## Rocket League provider data

### Private profile routes and Discord notification eligibility

`/RocketLeague/Profile` is the setup/onboarding route. Once the authenticated
private profile confirms both completion and Rocket League access, the browser
replaces the route with `/RocketLeague/MyProfile`. My Profile now has its own
HTML, JavaScript module, and CSS under `public/Tabs/RocketLeague/MyProfile/`;
it renders the authenticated private profile, three playlist ranks, known
career totals, and independent profile-discovery/presence settings. Unknown
numeric totals remain unavailable rather than rendering as zero. Private
profile GETs read persisted data only: they do not wake the presence monitor or
call the MMR/provider Worker. No direct Supabase table access was added. The
established route is auth-gated and redirects incomplete/ineligible profiles
back to setup.

My Profile additionally requests `includeMmrProgression=true`. The authenticated
Pages profile service uses the server-only Supabase credential to call the
service-role-only `api.get_rl_player_mmr_progression(uuid)` RPC; the browser
never calls Supabase directly. The RPC read is independent of the MMR Worker,
provider refresh, and latest-rank display. Each playlist delta is computed only
when both captures contain a valid value; missing values affect only that
playlist. The UI labels these as snapshot-to-snapshot changes and identifies
the previous capture time when available. A missing previous capture is shown
as “No previous capture yet”; RPC/shape failures leave My Profile usable and
show a temporary-unavailable message. Other private profile GETs do not request
this RPC.

Discord MatchBot eligibility currently returns a scoped `unavailable` result
from `functions/services/auth/providers/discord_matchbot/eligibility.js` for
linked Discord accounts. Static `DISCORD_GUILD_ID(S)` configuration is no
longer read by that service. The candidate `/users/@me/guilds` route requires a
user OAuth token with the `guilds` scope; it is not an authoritative bot guild
inventory and must not be called with `DISCORD_MATCHBOT_TOKEN`. DomainData has
request-driven MatchBot REST services and signed interaction handlers, but no
persistent Discord Gateway runtime, lifecycle-event receiver, reconnect owner,
or authoritative guild-registry writer. Profile reads and settings remain
usable while this optional check is unavailable. Registration initialization
isolates the check from profile loading, and the invalid `Set.filter()` call
was fixed by filtering the array before constructing the set.

#### Confirmed gap and proposed future boundary (not implemented)

The known BPD repositories have no owner for Gateway `READY`, `GUILD_CREATE`,
`GUILD_DELETE`, reconnect/session state, or startup guild reconciliation. Do not
simulate these events in Pages Functions. The current integration intentionally
does not claim mutual-guild eligibility until a persistent runtime is approved
and exists.

Recommended future owner: a standalone `bpd-matchbot-gateway` container project,
deployed as a single-instance Google Cloud Run worker pool in the existing
Google Cloud environment. This workload is continuous background work, needs
no public HTTP endpoint, and can initiate the Discord Gateway WebSocket
outbound. Configure exactly one active instance initially; reconnects and
replayed lifecycle events must be handled idempotently. Cloud Run worker pools
are intended for continuous background processes and have no load-balanced
HTTP endpoint; instances must be kept above zero and are restarted periodically,
so Gateway reconnect plus full startup reconciliation are mandatory. See [Cloud Run worker
pools](https://docs.cloud.google.com/run/docs/deploy-worker-pools) and [Cloud
Run resource types](https://docs.cloud.google.com/run/docs/overview/what-is-cloud-run).

Proposed responsibilities and data boundary:

- Gateway container: own the Discord Gateway session; request only the guild
  lifecycle intent; after a fully ready session, reconcile its complete current
  guild set, then emit lifecycle events. Keep the bot token in Google Secret
  Manager. Never write user membership data or hold a copy of Supabase's
  service-role credential.
- Durable source of truth: a future Supabase registry table, for example
  `core.discord_matchbot_guild_registry`, with `guild_id` as the key and only
  operational fields (`active`, temporary-unavailable state, `joined_at`,
  `left_at`, `last_seen_at`, `updated_at`, reconciliation/event identifiers).
  Do not store bot credentials or unnecessary guild/member data. This requires
  a separately reviewed Supabase migration; none is part of the current work.
- Write contract: the Gateway calls a new narrowly scoped DomainData Pages
  ingestion endpoint over HTTPS. Sign method, path, timestamp, event ID, and
  raw body with a dedicated rotated HMAC secret held in Google Secret Manager
  and as a Cloudflare Pages secret. Enforce a short clock-skew window,
  idempotent event IDs, strict Discord snowflake validation, payload limits,
  and rate limits. Pages validates the signature and writes only through
  service-side Supabase RPCs under the existing server credential. The Gateway
  receives no registry read access and no database credential. These endpoint,
  secret, RPC, and table contracts are proposed only; no binding or secret has
  been added.
- Event semantics: `GUILD_CREATE` upserts active; `GUILD_DELETE` with
  `unavailable=true` marks temporarily unavailable without recording a
  permanent leave; other deletes mark inactive and set `left_at`. A startup
  reconcile is accepted only after Gateway READY and complete guild-cache
  hydration, then atomically marks the supplied set active and stale entries
  inactive. Serialize reconciliation and event writes by event/reconcile ID.
- Read contract: the existing authenticated DomainData eligibility service
  reads only active guild IDs server-side, intersects them with the linked
  user's current membership using the existing bot member lookup, and returns
  safe status/count metadata only. A confirmed zero after a complete check may
  raise the existing eligibility-loss warning; partial REST failures remain
  unavailable, never “removed.” One surviving mutual guild keeps eligibility.
- Storage/bindings: the proposed design uses the existing Pages-side
  `SUPABASE_AUTH` server credential and adds a dedicated Supabase table/RPC
  contract plus a Cloudflare secret; it needs no new KV binding and does not
  reuse `AUTH_SESSIONS` or `RL_STATS_CACHE` for guild state. The Cloud Run
  worker pool has no inbound binding/route. No Guild Members intent or full
  member mirror is proposed.
- Rate/scale guard: current membership checks cost up to one Discord REST lookup
  per active bot guild to compute an exact count. Keep bounded concurrency and
  shared short-lived caching; if the guild count exceeds a configured safe
  scan budget, return `partial/unavailable` rather than false ineligibility.
  A reverse membership index is a later design only if measured traffic or
  Discord rate limits require it.

The repository inventory in `_folder_structure/folder_organization/04_workers.txt`
records that no Discord Gateway Worker currently exists. This proposal does
not establish that an external `bpd-matchbot-gateway` repository already exists.

Authenticated account activity and a successful, complete Rocket League
registration use the existing MMR refresh flow. Only when that flow completes
an actual MMR refresh (the existing per-account 24-hour MMR gate allowed it)
does Pages make one server-side request to the protected MMR Worker
`/get-player-data` endpoint for `profile,stats`. A separate `RL_STATS_CACHE` cooldown
deduplicates provider-data work per isolate and retries failures after 15
minutes; successful work is held for 24 hours. As with the existing KV gates,
cross-isolate cooldown checks are best-effort. The Worker may make six PsyNet
requests for career stats, and incomplete totals are never persisted.

Successful display-name data is written through
`api.save_rl_player_provider_profile`; the live RPC uses `COALESCE` so the
currently unsupported `level`, `xp`, `creator_code`, and provider timestamp
nulls preserve existing values. Complete six-field career totals are written
through `api.save_rl_player_stats`. Skills continue through the existing MMR
snapshot RPC/path. Match History is unsupported for other players and does not
call its persistence RPC; historical rows are retained. `SUPABASE_AUTH` and
`MMR_API_KEY` are used only server-side. The Admin capability registry marks
MMR / Skills, display-name Player Profile, and Player Stats active; XP /
Progression and Match History are not represented as supported.

### Presence pipeline

`workers/rl-presence-monitor/wrangler.jsonc` owns the 15-minute presence cron.
Its `presence_cycle.js` asks the API-schema candidate RPC for eligible players,
then rechecks account activity, canonical Epic identity, and fresh Epic
authorization before each lookup. The live candidate RPC additionally requires
an active RL player, registration status `complete` with a non-null completion
timestamp, and
`show_online_status=true`; opted-out players are therefore not polled. The
save RPC rechecks those same eligibility boundaries. The scheduled Worker
continues examining the eligible-candidate set even when all selected players
were previously offline, so it can discover when an opted-in player returns.

Each candidate is read through the protected MMR Worker
`/get-player-data?capabilities=presence` capability. Only normalized `online`
or `offline` results with a valid provider `checked_at` are saved to the existing
`core.rl_player_presence` path. Timeout, auth/session failure, rate limit,
malformed response, or `unknown` do not overwrite prior state or translate to
Offline. Public discovery masks disabled sharing as exactly “Presence not
shared.”; enabled but missing, invalid, future-dated, or older-than-30-minute
presence is returned as neutral `unknown` with no stale timestamp. The threshold
covers two 15-minute check intervals. Admin Run Now remains an explicit,
protected monitor action; the normal MMR force-refresh still excludes presence.
No browser polling is used. The Admin capability registry marks presence
active. No menu, party, matchmaking, private-match, or current-session state is
authoritatively exposed by the inspected Worker request path.

Admin-only force refresh is available from `/Admin/WorkerStatus`. It accepts a
BPD account UUID, then the existing server-side refresh state and authorization
services resolve/check the active account, Rocket League player, linked Epic
identity, and fresh Epic authorization. The action runs MMR / Skills and
provider profile/stats independently, bypassing only the normal BPD freshness
gates. It does not call Match History, alter editable profile settings, or
bypass MMR Worker rate limits. Same-isolate concurrent requests for one account
share an in-flight operation; this is not a cross-isolate distributed lock.

Private profile reads now carry a normalized `settings` object alongside legacy
flat fields for compatibility. A single server-side allow-list maps those
editable settings into the private profile response and the explicit save-RPC
arguments. Provider identity, MMR, and career stats remain outside that
allow-list and the profile form payload. Presence is separate: GET requests are
persisted-data-only; explicit opt-in on a successful profile save activates only
the scheduled monitor.

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
