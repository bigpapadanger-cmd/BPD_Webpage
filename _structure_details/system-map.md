# DomainData System Map

Snapshot: 2026-10-04

## Runtime overview

- `public/` is the browser-delivered site and calls the same-origin Pages API.
- `functions/api/` contains Cloudflare Pages routes; reusable server logic is
  under `functions/services/`.
- `workers/` contains independently configured Cloudflare Workers.
- `ocr_cloudData/` is a separate Google Cloud Run Python OCR service and is
  ignored by Git as intended.

## Authentication and browser navigation

Google and Discord login use same-window redirects through Pages provider-start
routes and the shared Supabase OAuth callback. Cookie-backed PKCE state is
validated server-side before account resolution and BPD session finalization.
Epic has a separate direct OAuth callback and server-only credential exchange.
OAuth/session cookies are Secure, HttpOnly, host-only, `Path=/`, and
`SameSite=Lax`; browser storage and popups are not part of the auth contract.
Discord account linking is independent of the REST-based MatchBot mutual-guild
eligibility check. See [authentication and mobile compatibility](auth-mobile-compatibility.md)
for the detailed flow map, provider-console checks, and physical-device matrix.

The shared Rocket League sidebar is implemented in
`public/Framework/Shell/JS/Sidebar/`. A collapsed sidebar temporarily expands
when a submenu is opened, then returns to the saved preference when the menu is
closed or a destination is selected. This temporary state is not persisted.
Competition, Players, and Tools use the shared submenu controller, and Rocket
League access visibility refreshes on Rocket League subroutes while server
route/API authorization remains authoritative. Settings and the router share
browser-local `bpdTheme`, `bpdAnimations`, and `bpdSidebar` preferences; Settings
changes apply immediately and appearance is reapplied on SPA and direct loads.

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

### Rocket League pages and Discord notification eligibility

`/RocketLeague/Profile` is the setup/onboarding route. Once the authenticated
private profile confirms both completion and Rocket League access, the browser
replaces the route with `/RocketLeague/MyProfile`. My Profile has its own HTML,
JavaScript module, and CSS under `public/Tabs/RocketLeague/MyProfile/`; it is
the authenticated settings editor. The private getter supplies saved settings
and consent values. Unconfirmed settings are named and their individual
controls disabled. Because the current save RPC replaces the complete settings
set, submission remains disabled until every editable argument and both
server-managed consents are confirmed. Provider/MMR/stat fields never enter the
settings payload. Private profile GETs read persisted data only: they do not
wake the presence monitor or call the MMR/provider Worker. No direct Supabase
table access was added. The public Rocket League hub remains visible for
incomplete profiles and presents a setup notice/CTA; protected features retain
their own access requirements. Notifications may be disabled without blocking
profile completion. Registration and My Profile use the same V2 notification
settings model: email, SMS, and Discord can be enabled independently, each with
up to three reminder offsets (15 minutes through 7 days 23 hours). Both editors
share validation and duplicate-time warning helpers. Discord eligibility remains
server-verified through `/api/auth/rocketleague/discord-notifications`. My
Profile and Registration disable new Discord opt-in when that check is not
eligible. Server saves also reject a newly enabled Discord preference unless
eligibility is confirmed. If a previously enabled preference loses eligibility,
its saved reminder values are preserved while the UI marks Discord unavailable;
the repository has no Discord notification-delivery dispatcher, so no delivery
is claimed by this state.

The signed-in `/RocketLeague` home displays current saved ranks, career totals,
per-playlist capture-to-capture changes, and a graph of up to the latest 15 MMR
captures. The authenticated Pages profile service uses the server-only
Supabase credential to call the service-role-only
`api.get_rl_player_mmr_progression(uuid)` and history RPCs; the browser never
calls Supabase directly. These reads are independent of the MMR Worker,
provider refresh, and latest-rank display. Each playlist delta is computed only
when both captures contain a valid value; missing values affect only that
playlist. The UI labels these as snapshot-to-snapshot changes and identifies
the previous capture time when available. A missing previous capture is shown
as “No previous capture yet”; RPC/shape failures leave My Profile usable and
show a temporary-unavailable message. Other private profile GETs do not request
this RPC.

Public `/RocketLeague/FindPlayers` uses the Rocket League master CSS caller and
searches only opt-in public profiles. Result cards remain lightweight and show
three compact playlist ranks with neutral handling for unknown presence.
`/RocketLeague/Shop` is public. A separate hourly background path fetches and
persists a normalized global shop snapshot. Its page reads only the public
DomainData `/api/rocketleague/shop` endpoint, which calls the confirmed
`api.get_rl_current_shop()` RPC server-side and returns an allowlisted cached
snapshot. A short shared cache reduces repeated database reads; no page view
wakes the provider Worker.
`/RocketLeague/ImageScanning` is retained as a compatibility route that replaces
the URL with `/RocketLeague/SubmitMatchResults`; it no longer renders the hub.
`/RocketLeague/MatchHistory` is a real auth-gated page that explains
match-by-match provider history is unsupported; the MMR Worker has one shared
service-account session, while `Matches/GetMatchHistory` reads only that
session's `localPlayerID`. It cannot supply a linked BPD user's private history,
and MMR captures are never presented as matches. Leaderboards, public Match
Results, Weekly Matches, My Matches, and Private Matches have shell-integrated
status pages rather than reusing the Rocket League landing page or displaying
fabricated records.

Discord MatchBot eligibility is a REST-only provider check. DomainData resolves
the authenticated BPD account and canonical linked Discord identity, applies
freshness/cache/backoff rules, and owns on-demand checks, hourly reconciliation,
Supabase persistence, and browser-safe status. The private
`bpd-provider-runtime` Worker owns only stateless Discord bot-guild inventory
and membership validation, plus its internal health response. DomainData calls
it through a Service Binding with internal caller authentication; it has no
public route, Supabase credentials, scheduling, account lookup, or persistence.
The Worker requests a complete validated paginated guild inventory, explicitly
enumerates shards when the configured large-bot mode requires it, then checks
the canonical linked user's membership. Missing/invalid shard configuration,
incomplete inventory, timeouts, rate limits, and provider errors fail closed.
Only a complete successful result is persisted; provider failure preserves the
last known eligibility. Member-endpoint 404 means nonmembership, while a guild
or bot-access 404 is unavailable. Fresh cached state avoids provider calls;
stale/unknown state is checked on demand, Check Again forces a refresh, and the
scheduled reconciler refreshes eligible accounts independently of page views.
No Gateway or persistent Discord session is used. The formerly proposed
Gateway-owned guild registry, ingestion endpoint, and Cloud Run worker-pool
design are obsolete and are not part of the current architecture.

#### Central notification system (approved direction; not implemented)

The repository does not yet contain a general website notification inbox or
durable cross-channel delivery system. Existing Rocket League reminder
preferences, Discord eligibility checks, Taskboard messages, and Discord
interactions remain separate features; none is the general notification
delivery path.

The website notification record is intended to be the durable source of truth;
Discord DM is an optional secondary channel. DomainData remains responsible for
Admin authorization, audience resolution, recipient snapshots, inbox
creation/read state, and delivery orchestration. Admin role targeting uses the
existing Admin/Moderator/League Staff permission groups, not the distinct
`identity.account_roles` responsibility roles. Discord DM consent must be an
independent opt-in and must not reuse Rocket League reminder consent. The first
user surface is a shared notification panel/inbox; a full history page can be
added later if needed.

Proposed flow: authorize the Admin action; resolve and snapshot recipients;
commit the website notification and per-recipient inbox records; then enqueue
optional Discord DM deliveries. A separate `bpd-notification-delivery` Worker
or queue consumer may receive bounded delivery jobs, send DMs, and return
normalized outcomes with bounded retry/backoff. It must not resolve accounts or
roles, choose audiences, authorize Admins, own inbox persistence decisions, or
share Rocket League provider-session state. Discord DMs stay outside
`bpd-provider-runtime`, whose current boundary remains provider validation and
narrow checks. Discord delivery failures must not erase or block the website
inbox notification. Exact storage, queue, callback, and deployment contracts
remain future design work. The authoritative production Supabase migration
workflow is not identified in this repository and must be established before
schema work; no migration location or database contract is assumed here.

Normal page reads do not call the provider. A single hourly cron on the existing
Rocket League background Worker asks the live
`api.get_rl_refresh_candidates(p_after_player_id, p_limit)` RPC for up to 20
eligible rows and follows due flags with a cursor stored in `SERVICE_STATUS` KV.
It requests only due `skills`, `profile`, `club`, and `stats` capabilities from
the protected MMR Worker. MMR, profile, complete aggregate stats, and club data
are persisted through their existing server-side RPCs, then each component is
checkpointed independently with `api.record_rl_player_refresh_result`. Incomplete
career stats are never persisted. The Supabase due flags control per-capability
cadence, so the hourly schedule does not imply an hourly request per player.
History remains unsupported for linked users because the Worker only has its
shared service-account PsyNet session. Discord eligibility refresh is performed
through the separate REST-only `bpd-provider-runtime` path described above. The same hourly
trigger starts an independent global Shop job: it calls the protected
`/get-shop-data` endpoint, hashes the normalized catalogue, saves it through
`api.save_rl_shop_snapshot`, and records the global `shop` refresh result. The
public page does not call or wake this provider path.
The prior Saturday MMR routine remains in the repository but is no longer
scheduled, avoiding a second competing MMR refresh path.

Authenticated account activity and a successful, complete Rocket League
registration may continue using the separate existing MMR refresh flow. The
successful login-triggered MMR, provider-profile, and complete-stats writes also
update the same per-component refresh ledger. This prevents the hourly candidate
scan from re-fetching those components immediately after a successful foreground
refresh. The scheduled due-aware system remains independent from page rendering
and profile reads.
The Worker may make six PsyNet requests for career stats, and incomplete totals
are never persisted.

Successful display-name data is written through
`api.save_rl_player_provider_profile`; the live RPC uses `COALESCE` so the
currently unsupported `level`, `xp`, `creator_code`, and provider timestamp
nulls preserve existing values. Complete six-field career totals are written
through `api.save_rl_player_stats`. Skills continue through the existing MMR
snapshot RPC/path. Club details are allowlisted by the MMR Worker and saved via
`api.save_rl_player_club`; member lists and raw provider payloads are not
returned. Match History is unsupported for other players and does not call its
persistence RPC; historical rows are retained. `SUPABASE_AUTH` and
`MMR_API_KEY` are used only server-side. The Admin capability registry marks
MMR / Skills, display-name Player Profile, Player Stats, and read-only Clubs
active; XP / Progression and Match History are not represented as supported.

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

The `find_profile_enabled` mapping recognizes the authoritative nested snake_case
field returned by the live private profile RPC, so a real `false` is available
without defaulting an unavailable value in the browser. Discovery opt-in remains
independent from `show_online_status`.

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

## Public help and account settings

`/FAQ` is curated static content describing only implemented behavior. It does
not request `/api/faq` or `/api/faq/upvote`; community submissions and votes
remain on the separate `/Suggestions` page. The footer links to FAQ but does not
invent a Contact route or support destination.

`/Settings` retains browser-local appearance controls and AdSense Privacy &
Messaging revocation for optional advertising choices. When signed in, it edits
only the canonical BPD display name through the existing same-origin account
mutation. The server resolves the account from the current session and exposes
the display name and its change/cooldown timestamps only. Names are globally
unique without case sensitivity; DomainData performs conservative server-side
appropriateness checks, while Supabase remains authoritative for final validation,
uniqueness, and the 30-day change cooldown. Settings presents the authoritative
unlock time in the browser's local timezone and refreshes the remaining-time
display once per minute; this display is not authorization. An explicit `null`
availability timestamp means no active cooldown, while a missing or malformed
field keeps an existing name locked until the account contract is confirmed.
Image fallback requests use the existing `/Assets/images/bad_image/fallback.png`;
the unavailable Steam icon has no image request. See
[Account Settings sub-map](system_sub_map/account-settings.md).
