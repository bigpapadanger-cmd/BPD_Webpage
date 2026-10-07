# Phase 4 production readiness — local implementation

## Boundaries

No Supabase, deployment, provider polling, Worker runtime source, OAuth, account
authorization, or MMR throttling changes. Auth/Admin/Custom Match APIs retain
no-store. No immutable cache policy has been added to mutable asset URLs.

## Browser architecture

The router still authorizes first, loads family master CSS, injects fragments,
then initializes the page. `routes.js:getRouteStyles` loads explicit page CSS;
family masters keep shared shell/RL chart styling. Page stylesheet loading has a
deadline and cleans up failed/superseded loads. `getPageMetadata` is shared by
Pages HTML rewriting and SPA navigation. Account/Admin/recovery/profile and
personalized Custom Match URLs are noindex; canonical URLs omit query data.

OCR runtime is dynamically imported when an OCR route or stored pending work
requires it. Existing runtime recovery/notification producers and consumers are
unchanged. Login owns the existing Turnstile loader; the shell no longer loads it
on every page. No service worker/bundler was introduced.

`scripts/boundedRequest.js` bounds fetch and JSON decoding. Find Players,
Suggestions and User Management use it with page cleanup where applicable;
Admin Home uses bounded responses. No new polling is introduced.

## Custom Matches

Section keys avoid unrelated browse/host/round/result rendering. Runtime presence
updates patch member text, Ready and Start controls rather than rebuilding forms.
Non-credential editable values, disclosure state and focus are preserved within
the same match when structural rendering is required. Credential values are not
included in preservation keys/snapshots and retain existing clearing rules.

Authoritative detail fetches are single-flight while their network read is pending.
Host reads retain independent generations. Same-match refresh retains its socket;
nonmembers cannot connect. Runtime refresh messages during a mutation defer to
the required post-mutation read. Policy-denial closes and six failed reconnects
stop automatic retry; explicit Refresh resets it. Backoff includes jitter.
The Pages runtime caller bounds fetch/body reading to 15 seconds/256 KiB.

## Accessibility/charts

Settings IDs are unique. Audited main fragments use sections beneath shell main.
Skip navigation, ordinary pressed-state management buttons, reduced-motion waves,
stable failed shop-image space and async image decoding are supplied. SVG history
keeps current renderer/reference definitions, skips unchanged data, provides a
numeric disclosure table and allows chart-local horizontal scrolling on mobile.

## Deferred Admin UUID contract

Existing authorized UUID handling remains unchanged by approval. Later migration:

- GET `/api/admin/user-management`: replace `users[].accountId` targeting contract.
- GET `/api/admin/user-management/[accountId]`: opaque target resolver required.
- GET/POST `/api/admin/user-management/[accountId]/notes`.
- POST `/api/admin/user-management/[accountId]/actions`.
- GET `/api/admin/user-management/history?targetAccountId=...`.
- Corresponding `functions/services/admin/user_management.js` RPC parameter
  construction must resolve opaque targets server-side while retaining current
  actor authorization and target/Owner protections.

Do not hide IDs cosmetically, fabricate opaque IDs, or change this contract until
the server/database resolver and approved response shapes exist.

## Changed application files in this pass

- functions/[[path]].js
- functions/services/rl/custom_matches/runtime_client.js
- public/scripts/boundedRequest.js
- public/scripts/repopulate_sitemap.js
- public/index.html; public/routes.js; public/sitemap.xml
- public/Framework/Shell/JS/router.js
- public/Framework/Shell/CSS/Callers/master.css; master_rl.css
- public/Framework/Shell/CSS/General/shell.css
- public/Framework/Shell/HTML/Body/body.html
- public/Global/Settings/HTML/settings.html
- public/Global/Index/CSS/index.css
- public/Global/404/HTML/404.html
- public/Global/Suggestions/JS/index.js; HTML/index.html
- public/Global/Admin/Home/JS/index.js
- public/Global/Admin/FAQ/JS/index.js
- public/Global/Admin/UserManagement/JS/index.js; HTML/index.html
- public/Required/FAQ/HTML/index.html
- public/Tabs/RocketLeague/CustomMatches/JS/client.js; index.js; view.js
- public/Tabs/RocketLeague/Features/HTML/find-custom-matches.html; JS/shop.js
- public/Tabs/RocketLeague/FindPlayers/JS/index.js; HTML/index.html
- public/Tabs/RocketLeague/PublicProfile/JS/index.js; HTML/index.html
- public/Tabs/RocketLeague/Index/JS/mmr_dashboard.js; CSS/index.css

Tests: tests/rocketleague/phase4_optimization.test.mjs (new), custom_match_ui.test.mjs,
mmr_history.test.mjs, page_pass.test.mjs, public_summary.test.mjs; tests/admin/user_management.test.mjs;
tests/route_health/dashboard.test.mjs, rocketleague_navigation.test.mjs, routes.test.mjs.
Layout inventory: _folder_structure/folder_organization/03_public.txt.

## Live validation still required

Local verification: full npm test (including Pages build) passed. Rocket League
suite: 328 tests passed. Custom Match Worker suite: 9 tests passed. Worker
dry-run passed with runtime still disabled. Syntax checks covered 17 changed
JavaScript modules. git diff --check passed (existing LF/CRLF warnings only).

Mobile/desktop focus, typing during presence updates, keyboard navigation,
three-mode charts, pending OCR recovery across navigation, metadata response
headers, WebSocket denial/reconnect and multi-client mutation fanout need browser
verification. No Lighthouse/CWV scores are claimed. No production assets replaced.
Large optional originals: cover_img.png 1672×941/2.59 MB;
gaming_network_banner.png 2111×745/1.99 MB; gaming_network_logo.png
1254×1254/1.78 MB. Determine actual display/LCP use before optimizing them.
