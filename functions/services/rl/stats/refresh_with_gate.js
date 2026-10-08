"use strict";

// Compatibility entry point for account activity/registration callers. Normal
// MMR collection now belongs exclusively to the existing hourly due-aware
// refresh cycle, which uses Supabase mmr_due (3-hour eligibility) and persists
// snapshots and per-component checkpoints. Hourly scanning is not hourly capture.
// Old KV/day gates must not create a second automatic collection path.
export async function refreshStatsWithGate(_env, _accountId) {
    return { success: true, refreshed: false, gated: false, scheduled: true,
        reason: "HOURLY_SCHEDULER_OWNS_REFRESH" };
}
