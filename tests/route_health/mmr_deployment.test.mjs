import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { getMmrDeploymentStatus, MMR_DEPLOY_TARGET, startMmrDeployment } from "../../functions/services/admin/mmr_deployment.js";
import { updateMmrBuildConfiguration } from "../../functions/services/admin/system_status.js";

function memoryKv() {
    const values = new Map();
    return {
        async get(key, type) { const value = values.get(key); return type === "json" && value ? JSON.parse(value) : value ?? null; },
        async put(key, value) { values.set(key, value); },
        async delete(key) { values.delete(key); }
    };
}

test("MMR deployment target is fixed and deployment responses contain no credential", async () => {
    const env = { RL_STATS_CACHE: memoryKv(), MMR_DEPLOY_GITHUB_TOKEN: "github-secret", MMR_API_URL: "https://mmr.example.test", MMR_API_KEY: "lookup-secret" };
    const originalFetch = globalThis.fetch;
    const requests = [];
    globalThis.fetch = async (input, init = {}) => {
        const url = new URL(input);
        requests.push({ url, init });
        if (url.pathname.endsWith("/dispatches")) return new Response(null, { status: 204 });
        if (url.pathname.endsWith("/runs")) return Response.json({ workflow_runs: [{ id: 77, status: "in_progress", conclusion: null, created_at: new Date().toISOString(), run_started_at: new Date().toISOString(), head_sha: "a".repeat(40) }] });
        if (url.pathname.endsWith("/actions/runs/77")) return Response.json({ id: 77, status: "completed", conclusion: "success", created_at: new Date(Date.now() - 1000).toISOString(), run_started_at: new Date(Date.now() - 900).toISOString(), updated_at: new Date().toISOString(), head_sha: "a".repeat(40) });
        if (url.pathname === "/health") return Response.json({ status: "ok" });
        if (url.pathname === "/health/ready") return Response.json({ status: "healthy", psynet: { state: "connected" }, build: { status: "valid" } });
        throw new Error(`Unexpected ${url}`);
    };
    try {
        const started = await startMmrDeployment(env, "account-1");
        assert.equal(started.deploymentState, "queued");
        assert.deepEqual(MMR_DEPLOY_TARGET, { owner: "bigpapadanger-cmd", repo: "mmr-api-v3", workflow: "deploy-production.yml", branch: "main", worker: "bpd-mmr-api" });
        const dispatch = requests[0];
        assert.equal(dispatch.url.pathname, "/repos/bigpapadanger-cmd/mmr-api-v3/actions/workflows/deploy-production.yml/dispatches");
        assert.equal(JSON.parse(dispatch.init.body).ref, "main");
        assert.equal(dispatch.init.headers.Authorization, "Bearer github-secret");
        assert.equal(JSON.stringify(started).includes("github-secret"), false);
        await assert.rejects(startMmrDeployment(env, "account-1"), { code: "MMR_DEPLOY_IN_PROGRESS", status: 409 });
        assert.equal((await getMmrDeploymentStatus(env)).deploymentState, "running");
        const completed = await getMmrDeploymentStatus(env);
        assert.equal(completed.deploymentState, "success");
        assert.equal(completed.commitSha, "a".repeat(40));
        assert.equal(completed.verification.status, "reachable");
        assert.equal(JSON.stringify(completed).includes("lookup-secret"), false);
        await assert.rejects(startMmrDeployment(env, "account-1"), { code: "MMR_DEPLOY_COOLDOWN", status: 429 });
    } finally { globalThis.fetch = originalFetch; }
});

test("deployment route requires confirmation and dedicated server authorization", async () => {
    const source = await readFile(new URL("../../functions/api/admin/system-status/mmr-deploy.js", import.meta.url), "utf8");
    assert.match(source, /ADMIN_PERMISSIONS\.MMR_DEPLOY/);
    assert.match(source, /parsed\.data\?\.confirm !== true/);
    assert.match(source, /Object\.keys\(parsed\.data \|\| \{\}\)/);
    assert.doesNotMatch(source, /workerName|repository|branch|workflow filename|command/);
});

test("deployment trigger failure is recorded without exposing the provider response", async () => {
    const env = { RL_STATS_CACHE: memoryKv(), MMR_DEPLOY_GITHUB_TOKEN: "github-secret" };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => Response.json({ token: "provider-secret" }, { status: 500 });
    try {
        await assert.rejects(startMmrDeployment(env, "account-2"), { code: "MMR_DEPLOY_TRIGGER_FAILED", status: 502 });
        const state = await getMmrDeploymentStatus(env);
        assert.equal(state.deploymentState, "failed");
        assert.equal(state.lastDeploymentFailureCode, "MMR_DEPLOY_TRIGGER_FAILED");
        assert.equal(JSON.stringify(state).includes("provider-secret"), false);
    } finally { globalThis.fetch = originalFetch; }
});

test("build update uses only the fixed protected MMR route and sanitizes the response", async () => {
    const env = { MMR_API_URL: "https://mmr.example.test", MMR_ADMIN_API_KEY: "admin-secret", MMR_API_KEY: "lookup-secret", RL_STATS_CACHE: memoryKv() };
    const originalFetch = globalThis.fetch;
    const paths = [];
    globalThis.fetch = async (input, init = {}) => {
        const url = new URL(input); paths.push(url.pathname);
        if (url.pathname === "/admin/build-configuration") {
            assert.equal(init.headers.Authorization, "Bearer admin-secret");
            assert.deepEqual(JSON.parse(init.body), { buildId: "246758282", featureSet: "PrimeUpdate60", userAgentBuildVersion: "260918.75141.528314" });
            return Response.json({ resultCode: "RL_BUILD_UPDATE_PROMOTED", buildId: "246758282", featureSet: "PrimeUpdate60", validatedAt: "2026-09-29T12:00:00.000Z", reconnectSucceeded: true, PsyToken: "must-not-pass" });
        }
        return Response.json({ status: "healthy", config: { requiredConfigPresent: true }, build: { status: "valid", active: { buildId: "246758282", featureSet: "PrimeUpdate60", source: "admin-validated" }, fallback: { buildId: "-1887694083", featureSet: "PrimeUpdate60", source: "wrangler" } }, psynet: { state: "connected" }, recovery: {}, traffic: {} });
    };
    try {
        const result = await updateMmrBuildConfiguration(env, { buildId: "246758282", featureSet: "PrimeUpdate60", userAgentBuildVersion: "260918.75141.528314" });
        assert.deepEqual(paths, ["/admin/build-configuration", "/health/ready"]);
        assert.equal(result.reconnectSucceeded, true);
        assert.equal(JSON.stringify(result).includes("must-not-pass"), false);
        await assert.rejects(updateMmrBuildConfiguration(env, { buildId: "bad", featureSet: "x", userAgentBuildVersion: "260918.75141.528314" }), { code: "RL_BUILD_UPDATE_INVALID", status: 400 });
        await assert.rejects(updateMmrBuildConfiguration(env, { buildId: "246758282", featureSet: "PrimeUpdate60", userAgentBuildVersion: "not-a-version" }), { code: "RL_BUILD_UPDATE_INVALID", status: 400 });
    } finally { globalThis.fetch = originalFetch; }
});

test("rejected build candidate refreshes status and is returned as a client-side validation failure", async () => {
    const deleted = [];
    const written = [];
    const env = {
        MMR_API_URL: "https://mmr.example.test",
        MMR_ADMIN_API_KEY: "admin-secret",
        MMR_API_KEY: "lookup-secret",
        RL_STATS_CACHE: { async delete(key) { deleted.push(key); }, async get() { return null; }, async put(key) { written.push(key); } }
    };
    const originalFetch = globalThis.fetch;
    const paths = [];
    globalThis.fetch = async input => {
        const url = new URL(input); paths.push(url.pathname);
        if (url.pathname === "/admin/build-configuration") return Response.json({ code: "RL_BUILD_UPDATE_REJECTED", providerCode: "VersionMismatch" }, { status: 422 });
        return Response.json({ status: "degraded", config: { requiredConfigPresent: true }, build: { status: "stale", candidateValidationResult: "VersionMismatch" }, psynet: { state: "idle" }, recovery: {}, traffic: {} });
    };
    try {
        await assert.rejects(
            updateMmrBuildConfiguration(env, { buildId: "246758282", featureSet: "PrimeUpdate60", userAgentBuildVersion: "260918.75141.528314" }),
            { code: "RL_BUILD_UPDATE_REJECTED", status: 422, providerCode: "VersionMismatch" }
        );
        assert.deepEqual(paths, ["/admin/build-configuration", "/health/ready"]);
        assert.ok(deleted.includes("admin:system-status:v2"));
        assert.ok(written.includes("admin:service-status:mmr-api"));
    } finally { globalThis.fetch = originalFetch; }
});

test("Worker Status deploy polling is bounded to active deployments", async () => {
    const source = await readFile(new URL("../../public/Global/Admin/WorkerStatus/JS/index.js", import.meta.url), "utf8");
    assert.match(source, /Redeploy the production MMR Worker/);
    assert.match(source, /setTimeout\(\(\) => \{ void loadDeploymentStatus\(\); \}, 7000\)/);
    assert.doesNotMatch(source, /setInterval\s*\(/);
    assert.match(source, /\["queued", "running"\]\.includes/);
});

test("Worker Status build form submits the logged client build version", async () => {
    const source = await readFile(new URL("../../public/Global/Admin/WorkerStatus/JS/index.js", import.meta.url), "utf8");
    assert.match(source, /name = "userAgentBuildVersion"/);
    assert.match(source, /GPsyonixBuildID/);
    assert.match(source, /userAgentBuildVersion\s*\}\)/);
});
