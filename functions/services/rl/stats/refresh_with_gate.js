"use strict";

// Compatibility entry point for account activity/registration callers. Normal
// MMR collection now belongs exclusively to the existing hourly due-aware
// refresh cycle, which persists snapshots and per-component checkpoints.
// Old KV/day gates must not create a second automatic collection path.
export async function refreshStatsWithGate(_env, _accountId) {
    return { success: true, refreshed: false, gated: false, scheduled: true,
        reason: "HOURLY_SCHEDULER_OWNS_REFRESH" };
}
