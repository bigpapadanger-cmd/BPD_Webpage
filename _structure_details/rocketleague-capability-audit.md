# Rocket League Provider Capability Audit

Snapshot: 2026-10-04. This is a source-contract/code audit, not a live PsyNet
measurement. No live Worker calls or Supabase changes were made.

## Support classifications

The dedicated provider runtime now has a disabled, separate `RL_USER_SESSION`
security foundation (ES256 verification, atomic replay consumption, monotonic
generation/cutoff and TTL cleanup). It has no live provider executor and does
not make Match History supported. Admin-only fresh OAuth handoff orchestration
and a separate global revocation authority are implemented locally; independent
provider-derived identity proof remains BLOCKED. No positive proof is inferred
from constructed/echoed IDs, display names or arbitrary-player lookups. Discord is unchanged.

| Capability / request | Classification | Request construction and useful result | Boundary |
| --- | --- | --- | --- |
| `Skills/GetPlayerSkill v1` | SUPPORTED, arbitrary-player | Worker passes the requested `PlayerID`; current skills path uses one request per player. | Existing MMR/Skills path remains authoritative for supported playlists. |
| `Skills/GetPlayersSkills v1` | SUPPORTED, arbitrary-player | Accepts a list of player IDs in the upstream request model; the current Worker endpoint does not batch multiple BPD targets. | Batch support is upstream evidence, not current Worker behavior. |
| `Players/GetProfile v1` | SUPPORTED, arbitrary-player | `PlayerIDs[]` is supplied by caller; `REQUESTS.md` says any valid player ID. Returns player name and `PresenceState` / presence information. | Current normalized `/get-player-data` profile exposes display name only. Legacy `/get-profile` returns a coarse state. No level, XP, creator code, or provider update timestamp is returned by this profile projection. |
| `Stats/GetStatLeaderboardValueForUser v1` | SUPPORTED, arbitrary-player | Worker issues six calls with requested `PlayerID`: wins, goals, assists, saves, shots, MVPs. | Persist only a complete aggregate; partial response is `incomplete`. |
| `Matches/GetMatchHistory v1` | LOCAL-PLAYER-ONLY | Go implementation injects the PsyNet session's `localPlayerID`; request has no arbitrary target parameter. | Current MMR Worker owns one shared service-account session, not a session per linked BPD account. Its history capability remains unsupported; never expose that account's matches as a user's private history. |
| `Players/GetXP v1` | LOCAL-PLAYER-ONLY | Go method fills request `PlayerID` from `localPlayerID`, regardless of caller. | Does not support arbitrary-player XP through this path. |
| `Players/GetCreatorCode v1` | LOCAL-PLAYER-ONLY | Go method sends an empty request and documents authenticated-player context. | Does not support arbitrary-player creator-code lookup. |
| `Party/GetPlayerPartyInfo v1` | LOCAL-PLAYER-ONLY / LIMITED | Empty request; Go response contains invitations, not a target party roster or stable current-party/member contract. | Cannot discover arbitrary players' parties or prove same-party membership. |
| `Party/System` | UNKNOWN / EVENT-ONLY | Request catalog calls this unknown/non-standard; no stable event schema or event subscription path is implemented in the Worker. | No party lifecycle signal can be treated as supported. |
| `Population/GetPopulation v1` | SUPPORTED, GLOBAL | Empty request; global population/playlist data. | Not player-specific and not presence. |
| `Population/UpdatePlayerPlaylist v1` | LOCAL-PLAYER-ONLY, MUTATION | Request updates the authenticated player's playlist/population signal. | Not a read endpoint and not a safe arbitrary-player state probe. |
| `Playlists/GetActivePlaylists v1` | SUPPORTED, GLOBAL | Empty request; playlist metadata. | Does not prove a player queued or entered a playlist. |
| `Matchmaking/PlayerSearchPrivateMatch v1` | LOCAL-PLAYER-ONLY, ACTION | Request takes region and playlist; response provides no private match identifier/participant list. | Search action, not current activity telemetry. Do not invoke as a probe. |
| `Matchmaking/StartMatchmaking v2` | LOCAL-PLAYER-ONLY, MUTATION | Starts queueing for the authenticated player/party. | Not a status lookup; excluded from monitoring. |
| `Reservations/JoinMatch v1` | LOCAL-PLAYER-ONLY, MUTATION | Requires join/server parameters such as server name/password. | An action, not a reservation or current-match feed. Never use for discovery. |
| `GameServer/GetClubPrivateMatches v1` | UNKNOWN / GLOBAL-SCOPE | Empty request returns server/private-match service data, not a target BPD player's current match. | Cannot associate a player with a private match. |
| `GameServer/GetGameServerPingList v2` | SUPPORTED, GLOBAL | Region/server ping data. | Network diagnostics only; no participant or lobby signal. |
| `Clubs/GetPlayerClubDetails v2` | SUPPORTED, arbitrary-player by explicit `PlayerID` | Request carries a caller-supplied player ID; returns club details and a member list. The protected Worker now exposes only a normalized allowlist without that member list. | One request when the live `club_due` flag requires a refresh. Persisted through `api.save_rl_player_club`; never requested on page reads. |
| `Clubs/GetClubDetails v1` | SUPPORTED, arbitrary-club by explicit `ClubID` | Request carries a club ID. | One request; access/privacy and safe output policy still need a product contract. |
| `Clubs/GetStats v1` | LOCAL-PLAYER-ONLY | Empty request is scoped to the authenticated player's club context. | Not an arbitrary target's club-stat lookup. |
| `Clubs/UpdateClub v2` | LOCAL-PLAYER-ONLY, MUTATION | Club update operation uses authenticated context. | No mutation surface should be exposed. |
| Item Shop | READ-ONLY CACHED DISPLAY ACTIVE | Protected MMR Worker `GET /get-shop-data` requests `GetStandardShops` then `GetShopCatalogue`; it has no player ID parameter and returns normalized public-safe sections/catalogues. DomainData hashes and saves the payload hourly. Public `/api/rocketleague/shop` reads confirmed `api.get_rl_current_shop()` server-side; `/RocketLeague/Shop` renders a keyboard-navigable cached section carousel. | No wallet, ownership, purchase, or mutation fields are exposed; page loads do not call the provider. See [`rocketleague-shop-audit.md`](rocketleague-shop-audit.md). |
| Discord notification eligibility | SUPPORTED, REST-ONLY | Private `bpd-provider-runtime` uses the bot token to obtain a complete paginated (and explicitly sharded when configured) guild inventory, then checks the canonical linked Discord user against that inventory with bounded concurrency. DomainData owns account/identity resolution, Supabase sync, hourly scheduling, 60-minute freshness, on-demand Check Again, and failure preservation. | No Gateway is used. Complete inventory is required before global reconciliation; member 404 means nonmembership, while inaccessible guilds and provider failures remain unavailable. No provider IDs are returned to the browser. Large-bot shard mode must be explicitly configured before deployment. |
| WebSocket push / lifecycle events | UNKNOWN | Worker Durable Object correlates outbound RPC request IDs to responses; no provider event subscription or party/match event dispatcher was found. | PsyPing keepalive is not a presence event stream. No push-only capability is established. |

The upstream contracts are documented in [`dank/rlapi REQUESTS.md`](https://github.com/dank/rlapi/blob/master/REQUESTS.md) and its Go request implementations for [players](https://github.com/dank/rlapi/blob/master/players.go), [skills](https://github.com/dank/rlapi/blob/master/skills.go), [stats](https://github.com/dank/rlapi/blob/master/stats.go), [matches](https://github.com/dank/rlapi/blob/master/matches.go), [party](https://github.com/dank/rlapi/blob/master/party.go), [matchmaking](https://github.com/dank/rlapi/blob/master/matchmaking.go), [clubs](https://github.com/dank/rlapi/blob/master/clubs.go), [playlists](https://github.com/dank/rlapi/blob/master/playlists.go), and [game-server methods](https://github.com/dank/rlapi/blob/master/misc.go). The MMR Worker code inspected was `worker/index.ts`, `worker/services/provider-data.ts`, and `worker/rl/socket.ts` in the separate `mmr-api-v2` checkout.

## Presence and activity conclusions

## Discord eligibility and privacy

- Discord validation uses the existing MatchBot REST token only inside provider
  execution; `bpd-provider-runtime` has no Supabase, BPD account lookup, schedule,
  public route, or persistence. DomainData calls it via Pages/monitor Service
  Bindings and resolves the canonical active Discord identity server-side.
- Complete bot-guild inventory is required before `api.sync_discord_bot_guilds`
  can replace the current registry. Per-account replacement is written only
  after every current guild membership check succeeds. An empty, successful
  membership result is authoritative ineligible; any provider/inventory error
  preserves previous state.
- Authenticated Settings/Registration reads use persisted state while its
  `checkedAt` is under 60 minutes; stale/unknown state validates on demand and
  Check Again forces a fresh check. The existing hourly refresh reconciles a
  complete bot-guild inventory even when no account is due, then batches due
  accounts and records each Discord checkpoint independently. Each account is
  checked in sequential batches of up to 400 guild IDs; the runtime checks at
  most three memberships concurrently. Provider
  `Retry-After` and bounded temporary failure cooldowns prevent retry storms.
- Browser-safe output includes eligibility, shared count, freshness, and warning
  suppression state only. Guild/user/account/player IDs and raw provider data
  remain server-side. The runtime requires explicit `DISCORD_LARGE_BOT_SHARDING`
  configuration; deployment remains blocked until the current bot mode is
  verified and caller/token secrets are configured.

- The legacy Worker `GET /get-profile?playerId=...` uses `Players/GetProfile v1` with the requested target ID and returns the provider's coarse `PresenceState` string. This is a provider-reported state, but its vocabulary is not normalized into actionable states such as menu, party, queue, training, private match, tournament, or in-game.
- The MMR Worker exposes normalized presence through `/get-player-data?capabilities=presence`, returning `online`, `offline`, or `unknown` with provider `checked_at`. DomainData's 15-minute monitor consumes this capability and persists only successful online/offline results through the existing presence RPC.
- The live candidate RPC requires an active account/player, registration `status='complete'` with a completion timestamp, an active matching Epic identity, and `show_online_status=true`; the save RPC rechecks eligibility. No browser profile read calls or wakes the provider/monitor. The Admin registry marks Presence active.
- A provider failure, malformed response, or `unknown` state leaves the previous row untouched. Public presence older than 30 minutes is represented neutrally as `unknown`; disabled sharing remains exactly “Presence not shared.”
- `Party/GetPlayerPartyInfo` does not provide another user's party roster. Matchmaking/private-match/JoinMatch requests are actions or yield no usable participant identifier. No authoritative evidence was found for BPD players' current playlist, lobby, match, team assignment, or match-start/end state.
- Respect `show_online_status=false`: public output remains “Presence not shared”; do not infer or reveal offline/activity state. Stale/missing provider presence should be unavailable, not Offline.

## OCR assist and identity trust

The authoritative display name from `Players/GetProfile` is a useful verified
candidate source. The existing Worker does not provide a safe current-party or
same-lobby roster. Club membership is technically queryable for an arbitrary
player and is now used only for scheduled club metadata persistence; it must not
be treated as a public roster or used to infer player identity.
Future OCR assist may use a bounded set of linked/provider-verified names as
review candidates. OCR or fuzzy similarity must never create an alias, link an
account, or auto-accept a player identity; only an explicit human correction
may become training/review data.

## Cost and frequency recommendations

“Page safe” means suitable to call as part of a normal UI read. “Scheduled” and
“admin force” refer to automatic background checks and an explicit privileged
refresh respectively.

| Capability | PsyNet requests per player / refresh | Batch support | Local-only? | Cache / recommended interval | Page safe? | Scheduled? | Admin force? |
| --- | ---: | --- | --- | --- | --- | --- | --- |
| MMR / Skills | 1 current skill request | Upstream batch method exists; current Worker path is one target | No | Persisted MMR; Supabase mmr_due after 3 hours, checked by hourly scanner | No provider call on render | Yes, preserve existing cadence | Yes, existing bounded action |
| Provider display profile | 1 | `PlayerIDs[]` upstream; current Worker call targets one ID | No | Supabase provider_due after 60 minutes; legacy page gate is not reached by normal activity | No | Yes, only with due refresh | Yes, existing bounded action |
| Career stats | 6 | No batch path used by Worker | No | Supabase career_stats_due after 24 hours; do not refresh on reads | No | Only with due refresh | Yes, explicit admin action |
| Presence state | 1 `/get-player-data?capabilities=presence` call per eligible player | One target per request; max concurrency 5; 15-second delay between batches | No | 15-minute monitor; 30-minute public freshness threshold | No; persisted row only | Existing monitor only; explicit protected Run Now | No separate force action recommended |
| Party | 1 empty-request call, limited to caller invitations | No arbitrary player batch | Yes / limited | Do not poll; if product-approved for the local account, cache at least 60 seconds and use an explicit view/action | No | No | No |
| Club profile/details | 1 per due player | No current Worker batch | Player-club lookup supports arbitrary ID; club stats do not | Live Supabase `club_due` flag; no page-triggered fetch | No | Yes, existing hourly due-aware scheduler only | Not separately forced |
| Global item shop | 2 per hourly snapshot (one protected MMR Worker request) | `GetStandardShops` then one `GetShopCatalogue` using returned shop IDs | Global shop data; no wallet/player input in either RPC | Hourly background refresh; content hash prevents unchanged snapshot writes | No | Yes, separate independent Shop job on existing hourly Worker trigger | Protected manual `shop` job only |
| XP | 1 | No | Yes | Unsupported for target lookup; if local account is later wired, at most daily | No | No | No for arbitrary targets |
| Creator code | 1 empty request | No | Yes | Unsupported for target lookup; if local account is later wired, at most daily | No | No | No for arbitrary targets |
| Population | 1 global request | Global result | No target | 15-minute shared cache | No direct per-player use | Yes only if a page/feature needs it | No per-account force |
| Private match signals | No safe read request proven | No | Action/session scope | Do not poll; no valid read cadence until an authoritative endpoint is identified | No | No | No |
| Match history | 1 local-player request | No arbitrary player batch | Yes | No refresh through shared service-account session; personal history needs a session bound to that linked user | No | No until correct per-user provider session exists | No for arbitrary target |

Avoid parallel fan-out that bypasses the current Worker request/rate gates. There
is no production traffic/billing telemetry in this source audit, so cadences
above are conservative recommendations, not measured capacity claims.

Presence request volume is 96 checks/player/day at 15 minutes: 25 opted-in
players means 2,400 requests/day, 100 means 9,600/day, and 500 means
48,000/day. At 500 players, the current batch-delay budget alone is about
24m45s per run, so measure first and consider at least a 30-minute interval or
bounded sharding before operating at that scale. The 15-minute cron remains
unchanged; 10- and 5-minute schedules are not recommended without measured
capacity and shared Worker rate-limit headroom.

## Data conclusions and remaining contracts

- No supported API in the current arbitrary-player path supplies total losses or total games played; wins alone cannot yield a win percentage.
- No supported arbitrary-player event/history method provides pre/post-MMR per-match values. Keep persisted snapshot-to-snapshot deltas distinct from match deltas.
- Snapshot progression is supplied by the confirmed live service-role-only RPC `api.get_rl_player_mmr_progression(uuid)`. DomainData calls it only for the authenticated Rocket League home page, through the existing server-side Supabase credential; no direct-table read, browser RPC, provider call, or schema change is involved. Its `current` and `previous` snapshots support independent 1v1/2v2/3v3 deltas. Missing playlist values remain unavailable; absent previous capture is not represented as zero change.
- The home page's history chart requests and displays up to 90 captures from `api.get_rl_player_mmr_history(uuid)` through the server-side profile path. It reads persisted snapshots only and never triggers the MMR Worker; the live RPC must be installed and return at least 90 rows for the full history to appear. That production contract has not been verified by this local code change.
- The separate MMR Worker protocol file `mmr-api-v2/docs/rocket-league-protocol.md` still describes the legacy capability state and was not edited from this DomainData-only writable workspace. It should be updated in the Worker checkout to document the confirmed legacy coarse presence field separately from normalized `/get-player-data` capabilities.

## 3F Match History current-state reconciliation (2026-10-07)

The registered /RocketLeague/MatchHistory route is authenticated, Epic/RL gated,
noindex/out of sitemap, and points to the explanatory HTML with module=null.
There is no dedicated Pages match-history endpoint, UI fetch, DTO or per-user
history query in this repository. Its unsupported wording is accurate; it does
not present an outage or promise matches after a retry. No integration is missing
for a currently supported per-user history source.

Provider ownership: the audited Matches/GetMatchHistory v1 contract uses the
PsyNet session localPlayerID. The existing shared MMR service-account session is
not a linked BPD user's independently verified session. The separate disabled
RL_USER_SESSION security foundation has no provider executor, and identity proof
remains blocked. This is a capability/ownership limitation, not evidence of a
transient provider outage. The collector does not request history; a due history
flag independently records RL_MATCH_HISTORY_AUTHENTICATED_PLAYER_ONLY. Admin
force refresh and activity provider data also explicitly return unsupported.

Available data distinctions:
- Private MMR: capture timestamp, ones/twos/threes MMR and tiers; latest 90
  captures loaded by default. Public summary: 14 UTC daily averages. Neither
  supplies individual match timestamps, opponents, match scores or outcomes.
- Career totals: wins/goals/assists/saves/shots/MVPs, aggregate rather than matches.
- BPD Custom Matches: scoped match/round/result RPCs with public matchCode,
  roundCode/resultCode, round state/start/end timestamps, team scores, winning
  team, result source and verification status. These are BPD-managed results,
  not general provider matchmaking history; they remain in their own feature.

No authoritative general linked-player match DTO, history depth, retention or
match fields can currently be reported. The Admin capability registry mentions
retained historical rows, but this source audit does not establish their live
contents, ownership, completeness or provenance. No live Supabase definitions or
stored records were read for 3F; absence of a repository consumer is not proof
that no database table exists. Historical rows must not be exposed by assumption.
No snapshots were converted, no identities fabricated, and no provider behavior
or replacement database contract was added. Current capability-gated page remains.

3F reconciliation: PASS locally; real linked-player Match History remains
unsupported pending an authoritative safe source/identity contract. No required
Supabase change for this reconciliation. 3B graph is PASS locally with browser
checks deferred to final release validation; production UM/FAQ/leaderboard causes
remain blocked pending their deployed diagnostic evidence.
