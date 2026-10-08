# Production acceptance — Section 1 operator preflight

2026-10-07. **NO-GO: production prerequisites are not ready.** Paused when the five-hour allowance reached 1%, below the requested 5% stop boundary; Section 2 is not authorized. No deployment, push, Cloudflare configuration change, secret rotation, Supabase mutation, runtime activation or new delivery enablement performed.

## Read-only production evidence obtained before stopping

- Pages project `bpd-webpage` exists with domains `bpd-webpage.pages.dev` and `bpd-gaming-network.com`; Git integration is present.
- The newest listed production Pages deployment `160e7e64-21be-4978-86d7-14a98de8c9ea` from branch `main`, source `d946250`, is **Failure**. The prior listed production deployment `9fbf9ed3-543b-4b9a-a41b-072be6a5578c` from source `3d86566` is the current rollback candidate, subject to confirming its live/canonical status.
- `bpd-custom-match-runtime` does **not exist** in the selected Cloudflare account. Its deployment and secret-list reads both returned Worker not found. This is a concrete release blocker because Pages declares the `CUSTOM_MATCH_RUNTIME` service binding even while the feature flag is false.
- Existing current Worker deployment/version pairs: Discord communications `66d7eff1-8aee-45ec-bf72-f8133062a6d4` / `7e9400df-41f6-443d-b6da-55071a554d5d`; Google mTLS diagnostic `310c01b4-a593-4a45-aa7f-9d18c41d2db4` / `ea013a44-a9de-4286-b964-5f4b058c031c`; OCR proxy `80bd4378-1087-4024-ad27-7d76fc29a619` / `b7caf030-60ae-4c16-b830-b3e083a67c82`; OCR consumer `dff76b9c-8653-4f8b-88d8-3f33805d0994` / `ce525d1b-3f7d-4112-a547-5df5f2a57cb6`; provider runtime `ad77afd9-5bbb-4b66-90d2-38c46465d666` / `7ca83489-8c4b-4a06-8c63-8005444cb43e`; presence monitor `214a1b45-9cac-42ab-8b20-8486e453b3f3` / `a3cb27f3-6195-4b1a-b51d-d4a3f8310d77`.
- Secret-name listings confirm Pages has the currently referenced core auth, provider, Supabase, OCR, Discord, MMR and Turnstile names. No values were retrieved, displayed or compared. Value compatibility remains unverified as explicitly required by the user.
- Provider runtime has `DISCORD_MATCHBOT_TOKEN` and `PROVIDER_RUNTIME_CALLER_SECRET`. OCR proxy has `OCR_API_KEY`, `OCR_GCP_X509_CERT_CHAIN`, `OCR_GOOGLE_TRANSPORT_SECRET`. OCR consumer has both job process/progress secure tokens. Presence has MMR/provider/Supabase/presence/summary names. Diagnostic has its bearer token and certificate-chain name.
- Discord communications currently lists only `DISCORD_COMMUNICATIONS_SECRET`; `NEW_TASKBOARD_REPORT_DISCORD` and `TASKBOARD_SUMMARY_DISCORD` are absent from that Worker. This is expected to keep new delivery disabled and blocks enabling its webhook delivery. Do not provision or enable them without a separately approved configuration step.
- Pages service-binding details, deployed ordinary variables/flags, applied DO migration tags/namespaces and canonical Pages deployment status remain unverified because the direct metadata reader was declined. The narrower Wrangler listing operations above were read-only and succeeded.

The current NO-GO is now based on two concrete blockers: the missing Custom Match target and missing communications webhook secret names for any future delivery activation, plus unverified binding/DO settings. Hypothetical local tests may validate name/value-shape behavior, but cannot prove matching production secret values.

## Release baseline

Branch main; commit d94625078b859db982b58200034fd5dcfb40158d. Candidate is the existing uncommitted Deep Clean working tree, not a release commit/version. Exact status and candidate file hashes are in operator-preflight-inventory.json. Listed untracked files are the documented Deep Clean implementation/tests/checkpoints; no unexplained untracked application file found. No changed/untracked SQL or migration file was found. Historical SQL support is not a new release mutation. Final local checkpoint exists; latest accepted full regression remains 903 passed, zero failed/skipped. Final Pages build and all seven Worker compiles passed. Preflight has not changed application code or rerun those accepted checks.

## Evidence boundary

Existing Wrangler login metadata was readable after a sandbox escalation; it identifies one account, but does not prove production target configuration. The further GET-only Cloudflare metadata check was declined by the user. No alternative credential path or browser workaround was attempted. Production versions, binding existence, secret presence/type, branch/build mapping, deployed flags and applied migration state are therefore UNVERIFIED, not missing or PASS. Repository intent must not be treated as deployed truth.

## Pages target

Intended project bpd-webpage. Repository build command npm run build; output .wrangler/public-build; Functions functions/; compatibility date 2026-09-16, no explicit compatibility flags. Production branch mapping/build override/custom domains require Cloudflare project evidence (local branch main is not proof of its mapping). Intended domain bpd-gaming-network.com. KV AUTH_SESSIONS/RL_STATS_CACHE; R2 OCR_TRAINING/OCR_STORAGE/OCR_PROGRESS; producer OCR_JOB_QUEUE -> bpd-ocr-jobs; four service bindings below; OCR_GCP_MTLS certificate binding. No D1 binding in repository. Variable names, namespaces/buckets/certificate IDs recorded in sanitized inventory; actual environment presence is UNVERIFIED. Intended API/private responses no-store; no mutable-URL immutable caching added.

## Complete Worker inventory

| Target | Repository folder | Compatibility | Exposure / placement | Local schedule |
| --- | --- | --- | --- | --- |
| bpd-rl-presence-monitor | workers/rl-presence-monitor | 2026-10-05 | workers_dev false; preview false; smart; status.bpd-gaming-network.com | */15 * * * *; 0 * * * *; 0 12 * * * |
| bpd-provider-runtime | workers/bpd-provider-runtime | 2026-10-05 | workers_dev false; preview false; smart; no public route | none |
| bpd-ocr-cloud-run-proxy | workers/ocr-cloud-run-proxy | 2026-10-05 | workers_dev false; preview false; smart; ocr-transport.bpd-gaming-network.com | none |
| bpd-ocr-job-consumer | workers/ocr-job-consumer | 2026-10-05 | workers_dev false; preview false; smart; ocr.bpd-gaming-network.com | */30 * * * * |
| bpd-discord-communications | workers/bpd-discord-communications | 2026-10-06 | workers_dev false; preview false; smart; no public route | 0 22,23 * * 5, gated disabled |
| bpd-custom-match-runtime | workers/bpd-custom-match-runtime | 2026-10-06 | workers_dev false; preview false; smart; no public route | none |
| bpd-google-mtls-diagnostic (seventh) | workers/google-mtls-diagnostic | 2026-10-05 | workers_dev false; preview false; placement unspecified; no public route | none |

Every Worker main is src/index.js. No explicit Worker compatibility flags. Account IDs are not pinned by repository config; selected login account is recorded but production ownership is unverified. Full per-target vars/secrets/KV/R2/mTLS/services/DO/crons/queues/observability are in the adjacent sanitized JSON. OCR consumer queue bpd-ocr-jobs: batch 1, timeout 1 second, retries 2, concurrency 2. Observability: Custom Match logs sampling .1; provider/proxy .1 persistent logs; diagnostic/consumer 1 persistent logs; presence .25 persistent logs; communications unspecified. Consumer traces disabled. No current deployed version/date or rollback identifier is established for any target.

## Secrets / variables

Per-target statically discovered secret references and all environment references are in operator-preflight-inventory.json. **Presence for every discovered secret is UNVERIFIED.** This is a conservative transitive import inventory: unused exported function bodies can over-report references. In particular, shared imports do NOT imply that communications needs SUPABASE_SERVICE_ROLE_KEY or DISCORD_AUTHZ_BOT_TOKEN; its README explicitly keeps database secrets out of that Worker. TASKBOARD_SUMMARY_DISCORD and NEW_TASKBOARD_REPORT_DISCORD are selected dynamically and must be added to its reviewed requirements. This inventory is not proof of required provisioning or runtime configuration; dynamic environment-name selection may require manual reconciliation. Matching secret names do not prove matching values. No secret value was printed or copied.

Important contracts: PROVIDER_RUNTIME_CALLER_SECRET on Pages/provider/presence; DISCORD_MATCHBOT_TOKEN in provider runtime; CUSTOM_MATCH_RUNTIME_CALLER_SECRET on Pages/custom runtime; SUPABASE_SERVICE_ROLE_KEY on trusted DB callers; DISCORD_COMMUNICATIONS_SECRET on Pages/communications; TASKBOARD_SUMMARY_DISCORD and NEW_TASKBOARD_REPORT_DISCORD webhook secrets in communications; OCR_GOOGLE_TRANSPORT_SECRET on Pages/proxy; OCR_API_KEY on the OCR proxy and OCR_JOB_PROCESS_SECURE_TOKEN on Pages/OCR consumer; DIAGNOSTIC_BEARER_TOKEN on diagnostic Worker. Disabled probe/linked-role secret references must be distinguished from required enabled functionality. Consult exact source consumers and inventory before provisioning; no rotation/provisioning authorized here.

No discovered credential-like code reference is assigned to a local ordinary var. Public app IDs, MatchBot public verification key, Turnstile site key and Supabase publishable key are intentionally non-secret configuration. Live secret-as-var duplication, missing references, stale names and configured secrets with no caller cannot be checked without production name/type listings. Do not report those unknowns as absent defects.

## Service binding map

| Caller | Exact binding | Target | Requirement / intended status | Deployed configured? |
| --- | --- | --- | --- | --- |
| Pages | PROVIDER_RUNTIME | bpd-provider-runtime | Required provider/Discord health and existing integration; private | UNVERIFIED |
| Presence Worker | PROVIDER_RUNTIME | bpd-provider-runtime | Required applicable provider operations; private | UNVERIFIED |
| Pages | CUSTOM_MATCH_RUNTIME | bpd-custom-match-runtime | Required for later transport; feature disabled; target may still be needed for Pages publication | UNVERIFIED |
| Pages | DISCORD_COMMUNICATIONS | bpd-discord-communications | Cutover/new communication path disabled; target may still be needed for publication | UNVERIFIED |
| Pages | OCR_GOOGLE_TRANSPORT | bpd-ocr-cloud-run-proxy | Required configured OCR transport and Admin health | UNVERIFIED |

Binding names match repository code. Admin Health runs inside Pages using these bindings, existing public status URLs and stored service status; it is not a separate Worker. OCR consumer invokes protected Pages HTTPS processing and shares existing queue/R2/KV; communications invokes signed Pages HTTPS summary/command routes. Those HTTPS dependencies are not Service Bindings. Existing MMR HTTPS provider is outside the seven repository Workers and needs separate operator ownership/version evidence if involved; do not invent its deployment.

## Durable Objects / migrations

Local Custom Match binding CUSTOM_MATCH_SESSIONS -> CustomMatchSession, exported implementation matches, tag custom-match-session-v1 creates SQLite class. Provider bindings RL_USER_SESSION -> UserRocketLeagueSession (rl-probe-security-v1), RL_PROBE_SECURITY -> RlProbeSecurityAuthority (rl-probe-authority-v2), DISCORD_LINKED_ROLE_NONCE -> DiscordLinkedRoleNonceAuthority (discord-linked-role-nonce-v1). Communications binding DISCORD_COMMUNICATION_RECEIPTS -> DiscordCommunicationReceipts, tag v1. Tags are ordered and unique within each Worker; the communications v1 is a separate Worker migration scope. No DO instantiated or migration applied during preflight.

Applied production tags/namespaces are UNVERIFIED. Required next migration cannot be identified until current production history is known; do not assume all local tags are new or already applied. Preserve namespaces/data/migration history during rollback; code rollback is not reverse migration. Real Service Binding/DO/hibernation/reconnect/concurrency/spectator/host/rejoin/recovery acceptance follows approved inactive deployment and explicit activation approval.

## Feature gates / Supabase freeze

Repository CUSTOM_MATCH_RUNTIME_ENABLED=false on Pages and runtime; DISCORD_COMMUNICATIONS_ENABLED=false on Pages and communications. Intended Custom Match activation and new Discord delivery remain DISABLED. Deployed flags are UNVERIFIED; do not claim live disabled confirmation without production evidence. No personal notification/reopen routes/subscriptions were introduced. Existing production-safe Discord behavior remains unchanged by this preflight.

Supabase remains frozen: authoritative spectator defaults disabled/4/max8, invite intended-team, rejoin, result overlap, monotonic provider verification, voting/player-result integrity and Admin Recovery accepted contracts preserved. No new DB assumption/SQL patch/schema mutation in this preflight. Existing local provider DO migration manifests are Cloudflare configuration, not Supabase SQL.

## Security/privacy

Intended headers: nosniff/SAMEORIGIN/referrer/permissions, API no-store, report-only CSP/Trusted Types, HTTPS HSTS300 without preload/subdomains. Logout POST, exact-origin profile/unlink/Admin mutation guards, sanitized allowlisted logging and reduced browser IDs are locally tested. Account scope/draft migration is a coupled browser/API change. Scope is correlatable, not authorization or anonymity. Required authorized Admin targeting UUID contracts remain intentional; no opaque-ID redesign here. Existing personal draft storage remains personal data. Live cache/header/origin/account-switch verification is pending.

## Compatibility / deployment order / rollback

| Component | Compatibility/order | Disabled after release? | Rollback boundary |
| --- | --- | --- | --- |
| Pages Functions + browser assets | Must release together, accountScope session DTO; all referenced missing target Workers must exist first | Custom/communications flags false | Roll back matching Pages deployment/asset pair; retain scoped drafts |
| Provider runtime | Target before Pages/presence when absent; compatible existing binding/caller-secret contract required | Probe disabled; preserve existing approved operations | Previous version plus unchanged DO authority state; never roll epoch backwards |
| OCR proxy | Existing target before Pages if absent; paired secret contract | Existing OCR behavior retained | Prior Worker version; preserve mTLS/bindings |
| OCR consumer | May update independently only with compatible protected Pages job contract; no incompatible consumer-first release | Existing queue/cleanup retained | Prior Worker version; preserve queue/R2/KV state |
| Presence Worker | Provider target first; coordinate retirement of old Discord sender with communications cutover | Existing approved schedules retained | Prior version; prevent duplicate summary owners |
| Communications | Provision private target before Pages if absent; activate after signed Pages contracts accepted | yes | Prior version/disabled flags; retain receipts; prevent dual senders |
| Custom runtime | Private target before Pages if absent; transport acceptance after matching Pages | yes | Disable gates first, code rollback compatible version; retain DO data |
| Diagnostic Worker | No new deployment needed absent verified change; retirement separate operator decision | No new public exposure | Existing version; preserve shared certificate |

Current production and rollback versions: UNVERIFIED for Pages and all Workers. Candidate version: uncommitted local file-hash manifest, not a deployed version or approved release commit. Operator rollback process is Pages rollback to a known successful production deployment and Worker rollback to a verified prior compatible version, after confirming platform restrictions and migration state. No rollback command is executed or claimed immediately safe. Missing historical identifiers and DO state prevent GO. No Supabase rollback needed.

## GO / NO-GO and required continuation

**NO-GO for Section 2.** Need read-only authoritative Cloudflare evidence for Pages build/branch/domains/env bindings/name/type configuration, all Worker settings/deployments/rollback IDs, secret presence and shared provisioning, DO namespace/applied tag history, queue/mTLS targets and live disabled flags. Unknown secrets/bindings are not asserted missing. Exact current target existence and release order cannot be approved from local manifests alone.

After those checks, retain production-only diagnostics, authorized Admin/mobile/populated graph/Shop/security checks and separate real Custom Match transport acceptance gates documented in deep-clean-final-local.md. Stopped without deployment; no Section 2 action authorized.
