import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { onRequestGet } from "../../functions/api/ocr/jobs/progress.js";
import { onRequestGet as getJob } from "../../functions/api/ocr/jobs/get_job.js";

const oldFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = oldFetch; });
const jobId = "ABCDEFGHIJKLMNOP";
const secret = "test-owner-secret";

function fixture({ signedIn = true, owner = "account-1", legacy = false, noMatch = false } = {}) {
    const now = Date.now();
    const iso = time => new Date(time).toISOString();
    const records = new Map([
        ["session:test-session", { UserId: "account-1", Role: "user", Active: true,
            CreatedAt: now - 1000, LastSeenAt: now, AbsoluteExpiresAt: now + 86400000,
            Providers: { epic: { AccountId: "epic-subject", Linked: true } } }],
        ["account_login_status:account-1", { accountId: "account-1", lastLoginAt: iso(now), providerReauthAfter: null }],
        ["provider_auth_id:account-1:epic", { accountId: "account-1", provider: "epic", connectedAt: iso(now), expiresAt: iso(now + 86400000) }]
    ]);
    globalThis.fetch = async (input, init = {}) => {
        const url = String(input);
        if (url.endsWith("get_account_access_state")) return Response.json({ exists: true, state: "active", accountActive: true,
            suspended: false, suspendedUntil: null, banned: false, removed: false, rocketLeague: { exists: true, active: true } });
        if (url.endsWith("can_account_perform")) return Response.json(true);
        if (url.endsWith("get_account_session_identity")) return Response.json([{ id: "account-1", role: "user", active: true }]);
        if (url.endsWith("verify_account_provider_identity")) return Response.json([{ account_id: "account-1", provider: "epic", provider_subject: "epic-subject", active: true }]);
        if (url.endsWith("get_rocketleague_profile_v2")) return Response.json({ account_id: "account-1", rl_player_id: "player-1", active: true,
            registration_status: "complete", profile_complete: true, rocket_league_access: true, age_consent: true, policy_consent: true });
        if (url.endsWith("touch_account_last_seen")) return Response.json({ updated: true });
        throw new Error("Unexpected test RPC");
    };
    let storageReads = 0;
    const status = { jobId, status: "completed", stage: noMatch ? "needs_review" : "completed", progress: 100,
        ...(noMatch ? { disposition: "needs_review", reviewRequired: true, confirmationStatus: "pending_review", matchId: null }
            : { matchId: "12345678-1234-4234-8234-123456789012" }),
        ownerId: createHmac("sha256", secret).update(owner).digest("hex"),
        ...(legacy ? {} : { ownerType: "account", ownerVersion: 2 }), updatedAt: iso(now), completedAt: iso(now) };
    return {
        context: { request: new Request(`https://example.test/api/ocr/jobs/progress?jobId=${jobId}`, {
            headers: signedIn ? { cookie: "bpd_session=test-session" } : {}
        }), env: { SUPABASE_URL: "https://db.invalid/rest/v1/", SUPABASE_AUTH: "test", OCR_OWNER_SECRET: secret,
            AUTH_SESSIONS: { get: async key => structuredClone(records.get(key) ?? null), put: async () => {} },
            OCR_STORAGE: { get: async () => { storageReads++; return { text: async () => JSON.stringify(status) }; } },
            OCR_PROGRESS: { get: async () => null }
        } },
        reads: () => storageReads
    };
}

test("no-match review job opens only for its authenticated owner", async () => {
    const owner = fixture({ noMatch: true });
    const response = await getJob(owner.context);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.job.reviewRequired, true);
    assert.equal(body.job.disposition, "needs_review");
    assert.equal(body.job.matchId, null);
    assert.doesNotMatch(JSON.stringify(body), /account-1|ownerId|reviewObjectKey/);

    const other = fixture({ noMatch: true, owner: "someone-else" });
    const denied = await getJob(other.context);
    assert.equal(denied.status, 403);
});

test("malformed or unknown no-match locators fail safely", async () => {
    const f = fixture({ noMatch: true });
    f.context.request = new Request("https://example.test/api/ocr/jobs/get_job?jobId=not-a-job", {
        headers: { cookie: "bpd_session=test-session" }
    });
    const response = await getJob(f.context);
    assert.equal(response.status, 400);
    assert.doesNotMatch(await response.text(), /ownerId|account-1/);
});

test("job ID alone cannot authorize progress reads", async () => {
    const f = fixture({ signedIn: false });
    const response = await onRequestGet(f.context);
    assert.equal(response.status, 401);
    assert.equal(f.reads(), 0);
    assert.doesNotMatch(await response.text(), /12345678/);
});

test("unrelated signed-in accounts cannot read match ID or progress", async () => {
    const f = fixture({ owner: "someone-else" });
    const response = await onRequestGet(f.context);
    assert.equal(response.status, 403);
    assert.doesNotMatch(await response.text(), /12345678/);
});

for (const legacy of [false, true]) {
    test(`authorized owner can read completed progress, legacy=${legacy}`, async () => {
        const f = fixture({ owner: legacy ? "epic-subject" : "account-1", legacy });
        const response = await onRequestGet(f.context);
        assert.equal(response.status, 200, await response.clone().text());
        const body = await response.json();
        assert.equal(body.success, true);
        assert.doesNotMatch(JSON.stringify(body), /ownerId|ownerType|ownerVersion|account-1|epic-subject/);
    });
}
