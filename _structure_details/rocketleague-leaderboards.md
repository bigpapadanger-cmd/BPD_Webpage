# Global leaderboard implementation contract

## Current state

The existing `/RocketLeague/Leaderboards` route remains an honest unavailable page. Provider-contract validation is the first implementation stage; no scheduler, public provider request, leaderboard persistence or preference is enabled yet.

The protected MMR Worker `/get-leaderboard-diagnostic` uses its existing API-key authorization, request rate limiter and shared service session for one `Skills/GetSkillLeaderboard v1` read with `{Playlist: 10, bDisableCrossplay: false}`. This is a public leaderboard read, not private Match History. It rejects query parameters and non-GET requests. Its strict allowlist reports platform counts, descending-MMR order and five public name/MMR/Value samples per platform; no raw PlayerIDs, credentials or payloads are returned. It does not interpret Value as position, merge platform rankings, or claim 1,000 entries.

Manual local caller: `node --env-file=.dev.vars scripts/debug-rl-leaderboard.mjs run`. Requires an independently approved Worker deployment before live use. No live diagnostic is run during implementation.

## Approved target

- Global cached rankings, up to 1,000 verified entries, 250 per page.
- Mode/platform/rank-range/name filters; rank-range terminology must distinguish placement from competitive tier.
- Private cached signed-in position above the public list, independent of public participation consent.
- BPD filtering only when both a separate default-off leaderboard preference and public profile discoverability allow it. Never annotate a hidden global player as a BPD member.
- Reuse the hourly control plane with bounded refreshes, changed-only writes and previous-cache preservation on provider failures. Page renders never contact PsyNet.
- Verify active ranked modes, platform/global ordering, result completeness, duplicates/ties and personal-position semantics before defining an authoritative rank projection.
- Prepare one reviewed Supabase migration against the supplied live V2 contracts; do not replace existing save overloads or overwrite notification settings. Do not apply SQL.

## Remaining gates

Real provider entry counts and position semantics are unverified. Artwork source reuse is a separate dependency, not a leaderboard dependency. The leaderboard cache/opt-in database contract has not been applied or implemented. The page must not show fabricated rankings while these gates remain unresolved.
