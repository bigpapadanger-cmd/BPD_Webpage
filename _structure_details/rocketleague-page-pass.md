# Rocket League public page data paths

## Shop category carousel

Local debug caller: `node scripts/debug-rl-shop.mjs plan` lists the current request
chain without network activity. `cached --shop 52` reads the public cached response;
`worker --shop 52` manually calls the fixed protected `/get-shop-data` endpoint using
`MMR_API_URL` and `MMR_API_KEY` from local environment (e.g. Node `--env-file=.dev.vars`).
It has a 40-second deadline, 2 MiB streaming response cap, no redirects/retries/writes,
and only prints public shop fields/counts/product IDs. Image query strings and raw
provider errors/credentials are excluded. This sees normalized Worker output, not raw
PsyNet responses; nulls there still require upstream-versus-normalizer investigation.

The Shop page groups the cached catalogues by provider shop ID and shows provider
title/name/type plus a real logo in one active-category header. It never imports live rlshop.gg
data or assumes product names/artwork beyond the normalized provider snapshot.
Each group contains at most three named items, preserving catalogue order. Artwork is
optional: missing or failed image URLs do not hide the item name, price, or allowlisted
paint/variant attributes. Expired/future shops/items and generic Region/unnamed
categories are excluded. Missing/broken artwork is not replaced by BPD logos. Previous/Next
navigate locally; an eight-second timer finishes each category's groups and
wraps across categories. Pause/Resume is explicit. Hover, keyboard focus, hidden
tabs, reduced motion and disabled site animations suppress automatic advancement.
Timers/listeners are cleared on reinitialization or after detecting a detached page;
late fetch responses cannot overwrite a newer page. Cycling makes no network calls.
Three columns fit wide screens, with two/one columns at smaller widths.
Supabase stores provider artwork URLs, not image bytes; no R2 copy is currently necessary.

Admin System Status exposes Force Refresh Shop on the RL presence monitor card.
POST `/api/admin/system-status` with service `rl-presence` and action `refresh-shop`
requires both settings-manage and RL force-refresh permission, same-origin validation,
JSON-only strict fields and a 60-second cooldown. It runs only the existing authenticated
`/admin/run-scheduled` Shop job, with a bounded 60-second request/body deadline and 4 KiB
response cap. Errors are sanitized; no raw provider data or credentials reach the browser.

## Network statistics

`GET /api/rocketleague/network-statistics` calls the canonical
`api.get_rl_homepage_counters()` with server-side Supabase access. The legacy
`api.get_rocketleague_network_statistics()` is a database compatibility wrapper;
application code calls only the canonical counters RPC.
The response allowlist is playersOnline, registeredPlayers, activeSeasons,
upcomingEvents, matchesPlayed, scoreboardsSubmitted, goalsRecorded, capturedAt.
Only nonnegative safe integer values render as numbers; zero remains zero.
Null, malformed values and failures render as an em dash. No client presence
calculation is involved. Responses may cache for 60 seconds.

Homepage order: hero/current ranks/recent MMR change/career totals; top ad;
MMR history (authorized profiles only); one public network-statistics block;
About; Goals; Explore; About Your Data; remaining ad slots. The existing block
was unwired, not duplicated. Its stale connection placeholder was removed.

## Find Players

Form submission (button or Enter) uses the existing fixed public search RPC.
The database excludes hidden profiles before returning the public projection.
Legacy contradictory visibility flags are additionally rejected server-side.
The form uses a flexible input grid column and an automatic button column;
on mobile they stack. Search result cards remain compact.

`GET /api/rocketleague/players/featured` calls `api.get_rl_featured_player()`.
The operator confirms this prepared RPC is live. It owns persisted UTC-day
selection and current eligibility/privacy checks; DomainData never selects
from or exposes a candidate pool. The public endpoint is no-store so privacy
is rechecked on each read. The browser loads this card before searching,
hides it during search and restores it when the input is cleared. Supported
career totals appear on the featured card; absent club/progression fields are
not fabricated. Only public profile identifiers used for navigation survive.

## Shop artwork boundary

Upstream `shops.go`: `ShopItem.ImageURL` and `Shop.LogoURL`.
MMR Worker `worker/services/provider-data.ts`: normalizes to `image_url` and
`logo_url` in `/get-shop-data`. No MMR Worker files changed in this pass.
`rl_shop_refresh.js`: carries those fields in `p_catalogues` / `p_shops` to
`api.save_rl_shop_snapshot`; content hashing includes them.
`api.get_rl_current_shop` returns persisted `catalogues[].items[].image_url`
and `shops[].logo_url`. `current_shop.js` revalidates HTTPS URLs and strips
ownership/purchase fields. `/api/rocketleague/shop` exposes that allowlist.
`Features/JS/shop.js` renders item images and section logos; failed images are
removed while their item cards remain visible.
No wallet/purchase calls, notification-image calls or page-triggered provider
refreshes were introduced.

The public Player profile retains the last MMR capture timestamp but no longer
shows the internal presence-check timestamp. Public Find Players and Player rank
badges use the shared Rocket League tier-to-color mapper. `master_rl.css` already
imports both page stylesheets; page styles remain in their owning folders.

The public Player endpoint now calls only `api.get_public_rl_player_summary`
with the public profile UUID. The live RPC filters active/discoverable players;
DomainData allowlists display/ Epic display names, primary platform, current
three-playlist MMR/tier/capture time, six career totals/capture time, and daily
MMR history. No internal ownership lookup, private history call, presence,
provider metadata or raw snapshots are used for this endpoint. Not-found/private
results share the same 404. History must be ascending, unique UTC dates within
today and the previous 13 days, with at most 14 points. The database supplies
the daily averages; the existing SVG helper renders them without re-averaging.
Null playlist values remain gaps; missing totals are not turned into zero.

Player data refreshes every five minutes without document reload. Hidden tabs
skip polling; returning visibility refreshes if due. Requests cannot overlap,
have a ten-second client deadline, and intervals/listeners are cleaned up on
page replacement/reinitialization. Transient refresh failures preserve the last
display; a definitive 404 hides it. The browser never calls Supabase/provider.

## Registration/access and bundle follow-up (2026-10-06)

Normal RL permissions come from current `api.can_account_perform`, whose live
policy requires active account/player and registration status `complete`.
Optional `profileComplete` flags remain informational, not access requirements.
Canonical Epic linkage is still server-verified; stale authorization leaves the
link intact and allows stored-data access, while live stats refresh still needs
fresh authorization. Registration saves require confirmed completion before
redirecting to MyProfile with a one-time completion notice. Confirmed MyProfile
saves show success and return to the hub after three seconds; failures remain
on the editor with settings locked where confirmation is unavailable.

Per user-confirmed catalog semantics, multi-product offers receive a wider
bundle card/badge and source price. Counts describe only listed contents,
because the existing cache projection is bounded. Component artwork/names,
discounts and rarity are not invented. Ordinary item cards and cache/carousel
requests are unchanged; the existing master stylesheet imports the owning CSS.

## Verification boundary

Tests use synthetic responses, including persistence request payloads, not
live database writes or provider requests. Live source freshness, image
availability and the deployed daily-selection behavior remain operator checks.
No Supabase schema, deployment or push is part of this pass.

Local verification: 172 Rocket League tests, 109 route tests and 4 Shop refresh
tests pass. Pages build and refresh Worker dry-run pass. Diff whitespace check
passes. The browser preview failed to open due to a browser-session registration
error; actual screenshot/desktop/mobile visual verification remains outstanding.
The synthetic preview server was stopped and its temporary script removed.

## Exact changed files

- functions/api/rocketleague/network-statistics.js (new)
- functions/api/rocketleague/players/featured.js (new)
- functions/services/supabase/rocketleague/discovery.js
- functions/services/admin/generatedApiRouteInventory.js (generated)
- public/Tabs/RocketLeague/Index/HTML/index.html
- public/Tabs/RocketLeague/Index/JS/index.js
- public/Tabs/RocketLeague/Index/JS/auth.js
- public/Tabs/RocketLeague/Index/JS/networkStatistics.js (new)
- public/Tabs/RocketLeague/FindPlayers/HTML/index.html
- public/Tabs/RocketLeague/FindPlayers/CSS/index.css
- public/Tabs/RocketLeague/FindPlayers/JS/index.js
- public/Tabs/RocketLeague/FindPlayers/JS/view.js
- public/Tabs/RocketLeague/Features/HTML/shop.html
- public/Tabs/RocketLeague/Features/CSS/index.css
- public/Tabs/RocketLeague/Features/JS/shop.js
- tests/rocketleague/page_pass.test.mjs (new)
- tests/rocketleague/public_discovery.test.mjs
- tests/rocketleague/shop_api.test.mjs
- tests/route_health/rocketleague_navigation.test.mjs
- workers/rl-presence-monitor/tests/rl_shop_refresh.test.mjs
- _folder_structure/folder_organization/01_functions.txt
- _folder_structure/folder_organization/03_public.txt
- _folder_structure/route-health/routes.json (generated)
- _structure_details/request-frequency-inventory.md
- _structure_details/rocketleague-page-pass.md (new)

# Manual MTX artwork diagnostic

The local debugger accepts `catalog` to call the protected MMR Worker `/get-mtx-catalog` endpoint once. The Worker fixes the request to `Microtransaction/GetCatalog v1`, category `StarterPack`, with its server-owned authenticated Epic PlayerID. It shares existing API-key authorization and lookup rate limiting; no arbitrary RPC, player, category, purchase, persistence or scheduled call is added. The allowlisted response contains catalogue IDs, titles, HTTPS artwork locations (without queries/fragments), and contained ProductIDs only. Ownership/platform account details are excluded.

Run manually after independently approving deployment of the Worker change: `node --env-file=.dev.vars scripts/debug-rl-shop.mjs catalog`. Local implementation alone does not make the live endpoint available. Upstream documents StarterPack and permits empty artwork; this diagnostic does not establish a universal Featured Shop icon mapping.

The diagnostic now reports `imageStatus`: `missing`, `empty`, `rejected` or `usable`. Older Worker responses show `unreported` in the local caller. Rejected raw values are never printed. The read-only October 5, 2026 artwork check found rlshop.gg uses hashed static assets named by ProductID, including `4770.xtzkzIGC.webp` (Dominus) and `4989.C-86jkoV.webp` (Interstellar), with paint metadata separate from those paths. This proves a static mapping exists there, not an official general icon endpoint or variant-specific artwork contract. Asset reuse permission, a maintained mapping and paint/variant accuracy remain dependencies. No scraping, hotlinking, image download, R2 upload or third-party runtime dependency was added.
