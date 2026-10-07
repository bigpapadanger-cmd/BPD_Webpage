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

Readiness is in memory. One vote type is stored per round until that vote is
resolved; the next successful open clears it. Start is serialized with readiness
changes and requires every active non-spectator member to be connected and ready,
at least one player on each team, and a current host/version. Supabase remains the
durable lifecycle authority.

Required deployment configuration (not provisioned by this local change):

- Pages `CUSTOM_MATCH_RUNTIME` Service Binding -> `bpd-custom-match-runtime`
- Matching random `CUSTOM_MATCH_RUNTIME_CALLER_SECRET` on Pages and Worker
- Worker `CUSTOM_MATCH_RUNTIME_ENABLED=true` only after the secret and binding are verified
- Worker `SUPABASE_SERVICE_ROLE_KEY` secret for the existing fixed RPC caller
- Worker `SUPABASE_URL` is configured in `wrangler.jsonc`
- Deploy the DO namespace migration only during an approved deployment

The local Worker config keeps execution disabled. No Supabase schema/RPC, live
Worker, secret value, or Cloudflare namespace was modified.
