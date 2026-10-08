# Deep Clean V2 — 1B/1C checkpoint, 7 October 2026

> Superseded for current local completion by [deep-clean-final-local.md](deep-clean-final-local.md), 2026-10-07. Counts and deferred browser identity/header descriptions below are historical checkpoint evidence.

## Status

1B identifier hardening and 1C bounded security corrections: **PASS locally**.
Required identifier migrations and staged browser policies remain explicit below.
This is not a claim that every historical endpoint or production setting is secure.
STOP before deployment. No push, deployment, Supabase/configuration modification,
runtime activation, SQL file or migration file was performed/created.

Acceptance hold CLEARED by authoritative user live results: Admin Recovery is
SECURITY DEFINER with EXECUTE service_role/postgres only, excluding
PUBLIC/anon/authenticated. Spectator defaults disabled/4, maximum 8, and
create/read/limits/settings/occupancy/role/invite enforcement are confirmed.
Custom Match DB contracts are frozen unless concrete defect evidence appears.

## Completed

- RL profile HTTP projection recursively omits canonical account/player/snapshot
  keys. Server normalization, authorization, RPC parameters and cache ownership
  retain them. Registration uses explicit profileExists/access flags. Settings,
  MMR values/timestamps and required own-provider metadata remain compatible.
- Admin User Management already projects display names and omits unnecessary
  detail/provider/actor IDs. Its accountId list/routing contract remains necessary.
  Admin force-refresh confirmation/results no longer repeat the raw target UUID.
  No fake browser-generated opaque identity or resolver was introduced.
- Logout now supports same-origin POST; GET returns 405 without deleting sessions.
  Both browser callers use POST. KV deletion, six session/OAuth cookie expirations,
  root redirect and existing best-effort cleanup remain compatible.
- Profile POST/PATCH and provider unlink reject missing/foreign Origin and
  cross-site metadata before authorization/upstream work. Unlink rejects non-POST
  calls and no longer reflects unknown database codes.
- Pages middleware applies existing nosniff/SAMEORIGIN/referrer/permissions headers
  to Functions and API no-store. Admin writes under /api/admin/ and /api/auth/admin/
  require exact same-origin Origin; route authorization is still mandatory.
  Signed internal ingress retains its own signature/replay trust boundary.
  Static caching and exact status-101 WebSocket upgrade objects are preserved.
- Session route/service and KV warnings omit arbitrary errors/stacks/raw account
  payloads. Profile MMR read/cache/RPC logs omit account/player/snapshot IDs and
  arbitrary errors. Existing 2A/2B/2C diagnostics and X-Debug-ID remain unchanged.
- Removed stale Admin recovery database-verification wording and synchronized docs.

## Security audit evidence and limits

| Control | Evidence / disposition |
| --- | --- |
| Identity and Admin | authorizeRequest resolves canonical identity from KV; current Admin and target/Owner protections remain. Recovery uses fixed service-role RPC, public codes, reason/version/idempotency. |
| Session/cookies | sessions/session.js uses HttpOnly, SameSite=Lax, Secure on HTTPS and existing absolute/idle expiry. Failed KV deletion still expires browser cookies; successful global revocation is not claimed on KV failure. |
| CSRF | Origin guards on changed logout/profile/unlink/Admin writes; existing account/Custom Match guards retained. JSON-only contracts remain. |
| Secrets/logs | Inspected browser JS contains no service-role/access/refresh-token configuration. Changed logs omit payloads/secrets/IDs. External secret stores were not attested. |
| XSS / Trusted Types | User Management and Custom Match dynamic text uses textContent. Shell/Task Board innerHTML sinks load repository-owned templates/config. No concrete injection established in this bounded trace; strict Trusted Types would break current template loading. |
| Replay | Existing ES256 handoff consumes IDs atomically; signed Discord/internal ingress replay protections and Custom Match DB action ledger remain authoritative. |
| Abuse limits | Existing submission controls, provider backoff and Discord rate handling retained. Production WAF/global quotas were not changed or attested; no KV pseudo-atomic limiter added. |
| Headers/cache | Function headers now match safe static rules; API no-store, cookies and redirects verified. Upgrade headers remain transport-owned. |
| CSP/HSTS/COOP | AdSense, Turnstile/OAuth and template loading require staged compatibility verification. Strict policies/preload were not blindly enabled. |

## Deferred identifier contracts and security policies

Auth session user.userId remains required by Framework/Auth active-account checks,
RL/Account consumers and registration per-account draft isolation. Replacing it
requires a real server-issued non-sensitive scope and coordinated account-switch
tests. Admin users[].accountId/detail/notes/actions/history and force-refresh
targets need a real opaque server resolver before API migration. Own-account Epic
identifiers remain where registration/link consumers require them. Visual masking
does not remove identifiers from authorized network requests/developer tools.

Stage CSP report-only with approved reporting and measured script/style/connect/
image/frame allowlists; review trusted template sinks before Trusted Types.
Verify HTTPS/domain coverage before bounded HSTS; no includeSubDomains/preload
without separate acceptance. Evaluate COOP same-origin-allow-popups against OAuth
and AdSense before enforcement. These are documented policy follow-ups, not enabled
production controls or a new database dependency.

## Verification

Focused User Management/profile/provider/delete/security: **90 passed, 0 failed,
0 skipped**. Full OCR/RL/Suggestions/routes/Admin/all Worker suite: **850 passed,
0 failed, 0 skipped, 0 cancelled**. Previous baseline 841; nine added checks cover
real profile GET projection, recursive privacy projection, logout origin/GET/KV/
cookies, sensitive error redaction, headers/cookies/static caching/upgrade identity,
profile/unlink origin rejection, and Admin guard versus route authorization.

`npm run build:check`: assets and Pages Functions compiled. No Worker implementation
changed in this pass; previous Worker compile evidence remains valid.
`git diff --check`: passed. All runtime tests used local fixtures.
Ignored evidence: .wrangler/health-validation/hardening-targeted-tests.txt,
hardening-full-tests.txt and hardening-build.txt.

## Exact files changed in this pass

- functions/_middleware.js (new)
- functions/api/auth/logout.js
- functions/api/auth/session.js
- functions/api/admin/rocketleague/custom-match-host-recovery.js (accepted-contract comment)
- functions/services/auth/account/get_session.js
- functions/services/auth/account/unlink_provider.js
- functions/services/auth/sessions/session.js
- functions/services/rl/profile.js
- functions/services/rl/stats/latest_cache.js
- functions/services/rl/stats/latest_mmr.js
- functions/services/supabase/rocketleague/get_latest_mmr.js
- functions/services/admin/generatedApiRouteInventory.js (regenerated logout methods)
- public/Framework/Banner/JS/account_banner.js
- public/Global/Admin/WorkerStatus/JS/index.js
- public/Global/Admin/Home/JS/custom_match_recovery.js
- public/Global/Admin/Home/HTML/index.html
- public/Tabs/RocketLeague/Registration/JS/index.js
- workers/rl-presence-monitor/tests/provider_authorization.test.mjs
- tests/route_health/security_hardening.test.mjs (new)
- _folder_structure/route-health/routes.json (regenerated logout methods)
- _folder_structure/folder_organization/01_functions.txt
- _folder_structure/folder_organization/05_support_and_generated.txt
- _structure_details/deep-clean-progress.md
- _structure_details/deep-clean-continuation.md
- _structure_details/deep-clean-hardening.md (new)
- _structure_details/custom-match-contract-boundary.md
- _structure_details/phase4-production-readiness.md
- _structure_details/system-map.md

Earlier uncommitted work is preserved and not attributed to this pass.

## Performance / privacy

Projection adds a linear walk of the existing response and sends fewer internal
identifier fields. Middleware adds headers/origin checks with no upstream calls.
No production latency improvement is claimed. API no-store prevents browser/shared
cache reuse; existing server Shop/MMR caches remain. No new dependency or storage.

## Recommended release sequence / remaining live-only validation

1. Review the local change set and separately approve staged release. Database
   acceptance is complete; do not reopen it/create SQL without defect evidence.
   Deploy approved database-independent Pages/Functions/diagnostic Workers first;
   keep Custom Match disabled.
2. Follow existing authorized User Management list and public GET /api/faq
   reproduction procedures. Capture sanitized status/error/X-Debug-ID and matching
   server stage logs only. Capture Leaderboard scheduled collection diagnostics;
   public GET does not recollect. Prove causes before repairs. Validate Admin
   Health, Shop and Discord diagnostics. Never share raw HARs/cookies/payloads.
3. Real browser/mobile acceptance: login/link/reauthorize/unlink/logout, account
   switching/draft isolation, Admin allow/deny, privacy/cache/headers, populated
   graphs/Shop and accessibility/SEO. Admin requires an already valid authorized
   session; otherwise pending. No bypass or credential injection.
4. Separately validate Service Binding, real Durable Object/WebSocket upgrades,
   reconnect/resync/hibernation, spectator create/join/invite/capacity and
   host/rejoin/Admin-transfer. Activate runtime only after those checks and separate
   approval. Discord provisioning/delivery also remains controlled; weekly receipts
   do not prove delivery.
5. Complete staged browser security-policy acceptance and fresh production
   Lighthouse/PageSpeed/Core Web Vitals plus final release regressions.

## Approval required

Staged release validation is next. STOPPED before deployment, push, Supabase change,
production configuration or runtime activation. Separate release approval required.
