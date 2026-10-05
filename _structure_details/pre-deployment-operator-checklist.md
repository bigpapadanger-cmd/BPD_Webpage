# Pre-deployment operator checklist — prepared, not executed

No deployment/push, live provider test, Supabase change or Portal configuration
was performed for this checklist. Run live steps only with separate approval.
Never paste secret values, tokens, account/Discord IDs or complete provider bodies.

## 1. Review intended versions and bindings

- Confirm the intended production Pages and Worker versions before any approved
  rollout; runtime configuration below must match those versions.
- Pages root `PROVIDER_RUNTIME` must target `bpd-provider-runtime`. The scheduled
  control plane must also retain its existing binding to that runtime.
- Runtime: `workers_dev=false`, `preview_urls=false`, no public routes/custom domain.
- Confirm `DISCORD_LINKED_ROLE_NONCE` -> `DiscordLinkedRoleNonceAuthority`, migration
  tag `discord-linked-role-nonce-v1`. Preserve existing RL migrations/namespaces.
- Confirm nonce namespace is distinct from `RL_USER_SESSION` and `RL_PROBE_SECURITY`.
- Keep `RL_PROBE_SECURITY_ENABLED=false`; no probe execution or history persistence.

## 2. Inspect expected configuration without revealing values

- Verify the runtime has `DISCORD_MATCHBOT_TOKEN` and `PROVIDER_RUNTIME_CALLER_SECRET`.
- Verify the Pages/control-plane caller secret matches the runtime secret using
  protected internal health responses, not printing or copying secret values.
- No new nonce secret is needed; no Supabase credential belongs in the runtime.
- Inspect the live normal var `DISCORD_LARGE_BOT_SHARDING`. It must explicitly be
  `false` for the current small bot, or `true` with correct shard inventory behavior
  if the bot actually requires large-bot REST sharding. Do not infer it from intents.
- Admin health should show the minimal runtime health contract, without contacting
  Discord/Epic or exposing configuration/namespace state.

## 3. Real Discord eligibility (controlled manual test)

- Sign into the BPD account and confirm its expected Discord account is linked.
  Verify canonical identity server-side; do not paste identifiers into browser output.
- Confirm the bot is in the intended server and the linked user is still a member.
- Click Check Again once. Observe only status, eligible, complete/count flags,
  mutual-guild count, checkedAt and sanitized code. Expected: available/eligible.
- A fresh ordinary read should reuse saved state without another provider check.
- A repeated successful Check Again within 60 seconds should use the cooldown.
- Verify opted-in notification UI in Registration/MyProfile; clicking Add Discord
  Bot or returning from Discord alone must not grant eligibility.
- Use staging/mocks for provider outage/429 tests; do not deliberately break
  production credentials. Previous eligibility must not be overwritten by failure.

## 4. Linked Roles fallback (only after Portal configuration approval)

- Verification URL:
  `https://bpd-gaming-network.com/api/auth/discord/linked-roles/verify`
- This is the Linked Roles verification entry point, not a replacement OAuth
  callback URL and not a role-assignment/metadata publication implementation.
- Signed-out access must not start verification. Signed-in GET shows confirmation.
- Same-origin confirmation -> existing Discord PKCE reauthorization -> canonical
  identity match -> atomic nonce consumption -> SAME shared-guild check.
- A wrong Discord account, stale/expired transaction or replay must fail without
  running a membership check or granting eligibility.
- Verify shared-member success and controlled non-member ineligibility. OAuth
  success alone must never grant eligibility. Provider failure preserves prior state.
- Multiple concurrent completions must have one accepted transaction only.
- Confirm expired transaction storage is removed by its alarm.

## 5. Read-only Supabase permission verification

- Confirm intended service-role access to `verify_account_provider_identity`,
  `sync_discord_bot_guilds`, `sync_account_discord_guilds` and
  `get_rl_discord_notification_state`; review existing grants/RLS without changing them.
- Confirm current profile V2 read/save and latest-MMR RPC contracts/permissions.
- Account resolution must remain server-derived. Never submit arbitrary IDs from
  the browser or expose service-role keys to browser requests.

## 6. Diagnostic Worker retirement

- Verify no live production caller depends on `bpd-google-mtls-diagnostic` before
  deleting the deployed resource. Repository evidence shows no production caller.
- After separate approval, remove its deployed public endpoint/routes and retire
  the diagnostic-only `DIAGNOSTIC_BEARER_TOKEN` and certificate-chain secret.
- Do not remove shared mTLS certificates, WIF resources, service-account access,
  production OCR transport secrets or the separate production OCR Worker.
- The local config already disables workers.dev/preview URLs; that has not changed
  the deployed resource. The admin-only Pages probe is separate and must not be
  confused with this Worker; retain/remove it only as an explicit separate decision.

## 7. Acceptance record

Record only pass/fail, intended versions, timestamps and sanitized error codes.
Mark each live check complete individually. Local tests/dry-runs are not proof
that deployed bindings, grants or real provider behavior match this checklist.
Match History remains blocked until independent canonical PsyNet identity proof
is established and a controlled live probe is separately authorized.
