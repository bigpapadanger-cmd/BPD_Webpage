import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { ADMIN_PERMISSIONS, getPermissionsForDiscordRoles } from "../../functions/services/admin/permissions.js";
import { buildForceRefreshResult, forceRocketLeagueRefresh } from "../../functions/services/rl/admin_force_refresh.js";
import { getRefreshEligibility } from "../../functions/services/rl/stats/refresh.js";

const ACCOUNT_ID = "f6332c75-771a-46bc-ae09-ef5d886a4c35";

test("force-refresh permission is granted to admins only", () => {
    assert.equal(ADMIN_PERMISSIONS.RL_FORCE_REFRESH, "admin.rocketleague.force-refresh");
    assert.ok(getPermissionsForDiscordRoles({ isAdmin: true }).includes(ADMIN_PERMISSIONS.RL_FORCE_REFRESH));
    assert.equal(getPermissionsForDiscordRoles({ isModerator: true }).includes(ADMIN_PERMISSIONS.RL_FORCE_REFRESH), false);
    assert.equal(getPermissionsForDiscordRoles({ isLeagueStaff: true }).includes(ADMIN_PERMISSIONS.RL_FORCE_REFRESH), false);
});

test("force route accepts only confirmed BPD account UUID and enforces the narrow permission", async () => {
    const source = await readFile(new URL("../../functions/api/admin/rocketleague/force-refresh.js", import.meta.url), "utf8");
    assert.match(source, /authorizeAdminPermission\(request, env, ADMIN_PERMISSIONS\.RL_FORCE_REFRESH\)/);
    assert.match(source, /body\.confirm !== true/);
    assert.match(source, /body\.accountId/);
    assert.match(source, /Object\.keys\(body\)\.some/);
    assert.doesNotMatch(source, /epicAccountId|playerId/);
});

test("forced action bypasses only existing freshness gates and reuses the refresh clients", async () => {
    const source = await readFile(new URL("../../functions/services/rl/admin_force_refresh.js", import.meta.url), "utf8");
    const stats = await readFile(new URL("../../functions/services/rl/stats/refresh.js", import.meta.url), "utf8");
    assert.match(source, /refreshStats\(env, accountId, \{ force: true \}\)/);
    assert.match(source, /refreshProviderDataForced\(env, accountId\)/);
    assert.doesNotMatch(source, /refreshStatsWithGate|refreshProviderDataWithGate/);
    assert.match(stats, /verifyBackgroundEpicAccount\(/);
    assert.match(stats, /getRefreshEligibility\(state, Date\.now\(\), force\)/);
    assert.match(stats, /const force = options\?\.force === true/);
    const staleButActive = { active: true, lastSeenAt: "2025-01-01T00:00:00Z", lastRefreshAt: "2026-10-02T00:00:00Z" };
    assert.equal(getRefreshEligibility(staleButActive, Date.parse("2026-10-02T01:00:00Z")).reason, "INACTIVE_ACCOUNT");
    assert.equal(getRefreshEligibility(staleButActive, Date.parse("2026-10-02T01:00:00Z"), true).allowed, true);
    assert.equal(getRefreshEligibility({ ...staleButActive, active: false }, Date.now(), true).reason, "ACCOUNT_INACTIVE");
});

test("capability outcomes remain isolated and unsupported history is explicit", () => {
    const result = buildForceRefreshResult(
        { status: "fulfilled", value: { refreshed: true, refreshedAt: "2026-10-01T12:00:00Z" } },
        { status: "fulfilled", value: { refreshed: true, persisted: {
            profile: { status: "persistence_failed" },
            stats: { status: "persisted", capturedAt: "2026-10-01T12:00:01Z" }
        } } },
        "2026-10-01T12:00:02Z"
    );
    assert.equal(result.capabilities.skills.status, "updated");
    assert.equal(result.capabilities.profile.status, "failed");
    assert.equal(result.capabilities.stats.status, "updated");
    assert.equal(result.capabilities.history.status, "unsupported");
    assert.equal(result.success, true);
});

test("same-account concurrent force refresh requests share one in-isolate operation", async () => {
    const [first, second] = await Promise.all([
        forceRocketLeagueRefresh({}, ACCOUNT_ID),
        forceRocketLeagueRefresh({}, ACCOUNT_ID)
    ]);
    assert.strictEqual(first, second);
    assert.equal(first.forced, true);
    assert.equal(first.capabilities.history.status, "unsupported");
    assert.equal(first.capabilities.skills.status, "failed");
    assert.equal(first.capabilities.profile.status, "failed");
    assert.equal(first.capabilities.stats.status, "failed");
});
