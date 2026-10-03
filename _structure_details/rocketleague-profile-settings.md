# Rocket League Private Profile Settings Contract

## Current DomainData contract

`GET /api/auth/rocketleague/profile` reads the authenticated account through
`api.get_rocketleague_profile(uuid)`. Its private `profile` response includes
the existing flat compatibility properties and a normalized `settings`
object. The getter returns `find_profile_enabled`; DomainData preserves explicit
`false` and leaves the setting `null` if the field is absent instead of
silently turning absence into a saved false value. A completed profile with an
unavailable saved boolean setting must choose that control before saving.

`POST /api/auth/rocketleague/profile` accepts only the existing explicit,
validated form fields. `functions/services/rl/profile_settings.js` is the
authoritative allow-list and maps settings to the current explicit
`api.save_rocketleague_profile` RPC arguments. The current 17-argument contract
is retained, including `s_find_profile_enabled`. Unknown browser properties
are not forwarded. Provider identity, MMR, and career statistics are read-only
and never enter the settings write payload.

The My Profile editor renders the saved values from the private GET and reports
unconfirmed editable fields by name. A field is individually disabled when its
availability flag or value type is not confirmed. The current RPC is a full
settings replacement, so the Update Profile action stays disabled until every
editable RPC value and both server-managed consent values can be confirmed; this
prevents an unknown value from being submitted as a default. Explicit `false`,
empty string, empty array, and nullable text values remain distinct. Server-owned
consents are never editable. Normal profile GET does not call MMR or the provider
Worker. The separate Admin force-refresh operation changes only provider-derived
MMR/profile/stats records; it does not change registration settings.

The editor supports the current persisted settings: automatic region detection,
preferred/other mode, weekly availability, online-status sharing, Find Players
visibility, email/phone contact values, notification enablement, notification
method, and reminder timing. Region/country/time zone and consent status remain
read-only. Provider identity, rank/MMR, career stats, and presence are not save
fields.

## Database contract changes

None are required for this implementation. The deployed private getter must
continue returning `find_profile_enabled` as a JSON boolean and the deployed
save RPC must keep the 17th `s_find_profile_enabled` argument. If either
contract changes or the getter omits that property, profile updates fail closed
for that missing setting rather than overwriting its value.

## Future expansion recommendation

Continue adding settings as explicit typed columns and explicit getter/save-RPC
fields for the current scale. This keeps validation, SQL constraints, API
compatibility, and review visible. Do not add an arbitrary `settings` JSON
write from the browser.

If settings become numerous or evolve frequently enough that each new setting
requires risky overload/signature churn, introduce a separately versioned
settings contract (for example, a private `api.get_rocketleague_profile_v2`
and `api.save_rocketleague_profile_settings_v2(account_id, settings_version,
settings)` with a database-side allow-list/validation and explicit RLS/grants).
Keep the existing getter/save RPC as a compatibility layer during migration;
only switch after consumers and rollback behavior are verified. This future
database change is not applied or required now.
