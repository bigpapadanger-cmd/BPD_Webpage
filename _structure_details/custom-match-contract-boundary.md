# Custom Match server contract boundary

Phases A/B/C and locally implemented Phases D/E. Phase C host reads use the
verified live contracts supplied by the operator.
No SQL changes, live provider calls, Worker deployment, or Cloudflare namespace
creation were performed.

`rl/custom_matches/service.js` validates the request, derives the current account
through `authorizeRocketLeagueRequest`, checks configured capacity limits, builds
exact RPC parameters, and verifies returned match/round/action associations.
Stored-data actions do not require fresh Epic reauthorization. Supabase independently
enforces durable object authorization, versions and idempotency.

`rl/custom_matches/contracts.js` rejects unknown request keys and projects only
documented response fields. A malformed row rejects the entire response; unknown
stats remain null. Account/player UUIDs, raw provider data, hidden roles and ballots
are not projected. Creation and explicit credential results alone contain credentials.
Phase B HTTP adapters send `Cache-Control: no-store`, enforce methods and
same-origin/CSRF protections, and keep credentials out of URLs/logs/storage.
Creation credentials are stripped by the HTTP adapter; the Phase A RPC sanitizer
still validates the existing creation contract without changing it.

## Phase B routes and UI

`/RocketLeague/FindCustomMatches` keeps its existing shell/sidebar and HTML path;
the CustomMatches module supplies browse, create and a selected lobby through the
`match` query parameter (external match code only). The scoped stylesheet is loaded
by `master_rl.css`. No unrelated page/navigation definition changes.

Public GET `/api/rocketleague/custom-matches` and `/limits` read the fixed public
RPCs. Private entries in a browse response fail closed, rather than being filtered.
GET `/access` runs current RL authorization and returns only an allowed boolean.
POST on the collection creates; GET `/[matchCode]` reads authenticated match detail;
POST `/[matchCode]/actions` supports the Phase B actions plus kick_member and transfer_host. Every protected
operation uses the unchanged Phase A service/current-account policy. Private-match
existence errors remain indistinguishable. Explicit GET `/[matchCode]/credentials`
uses the unchanged protected RPC. Phase C adds host-only invite/request/history
reads and approved membership actions; Phase E adds round/vote/result endpoints.
Provider ingestion remains outside the browser API.

Mutation bodies are capped at 8 KiB and their read/parse deadline is three seconds.
The existing JSON reader gained an optional abort signal; existing callers retain
their behavior. Database transport retains Phase A deadlines/size limits.

The UI offers configured basic modes, standard capacity presets and asymmetric custom
capacities. Round/vote workflows are implemented locally; live runtime provisioning remains disabled.
Basic host actions include open, pregame, resize, team assignment, join policy,
late-join policy, cancel, close and archive. Host leave is locked when transfer is
required; transfer and kick are available for current members. Rejoin/general-invite/approval tools are implemented by Phase C.

Reads are initial/manual only. Mutation conflicts refresh authoritative detail without
retrying. Temporary transport failures retain the exact serialized request/key for an
explicit retry; a new logical action receives a new key. Protected controls stay locked
while pending and when required validation fails. Auth/account denial clears detail;
host-permission failure refreshes actor state without reclassifying authentication.
Request deadlines include body decoding; page-root cleanup aborts old listeners and
requests on removal/reinitialization, including routeLoad cache-busted imports.

`supabase/rocketleague/custom_matches.js` uses only the service-role credential and
fixed read/create/action/round/vote/result RPC names. Provider ingestion is excluded.
HTTPS configuration is validated; redirects are rejected. Shared transport bounds
fetch, streaming body read, parsing and sanitization to 10 seconds and 256 KiB.
New `sb_secret_` API keys are sent only in `apikey` (they are not JWTs); legacy
`service_role` JWT keys continue to use both `apikey` and bearer authorization.
No automatic mutation retries or assumed replacement versions/keys exist.

## Explicit gates / unresolved contracts

- Start routes through the Phase D runtime readiness authority; local runtime
  configuration stays disabled pending operator provisioning.
- Voting routes through the Phase E single-vote-type authority. All four request
  schemas are validated independently; runtime provisioning is still required.
- Targeted invite UUIDs are rejected at the untrusted request boundary. A future
  server-derived recipient lookup is required; general invite creation/read/revoke and invitation-code joining are enabled in the repository.
- Non-null `modeResult` is rejected pending its exact public-safe nested schema.
- Reason text has a local 500-character safety limit; this is not a claimed DB limit.
- Unspecified round-state/outcome/threshold/result-type strings are bounded but
  not assigned invented enums. Confirm these types against live fixtures before UI use.
- Existing supplied RPC shapes are implemented; no live response verification has run.

Tests: `tests/rocketleague/custom_matches.test.mjs` is included by the existing RL
test glob. Private match not-found remains indistinguishable from ordinary not-found.
Unknown upstream errors are fixed unavailable errors, without provider diagnostics.
Phase B API/controller/view checks are in `custom_match_api.test.mjs` and
`custom_match_ui.test.mjs`. Live Supabase/desktop/mobile browser verification remains
an operator check; no live mutation was performed during local tests.

## Exact Phase B changed files

- functions/api/rocketleague/custom-matches/index.js
- functions/api/rocketleague/custom-matches/limits.js
- functions/api/rocketleague/custom-matches/access.js
- functions/api/rocketleague/custom-matches/[matchCode].js
- functions/api/rocketleague/custom-matches/[matchCode]/actions.js
- functions/services/rl/custom_matches/http.js
- functions/services/http/json.js
- public/Tabs/RocketLeague/CustomMatches/JS/index.js
- public/Tabs/RocketLeague/CustomMatches/JS/client.js
- public/Tabs/RocketLeague/CustomMatches/JS/view.js
- public/Tabs/RocketLeague/CustomMatches/CSS/index.css
- public/Tabs/RocketLeague/CustomMatches/HTML/index.html
- public/Framework/Shell/CSS/Callers/master_rl.css
- public/routes.js
- tests/rocketleague/custom_match_api.test.mjs
- tests/rocketleague/custom_match_ui.test.mjs
- tests/route_health/rocketleague_navigation.test.mjs
- functions/services/admin/generatedApiRouteInventory.js (generated)
- _folder_structure/route-health/routes.json (generated)
- _folder_structure/folder_organization/01_functions.txt
- _folder_structure/folder_organization/03_public.txt
- _structure_details/request-frequency-inventory.md
- _structure_details/custom-match-contract-boundary.md

The Phase A service, request schemas, RPC transport, response projections, and
security gates were not modified by Phase B. All pre-existing unrelated dirty
changes were preserved.

## Phase C — credentials, invites and membership

Credentials are requested explicitly after current server authorization and durable
membership/state checks. They are transient text, never persisted or put into URLs,
attributes, logs or analytics. Client state/DOM clears after ten seconds, blur,
hidden document, page disposal, detail refresh, access check and any mutation.
Late request completion cannot restore cleared credentials. The runtime revokes
affected live connections after kick/leave; already viewed credentials cannot be
revoked from a user's memory. Each new read rechecks authoritative access.

Host transfer excludes self/spectator targets in the UI; kicks exclude self. Both
reuse durable authorization, external member codes, versions and idempotency.

The verified host-only read RPCs are `list_custom_match_invites`,
`list_custom_match_join_requests`, and `list_custom_match_member_history`. Narrow
GET routes `/[matchCode]/invites`, `/join-requests`, and `/member-history` derive
the actor from current BPD/RL authorization and use the fixed service-role caller.
Supabase authorizes the current host. Response projections strip internal UUIDs
and preserve nulls; malformed rows fail closed, including null `leftAt` in former
member history and non-pending request status.

The host UI lists outstanding invite codes with copy/revoke controls, pending
requests with approve/reject controls, and former members with departure/kick
information. Rejoin controls use only `canAllowRejoin` from the authoritative
read. General invitation creation, invitation-code joining and approval requests
reuse existing action contracts. No invite codes are put in share URLs or browser
storage. Each mutation retains the existing version/idempotency behavior and
refreshes host lists after authoritative detail reload. Manual list refresh also
clears transient credentials. Generations prevent late responses from repopulating
host data after navigation, disposal, access loss or host transfer. Individual
list failures clear that list and leave other successfully loaded lists usable.

Targeted creation remains disabled: the public discovery service returns only
public-safe profile information, and no approved public-identifier-to-account
recipient resolver exists for Custom Match invitations. `targetAccountId` is
rejected by the browser request schema. No direct table queries, guessed RPCs,
or SQL files were introduced.

Phase C changed files: functions/services/rl/custom_matches/http.js;
functions/services/rl/custom_matches/contracts.js;
functions/api/rocketleague/custom-matches/[matchCode]/{invites,join-requests,member-history}.js;
functions/api/rocketleague/custom-matches/[matchCode]/credentials.js;
public/Tabs/RocketLeague/CustomMatches/JS/{client,view,index}.js;
public/Tabs/RocketLeague/CustomMatches/HTML/index.html;
tests/rocketleague/custom_match_{api,ui}.test.mjs;
_folder_structure/folder_organization/01_functions.txt;
_structure_details/{custom-match-contract-boundary,request-frequency-inventory}.md;
generated functions/services/admin/generatedApiRouteInventory.js and
_folder_structure/route-health/routes.json.

Phase C verification: focused Custom Match contract/API/UI checks; full Rocket
League tests; route tests and generated inventory; Pages build; syntax checks;
runtime regression tests; git diff --check. Tests use safe fixture RPC responses;
no live Supabase or provider call was executed.

## Phase C read-contract completion — exact changed files

- functions/services/rl/custom_matches/contracts.js
- functions/services/rl/custom_matches/http.js
- functions/api/rocketleague/custom-matches/[matchCode]/invites.js
- functions/api/rocketleague/custom-matches/[matchCode]/join-requests.js
- functions/api/rocketleague/custom-matches/[matchCode]/member-history.js
- public/Tabs/RocketLeague/CustomMatches/JS/client.js
- public/Tabs/RocketLeague/CustomMatches/JS/view.js
- public/Tabs/RocketLeague/CustomMatches/JS/index.js
- public/Tabs/RocketLeague/CustomMatches/HTML/index.html
- tests/rocketleague/custom_match_api.test.mjs
- tests/rocketleague/custom_match_ui.test.mjs
- functions/services/admin/generatedApiRouteInventory.js (generated)
- _folder_structure/route-health/routes.json (generated)
- _folder_structure/folder_organization/01_functions.txt
- _structure_details/custom-match-contract-boundary.md
- _structure_details/system-map.md
- _structure_details/request-frequency-inventory.md

## Phase D — lobby runtime

`workers/bpd-custom-match-runtime` is a separate private Worker. Pages binds it as
`CUSTOM_MATCH_RUNTIME`; the Worker maps each match code to one
`CustomMatchSession` Durable Object. The browser establishes WebSockets only via
the authenticated same-origin Pages route. A random 64+ character caller secret
authenticates Pages-to-Worker requests; the browser receives neither the secret
nor the internal account binding header.

Each connection and protected transition rechecks current match membership through
the fixed `api.get_custom_match` server-role RPC. Durable Object messages serialize
readiness and Start. Start additionally requires both teams populated and every
playing member connected and ready, plus the current host and match version. Kick
and leave close affected sockets after the durable action succeeds. Existing
sockets are also checked against authoritative membership before resync/readiness
messages. Host disconnect changes presence/readiness only; it does not transfer
ownership. A DO restart resets all readiness while retaining active connection
identity. Events expose only external match/member codes, display names, team,
connection/readiness, and safe state/version metadata.

The runtime remains disabled in local configuration. Deployment requires the
Pages service binding, matching caller-secret provisioning, Worker
`SUPABASE_SERVICE_ROLE_KEY`, explicit enablement, and approved DO namespace
migration. No live configuration was changed.

## Phase E — rounds, voting and results

The fixed API operations are `list_custom_match_rounds`,
`begin_custom_match_round`, `open_custom_match_vote`,
`cast_custom_match_vote`, `resolve_custom_match_vote`,
`get_custom_match_vote_result`, `submit_custom_match_result`,
`confirm_custom_match_result`, and `get_custom_match_player_results`. The Pages
adapter derives the account from the BPD session. Round open/vote/resolve pass
through the runtime's per-match serialized authority. One vote type is claimed per
round/window, and a conflicting type is rejected. Authoritative threshold/result
calculation stays in Supabase; the browser only displays returned fields.

Match and round version conflicts refresh authoritative state without retrying.
An idempotency key is generated once per logical mutation and the exact request is
retained for transport retry. Nullable result statistics render as unavailable;
non-null `modeResult` still fails closed because its public-safe nested schema is
not defined. Result codes are displayed only from a successful submission
response. No result/history persistence was added by application code.

Two response details remain contract-sensitive: round `roundVersion` is accepted
only when present in the rounds RPC and voting controls stay locked when absent;
confirmation uses the returned external result code, which the submitting player
must share with the other team. Verify these against live RPC fixtures before
enabling the runtime in production.

The Phase C host-read dependency is resolved. Targeted invitation recipient
resolution remains deferred independently of these implemented host lists.

## Phase D/E files added or changed

- workers/bpd-custom-match-runtime/src/index.js
- workers/bpd-custom-match-runtime/wrangler.jsonc
- workers/bpd-custom-match-runtime/README.md
- workers/bpd-custom-match-runtime/tests/runtime.test.mjs
- functions/services/rl/custom_matches/runtime_client.js
- functions/services/rl/custom_matches/http.js
- functions/api/rocketleague/custom-matches/[matchCode]/runtime.js
- functions/api/rocketleague/custom-matches/[matchCode]/rounds.js
- functions/api/rocketleague/custom-matches/[matchCode]/rounds/begin.js
- functions/api/rocketleague/custom-matches/[matchCode]/rounds/[roundCode]/open-vote.js
- functions/api/rocketleague/custom-matches/[matchCode]/rounds/[roundCode]/vote.js
- functions/api/rocketleague/custom-matches/[matchCode]/rounds/[roundCode]/resolve.js
- functions/api/rocketleague/custom-matches/[matchCode]/rounds/[roundCode]/result.js
- functions/api/rocketleague/custom-matches/[matchCode]/results.js
- functions/api/rocketleague/custom-matches/[matchCode]/results/submit.js
- functions/api/rocketleague/custom-matches/[matchCode]/results/[resultCode]/confirm.js
- functions/services/rl/custom_matches/contracts.js
- functions/services/rl/custom_matches/service.js
- public/Tabs/RocketLeague/CustomMatches/JS/{client,index,view}.js
- public/Tabs/RocketLeague/CustomMatches/HTML/index.html
- wrangler.jsonc
- tests/rocketleague/custom_match_api.test.mjs
- tests/rocketleague/custom_match_ui.test.mjs
- _folder_structure/folder_organization/01_functions.txt
- _folder_structure/folder_organization/04_workers.txt
- _structure_details/request-frequency-inventory.md
- _structure_details/custom-match-contract-boundary.md

## 4A authoritative backend reconciliation (2026-10-07)

This checkpoint supersedes historical Phase C/D/E limitations above. The user's
continuation supplies confirmed database guarantees: sanitized action receipts
and historical rows; kicked departure history retained with independent rejoin
permission; gameplay-interval participation including eligible late joins;
monotonic provider verification; authoritative invite team; optional spectators;
one current round/ballot; cross-row player-result integrity; normal durable host
transfer. No replacement SQL is pending for those guarantees.

Repository integration now projects allowSpectators/spectatorCapacity and
backend spectator limits, accepts spectator create/settings/join/request/approval,
keeps team capacity independent, excludes spectators from readiness/Start/voting
and playing results, and limits voting to player_target/skip. The old first-ballot
window-category lock was removed: skip is a choice within player voting, and the
database owns ballot supersession. Invite preferences never override the database
assignment. Provider data remains nullable and cannot be declared by browsers.
Rejoin history remains kicked; optional rejoinAllowedAt is projected without IDs.

Create responses no longer require or return receipt credentials. A successful
create/retry immediately loads current authorized credentials through the existing
protected read. Secrets remain transient, expire after ten seconds, and clear on
refresh, blur, navigation and disposal. No credential persistence/logging added.

Admin recovery: POST /api/admin/rocketleague/custom-match-host-recovery uses the
existing current server-verified Admin context, then calls the fixed service-role
admin_transfer_custom_match_host RPC with server-derived admin account, public
match/member codes, expected version, idempotency key and explicit reason. The
Admin home form retains the key for unchanged ambiguous retries; conflict requires
operator review. Missing RPC fails sanitized/no-store with no fallback. The normal
RL service explicitly refuses this operation. Recovery never uses offline status.
Live acceptance PASS (authoritative user verification, 2026-10-07): SECURITY
DEFINER true; EXECUTE service_role/postgres true; PUBLIC/anon/authenticated false.
The repository continues to authorize current Admin first and fail safely.

Spectator live acceptance PASS (authoritative user consolidated checks):
allowSpectators/spectatorCapacity create/read contract, limits defaults/max,
set_spectator_settings, disabled/full/occupancy guards, spectator role behavior
and authoritative invite intended_team. Rocket League defaults: disabled, 4;
maximum: 8. Missing limits still fail closed; legacy projections remain compatible.
The Custom Match database contract is frozen for this release; no SQL is pending.

Verification: combined Custom Match/API/UI/runtime/health/routes suite 168/168;
focused runtime rerun 13/13 after adding disconnected spectator Start acceptance.
Admin tests cover verified Admin, moderator denial, unavailable RPC, malformed
response, method/origin/session rejection, server actor and sensitive projection.
Real WebSocket upgrade, reconnect, hibernation/restart, concurrency and durable
provider/result interactions still need separately authorized release validation.

Runtime stays disabled on Pages and Worker. Activation separately requires matching
64+ character caller secrets, service binding, Worker service-role secret, HTTPS
Supabase URL and approved custom-match-session-v1 SQLite DO migration/binding.
Enable both flags only after approved provisioning and live validation. No deploy,
push, Supabase change or production configuration change occurred.
