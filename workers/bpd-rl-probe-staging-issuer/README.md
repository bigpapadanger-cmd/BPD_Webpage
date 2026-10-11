# Private staging assertion issuer

This Worker is a private service-binding target, not a public API. It has no
route, custom domain, Pages Preview binding, Durable Object, or provider access.
The feature gate is false by default. It signs only the two hard-coded synthetic
slots `A` and `B`; neither slot is a UUID or can be resolved through BPD account
or Epic identity lookup. The issuer never calls Epic or PsyNet.

The private `RL_PROBE_SIGNING_JWK` and `RL_PROBE_ACCOUNT_KEY_SECRET` belong only
to this Worker. The matching public P-256 JWK, issuer and key version belong on
`bpd-provider-runtime-staging`. Pages receives only ephemeral synthetic identity
context and assertions through the private service binding, then forwards them
to the staging runtime. It returns only test pass/fail booleans to the Admin UI.

All operations require `RL_PROBE_STAGING_ISSUER_CALLER_SECRET`. Readiness and
issuance return `Cache-Control: no-store`; request bodies are exact-schema
validated; no credentials, assertions, IDs, or request bodies are logged or
persisted. Keep `RL_PROBE_STAGING_ISSUER_ENABLED=false` until a separately
approved activation. Never bind this issuer to Pages Preview or a public route.

## Configuration contract (not provisioned by this change)

Pages binds `RL_PROBE_STAGING_RUNTIME` to `bpd-provider-runtime-staging` and
`RL_PROBE_STAGING_ISSUER` to this Worker. Keep the existing `PROVIDER_RUNTIME`
binding pointed at production. Pages uses the non-secret gate
`RL_PROBE_STAGING_TEST_ENABLED` (default `false`) and three separate secrets:
`RL_PROBE_STAGING_RUNTIME_CALLER_SECRET` (must match staging Worker's
`PROVIDER_RUNTIME_CALLER_SECRET`), `RL_PROBE_STAGING_REVOCATION_SECRET` (must
match staging Worker's `RL_PROBE_REVOCATION_SECRET`), and
`RL_PROBE_STAGING_ISSUER_CALLER_SECRET` (must match this Worker's same-named
secret).

The staging runtime keeps `RL_PROBE_SECURITY_ENABLED=false` until separately
approved. When activated, its normal vars are `RL_PROBE_ISSUER` set to
`bpd-provider-runtime-staging`, `RL_PROBE_KEY_VERSION` set to `staging-v1`, and
`RL_PROBE_VERIFY_JWK` containing only the matching public P-256 key. This issuer
Worker alone receives `RL_PROBE_ACCOUNT_KEY_SECRET` and private
`RL_PROBE_SIGNING_JWK`. The Pages `RL_PROBE_STAGING_TEST_ENABLED` gate and this
Worker's `RL_PROBE_STAGING_ISSUER_ENABLED` gate stay false until all config and
rollback steps are reviewed and explicitly approved. Do not put issuer secrets
or private JWK material in Pages Preview, Wrangler vars, source, or logs.

## Review and rollback

The Admin panel appears only after existing Admin permission checks, the Pages
test gate, and private binding health checks pass. Its POST requires same-origin
and explicit confirmation. It tests only fixed slots A/B, never resolves a BPD
or Epic account, and concludes with a staging-wide monotonic revocation. It
returns pass/fail booleans only. The staging SQLite namespace and global epoch
are not reset during rollback. Before approval, keep all three feature gates
false. To remove the temporary interface, revert this feature's isolated source
patch (including its two Pages service-binding entries, route, panel, issuer
Worker, and tests); do not delete or roll back deployed Durable Object
migrations or storage. If already activated, first set the Pages test gate and
issuer gate false, then disable the staging runtime probe gate; verify the
Admin panel is hidden before removing code/bindings. Never change the production
`PROVIDER_RUNTIME` binding or production probe gate as part of rollback.
