# Global Rocket League Leaderboards

## Current implementation

`/RocketLeague/Leaderboards` reads only the cached DomainData API. It provides
Ranked Duel (playlist 10), Ranked Doubles (11), and Ranked Standard (13),
250-row pages by default, name search, snapshot-position range, and an optional
BPD-members-only filter. A signed-in player can see their own latest cached
position above the public list, independently of public participation consent.

Rows are globally ordered by descending MMR, with platform and provider identity
as deterministic tie-breaks. The displayed position is a position derived from
the captured snapshot, not a provider-confirmed ordinal rank or competitive
tier. The provider `Value` field is kept separate and is not shown as rank.
Available depth is the actual number of rows returned; the UI does not claim
top-1,000 coverage. Cross-platform identities are not deduplicated because the
provider data does not prove a safe merge.

The Worker refreshes all three playlists from the existing protected MMR Worker
once per UTC day at noon, alongside the daily Taskboard summary. This matches
the verified Supabase contract of one snapshot per playlist per UTC day. That is
three fixed PsyNet leaderboard reads per daily run, without page-view calls or
retries. Each playlist is isolated: a failed refresh is recorded, and the
previous completed snapshot remains readable. Supabase retains snapshots for
90 days and considers them stale after 30 hours. Reads return
only safe names, platform, MMR, derived position, optional consented BPD badge,
and freshness metadata; provider IDs stay server-side.

The verified live Supabase contract provides service-role-only snapshot/
preference RPCs and private tables; browser traffic reaches them only through
DomainData. Earlier local SQL drafts are not authoritative and must not be
applied. The My Profile leaderboard preference is
separate, default-off, and only labels a BPD member when current Find Players
visibility, completed/consented registration, and active account/profile state
all permit it. It does not control the player's private position card.

The verified RPC JSON uses camelCase. A leaderboard position may be JSON null;
`tier`, `division`, `matchesPlayed`, and `wins` are optional enrichment and do
not gate rendering. `availableDepth` is the provider snapshot depth, while
`totalEntries` reflects current filtering/search. Preference RPCs return
`available` and `globalLeaderboardVisible`; a save without an active RL profile
is normalized to `RL_PROFILE_REQUIRED` rather than an unavailable error.

## Verification and limitations

- The live Supabase contract was confirmed installed: one daily snapshot per
  playlist, 90-day retention, 30-hour staleness, and failure-safe current
  snapshot pointers.
- The provider's maximum list depth, canonical cross-platform identity, and
  competitive tier/rank semantics remain unverified. The feature deliberately
  reports actual snapshot depth and calculated MMR order instead.
- A service/API failure does not erase the last completed snapshot; its
  metadata reports the refresh failure/staleness.
- No leaderboard history, match history, or BPD Series ranking is implied.
