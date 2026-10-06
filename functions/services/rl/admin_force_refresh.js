"use strict";

import { refreshStats } from "./stats/refresh.js";
import { refreshProviderDataForced } from "./provider_data/refresh.js";
import { assertAccountCanPerform } from "../auth/account/access.js";

const activeRefreshes = new Map();

function failureCode(error, fallback) {
    return /^[A-Z0-9_]{3,80}$/.test(String(error?.code || "")) ? error.code : fallback;
}

function normalizeCapability(result, source) {
    const status = result?.status;
    if (status === "persisted") return { status: "updated", capturedAt: result.capturedAt || result.providerUpdatedAt || null };
    if (["incomplete", "partial_not_persisted", "invalid_not_persisted"].includes(status)) return { status: "incomplete", reason: status };
    if (["persistence_failed", "error"].includes(status)) return { status: "failed", reason: result.code || status };
    if (status === "unsupported") return { status: "unsupported" };
    return { status: "skipped", reason: result?.reason || status || source || "NOT_REFRESHED" };
}

export function buildForceRefreshResult(skillsResult, providerResult, completedAt = new Date().toISOString()) {
    const skills = skillsResult.status === "fulfilled"
        ? (skillsResult.value?.refreshed === true
            ? { status: "updated", capturedAt: skillsResult.value.refreshedAt || null }
            : { status: "skipped", reason: skillsResult.value?.reason || "NOT_REFRESHED" })
        : { status: "failed", reason: failureCode(skillsResult.reason, "SKILLS_REFRESH_FAILED") };

    const provider = providerResult.status === "fulfilled" ? providerResult.value : null;
    const persisted = provider?.persisted || {};
    const profile = providerResult.status === "rejected"
        ? { status: "failed", reason: failureCode(providerResult.reason, "PROVIDER_REFRESH_FAILED") }
        : normalizeCapability(persisted.profile, provider?.reason);
    const stats = providerResult.status === "rejected"
        ? { status: "failed", reason: failureCode(providerResult.reason, "PROVIDER_REFRESH_FAILED") }
        : normalizeCapability(persisted.stats, provider?.reason);
    const statuses = [skills.status, profile.status, stats.status];

    return {
        success: statuses.some(status => status === "updated"),
        forced: true,
        completedAt,
        capabilities: { skills, profile, stats, history: { status: "unsupported" } }
    };
}

async function runForceRefresh(env, accountId) {
    const results = await Promise.allSettled([
        refreshStats(env, accountId, { force: true }),
        refreshProviderDataForced(env, accountId)
    ]);
    return buildForceRefreshResult(results[0], results[1]);
}

export async function forceRocketLeagueRefresh(env, accountId) {
    const normalizedAccountId = String(accountId || "").trim();
    if (!normalizedAccountId) {
        const error = new Error("Account ID is required.");
        error.code = "ACCOUNT_ID_REQUIRED";
        error.status = 400;
        throw error;
    }
    await assertAccountCanPerform(env, normalizedAccountId, "refresh_rl_stats");
    if (activeRefreshes.has(normalizedAccountId)) return activeRefreshes.get(normalizedAccountId);
    const task = runForceRefresh(env, normalizedAccountId).finally(() => activeRefreshes.delete(normalizedAccountId));
    activeRefreshes.set(normalizedAccountId, task);
    return task;
}
