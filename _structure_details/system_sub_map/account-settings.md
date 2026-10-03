# Account Settings and BPD Display Names

## Display-name ownership

- `identity.accounts.display_name` is the canonical BPD display name.
- Names are globally unique case-insensitively. Supabase is the final authority
  for uniqueness, allowed length/characters, reserved values, no-op behavior,
  concurrency, and the 30-day rename cooldown.
- DomainData resolves the authenticated BPD account from the server-side session;
  the browser cannot select an account ID or write the identity table directly.
- `functions/services/auth/account/display_name_validation.js` provides an
  additional private, deterministic appropriateness check before the existing
  `api.update_account_display_name` RPC. The small private policy is not bundled
  to the browser. Unicode normalization, separator/leet/repeated-character
  normalization, and narrowly bounded fuzzy comparison are used to catch clear
  evasions while limiting false positives.

## Session and mutation contracts

- `api.get_account_session_identity(uuid)` returns `display_name`,
  `display_name_changed_at`, and `display_name_change_available_at`.
- `functions/services/auth/account/get_session.js` maps only the needed safe
  values to `displayName`, `displayNameChangedAt`, and
  `displayNameChangeAvailableAt`; explicit null is retained and missing fields
  remain missing.
- The authenticated session endpoint returns those fields to the signed-in
  browser. The account mutation resolves its account ID from the session and
  returns the display name and authoritative timestamps after a successful RPC.
- Known validation/cooldown failures use stable application codes and safe
  messages; private match details and unsafe-term policy are never returned.

## Settings cooldown presentation

- `/Settings` uses the server-provided `displayNameChangeAvailableAt` as the
  source of truth. An explicit null means no active cooldown; a missing or
  malformed field locks an existing name conservatively. An account without a
  saved name can create its first name.
- `public/Global/Settings/JS/display_name_cooldown.js` formats remaining time
  and the exact unlock timestamp. Date formatting uses the browser's local
  timezone. Remaining time refreshes at most once per minute while Settings is
  open and is cleared on SPA navigation.
- This client timer is display-only. It never authorizes a change; Supabase
  enforces the cooldown even if a client clock is manipulated.

## Main files

- `functions/services/auth/account/get_session.js`
- `functions/services/auth/account/mutations.js`
- `functions/services/auth/account/display_name_validation.js`
- `functions/services/auth/account/display_name_policy.js` (private server data)
- `public/Global/Settings/HTML/settings.html`
- `public/Global/Settings/JS/settings.js`
- `public/Global/Settings/JS/display_name_cooldown.js`
- `public/Global/Settings/CSS/settings-page.css`
- `tests/auth/display_name_validation.test.mjs`
- `tests/route_health/display_name_cooldown.test.mjs`
