# BPD Provider Runtime

Private, service-binding-only provider execution runtime. Discord operations are
stateless and do not access Supabase, resolve BPD accounts, or persist results.

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

## Integration status

DomainData invokes the runtime only through Cloudflare Service Bindings. Pages
owns authenticated on-demand reads/forced refreshes; the existing hourly refresh
Worker owns global inventory reconciliation and due-account batching. DomainData
uses server-side Supabase service-role RPCs for authoritative state. The runtime
has no public route, custom domain, queue, schedule, Durable Object, or database
credentials. Configure `PROVIDER_RUNTIME_CALLER_SECRET` for both callers and
the runtime as a secret, `DISCORD_MATCHBOT_TOKEN` only on this runtime, and
explicitly verify/set `DISCORD_LARGE_BOT_SHARDING` before deployment.
