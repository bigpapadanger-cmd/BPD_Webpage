# Deep Clean V2 continuation checkpoint — 7 October 2026

> Superseded for current local completion by [deep-clean-final-local.md](deep-clean-final-local.md), 2026-10-07. Counts and deferred browser identity/header descriptions below are historical checkpoint evidence.

No deployment, Git push, Supabase changes, production configuration changes,
live authenticated mutations, or new production subscriptions were performed.
Prior work remains uncommitted and preserved. This report covers the continuation
from attachment 82035b75, including subsequent UE6/MMR wording instructions.

## Workstream checkpoints

| Section | Local outcome | Remaining acceptance |
| --- | --- | --- |
| 4A Custom Match reconciliation | Implemented spectator create/settings/read/join/request/approval; protected immediate credential read; player_target/skip ballots; Admin recovery route/form | Spectator/Admin Recovery live acceptance PASS by authoritative user evidence; real runtime transport remains |
| 4B Match History | PASS; explicitly separates BPD records from unsupported complete account history | No genuine general account-history source exists |
| 4C UE6 | PASS; public static opinion page, user-authored excitement/custom matchmaking/map hopes and summer 2027 prediction; no new external links | Release visual acceptance |
| 4D Shop | PASS; single-page expiry, progress/pause/context, bounded browser/public/collector reads | Current live snapshot/category completeness after release |
| 4E Discord | PASS locally; existing weekly/task command path traced, sanitized weekly diagnostics added | Provisioning/delivery/command acceptance remain disabled/pending |
| 5 architecture/performance | Local build and shared shell improvements verified | Production request waterfall, CPU/LCP/CLS and all-device acceptance |
| 6 accessibility/SEO | Local shared patterns, labels, submit semantics, single main, static public content and generated sitemap verified | Complete real-browser accessibility/contrast review with populated private/Admin flows |
| 7 performance readiness | PASS locally; measured artifact sizes below | Fresh production performance measurements require approved release |
| 8 regression | Final broad local suite recorded below | Live-only checks remain pending |

4A accepts the user's confirmed DB boundaries: action-ledger sanitization,
independent rejoin authorization retaining kicked history, gameplay-overlap result
eligibility, monotonic provider verification, authoritative invite assignment,
spectator capacity/exclusions, round/ballot uniqueness, cross-row results and
durable normal host ownership. Repository mocks do not independently prove DB
transactions or grants. No SQL is pending for those confirmed boundaries.

The runtime's obsolete first-ballot category lock was removed: skip and player
target are choices in the same supported player-vote model; the DB supersedes
ballots. Spectators neither vote nor satisfy/block player Start readiness. The
previous state.acceptWebSocket repair remains. A successful create/replay no
longer depends on receipt credentials and immediately makes a protected credential
read; transient credentials still clear after ten seconds, blur, refresh and exit.

Admin recovery requires current server-verified Admin authorization, public match
and member codes, expected version, idempotency key and a nonblank audit reason.
The actor account comes from server authorization. The ordinary RL service denies
this operation. Missing RPC/malformed response fails sanitized and no-store;
no normal-host or table-write fallback exists. The Admin form preserves the action
key for unchanged ambiguous retries and requires review after conflicts.

## Verification

Final broad suite: **841 total; 841 passed; 0 failed; 0 skipped; 0 cancelled**.

- 4A combined contract/API/UI/runtime/health/routes checkpoint: 168 passed, 0 failed.
- 4C initial route/navigation checks: 27 passed, 0 failed.
- 4D public Shop/debug/collector checks: 25 passed, 0 failed.
- 4E Discord/linkage/commands/MMR/navigation checks: 98 passed, 0 failed.
- Shared shell/accessibility-pattern route checks: 165 passed, 0 failed.
- Generated output contract/CSS URL/sitemap checks: 3 passed, 0 failed.
- Registration/RL focused regression after stale fixture correction: 361 passed.
- Final broad local command: node --test tests/ocr/*.test.mjs
  tests/rocketleague/*.test.mjs tests/suggestions/*.test.mjs
  tests/route_health/*.test.mjs tests/admin/*.test.mjs workers/*/tests/*.test.mjs.
- Pages build: npm run build:check, successful. Three Worker compile-only dry
  runs: Custom Match runtime, Discord communications, RL presence monitor.
- git diff --check passed. No real transport or deployment inferred from compile.

The broad pass exposed one pre-existing stale OAuth registration fixture. It
treated optional profileComplete as registration acceptance. HEAD already uses
registrationAccepted AND rocketLeagueAccess; only the fixture was corrected,
including coverage that optional profile completion alone cannot override gating.

Local built browser checks used a read-only preview with unavailable/signed-out
API fixtures and no production API forwarding. UE6 checked at 320, 390, 768,
1440 and 1920 pixels; Custom Match at 320, 390, 768 and 1440. Single-main and
horizontal-width checks passed; mobile expanded navigation overlays without
squeezing page width. Skip link focused siteContent. Shop unavailable state and
Custom Match locked inputs rendered. These do not prove authenticated behavior.

## Performance readiness — measured local artifacts

| Artifact | Raw source bytes | Generated bytes | Meaning |
| --- | ---: | ---: | --- |
| 99 JavaScript files | 1,481,721 | 551,173 | 62.8% reduction; imports/exports and URLs retained |
| 51 CSS files before caller bundling | 541,499 | 287,371 | 46.9% minification reduction |
| Main CSS caller, 9 inputs | 73,737 | 33,206 | One flattened caller instead of import chain |
| RL CSS caller, 11 inputs | 115,901 | 58,557 | 49.5% raw-byte reduction for combined inputs |
| Admin CSS caller, 16 inputs | 184,540 | 89,179 | One flattened caller |

Final CSS on disk is 561,552 bytes because bundled callers duplicate shared rules.
That is not a total-CSS disk reduction. Per-route delivery and import-chain
changes require production waterfall measurement. No new source maps are shipped.
Editable CSS import files remain; only generated callers are flattened.

Local measurements support artifact size, import count, render/focus behavior and
mocked request deadlines. They do not establish production compression, TTFB,
LCP, CLS, INP, long-task improvements or PageSpeed scores. Historical scores are
not post-change measurements. External advertisements/provider image delivery,
populated graphs and private/Admin flows still require release measurements.

Source development remains npm run dev with explicit public/ directory. Build
output is ignored .wrangler/public-build, configured by repository wrangler.jsonc.
Production build must run npm run build; build:check preserves existing cache IDs.
Static mutable assets revalidate; no unversioned path is marked immutable.
Private/authenticated responses retain their route-level no-store behavior.

## Security/privacy and retained limitations

No secrets, actor UUIDs, credentials or raw provider payloads were added to
browser projections or diagnostics. Admin recovery uses existing authorization;
runtime and communications enablement flags remain false. Public cache rules
do not target API paths. Spectator configuration is unavailable in UI if its
authoritative limits are missing. Missing exact wire definitions are not guessed
as live acceptance. No client-side private discovery search was introduced.

Removed: unused Tracker URL export/link, unsupported yes_no/option browser vote
controls/request schemas, and runtime ballot-category claim writes. Retained:
legacy vote-key reads/deletion for stored compatibility, manual sitemap utility,
source CSS imports, gated targeted invites/non-null modeResult, and legacy refresh
entry points with known callers. No module/page was deleted without caller proof.

1B/1C local hardening is completed in deep-clean-hardening.md. Still pending: actual User
Management/FAQ/Leaderboard production causes; populated graph/private/Admin
browser checks; targeted invitation resolver/non-null modeResult public schema;
real DO
hibernation/reconnect/concurrency; full production accessibility/performance.
User-targeted Admin notifications and Discord reopen commands are not advertised
as implemented; the current task command supports completion only.

## Release order — recommendation only, not executed

1. Database acceptance is COMPLETE and the Custom Match contract frozen: spectator
   defaults/capacity/actions/occupancy/roles/invite assignment and Admin Recovery
   SECURITY DEFINER/service_role-postgres-only EXECUTE are authoritative. Local
   1B/1C is complete; use the updated release sequence in deep-clean-hardening.md.
2. Review the complete uncommitted change set, then separately authorize release.
   Run npm run build and deploy the generated Pages asset output with Functions.
   Keep Custom Match and Discord communications disabled.
3. Release collector diagnostics through a separately approved Worker release.
   Use existing authorized UM GET and public FAQ GET reproduction procedures:
   capture response X-Debug-ID/status/sanitized error and matching server log only.
   For Leaderboards, capture the scheduled playlist diagnostic groups; public GET
   does not rerun collection. Never share HARs, cookies or raw request payloads.
4. Validate public pages, privacy, graphs, cache headers and authorized Admin flows;
   obtain current root-cause evidence before any UM/FAQ/Leaderboard repair.
5. Only with separate activation approval, provision matching runtime caller
   secret, service binding, service-role configuration and SQLite DO migration;
   enable both Custom Match flags and validate real sockets/durable interactions.
6. Separately provision communications secret, binding, receipt DO migration and
   existing server-side webhooks/application verification configuration. Verify
   weekly Friday 18:00 America/New_York behavior and supported signed commands.
   Delivery receipts intentionally prevent ambiguous automatic retries; a claimed
   weekly operation is not proof of delivery. Filter [DISCORD WEEKLY DIAGNOSTIC]
   by its server-generated ID to identify claim/config/summary/decode/delivery stage.
7. Capture fresh production performance and full accessibility/release regressions.

## Exact continuation files

Paths below are repository-relative; ignored preview/build/test-output artifacts
are not source changes. Earlier Deep Clean changes outside this list are retained.

- _folder_structure/folder_organization/00_project_root.txt
- _folder_structure/folder_organization/01_functions.txt
- _folder_structure/folder_organization/03_public.txt
- _folder_structure/folder_organization/05_support_and_generated.txt
- _folder_structure/route-health/routes.json
- _structure_details/custom-match-contract-boundary.md
- _structure_details/deep-clean-progress.md
- _structure_details/deep-clean-continuation.md
- _structure_details/phase4-production-readiness.md
- _structure_details/rocketleague-page-pass.md
- functions/[[path]].js
- functions/api/admin/rocketleague/custom-match-host-recovery.js
- functions/services/admin/generatedApiRouteInventory.js
- functions/services/auth/providers/discord_matchbot/interactions.js
- functions/services/rl/custom_matches/contracts.js
- functions/services/rl/custom_matches/http.js
- functions/services/rl/custom_matches/service.js
- functions/services/supabase/rocketleague/current_shop.js
- package.json
- package-lock.json
- public/Framework/Shell/CSS/General/body.css
- public/Framework/Shell/HTML/Sidebar/rl_menu.html
- public/Framework/Shell/JS/router.js
- public/Global/Admin/Home/HTML/index.html
- public/Global/Admin/Home/JS/index.js
- public/Global/Admin/Home/JS/custom_match_recovery.js
- public/Tabs/RocketLeague/CustomMatches/JS/client.js
- public/Tabs/RocketLeague/CustomMatches/JS/index.js
- public/Tabs/RocketLeague/CustomMatches/JS/view.js
- public/Tabs/RocketLeague/Features/HTML/find-custom-matches.html
- public/Tabs/RocketLeague/Features/HTML/match-history.html
- public/Tabs/RocketLeague/Features/HTML/shop.html
- public/Tabs/RocketLeague/Features/HTML/ue6.html
- public/Tabs/RocketLeague/Features/JS/shop.js
- public/Tabs/RocketLeague/Index/JS/mmr_dashboard.js
- public/Tabs/RocketLeague/shared/mmrRankReferences.js
- public/_headers
- public/routes.js
- public/scripts/repopulate_sitemap.js
- public/sitemap.xml
- scripts/build-public-assets.mjs
- scripts/generate-api-route-inventory.mjs
- tests/rocketleague/custom_match_api.test.mjs
- tests/rocketleague/custom_match_ui.test.mjs
- tests/rocketleague/custom_matches.test.mjs
- tests/rocketleague/mmr_history.test.mjs
- tests/rocketleague/shop_api.test.mjs
- tests/route_health/rocketleague_navigation.test.mjs
- tests/route_health/public_build.test.mjs
- workers/bpd-custom-match-runtime/src/index.js
- workers/bpd-custom-match-runtime/tests/runtime.test.mjs
- workers/bpd-discord-communications/src/index.js
- workers/bpd-discord-communications/tests/communications.test.mjs
- workers/rl-presence-monitor/src/rl_shop_refresh.js
- workers/rl-presence-monitor/tests/oauth_navigation.test.mjs
- wrangler.jsonc
