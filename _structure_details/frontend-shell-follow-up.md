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

- The root shell loads Google AdSense. The reported Protected Audience API and
  third-party cookie activity appears associated with Google/DoubleClick and
  Google API frames, but the screenshots alone do not prove each request's
  initiator. Preserve ads and the existing AdSense privacy controls; validate
  with a browser request/initiator trace before changing ad behavior. Third-
  party cookie policy is controlled by those integrations and browser settings.
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
