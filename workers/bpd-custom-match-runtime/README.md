# Custom Match Runtime

Private Pages Service Binding target for lobby presence/readiness and serialized
Start/vote-window transitions. It has no workers.dev, preview URL, or public route.
Pages authenticates the browser session and passes the server-derived account only
over the Service Binding with a separate 64+ character caller secret.

`CustomMatchSession` is addressed by match code and authoritatively rechecks the
actor through the existing `api.get_custom_match` RPC before accepting a socket or
protected transition. Public events contain only match code/version/state and
member code/display name/team/connected/ready. DO restart preserves active socket
attachments but clears readiness and broadcasts that reset.

Sockets use the Durable Object WebSocket Hibernation API: `state.acceptWebSocket`
registers each server socket before attachment persistence and fanout. Messages
and disconnects reach `webSocketMessage` and `webSocketClose`; `getWebSockets`
provides registered connections for capacity checks and restart recovery.
Ordinary `socket.accept()` must not be used with these handlers.

The runtime tests exercise the connect path with a registration-aware state mock,
then dispatch readiness/resync, restart recovery and close through registered
sockets. They also check the global connection cap and rejected handshakes. Node
emulates the Workers-only 101 response; actual runtime transport/hibernation still
requires separate local Workers or approved staging verification before activation.

Readiness is in memory. One vote type is stored per round until that vote is
resolved; the next successful open clears it. Start is serialized with readiness
changes and requires every active non-spectator member to be connected and ready,
at least one player on each team, and a current host/version. Supabase remains the
durable lifecycle authority.

Required deployment configuration (not provisioned by this local change):

- Pages `CUSTOM_MATCH_RUNTIME` Service Binding -> `bpd-custom-match-runtime`
- Matching random `CUSTOM_MATCH_RUNTIME_CALLER_SECRET` on Pages and Worker
- Matching Pages and Worker `CUSTOM_MATCH_RUNTIME_ENABLED=true` only after the secret and binding are verified
- Worker `SUPABASE_SERVICE_ROLE_KEY` secret for the existing fixed RPC caller
- Worker `SUPABASE_URL` is configured in `wrangler.jsonc`
- Deploy the DO namespace migration only during an approved deployment

The local Worker config keeps execution disabled. No Supabase schema/RPC, live
Worker, secret value, or Cloudflare namespace was modified.

## Admin health

The existing Pages Admin Health adapter calls authenticated GET `/internal/health`
through `CUSTOM_MATCH_RUNTIME` only when Pages enablement is explicitly true.
The route verifies the existing caller secret even when the Worker is disabled.
It returns no-store liveness/configuration booleans, never calls Supabase, and
never selects or creates a match Durable Object. Explicit false means Disabled;
missing or malformed enablement means Unknown. Matching Pages/Worker flags must
be reconciled during a separately approved release; the local defaults stay false.
CustomMatchSession instance health remains Unknown when only its Worker and
namespace configuration have been checked.
