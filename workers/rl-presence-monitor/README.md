# Rocket League Presence Monitor

Taskboard summaries moved to the private `bpd-discord-communications` Worker.
The daily noon UTC trigger now refreshes leaderboards only; manual
`job=taskboard` is a non-delivering compatibility response. Friday reports run
at 6 PM America/New_York in the communication Worker, with transactional receipts.

This Worker owns the scheduled refresh of Rocket League public-presence state.
It is not a persistent PsyNet connection and does not query PsyNet directly.

## Flow and boundaries

`wrangler.jsonc` runs the presence cycle every 15 minutes. The cycle reads
`api.get_rl_presence_candidates()`, which delegates to the live identity RPC.
That RPC selects only active accounts and Rocket League players with
`status='complete'` and a non-null registration-completion timestamp, plus an
active Epic identity matching the Rocket League player and
`show_online_status=true`. The cycle independently rechecks the
canonical account, Epic identity, and fresh Epic authorization before a lookup.

For each eligible player the Worker calls the protected MMR API
`GET /get-player-data?playerId=Epic%7C...%7C0&capabilities=presence`. The MMR
Worker owns the provider session and normalizes the response. This Worker saves
only a successful, well-formed `online` or `offline` state and the provider's
`checked_at` timestamp through `api.save_rl_player_presence(...)`. The live save
RPC rechecks active account/player, completed registration, and presence-sharing
eligibility.

Timeout, auth/session failure, rate limit, malformed payload, and `unknown` are
not Offline. They do not call the save RPC, so the existing row remains
unchanged and becomes stale naturally. The RPC does not identify provider
failure; this Worker must enforce the success-only rule before calling it.

The candidate list is refreshed on every scheduled cycle even if all eligible
players were previously offline. This keeps opt-in presence current and lets
the monitor discover when a player returns. Normal profile/page GETs do not
wake the Worker or call the provider. Admin Run Now is a separate protected
action and does not change the normal schedule.

The same Worker also runs one hourly due-aware refresh cycle for stored MMR,
provider display name, club metadata, and career stats. It asks
`api.get_rl_refresh_candidates(p_after_player_id, p_limit)` for at most 20 rows,
follows the returned `player_id` cursor in `SERVICE_STATUS` KV, rechecks each
candidate's canonical account/Epic link and fresh authorization, and requests
only components whose `*_due` flags are true. Successful values are persisted
through their existing `api.save_*` RPCs and checkpointed independently through
`api.record_rl_player_refresh_result`. A capability failure does not discard
another capability's result. Career stats require all six totals; incomplete
data is never written. Match History remains unsupported for arbitrary
scheduled player IDs, and Discord eligibility refresh remains unavailable
until an authoritative persistent Gateway runtime exists.

The same hourly schedule starts an independent global Shop refresh. It makes one
protected `/get-shop-data` call (two PsyNet read RPCs), computes a SHA-256 hash
of the normalized snapshot, and calls `api.save_rl_shop_snapshot(...)`. The
`saved` result becomes `p_changed` in `api.record_rl_global_refresh_result` for
the `shop` key. Shop failures do not block per-player refreshes. The public Shop
page remains read-only/static until its confirmed cached Supabase reader contract
is wired; it does not call the provider or wake this Worker.

The previous Saturday MMR refresh schedule is removed; its legacy implementation
file is retained but is no longer dispatched. This avoids keeping a competing
MMR refresh path active.

## Public freshness and privacy

Public discovery independently checks `show_online_status`. When disabled it
returns `presence_shared=false`, `presence_state=null`, and
`presence_checked_at=null`; the UI label is exactly “Presence not shared.”
When enabled, a state is considered fresh for 30 minutes (two normal schedule
intervals). Stale, malformed, future-dated, or unknown states render neutrally
as unavailable/unknown, never confidently Online or Offline.

## Frequency and scaling

The unchanged 15-minute schedule allows 96 lookup opportunities per opted-in
player per day: 25 players = 2,400 requests/day, 100 = 9,600, and 500 = 48,000.
The Worker processes up to five at once with a 15-second pause between batches.
At 500 players, pause time alone is approximately 24m45s, so the current cycle
would exceed its schedule interval. Measure real eligible counts, duration,
and shared MMR API rate-limit headroom before scaling; at that size consider at
least a 30-minute cadence or bounded sharding. Do not shorten the schedule to
10 or 5 minutes without measured capacity.

The hourly data refresh pages at most 20 candidate rows per invocation. Provider
requests are made only for due components; career stats consume six PsyNet
requests when due. The database due flags, not the hourly trigger itself, govern
each player's cadence. Same-isolate overlapping refresh jobs are rejected by
the dispatch guard. A distributed lock is not configured, so multi-isolate
overlap remains a known operational limitation to monitor before increasing the
batch size or schedule frequency.

## Verification ownership

Worker cycle contract tests live under `tests/`. DomainData's public response
sanitization and page behavior tests live under `../../tests/rocketleague/`.
No migration, deployment, or Supabase change is performed by this Worker
documentation.
