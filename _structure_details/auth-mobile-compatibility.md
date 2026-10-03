# Authentication and Mobile Compatibility Review

Snapshot: 2026-10-02

## Scope and evidence

This review traces repository code and tests. It does not claim a live provider
configuration audit or testing on physical devices. The reported iPhone issue is
Discord sign-in at `https://bpd-gaming-network.com/Login`, which returns the
generic message “Authentication is temporarily unavailable. Please try again.
Your provider connections have been preserved.” The message corresponds to a
server-side callback failure, not a client popup failure. Safe reference IDs are
now carried through that error path when available; provider/server logs are
needed to identify the exact failing stage.

## Provider flow map

| Provider | Entry and browser behavior | Callback and identity/session path |
| --- | --- | --- |
| Discord | Login UI posts to the Pages provider-start route. The server validates the request/Turnstile, creates PKCE state, and the browser navigates the same tab to the authorization URL. Linking/reauthorization uses the authenticated account-link path. | Supabase returns to `/api/auth/_oauth/callback`; the BPD callback validates cookie-backed PKCE state, exchanges the code server-side, validates the user, resolves/links the account, finalizes the BPD session, and redirects to a safe local destination. |
| Google | Same-window redirect through the provider-start route; link/reauthorization is a separate authenticated account operation. | Shared Supabase callback and BPD session finalization, with the same cookie-backed state and PKCE protections as Discord. |
| Epic | Same-window redirect to Epic, with server-generated state and host-only state/mode/account cookies. | Fixed `EPIC_REDIRECT_URI` callback validates state, exchanges server-side, resolves identity/account, and resumes login/link/reauthorization. Reauthorization does not recreate the permanent Epic link. |
| Steam | No supported login flow found. The visible entry is unavailable/future-facing; stale empty route files do not establish support. | None. |

Authentication, account linking, reauthorization, and unlinking are distinct
server-side flows. Discord OAuth success is independent of MatchBot mutual-guild
eligibility; that eligibility remains intentionally unavailable pending a
persistent Gateway owner. No `DISCORD_GUILD_ID(S)` fallback is used.

## Mobile, popup, session, and redirect findings

- Provider auth uses same-window navigation; no auth flow relies on
  `window.open`, `window.opener`, popup polling, or `postMessage`. The only
  `window.open` found is for the separate MatchBot install action.
- OAuth state and PKCE verifiers are held in Secure, HttpOnly, host-only cookies,
  not browser storage. The BPD session cookie is also Secure, HttpOnly,
  host-only, `Path=/`, and `SameSite=Lax`. Lax is appropriate for returning via
  the top-level provider callback GET; relaxing it is not indicated.
- The Discord/Google callback URI is constructed from the initiating request's
  origin. Epic uses its configured fixed `EPIC_REDIRECT_URI`. This keeps cookie
  host and callback host aligned only if the public site canonicalizes hosts
  before the OAuth start. The Pages repository does not declare the apex/www
  canonical redirect; Cloudflare configuration owns it. User-provided evidence
  confirms the failing flow starts on the apex HTTPS URL, but the actual www
  redirect target remains to be verified in Cloudflare.
- `returnTo` is restricted to safe local paths; callback errors do not expose
  upstream messages, codes, tokens, or stack traces. Generic callback failures
  retain a safe UUID reference ID for correlation.
- Embedded browsers still use the same full-page flow. No popup or browser
  storage dependency was found, so there is no evidence for an in-app-browser
  workaround. If the embedded browser loses the host-only cookie, the safe
  outcome is a state/session error rather than weakening cookie protections.

### Discord iPhone failure status

The current evidence narrows the failure to the server-side OAuth callback or
post-callback session resolution. It does not identify whether the failure is
PKCE code exchange, account resolution, BPD session finalization, or session
lookup. A newly visible reference ID can be matched to safe server logs. The
next useful reproduction should record that ID, iOS browser (Safari or Chrome),
whether the flow began in an embedded browser, and whether the canonical URL
changed before authorization. Do not ask the user to share authorization URLs,
codes, cookies, or tokens.

## Cookie and host configuration checks

Repository code sets Secure, HttpOnly, SameSite=Lax, and Path `/`, with no
Domain attribute. This produces host-only cookies. Callback routing preserves
the provider connection and returns a generic user-facing failure. The following
must be verified in provider/Cloudflare control panels before production
troubleshooting is complete:

- Cloudflare redirects `http` to `https` and `www.bpd-gaming-network.com` to
  the chosen canonical host before login begins. Current observed flow starts
  on `https://bpd-gaming-network.com`.
- Supabase Auth allows the exact redirect URI
  `https://bpd-gaming-network.com/api/auth/_oauth/callback` and its site URL is
  consistent with the canonical host.
- Epic's registered redirect URI exactly matches the server-side
  `EPIC_REDIRECT_URI` value and its callback route.
- Provider credentials/secrets remain in their server-side secret stores and
  are not added to source or logs.

No Cloudflare or provider-console changes were made.

## Find Profile privacy setting

The live private profile response used nested snake_case
`settings.find_profile_enabled`, while the client normalizer handled nested
camelCase and legacy flat snake_case only. This caused a stored false/true value
to be reported as unavailable and disabled the My Profile form. The normalizer
now maps nested snake_case and marks the field available when the authoritative
boolean is present. Registration and My Profile keep profile discovery
(`find_profile_enabled`) separate from online presence (`show_online_status`).
No browser default, direct Supabase read, or schema change was introduced.

## Sidebar behavior

When the Rocket League sidebar is collapsed, selecting a group now temporarily
expands the sidebar and displays its submenu in normal document flow. Outside
click, Escape, or selecting a submenu destination closes it and restores the
saved collapsed preference. Temporary expansion does not persist a new user
preference. The same submenu behavior works for mouse and touch because it uses
the button click event, and ARIA expanded state stays synchronized.

## Manual compatibility checklist

Do not mark an environment passed until actually tested. For each provider
(Discord, Google, Epic) and applicable action (sign-in, link, reauthorization),
record initiation, provider page, callback return, session retained, identity
state, final route, and safe error/reference ID if failed.

| Environment | Checks |
| --- | --- |
| Desktop Chrome, Edge, Firefox, Safari where available | Sign-in, link, reauthorization, callback, session, logout, final route. |
| iPhone/iPad Safari | Discord first (capture reference ID), then Google/Epic; also test link, reauthorization, logout, and return routing. |
| iPhone Chrome | Repeat provider and callback checks; note that iOS Chrome still uses WebKit. |
| Android Chrome | Repeat provider and callback checks. |
| Discord/Gmail/Google in-app browser | Try only if normally used; record whether cookies survive, then retry in system browser without changing security settings. |

For the collapsed sidebar, test touch to open each group, scroll long submenu,
select a destination, tap outside, press Escape with an external keyboard, and
resize/rotate while open. Verify the preference restores after close/reload.

