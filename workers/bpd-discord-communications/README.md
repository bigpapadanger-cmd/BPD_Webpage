# Discord communications

Private communication runtime; no public routes, workers.dev, preview URLs,
Supabase credentials, account resolution, task mutation, or RL session state.
Pages keeps the existing public Discord interaction URL:
`https://bpd-gaming-network.com/api/auth/discord/matchbot/interactions`.

## Execution paths

- Interaction: Pages bounded raw-body read -> Service Binding -> Discord
  Ed25519 signature, timestamp and application check -> atomic interaction-ID
  receipt -> private deferred acknowledgement -> Pages read-only canonical
  Discord account lookup -> current account access -> fresh staff guild roles
  -> tasks.update -> current Taskboard membership and persisted responsibility
  -> canonical lifecycle RPC with server-derived actor/version -> Worker reply.
- Task create/complete/shelve: existing Pages embed builder -> signed private
  Worker request -> fixed configured Discord webhook. No browser chooses URL.
- Weekly: Friday 22:00 and 23:00 UTC cron opportunities -> Friday 18:00
  America/New_York gate -> one receipt for local Friday date -> signed HTTPS
  POST `/api/internal/discord/task-summary` -> Pages verifies HMAC and consumes
  request nonce through the Worker -> existing `api.admin_taskboard_summary()`
  -> strict aggregate contract -> one mention-free weekly Discord report.
  `active_tasks` in that RPC means non-deleted, including completed/archived.

The old presence Worker no longer sends Taskboard summaries, including manual
`job=taskboard`. Its daily noon leaderboard refresh and hourly RL jobs remain.

## Secrets and configuration — operator steps, not executed

Both Pages and this Worker require **the same new random**
`DISCORD_COMMUNICATIONS_SECRET` (at least 32 bytes of random material). Generate
and transfer it securely; never paste it into chat, source, logs, or command
arguments. Secret provisioning prompts accept values without putting them in
source files:

```powershell
# Run from DomainData; these commands change live secrets only when you run them.
npx wrangler secret put DISCORD_COMMUNICATIONS_SECRET --config workers/bpd-discord-communications/wrangler.jsonc
npx wrangler secret put NEW_TASKBOARD_REPORT_DISCORD --config workers/bpd-discord-communications/wrangler.jsonc
npx wrangler secret put TASKBOARD_SUMMARY_DISCORD --config workers/bpd-discord-communications/wrangler.jsonc
npx wrangler pages secret put DISCORD_COMMUNICATIONS_SECRET --project-name bpd-webpage
```

Existing webhook secrets are provisioned into the new Worker by the operator;
they cannot be recovered from Cloudflare encrypted secret listings. Do not copy
Supabase, Epic, PsyNet, browser-session, or provider-runtime secrets into it.
DomainData retains its existing Supabase service-role and Discord authorization
bot/guild configuration. Public app ID/key are configured, not secrets.

Pages binding: `DISCORD_COMMUNICATIONS -> bpd-discord-communications`.
Worker namespace: `DISCORD_COMMUNICATION_RECEIPTS`, class
`DiscordCommunicationReceipts`; first SQLite DO migration is in Wrangler config.
Both configs ship `DISCORD_COMMUNICATIONS_ENABLED="false"`. After approved
provisioning/cutover, enable both together. This is not a deployment instruction.

Register `/complete` separately in Discord with one required string option:
`tasknumber`. Use the existing displayed code (`TASK-ABC234` format), not an
account/database ID. Command registration and Portal configuration were not run.

## Failure and replay policy

One DO per SHA-256 operation key. Persist only hashed key and expiry; alarm
cleanup removes expired receipts. Interaction receipts last 10 minutes, replies
20 minutes, notification payload hashes one day, weekly occurrences eight days,
and signed summary request nonces one minute. HMAC binds POST/path/body/time/nonce
with a 30-second acceptance window. A duplicate is atomically rejected before
account/task mutation or delivery. Never reset a receipt to retry blindly.

Claims are consumed before external work. There is no atomic transaction spanning
DO, Supabase and Discord: a crash can leave a task completed without a reply, or
leave a summary undelivered. Receipts deliberately prevent retries after ambiguous
delivery. This is at-most-one automatic attempt, **not guaranteed exactly-once
delivery**. Operator reconciliation is required for missing/uncertain reports.
No background retries; 429 responses remain unavailable and are not hammered.
Provider requests have bounded deadlines and streaming response-size limits.

When disabled, task activity notifications retain the existing Pages delivery
path for compatibility. Inbound commands fail closed. On cutover, notifications
use only the Worker; no automatic fallback after its failures.

## Verification before live cutover

1. Run `npm test`, Worker dry-run, Pages build and diff checks.
2. Confirm secret **names only**, matching shared-secret provisioning, app ID/key,
   private Worker config, Service Binding and namespace migration.
3. Register `/complete` manually; verify a signed Ping and private command reply.
4. Test authorized assigned task, missing/completed task, unlinked user, suspended
   account, and unauthorized responsibility. Replaying one interaction must not
   cause another mutation.
5. Verify created/completed/shelved notifications route once through the Worker.
6. Confirm Friday 6 PM timezone schedule and no old daily Taskboard sender.
7. Check FAQ/Suggestions against live contracts separately; local regressions
   cannot establish production data/config readiness.

Rollback: disable communications on both sides, retain receipt namespace/state,
restore prior Pages ingress if needed. Do not delete the namespace or restore the
old daily summary owner during cutover. Rotate the shared HMAC secret on both
sides together; key mismatch fails closed. No Supabase schema changes required.

## Phase 2 changed files

Communication implementation and configuration:

- `workers/bpd-discord-communications/src/index.js`
- `workers/bpd-discord-communications/src/receipts.js`
- `workers/bpd-discord-communications/wrangler.jsonc`
- `workers/bpd-discord-communications/README.md`
- `functions/services/admin/discord_communications.js`
- `functions/api/internal/discord/task-summary.js`
- `functions/api/auth/discord/matchbot/interactions.js`
- `functions/services/auth/providers/discord_matchbot/interactions.js`
- `functions/services/auth/providers/provider_identity.js`
- `functions/services/admin/taskboard_discord.js`
- `functions/services/supabase/admin/tasks/lifecycle.js`
- `functions/services/supabase/admin/tasks/rpc.js`
- `workers/rl-presence-monitor/src/index.js`
- `workers/rl-presence-monitor/src/taskboard_summary.js` (removed; former daily sender)
- `workers/rl-presence-monitor/README.md`
- `wrangler.jsonc`
- `package.json`

Admin navigation/Suggestions work completed earlier in Phase 2:

- `public/Framework/Shell/HTML/Sidebar/admin.html`
- `public/Framework/Shell/JS/Sidebar/sidebar.js`
- `public/Global/Admin/Suggestions/HTML/index.html`
- `public/Global/Admin/Suggestions/JS/index.js`
- `functions/api/admin/suggestions/index.js`

Tests and generated/documentation consumers:

- `workers/bpd-discord-communications/tests/communications.test.mjs`
- `tests/admin/discord_command_lookup.test.mjs`
- `tests/admin/accordion.test.mjs`
- `tests/route_health/routes.test.mjs`
- `tests/route_health/rocketleague_navigation.test.mjs`
- `workers/rl-presence-monitor/tests/worker_dispatch.test.mjs`
- `workers/ocr-cloud-run-proxy/tests/index.test.mjs`
- `functions/services/admin/generatedApiRouteInventory.js`
- `_folder_structure/route-health/routes.json`
- `_folder_structure/folder_organization/01_functions.txt`
- `_folder_structure/folder_organization/04_workers.txt`
- `_structure_details/request-frequency-inventory.md`

Unrelated pre-existing Phase 1 Rocket League graph/platform changes are preserved.
FAQ review retains its existing APIs and authorization; local FAQ/Admin tests
pass, but prior production 503 reports still need live verification. This pass
does not claim live configuration or database access has been proven.
