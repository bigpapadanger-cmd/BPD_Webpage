# Security remediation follow-up

Local changes only. No deployment, push, live Supabase change, provider probe,
Developer Portal configuration, or Cloudflare resource deletion.

## Implemented

- `/api/ocr/localTracking`: no repository consumer; POST 410, other methods 405.
  No upstream forwarding. External traffic was not inspected.
- OCR progress GET reuses the canonical job reader's account ownership checks,
  including legacy Epic-owner compatibility. POST retains its internal progress
  token. A job ID is not read authorization.
- Discord eligibility RPCs have a 10-second timeout through response decoding.
  Successful forced checks have a 60-second account cooldown. The in-isolate
  guard and KV checkpoint are best-effort across isolates, not a global limiter.
- Taskboard upstream database details, hints and database codes no longer cross
  the RPC error boundary. Fixed business messages/statuses are preserved.
- Diagnostic Google Worker `workers_dev` disabled locally. Deployed resources
  and diagnostic-only secrets still require operator retirement.

## Linked Roles fallback

URL: `https://bpd-gaming-network.com/api/auth/discord/linked-roles/verify`

GET authenticates the BPD account, resolves its canonical linked Discord identity
and displays a confirmation form. POST validates same origin, bounded strict form
input and an expiring browser/account/identity-bound nonce. It starts the existing
Discord Supabase PKCE reauthorization flow. Only after the callback verifies the
canonical identity does it consume fallback state and force the same shared-guild
eligibility service. OAuth success alone grants nothing. Provider failures do not
write inferred ineligibility. The runtime remains Service-Binding-only.

The provider authorization code is single-use. The approved dedicated
`DISCORD_LINKED_ROLE_NONCE` / `DiscordLinkedRoleNonceAuthority` SQLite authority
now performs atomic create/begin/consume transitions, bound to opaque account and
Discord identity hashes, fixed action and immutable five-minute expiry. Concurrent
duplicates have exactly one winner. No KV read/delete authorizes the fallback.
An alarm deletes transaction state after expiry. The Developer Portal is unchanged.

## Timeout and response hardening

- The identified provider identity, profile read/save/initialization, OAuth
  exchange/user/identity RPC, latest-MMR and Taskboard calls now run inside a
  10-second deadline through body reading, parsing and validation. Streamed bodies
  are capped at 256 KiB; nonce authority responses at 1 KiB and internal runtime
  inventory/membership responses at 2 MiB. Overflow/timeout
  cancels or aborts without decoding/logging a full provider body. Known business
  errors remain allowlisted; unavailable dependencies are not authorization denial.

## Remaining concerns

- Successful Check Again cooldown remains best-effort across isolates; the nonce
  authority deliberately does not become an eligibility cache or global limiter.
- Live shared-server eligibility, Service Binding/secrets, Supabase privileges/RLS
  and diagnostic retirement require operator checks.
- PsyNet identity proof remains blocked; the RL compatibility probe is disabled.
  Shared MMR sessions must not be used for private Match History.

Source review and mocked/local checks are not live deployment verification.

## Current local verification

- Source coverage: 59/59 API handler files (63 API files including three empty
  stubs and one helper); 102 service files; five Worker entrypoints and three
  Durable Object classes. Generated artifacts excluded.
- Full repository test command: 426 tests passed; full presence/control-plane
  suite: 105 passed (overlaps the repository suite, not an additional unique count).
- Pages compilation, all five Worker dry-runs and `git diff --check` passed.
- Identified local hardening is complete; live deployment readiness still requires
  the operator checklist, not a claim based on source tests.
