# BPD Provider Runtime

Private, service-binding-only provider execution runtime. Discord eligibility
validation is stateless and does not access Supabase, resolve BPD accounts, or
persist eligibility results. Its separate Linked Roles nonce authority stores
only short-lived transaction security state, not provider/account/session data.

The local Wrangler configuration enables Smart Placement (`placement.mode: "smart"`).
This does not change its private Service Binding boundary or caller authentication.

## Manual Admin bot connection check

`GET /internal/discord/bot-health` requires the existing internal caller secret,
rejects query parameters, and uses the existing MatchBot secret for one read-only
Discord `/users/@me` request. It validates a bot identity and returns only
`success`, `botAuthenticated`, and `checkedAt`. Errors are normalized; IDs,
credentials and provider payloads are not returned. No public route is added.

The existing Admin System Status page exposes a manual **Check connection**
action. Page loads read the last saved check, without contacting Discord.
Pages enforces a 60-second advisory cooldown and honors provider Retry-After.
The separate role-authorization bot check stays in Pages and validates its
existing bot credential plus access to its configured authorization guild.
Neither check sends messages, changes roles, verifies Gateway presence, or
changes shared-server eligibility. Routine runtime health remains provider-free.

## Transactional Discord Linked Roles state

`DISCORD_LINKED_ROLE_NONCE` binds `DiscordLinkedRoleNonceAuthority` in a dedicated
SQLite namespace. It does not use `RL_USER_SESSION`, `RL_PROBE_SECURITY`, KV,
Supabase, or eligibility storage. Each random nonce addresses one object.

Internal authenticated operations:

- `POST /internal/discord/linked-roles/nonce/create`: nonce, server-derived account
  and canonical Discord SHA-256 bindings, fixed action, expiry (maximum five minutes).
- `POST /internal/discord/linked-roles/nonce/begin`: matching bindings/action;
  atomically created -> begun, before the OAuth redirect.
- `POST /internal/discord/linked-roles/nonce/consume`: matching bindings/action;
  atomically begun -> consumed, before any shared-guild check or eligibility write.

Every transition is committed inside a storage transaction. Concurrent duplicates
are rejected; failure after consumption requires starting a new verification.
Consumed tombstones remain until expiry. An alarm clears all transaction storage;
late/replayed calls cannot become valid after cleanup. No raw account/Discord IDs,
OAuth tokens, guilds, or long-lived sessions are stored. There is no public route,
read API, scheduler, or new secret. Existing internal caller authentication applies.

The implementation follows the [Cloudflare SQLite storage transaction API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#transaction).

## Disabled RL probe security foundation

`RL_USER_SESSION` binds the separate SQLite Durable Object class
`UserRocketLeagueSession`. It is not the MMR Worker's shared `RL_SESSION` and
never stores Discord state. Local `RL_PROBE_SECURITY_ENABLED="false"` keeps its
internal bootstrap/invalidate/consume operations disabled. The Admin Pages
compatibility-probe route is also disabled by construction: no variable can
enable provider execution in this version.

Prepared operations (internal caller authorization required):

- `POST /internal/rl-probe/bootstrap`: `{ accountKey, epicIdentityHash }`.
  Only a server-authorized canonical identity may bootstrap an object. A changed
  identity clears temporary state and rejects; another authoritative bootstrap
  is required. The returned generation/cutoff is internal, never browser data.
- `POST /internal/rl-probe/invalidate`: `{ accountKey, reason }`.
  Advances generation/cutoff before logout, Epic unlink/link or profile deletion.
  Once enabled on Pages, failure blocks those operations. Normal production
  behavior is unchanged while the feature is absent/off.
- `POST /internal/rl-probe/consume`: `{ accountKey, assertion, credential }`.
  Verifies ES256, issuer/audience/action, credential digest, identity/account
  binding, generation, cutoff, 60-second lifetime and 15-second skew. A 256-bit
  nonce is committed atomically before any future provider work. Duplicate or
  concurrent attempts fail; only one handoff occupies a context. The response
  explicitly reports provider execution disabled. No credential is persisted.

Idle expiry is 10 minutes; hard expiry is 30 minutes. Alarms remove temporary
state/expired nonces but retain generation/cutoff tombstones, so expiry/relink
does not resurrect old assertions. Account keys are HMAC-derived by DomainData,
not raw UUIDs. Do not rotate the account-key derivation secret as ordinary
signing-key rotation: doing so changes object addressing and requires a separate
revocation/migration plan.

Future configuration, **not provisioned or enabled by this pass**


- Pages secret `RL_PROBE_ACCOUNT_KEY_SECRET`: stable opaque-key derivation,
  64–256 characters, no whitespace.
- Pages secret `RL_PROBE_SIGNING_JWK`: private P-256 JWK; never in this Worker.
- Runtime normal var `RL_PROBE_VERIFY_JWK`: public P-256 JWK only; private `d`
  material is rejected.
- Matching normal vars `RL_PROBE_ISSUER` and `RL_PROBE_KEY_VERSION`.
- Pages/runtime secret `RL_PROBE_REVOCATION_SECRET`: separate 64–256-character
  emergency-management credential. Routine Discord caller credentials cannot bump epochs.
- Matching `RL_PROBE_SECURITY_ENABLED` on Pages and runtime, plus the existing
  Service Binding/caller secret. Enable only after all lifecycle callers are
  configured; enabling the runtime alone is not sufficient.

The `RL_PROBE_SECURITY` binding / `RlProbeSecurityAuthority` singleton stores the
authoritative global epoch. `RL_PROBE_SECURITY_EPOCH` is no longer used. Reads
and increments use storage transactions; never reset/delete/restore an older
authority tombstone or change its singleton key. Every assertion issuance and
user-object operation reads the authority without an epoch cache. An authority
outage fails closed. Active opaque keys are registered for 30 minutes (maximum
1,000); a bump commits its higher epoch FIRST, then clears registered per-user
objects sequentially. Old assertions are invalid even if physical cleanup
fails; the Admin gets an unavailable result and must retry cleanup, not roll back.
No live provider sessions exist in this version. Future provider work must retain
these checks and cancellation semantics rather than treating one check as a
permanent authorization lease.

Emergency procedure: keep execution disabled, revoke all probe state through the
Admin-only confirmation `REVOKE_ALL_RL_PROBES`, then replace compromised signing/
verification keys and key version before enabling any later approved execution.
Do not rotate the opaque account-key secret or restore an old epoch as rollback.
If the internal revocation credential is compromised, rotate it separately.
Epoch read uses routine Service Binding caller auth; bump uses the separate
revocation credential. Epochs/registry are never returned to browser responses.

Remaining probe blockers: credential compatibility and independent resulting
PsyNet identity proof. Fresh Admin reauthorization orchestration is now wired.
The upstream client constructs `localPlayerID` from the requested account;
that is not a provider-derived ownership attestation. AuthPlayer acceptance or
matching display names alone must not unlock history. No history is requested,
returned or persisted by this foundation. No Supabase/schema or MMR change was
made, and no live provider call was performed.

### Manual fresh-reauthorization lifecycle

The existing Admin endpoint accepts only one `confirmation` property:
`START_FRESH_EPIC_REAUTH`, `EXECUTE_PREPARED_PROBE`, `REVOKE_ALL_RL_PROBES`, or
the prior disabled `CHECK_RL_COMPATIBILITY`. All require current Admin permission
and same-origin POST. There is no new public Worker route or scheduler.

Admin start -> server resolves canonical account/Epic identity -> a random
transaction and OAuth state are bound to the current BPD session, identity,
per-user generation and global epoch -> new Epic OAuth reauthorization ->
callback validates existing OAuth state/account and rechecks Admin authority ->
atomically claims the transaction BEFORE exchanging the authorization code ->
fresh provider profile must match the canonical linked Epic identity -> normal
reauthorization completes -> signed handoff becomes available in the isolated
object -> callback returns to Admin without executing -> separate explicit
execute consumes the jti and reports `RL_PROBE_IDENTITY_PROOF_BLOCKED`.

Pending OAuth transactions expire after five minutes. Credentials/assertions are
held in object memory ONLY for at most 60 seconds, never DO storage, KV, Supabase
or browser output. Expiry, eviction, invalidation, identity mismatch or explicit
execution clears custody; eviction requires fresh reauthorization. The browser
receives only a random HttpOnly transaction cookie, the existing OAuth redirect,
and allowlisted diagnostics, not a credential, assertion, identity or object key.
No refresh token is retained. Ordinary login/reauthorization without a probe
transaction does not stage anything. No AuthPlayer/history executor exists.

Identity audit: upstream `auth.go` constructs `localPlayerID` from its input;
`AuthPlayerResponse` supplies opaque session credentials and a verified name,
not an independently verified Epic account. `psynetrpc.go` stores that constructed
ID. `players.go` profile lookup accepts caller-selected IDs; matching its result
does not establish session ownership. `matches.go` uses the same constructed ID.
The local MMR protocol follows this chain. Missing/mismatched/echoed/constructed
identity and matching names/lookup results cannot satisfy the gate. No positive
identity-proof fixture is invented without an audited provider-owned contract.
Sources: [auth.go](https://github.com/dank/rlapi/blob/master/auth.go),
[psynetrpc.go](https://github.com/dank/rlapi/blob/master/psynetrpc.go),
[players.go](https://github.com/dank/rlapi/blob/master/players.go),
[matches.go](https://github.com/dank/rlapi/blob/master/matches.go).

## Discord internal contract

- `GET /internal/health` returns only `{ success, service, status, timestamp }`;
  it performs no Discord/provider call and requires the same internal caller
  authorization. The Admin System Status endpoint checks it through the Service
  Binding; it is not a public endpoint.
- `POST /internal/discord/guild-inventory` with `{}` returns a complete validated
  `{ complete, guilds: [{ id, name }], count, capturedAt }` inventory for trusted
  internal DomainData callers only. It paginates through every page and rejects
  incomplete/malformed results.
- `POST /internal/discord/check-membership` with
  `{ discordUserId, guildIds }` checks all supplied guilds and returns normalized
  eligibility plus confirmed `sharedGuildIds` for the authenticated DomainData
  caller's server-side Supabase reconciliation. These identifiers must never be
  copied into browser responses. Provider failures return `unavailable`; the
  caller must preserve its last persisted eligibility.
- All routes require `Authorization: Bearer <PROVIDER_RUNTIME_CALLER_SECRET>`.
  The configured caller secret must be 64–256 characters with no whitespace;
  values outside that range fail closed. No particular encoding is required.
  The shared caller secret must be provisioned independently in this Worker and
  each approved Service-Binding caller; `DISCORD_MATCHBOT_TOKEN` is a secret on
  this Worker. Never add values to Wrangler config, source, or logs.
- `DISCORD_LARGE_BOT_SHARDING` is a normal, non-secret variable. Set it explicitly
  to the string `true` or `false` only after
  verifying the application's current Discord sharding configuration. Missing
  or invalid configuration fails closed. Large-bot mode reads the recommended
  shard range from `session_start_limit.max_concurrency` in Discord's
  authenticated `/gateway/bot` response, as required by the guild-list endpoint,
  and enumerates each value from zero through that maximum minus one.
- 429 responses are not retried in the Worker. The safe response includes only
  a bounded `retryAfterSeconds` so DomainData can back off. Guild membership
  uses bounded concurrency of three.
- Each Discord REST operation has a 10-second timeout that remains active
  through response-body parsing. DomainData bounds a complete Service-Binding
  operation to 30 seconds; its lightweight Admin health check keeps the existing
  2-second health-check budget. Timeouts remain unavailable and never imply
  non-membership.

## Temporary eligibility diagnostics

Set the non-secret variable `DISCORD_ELIGIBILITY_DIAGNOSTICS` to the string
`true` on Pages/the scheduled caller and this Worker only while investigating.
It defaults off; remove it or set `false` afterward. Existing log sampling may
omit a given invocation. Diagnostics identify authorization, canonical identity,
inventory, membership, Supabase sync and state-read boundaries using booleans,
counts, safe codes and timestamps only. Discord failure HTTP status is also
recorded without its raw message or request path. No identifiers or credentials
are logged or added to browser responses.

Check Again refreshes both bot inventory and account membership, subject to
existing rate-limit backoff. A successful membership sync contradicted by the
private state getter returns `DISCORD_STATE_SYNC_MISMATCH` as unavailable and
preserves the previous visible state rather than reporting false ineligibility.
The internal membership result includes `membershipChecksAttempted`; callers
must not copy internal results wholesale to browser responses.

Local tests cannot confirm a deployed binding/secret match, the linked Discord
account, or the expected real server. Missing `DISCORD_LARGE_BOT_SHARDING` fails
closed with `DISCORD_SHARDING_CONFIGURATION_REQUIRED`; secret-list output does
not establish this ordinary variable or matching caller secret values.

Wrangler explicitly sets normal REST inventory mode (`DISCORD_LARGE_BOT_SHARDING`
is `false`), based on the operator-confirmed current single-server installation.
This is independent of Gateway intents. The large-bot implementation remains
available; set `true` if Discord large-bot sharding is later configured, so every
required REST shard is enumerated before reconciliation.

## Deployment integration

DomainData invokes the runtime only through Cloudflare Service Bindings. Pages
owns authenticated on-demand reads/forced refreshes; the existing hourly refresh
Worker owns global inventory reconciliation and due-account batching. DomainData
uses server-side Supabase service-role RPCs for authoritative state. The runtime
has no public route, custom domain, queue, schedule, Durable Object, or database
credentials. Configure `PROVIDER_RUNTIME_CALLER_SECRET` for both callers and
the runtime as a secret, `DISCORD_MATCHBOT_TOKEN` only on this runtime, and
explicitly verify/set `DISCORD_LARGE_BOT_SHARDING` before deployment.
