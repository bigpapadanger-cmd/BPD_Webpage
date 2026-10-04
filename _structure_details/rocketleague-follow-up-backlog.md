# Rocket League Follow-up Backlog

This backlog records the next scoped work after the current regression-triage and
test cleanup. It does not indicate that the future capabilities are implemented.

## 1. Search Players / Public Player Profile

Do this after the current regression-test cleanup and before any Match History
implementation.

- Redesign Search Players results/cards to be useful and visually consistent with
  the Rocket League section.
- Enforce `find_profile_enabled`; hidden players must not appear in public search.
- Enforce `show_online_status`; mask presence when disabled.
- Return only public-safe fields. Never expose private IDs, contact information,
  provider subjects, or alias history.
- Add safe Rocket League career stats and club name/tag/verified status where the
  existing public contract supports them.
- Show future BPD competition/tournament areas as “Coming soon” only; do not
  fabricate statistics or participation.
- Verify direct-load and SPA behavior. Add focused tests for privacy filtering,
  public-card rendering, presence masking, and hidden-profile behavior.

## 2. Match History session audit, then implementation only if safe

Before implementing Match History, audit `RL_SESSION`, `localPlayerID`, and
provider-session ownership. Establish whether a PsyNet session is shared or
uniquely authenticated for each player. Until per-user ownership is proven and
the design is approved, keep Match History deferred and do not query history for
arbitrary player IDs.

If safe per-user access is established, follow the documented request/response
contract style used by the MMR API (`REQUESTS.md`) rather than extending the old
ad hoc details-fetch path. The candidate provider protocol is modeled on
`Matches/GetMatchHistory v1`: the request's `PlayerID` comes only from the
authenticated session's `localPlayerID`, and the response contains
`Matches []MatchEntry`. Never accept an arbitrary target player ID from the
browser. Normalize and persist only after session ownership and the storage/read
contract are verified.

## Cross-cutting provider integration convention

For future provider capabilities, document explicit request/response structures,
authentication/session requirements, capability status, and failure behavior in
the MMR API-style contract before wiring consumers. This is a direction for
future work, not a claim that the legacy path has already been replaced.
