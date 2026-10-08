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
once per UTC day at noon. Taskboard summaries now run in the separate Discord
communications Worker. This matches
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

## Collector diagnostics and release validation

Each playlist gets a server-generated debug ID and fixed playlist/game-mode
metadata using the shared `functions/services/http/diagnostics.js` helper.
`[LEADERBOARD DIAGNOSTIC]` records identify configuration, begin snapshot,
provider fetch/body/decode/schema/row validation/normalization, combined
persistence/finalization, and failure recording. Counts are bounded source-row
counts, not player records. Error codes are allowlisted; no snapshot UUID,
provider subject, credentials, environment value, payload or request body is logged.

The original failure is logged before failure recording. A second record with
the same debug ID reports the failure-recording outcome, including a separate
recording failure. Successful/already-complete playlists produce their own record.
The existing 30-second per-operation deadline covers body/decode/validation;
RPC completion validation is also inside that deadline. Cadence and limits remain
unchanged. `complete_rl_global_leaderboard_snapshot` combines persistence and
finalization: caller logs cannot prove the internal database substage.

Failure recording sends only the newly begun snapshot ID, never a prior completed
ID. Local contract-model tests verify that failed attempts leave the previous
completed pointer unchanged and duplicate completed days skip collection.
This is repository/contract evidence; this work does not independently verify
live RPC definitions or database writes. Deployed root cause remains blocked
pending release plus collector evidence, just like User Management and FAQ.

After a separately authorized release of the presence-monitor Worker, capture
Worker logs around the existing `0 12 * * *` scheduled run (12:00 UTC), filtering
for `[LEADERBOARD DIAGNOSTIC]`. Collect records for playlists 10, 11 and 13;
group by debug ID, keeping both original-failure and failure-recording records.
The configured persisted-log sampling rate is 0.25, so missing records are not
proof that a playlist did not run. Use an authorized live log stream around the
scheduled run if retained logs omit it; do not change logging settings here.

An existing operator-only alternative is POST `/admin/run-scheduled` on this
Worker's configured origin with JSON `{"job":"leaderboards"}`, authenticated
using the existing `PRESENCE_TRIGGER_KEY` bearer credential via approved operator
tooling. Do not put that credential in browser scripts, chat, logs or shared
commands. This is a production write trigger and needs separate authorization;
it is not executed by this workstream. `ALREADY_COMPLETE` may skip the current
UTC day; wait for the next scheduled day rather than resetting snapshots.
Public GET `/api/rocketleague/leaderboards?playlist=10` (also 11/13) only reads
snapshot state and cannot reproduce a collector failure. It remains HTTP 200
with sanitized failed-state data when the read RPC returns that state.
