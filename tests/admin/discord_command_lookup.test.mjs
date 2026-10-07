import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { readFile } from "node:fs/promises";
import { resolveBpdAccountFromDiscordSubject } from "../../functions/services/auth/providers/provider_identity.js";
import { handleDiscordMatchBotInteraction, verifyDiscordMatchBotInteraction } from "../../functions/services/auth/providers/discord_matchbot/interactions.js";

const savedFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = savedFetch; });
const subject = "123456789012345678", guild = "223456789012345678", app = "323456789012345678";
const accountId = "11111111-1111-4111-8111-111111111111";
const env = { SUPABASE_URL: "https://database.example/rest/v1/", SUPABASE_SERVICE_ROLE_KEY: "service-test-secret",
    SUPABASE_AUTH: "access-test-secret", DISCORD_AUTHZ_GUILD_ID: guild, DISCORD_AUTHZ_BOT_TOKEN: "bot-test-secret",
    DISCORD_AUTHZ_ADMIN_ROLE_ID: "423456789012345678", DISCORD_AUTHZ_MOD_ROLE_ID: "523456789012345678",
    DISCORD_AUTHZ_LEAGUE_STAFF_ROLE_ID: "623456789012345678", DISCORD_MATCHBOT_CLIENT_ID: app,
    DISCORD_AUTHZ_OWNER_ROLE_ID: "723456789012345678", DISCORD_AUTHZ_DATABASE_ROLE_ID: "823456789012345678",
    DISCORD_AUTHZ_SECURITY_ROLE_ID: "923456789012345678", DISCORD_AUTHZ_UI_ROLE_ID: "103456789012345678" };
const success = role => ({ success: true, account: { accountId, role, active: true, discordDisplayName: "not-needed", email: "private" } });
const command = () => ({ type: 2, data: { name: "complete" }, guildId: guild, user: { id: subject, username: "not-a-lookup-key" } });

test("inverse lookup calls only the verified read-only RPC with server credentials and minimal projection", async () => {
    const calls = [];
    globalThis.fetch = async (url, init) => {
        calls.push(String(url));
        assert.equal(init.headers.apikey, env.SUPABASE_SERVICE_ROLE_KEY);
        assert.equal(init.headers["Content-Profile"], "api");
        assert.equal(init.redirect, "error");
        assert.deepEqual(JSON.parse(init.body), { p_provider_subject: subject });
        return Response.json(success("admin"));
    };
    assert.deepEqual(await resolveBpdAccountFromDiscordSubject(env, subject), { accountId, role: "admin", active: true });
    assert.deepEqual(calls, ["https://database.example/rest/v1/rpc/get_account_by_discord_subject"]);
});

for (const condition of ["unknown subject", "inactive link", "inactive account"]) {
    test(`${condition} uses the RPC not-found result without fallback lookup`, async () => {
        let calls = 0;
        globalThis.fetch = async url => {
            calls++;
            assert.ok(String(url).endsWith("/get_account_by_discord_subject"));
            return Response.json({ success: false, code: "DISCORD_ACCOUNT_NOT_FOUND" });
        };
        assert.equal(await resolveBpdAccountFromDiscordSubject(env, subject), null);
        assert.equal(calls, 1);
    });
}

test("invalid identity or missing service-role configuration fails before fetching", async () => {
    globalThis.fetch = () => { throw new Error("must not fetch"); };
    for (const id of [null, "", " ", "email@example.test", "displayName", "0", "99999999999999999999"]) {
        await assert.rejects(resolveBpdAccountFromDiscordSubject(env, id), { code: "DISCORD_SUBJECT_INVALID" });
    }
    await assert.rejects(resolveBpdAccountFromDiscordSubject({ ...env, SUPABASE_SERVICE_ROLE_KEY: "" }, subject), { code: "DISCORD_ACCOUNT_LOOKUP_UNAVAILABLE" });
});

test("provider errors and malformed successful responses are unavailable, never not-found", async () => {
    for (const value of [Response.json({ message: "private SQL" }, { status: 503 }), Response.json({ success: true, account: {} }),
        Response.json({ success: false, code: "other" }), Response.json(success("unrecognized"))]) {
        globalThis.fetch = async () => value;
        await assert.rejects(resolveBpdAccountFromDiscordSubject(env, subject), error => error.code === "DISCORD_ACCOUNT_LOOKUP_UNAVAILABLE" && !/private/.test(error.message));
    }
    globalThis.fetch = async () => { throw new Error("service-test-secret"); };
    await assert.rejects(resolveBpdAccountFromDiscordSubject(env, subject), { code: "DISCORD_ACCOUNT_LOOKUP_UNAVAILABLE" });
});

function installCommandFetch(roleIds, { allowed = true, linked = true, outage = false,
    taskStatus = "In Progress", taskRoles = ["owner"], memberRoles = ["owner"], missingTask = false, failMutation = false } = {}) {
    const calls = [];
    globalThis.fetch = async (url, init) => {
        const name = String(url).split("/").at(-1);
        calls.push(name);
        if (name === "get_account_by_discord_subject") {
            if (outage) return Response.json({}, { status: 503 });
            return Response.json(linked ? success("owner") : { success: false, code: "DISCORD_ACCOUNT_NOT_FOUND" });
        }
        if (name === "get_account_access_state") return Response.json({ exists: true, state: allowed ? "active" : "suspended",
            accountActive: true, suspended: !allowed, suspendedUntil: null, banned: false, removed: false,
            rocketLeague: { exists: false, active: false } });
        if (name === "can_account_perform") {
            assert.deepEqual(JSON.parse(init.body), { p_account_id: accountId, p_action: "manage_account" });
            return Response.json(allowed);
        }
        if (String(url).includes("/members/")) return Response.json({ user: { id: subject }, roles: roleIds, pending: false });
        if (name === "admin_get_taskboard_roles") return Response.json(memberRoles.map(role => ({ role })));
        if (name === "admin_get_task") return Response.json(missingTask ? null : { task_code: "TASK-ABC234", status: taskStatus, version: 7, responsible_roles: taskRoles });
        if (name === "admin_complete_task") {
            assert.deepEqual(JSON.parse(init.body), { p_task_code: "TASK-ABC234", p_expected_version: 7, p_actor_account_id: accountId });
            return failMutation ? Response.json({}, { status: 503 }) : Response.json({ task: { task_code: "TASK-ABC234", status: "Completed", version: 8 } });
        }
        if (name === "@original") {
            assert.equal(init.method, "PATCH");
            assert.doesNotMatch(init.body, new RegExp(`${accountId}|${subject}|service-test-secret|bot-test-secret`));
            return Response.json({});
        }
        throw new Error(`Unexpected RPC ${name}`);
    };
    return calls;
}

test("lookup success still requires current account, Discord permission and Taskboard checks; no mutation occurs", async () => {
    for (const role of [env.DISCORD_AUTHZ_ADMIN_ROLE_ID, env.DISCORD_AUTHZ_MOD_ROLE_ID, env.DISCORD_AUTHZ_LEAGUE_STAFF_ROLE_ID]) {
        const calls = installCommandFetch([role]);
        const response = await handleDiscordMatchBotInteraction(command(), env);
        assert.match(response.data.content, /verified.*not enabled/, JSON.stringify(calls));
        assert.ok(calls.includes("can_account_perform"));
        assert.ok(calls.includes("admin_get_taskboard_roles"));
        assert.ok(!calls.some(name => /resolve_discord_identity|link_discord_identity|complete_task|create/.test(name)));
        assert.doesNotMatch(JSON.stringify(response), new RegExp(accountId));
    }
    const calls = installCommandFetch([]);
    assert.match((await handleDiscordMatchBotInteraction(command(), env)).data.content, /do not have permission/);
    assert.ok(!calls.includes("admin_get_taskboard_roles"));
    installCommandFetch([env.DISCORD_AUTHZ_ADMIN_ROLE_ID], { allowed: false });
    assert.match((await handleDiscordMatchBotInteraction(command(), env)).data.content, /do not have permission/);
});

test("safe command messages distinguish unlinked from unavailable without email/username fallback", async () => {
    installCommandFetch([], { linked: false });
    assert.match((await handleDiscordMatchBotInteraction(command(), env)).data.content, /not linked/);
    installCommandFetch([], { outage: true });
    assert.match((await handleDiscordMatchBotInteraction(command(), env)).data.content, /temporarily unavailable/);
    const calls = installCommandFetch([]);
    const missing = command(); missing.user = { username: "name", email: "email@example.test" };
    assert.match((await handleDiscordMatchBotInteraction(missing, env)).data.content, /identity could not be verified/);
    assert.equal(calls.length, 0);
});

test("signature verifier rejects stale signatures without account lookup", async () => {
    const keys = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
    const publicKey = Buffer.from(await crypto.subtle.exportKey("raw", keys.publicKey)).toString("hex");
    const body = JSON.stringify({ id: "723456789012345678", application_id: app, type: 2, guild_id: guild,
        member: { user: { id: subject } }, token: "test-response-token", data: { name: "complete" } });
    const signed = async seconds => {
        const timestamp = String(seconds);
        const signature = Buffer.from(await crypto.subtle.sign("Ed25519", keys.privateKey, new TextEncoder().encode(timestamp + body))).toString("hex");
        return new Request("https://bpd.example/api/auth/discord/matchbot/interactions", { method: "POST",
            headers: { "X-Signature-Timestamp": timestamp, "X-Signature-Ed25519": signature }, body });
    };
    const configured = { ...env, DISCORD_MATCHBOT_PUBLIC_KEY: publicKey };
    const calls = installCommandFetch([env.DISCORD_AUTHZ_ADMIN_ROLE_ID]);
    assert.equal(await verifyDiscordMatchBotInteraction(await signed(Math.floor(Date.now() / 1000) - 600), configured, body), false);
    assert.equal(calls.length, 0);
    assert.equal(await verifyDiscordMatchBotInteraction(await signed(Math.floor(Date.now() / 1000)), configured, body), true);
    assert.ok(!calls.includes("admin_complete_task"));
});

test("lookup source has no identity mutation, direct table, email or username fallback", async () => {
    const file = await readFile(new URL("../../functions/services/auth/providers/provider_identity.js", import.meta.url), "utf8");
    const lookup = file.slice(file.indexOf("export async function resolveBpdAccountFromDiscordSubject"));
    assert.doesNotMatch(lookup, /resolve_discord_identity|link_discord_identity|account_identities|p_email|displayUsername/);
});

test("enabled completion reuses canonical task version/actor RPC and preserves safe failure outcomes", async () => {
    const enabled = { ...env, DISCORD_COMMUNICATIONS_ENABLED: "true",
        DISCORD_COMMUNICATIONS: { async fetch() { return Response.json({ success: true }); } },
        DISCORD_COMMUNICATIONS_SECRET: "local-only-test-signing-secret-long-enough" };
    const input = command(); input.data.options = [{ name: "tasknumber", type: 3, value: "TASK-ABC234" }];
    let calls = installCommandFetch([env.DISCORD_AUTHZ_MOD_ROLE_ID]);
    assert.match((await handleDiscordMatchBotInteraction(input, enabled)).data.content, /completed successfully/);
    assert.equal(calls.filter(n => n === "admin_complete_task").length, 1);
    calls = installCommandFetch([env.DISCORD_AUTHZ_MOD_ROLE_ID], { taskStatus: "Completed" });
    assert.match((await handleDiscordMatchBotInteraction(input, enabled)).data.content, /already completed/);
    assert.ok(!calls.includes("admin_complete_task"));
    calls = installCommandFetch([env.DISCORD_AUTHZ_MOD_ROLE_ID], { missingTask: true });
    assert.match((await handleDiscordMatchBotInteraction(input, enabled)).data.content, /not found/);
    calls = installCommandFetch([env.DISCORD_AUTHZ_MOD_ROLE_ID], { memberRoles: ["database"], taskRoles: ["security"] });
    assert.match((await handleDiscordMatchBotInteraction(input, enabled)).data.content, /do not have permission/);
    assert.ok(!calls.includes("admin_complete_task"));
    calls = installCommandFetch([env.DISCORD_AUTHZ_MOD_ROLE_ID], { failMutation: true });
    assert.match((await handleDiscordMatchBotInteraction(input, enabled)).data.content, /temporarily unavailable/);
});
