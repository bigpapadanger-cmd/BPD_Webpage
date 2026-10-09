# Frontend Shell and Dashboard Follow-up

Snapshot: 2026-10-09

## Current segment

Desktop and mobile shell navigation now groups game pages into dropdowns and
separates primary destinations from account, Admin, community, and policy
links. The Dashboard uses the existing authenticated account state and shared
sanitized notifications. A match-activity feed is not available through a
verified browser/API contract, so the page does not infer match activity.
Admin Match Management is an authenticated placeholder.

The local Lighthouse screenshots identified a Dashboard layout shift score of
0.241, render-blocking `master.css` and `account_banner.css`, 32 KiB of
cache-lifetime opportunities, an oversized Discord icon asset, unused Google
Ads JavaScript, non-composited header/footer padding animation, and low footer
copyright contrast. This segment adds a formatting context and explicit
Dashboard spacing, reserves the provider icon's displayed dimensions, removes
the padding animation, and raises footer text contrast. These code changes are
not a replacement for a post-release Lighthouse measurement.

## Deferred validation / later segment

- Rerun desktop and mobile Lighthouse on the released Dashboard and compare
  CLS and all four Lighthouse categories with the supplied baseline.
- Inspect the remaining CLS contributors in a real browser trace before making
  further layout changes.
- Evaluate first-party cache headers and right-size the Discord asset without
  changing third-party Ads or Cloudflare telemetry behavior.
- Keep critical shell CSS render-blocking unless a measured, tested critical-CSS
  strategy can preserve first paint and avoid FOUC/layout shifts.
- Verify authenticated dashboard notification display and reviewed destinations
  with an authorized session; this local segment does not assume one.
- Run representative route, keyboard, touch, and narrow-mobile checks for all
  shared navigation variants.
- Do not claim a production performance improvement from local source changes
  alone; field Core Web Vitals require post-release data.

## Full-site Lighthouse follow-up (2026-10-09)

The additional browser screenshots report deprecated APIs, 24 third-party
cookies, no enforced XSS-focused CSP, short HSTS, no COOP, and CLS 0.241.
These are site-wide findings and need representative route coverage, not only a
Dashboard check.

### Addressed locally in this segment

- Pages static assets and Function responses now use a one-year HSTS max-age.
  `includeSubDomains` and `preload` remain off until every subdomain and its
  long-term HTTPS availability have been independently verified.
- Both response paths now set `Cross-Origin-Opener-Policy:
  same-origin-allow-popups`. The inspected `window.open` calls already use
  `noopener,noreferrer`; this policy preserves compatibility with external
  authorization popups.
- Existing `X-Frame-Options: SAMEORIGIN` and `frame-ancestors 'self'` reporting
  remain in place.

### Findings requiring staged follow-up

- The root shell no longer loads Google AdSense before approval. Configured
  display units are handled by the deferred loader described below. The
  screenshots do not identify the complete URL/initiator of every third-party
  warning; recheck those origins when approved advertising is enabled.
- No repository source call to `navigator.storage.persist()` or Protected
  Audience APIs was found. Lighthouse attributes the warning to a minified
  `main.js:1`; determine the actual script URL and initiator in DevTools before
  attributing or changing it.
- The site only sends a report-only CSP. It currently observes Trusted Types
  violations but has no reporting endpoint, and it does not provide an
  enforcing `script-src` policy. Do not switch to enforcement from this
  inventory alone: the SPA has many dynamic HTML sinks, AdSense injects scripts
  and frames, and authentication / Turnstile flows need a tested source policy.
  Next step: capture report-only violations across representative public,
  authenticated, Admin, Ads, OAuth, and OCR routes; then design a nonce/hash
  policy and test its report-only version before enforcement.
- The Lighthouse CLS score of 0.241 needs a real-browser trace on the exact
  measured route and viewport. Existing local shell spacing changes are not
  evidence that the score is fixed. Record the shifted nodes, trigger, and
  before/after field or lab metric before further layout edits.
- Run the full-site security/performance matrix after release: public routes,
  authenticated routes with an authorized session, Admin only with a valid
  authorized session, mobile drawer, auth popup behavior, ad consent, CSP
  violations, and all four Lighthouse categories. Do not use credentials in
  tests or infer Admin production behavior without an authorized session.

## Site-wide loading stages (2026-10-09)

- `router.js` retains route authorization, CSS, fragments and required route
  initializers as the primary readiness contract. Route modules already load
  through dynamic imports. Shared sidebar behavior now loads dynamically;
  navigation becomes interactive before its tooltip fragment arrives.
- Session refresh publishes account readiness without waiting for Admin access.
  `getAuthState({ includeAdmin: true })` waits for the canonical staff check;
  this is the default on `/Admin` destinations. Other pages request it after
  route readiness, window load and an idle opportunity. Unknown/denied staff
  state keeps shortcuts hidden. A response for an older session cannot grant
  access to a newer session.
- Notifications and API monitoring are imported after primary page readiness
  and window load. A 36px bell opens the notification dropdown; it is disabled
  during the initial fetch. The notification controller skips automatic reads
  during navigation and ignores responses from a previous authentication state.
  Dashboard review destinations use the small `notification_destinations.js`
  module instead of importing the notification controller on the critical path.
- The router starts `Global/Ads/JS/ads.js` last. There are currently no approved
  display-unit IDs, so placeholders make no ad-network requests. Once IDs are
  configured with `data-ad-slot`, requests require viewport proximity and at
  least 250px width/50px height. Fixed reserved banner heights are 90px desktop
  and 100px narrow-screen; no-fill/error states retain that space. Disable
  AdSense automatic in-page placement before activation to retain controlled
  placement. Review approval, unit sizes and certified consent settings before
  adding IDs; no consent choice or AdSense account setting is fabricated here.
- Shared CSS keeps the route shell at its existing available viewport height,
  reserves the initial header row and named dynamic lists/grids, and reserves
  banner space for the bell. Loading decoration ends with primary readiness;
  empty states keep space without continuing to imply a pending request.
- The mobile drawer container is a `div`, allowing its existing `dialog` role
  while open. Its nested navigation, accessible name, focus containment,
  inert-background behavior and Escape handling are preserved.

### Cookie/deprecated API findings

The BPD session and OAuth cookies are host-only, Secure/HttpOnly on HTTPS and
SameSite=Lax. Login uses top-level redirects rather than cross-site cookie
access, so these cookies should not be converted to CHIPS or SameSite=None.
AdSense owns its cross-site advertising cookies. Google's limited-ads mode
can still use invalid-traffic cookies/local storage; it must not be advertised
as cookie-free. Select appropriate certified CMP/AdSense settings after
approval and verify with third-party cookies blocked.

No repository calls to the deprecated persistent StorageType or Protected
Audience methods were found. The screenshot's `main.js:1` alone does not prove
the script's origin. Removing the premature advertising bootstrap removes that
known injection path now; vendor warnings still require a full URL/initiator
trace if they recur. Cloudflare's externally supplied telemetry/polyfills are
also vendor code, not a local module to rewrite.

### Research used (accessed 2026-10-09)

- [Chrome agentic browsing scoring](https://developer.chrome.com/docs/lighthouse/agentic-browsing/scoring): experimental checks, valid accessibility trees and stable layout.
- [web.dev CLS guidance](https://web.dev/articles/optimize-cls): reserve space for dynamic content and ads, including no-fill states.
- [MDN Intersection Observer](https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API): viewport-based deferred work.
- [AdSense responsive units](https://support.google.com/adsense/answer/9183363?hl=en): controlled responsive unit geometry.
- [Third-party cookie restrictions](https://privacysandbox.google.com/cookies/prepare/overview): audit and test cross-site dependencies.
- [Google's retirement announcement](https://privacysandbox.google.com/blog/update-on-plans-for-privacy-sandbox-technologies): the older overview's Protected Audience/Topics recommendations are no longer a migration target.
- [AdSense limited ads](https://support.google.com/adsense/answer/14210870?hl=en): limited ads are not necessarily cookie-free.

### Local verification

Frontend assets and Pages Functions compiled; 171 route tests passed
after adding ad-loader coverage. Auth deferral/stale-session tests and
notification pending/sign-out tests passed. Headless Edge visited all 41 route
destinations at 1440x900 and 390x844 with synthetic API responses: no uncaught
page errors, no horizontal overflow, and correct recovery/denial outcomes for
protected routes. Optional notification/Admin calls followed primary readiness;
the bell opened, closed on Escape and restored focus. Unconfigured ads issued
no requests. These checks do not establish production CLS or a production Lighthouse score.

## Accessibility follow-up (2026-10-09)

Chrome's [accessibility scoring guidance](https://developer.chrome.com/docs/lighthouse/accessibility/scoring)
uses weighted, binary audits and requires manual checks in addition to the
automated score. The [WAI disclosure pattern](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/)
informs the existing native-button/aria-expanded/aria-controls dropdown behavior.

The rendered-page audit found and corrected:

- Account banner and desktop sidebar content outside named landmarks. The
  banner is a named region; the generic sidebar container is complementary on
  desktop and becomes a named modal dialog on mobile, with existing focus and
  inert behavior preserved. This avoids the original aside/dialog role mismatch.
- Account help text and ARK small purple labels below 4.5:1 contrast. Scoped
  text colors were raised and the actual rendered colors rechecked.
- FAQ published/matched answer groups and the Login verification container had
  aria-label on generic divs with no naming-compatible role. They now have
  explicit group semantics.
- The public profile's only h1 was inside a hidden data panel, so error/loading
  states had no page heading. A persistent h1 now titles the page; the player
  name is h2 when available.
- Header placeholder whitespace defeated :empty, and the empty banner had no
  height reservation. The outer containers now reserve the existing dimensions;
  whitespace-only navigation is removed before fragment paint.
- Page display rules overrode the native hidden state on the main-menu Admin
  card and Dashboard sign-in link. Shared CSS now enforces hidden except for
  the distinct until-found state. The staff card occupies a trailing reserved
  grid cell; sidebar staff links have reserved rows. Revealing the links in a
  visual fixture left neighboring cards, legal links and sidebar rows unchanged
  at both viewport widths. The Dashboard reserves status text and sign-in space.
  See [MDN hidden semantics](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/hidden).
- The signed-out walkthrough uncovered a failed Turnstile script retained in
  the document. A later retry waited for an event that had already fired. The
  loader now removes failures and bounds pending script load to 12 seconds;
  sign-in stays disabled until successful verification. Existing 73px normal /
  148px compact reserved widget footprints match Cloudflare's documented
  65px/140px widget heights plus the current 8px padding.

### Browser/lab evidence and limits

Using the built assets and synthetic API responses, axe-core scanned 24 distinct
rendered permitted/recovery pages while visiting all 41 destinations in each
viewport (1440x900 and 390x844): zero violations in signed-in and signed-out fixtures.
Open notification dropdowns and the open mobile navigation dialog also had
zero axe violations; Escape closed them and restored focus/inert state.

Local Lighthouse 12.8.2 Dashboard snapshots scored Accessibility 100 and SEO 100
on desktop/mobile. Final performance snapshots were 80 desktop and 97 mobile;
they use an uncompressed localhost fixture,
not Cloudflare production delivery, so they are not a production comparison.
Best Practices was 96 due to fixture console/network errors. No claim of
complete WCAG compliance or production score follows from these lab results.

The final signed-in Dashboard shift trace was 0.000040 desktop / 0.000060 mobile,
and the signed-out trace was 0.000044 desktop / 0.000060 mobile. The final
Lighthouse run measured 0.000040 desktop / 0.000066 mobile. The remaining source was the account-status
text swap. Production CLS, populated staff/game workflows, live Turnstile,
screen-reader usability and approved-ad consent/fill still need authorized live
verification. No release or deployment was performed.

Cloudflare reference: [Turnstile widget configurations](https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/widget-configurations/), accessed 2026-10-09.

## Supabase redirect and REST-base follow-up

The `SUPABASE_URL` setting may be either the project URL or the configured
`/rest/v1/` endpoint. The shared `services/supabase/rest.js` helper normalizes
to a trailing `/rest/v1/` base and appends table/RPC paths beneath it. It does
not remove that suffix and reconstruct it elsewhere. Its redirect transport
uses manual redirects, follows only HTTPS same-origin targets that remain under
`/rest/v1/`, limits hops, and rejects ambiguous or cross-origin redirects so
service authorization headers are never forwarded to another host. Notifications
records HTTP redirect status and a safe destination category for rejected
redirects.

The browser Notifications and Admin User Management clients now use the existing
same-origin `apiFetch` guard. The Leaderboard browser client already used it and
remains on it. These browser requests still go to BPD `/api/*`; only server-side
Cloudflare functions call Supabase directly. Relevant references: [Cloudflare
Fetch redirect policy](https://developers.cloudflare.com/workers/runtime-apis/request/)
and [Supabase Data REST API](https://supabase.com/docs/guides/api), accessed
2026-10-09.

## Notification API boundary and Trusted Types follow-up

Keep `core.notification_state` and `core.notification_events` outside the
Supabase exposed-schema list. The Pages service uses narrowly scoped
`api.*notification*` RPCs, granted to `service_role` and `postgres` only; the
prepared migration and rollback are in local operator materials under
`Notes/supabase/notifications/`. These SQL files are not applied by application
builds and must be reviewed/applied in Supabase before deploying matching Worker
changes.

The report-only Trusted Types findings came from dynamic HTML/script URL
assignments in the account banner, router, header renderer, and sidebar hover
loaders. The banner and header now build nodes with DOM APIs. Router and hover
fragments accept TrustedHTML only when fetched from same-origin static `.html`
assets; their final URL may be only the exact corresponding path without
`.html`, because the live edge responds with 308 redirects that strip that
suffix. All other destinations are rejected. Classic route script URLs are
constrained to same-origin `.js` assets. Other app-owned HTML sinks now use
either these static-asset checks or the escaped-template helper (whose callers
must escape dynamic text/attributes and validate URLs). Dynamic script URLs are
restricted to local assets or the fixed Turnstile/AdSense URLs.

The live page also receives Cloudflare-injected code at
`/cdn-cgi/challenge-platform/scripts/precursor/main.js`. Deprecation warnings
attributed to `main.js` and the inline Trusted Types report at `(index)` match
this edge injection, not a repository-owned `main.js` (none exists in `public`).
The remaining report-only violation is from Cloudflare's injected inline loader,
which assigns the Precursor script URL as a plain string. Cloudflare
Precursor/JavaScript Detections is configurable in the Cloudflare zone's
Security settings; changing it affects bot protection and must be a separate,
deliberate security decision. Keep report-only CSP while this injection remains;
app code does not suppress or trust it. See [Cloudflare Precursor](https://developers.cloudflare.com/cloudflare-challenges/precursor/)
and [Cloudflare JavaScript Detections](https://developers.cloudflare.com/cloudflare-challenges/challenge-types/javascript-detections/),
accessed 2026-10-09.

## Follow-up: production notification transport error

When a Cloudflare log reports `stage: event_list`, `fetch_type_error`, and no
`upstreamStatus`, while Supabase API Gateway has no matching request, the
failure happened before an HTTP response came back from Supabase. The original
diagnostic could not distinguish DNS, connection, TLS, redirect, or request-shape
failures. Transport failures now log a closed-set `transportCauseClass` derived
from recognized nested cause codes/messages. Upstream redirects are handled
manually (never followed, so authorization headers are not forwarded), then
rejected with their HTTP status and a closed-set `redirectTargetClass`. Neither
path logs raw exception text, request headers, or URL/query values. Deploy this
diagnostic update and reproduce one signed-in Dashboard load while streaming
Cloudflare Pages Function logs; use the new category to select the next
investigation.
