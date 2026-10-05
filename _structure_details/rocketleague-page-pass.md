# Rocket League public page data paths

## Shop category carousel

The Shop page groups the cached catalogues by provider shop ID and shows provider
title/name/type plus logo as category navigation. It never imports live rlshop.gg
data or assumes product names/artwork beyond the normalized provider snapshot.
Each group contains at most five items, preserving catalogue order. Previous/Next
and category buttons navigate locally; an eight-second timer advances groups and
wraps across categories. Pause/Resume is explicit. Hover, keyboard focus, hidden
tabs, reduced motion and disabled site animations suppress automatic advancement.
Timers/listeners are cleared on reinitialization or after detecting a detached page;
late fetch responses cannot overwrite a newer page. Cycling makes no network calls.
Five columns fit wide screens, with three/two/one columns at smaller widths.

## Network statistics

`GET /api/rocketleague/network-statistics` calls the confirmed
`api.get_rocketleague_network_statistics()` with server-side Supabase access.
The response allowlist is playersOnline, registeredPlayers, activeSeasons,
upcomingEvents, matchesPlayed, scoreboardsSubmitted, goalsRecorded, generatedAt.
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
`Features/JS/shop.js` renders item images and section logos with a one-shot
error fallback to `/Assets/logo/gaming_network_logo_128px_no_border.png`.
No wallet/purchase calls, notification-image calls or page-triggered provider
refreshes were introduced.

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
