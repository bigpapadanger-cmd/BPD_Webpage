import { callCustomMatchRpc } from "../../../functions/services/supabase/rocketleague/custom_matches.js";
import { toCustomMatchRpcParameters, validateCustomMatchRequest } from "../../../functions/services/rl/custom_matches/contracts.js";

const headers = { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8", "X-Content-Type-Options": "nosniff" };
const response = (value, status = 200) => Response.json(value, { status, headers });
const fail = (code, status = 503) => response({ success: false, code }, status);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MATCH = /^CM[A-Za-z0-9]{8}$/;
const MEMBER = /^CMM[A-Za-z0-9]{8}$/;
const ROUND = /^CMRD[A-Za-z0-9]{8}$/;
const RESULT = /^CMR[A-Za-z0-9]{8}$/;
const IDEMPOTENCY = UUID;
const exact = (value, names) => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).sort().join(",") === [...names].sort().join(",");
async function authorized(request, env) {
    const expected = env.CUSTOM_MATCH_RUNTIME_CALLER_SECRET;
    const supplied = request.headers.get("X-Custom-Match-Caller");
    if (env.CUSTOM_MATCH_RUNTIME_ENABLED !== "true" || typeof expected !== "string" || expected.length < 64
        || typeof supplied !== "string" || supplied.length !== expected.length) return false;
    const [a, b] = await Promise.all([expected, supplied].map(value => crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
    const left = new Uint8Array(a), right = new Uint8Array(b); let difference = 0;
    for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
    return difference === 0;
}
function account(request) { const value = request.headers.get("X-Custom-Match-Account"); return UUID.test(value ?? "") ? value : null; }
async function parseBounded(request, max = 4096) {
    const declared = Number(request.headers.get("Content-Length"));
    if (Number.isFinite(declared) && declared > max) return null;
    const reader = request.body?.getReader(); if (!reader) return null;
    const chunks = []; let size = 0; let timerId;
    try {
        const read = async () => {
            while (true) {
                const part = await reader.read();
                if (part.done) break;
                size += part.value.byteLength; if (size > max) throw new Error("oversize");
                chunks.push(part.value);
            }
        };
        await Promise.race([read(), new Promise((_, reject) => { timerId = setTimeout(() => reject(new Error("timeout")), 3000); })]);
        const bytes = new Uint8Array(size); let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch { await reader.cancel().catch(() => {}); return null; }
    finally { clearTimeout(timerId); }
}

export class CustomMatchSession {
    constructor(state, env) {
        this.state = state; this.env = env; this.ready = new Map(); this.members = new Map(); this.lock = Promise.resolve();
        this.sockets = state.getWebSockets?.() ?? [];
        this.needsResetFanout = this.sockets.length > 0;
        // Durable Object restart intentionally drops readiness. Restore only live connection identity.
        for (const socket of this.sockets) {
            const attachment = socket.deserializeAttachment?.();
            if (attachment?.memberCode && attachment?.accountId) {
                this.matchCode ??= attachment.matchCode;
                this.memberTeams ??= new Map(); this.memberTeams.set(attachment.memberCode, attachment.team);
                const set = this.members.get(attachment.memberCode) ?? new Set(); set.add(socket); this.members.set(attachment.memberCode, set);
                this.ready.set(attachment.memberCode, false);
            }
        }
    }
    serial(work) { const next = this.lock.then(work, work); this.lock = next.catch(() => {}); return next; }
    async detail(matchCode, accountId) {
        const value = await callCustomMatchRpc(this.env, "detail", { p_match_code: matchCode, p_actor_account_id: accountId });
        if (value.match?.matchCode !== matchCode || !Array.isArray(value.members)) throw new Error("invalid");
        return value;
    }
    add(memberCode, socket, accountId) {
        const set = this.members.get(memberCode) ?? new Set(); set.add(socket); this.members.set(memberCode, set);
        socket.serializeAttachment({ memberCode, accountId, matchCode: this.matchCode, team: this.memberTeams?.get(memberCode) ?? null }); this.ready.set(memberCode, false);
    }
    remove(socket) {
        const attachment = socket.deserializeAttachment?.(); const memberCode = attachment?.memberCode;
        const set = this.members.get(memberCode); set?.delete(socket);
        if (!set?.size) { this.members.delete(memberCode); this.ready.set(memberCode, false); }
        this.broadcast({ type: "presence", memberCode, connected: Boolean(set?.size), ready: Boolean(set?.size && this.ready.get(memberCode)) });
    }
    async snapshot(detail) {
        const savedVotes = await this.state.storage.list({ prefix: "vote-type:", limit: 200 });
        const voteTypes = Object.fromEntries([...savedVotes].map(([key, voteType]) => [key.slice("vote-type:".length), voteType]));
        return { type: "snapshot", matchCode: detail.match.matchCode, matchVersion: detail.match.version, state: detail.match.state, voteTypes,
            members: detail.members.map(member => ({ memberCode: member.memberCode, displayName: member.displayName, team: member.team,
                connected: Boolean(this.members.get(member.memberCode)?.size), ready: Boolean(this.members.get(member.memberCode)?.size && this.ready.get(member.memberCode)) })) };
    }
    send(socket, value) { try { socket.send(JSON.stringify(value)); } catch { this.remove(socket); } }
    broadcast(value) { for (const sockets of this.members.values()) for (const socket of sockets) this.send(socket, value); }
    async fetch(request) {
        if (this.needsResetFanout) { this.needsResetFanout = false; this.broadcast({ type: "readiness_reset" }); }
        const url = new URL(request.url), matchCode = url.pathname.split("/").filter(Boolean)[0];
        if (!MATCH.test(matchCode ?? "")) return fail("CUSTOM_MATCH_INPUT_INVALID", 400);
        if (url.pathname === `/${matchCode}/connect` && request.headers.get("Upgrade")?.toLowerCase() === "websocket" && request.method === "GET") {
            const accountId = request.headers.get("X-Custom-Match-Account");
            if (!UUID.test(accountId ?? "") || !request.headers.get("X-Custom-Match-Internal")) return fail("CUSTOM_MATCH_ACCESS_DENIED", 403);
            return this.serial(async () => {
                let detail; try { detail = await this.detail(matchCode, accountId); } catch { return fail("CUSTOM_MATCH_UNAVAILABLE"); }
                const actor = detail.actor;
                if (!actor?.isMember || !actor.memberCode || !detail.members.some(member => member.memberCode === actor.memberCode)) return fail("CUSTOM_MATCH_ACCESS_DENIED", 403);
                if (this.state.getWebSockets().length >= 256) return fail("CUSTOM_MATCH_CAPACITY_REACHED", 429);
                if ((this.members.get(actor.memberCode)?.size ?? 0) >= 4) return fail("CUSTOM_MATCH_CAPACITY_REACHED", 429);
                this.matchCode = matchCode; this.memberTeams = new Map(detail.members.map(member => [member.memberCode, member.team]));
                const pair = new WebSocketPair(); pair[1].accept(); this.add(actor.memberCode, pair[1], accountId);
                this.broadcast({ type: "presence", memberCode: actor.memberCode, connected: true, ready: false });
                this.send(pair[1], await this.snapshot(detail));
                return new Response(null, { status: 101, webSocket: pair[0] });
            });
        }
        if (request.method !== "POST" || !request.headers.get("X-Custom-Match-Internal")) return fail("NOT_FOUND", 404);
        const body = await parseBounded(request);
        if (!body) return fail("CUSTOM_MATCH_INPUT_INVALID", 400);
        if (url.pathname === `/${matchCode}/revoke`) {
            if (!exact(body, ["memberCode", "accountId"]) || (body.memberCode !== null && !MEMBER.test(body.memberCode)) || (body.accountId !== null && !UUID.test(body.accountId))
                || (body.memberCode === null) === (body.accountId === null)) return fail("CUSTOM_MATCH_INPUT_INVALID", 400);
            return this.serial(async () => {
                const targets = [...this.members.entries()].filter(([memberCode, sockets]) => (body.memberCode !== null && body.memberCode === memberCode)
                    || (body.accountId !== null && [...sockets].some(socket => socket.deserializeAttachment()?.accountId === body.accountId)));
                for (const [memberCode, sockets] of targets) {
                    this.ready.set(memberCode, false); this.members.delete(memberCode);
                    for (const socket of sockets) { this.send(socket, { type: "revoked" }); try { socket.close(1008, "access changed"); } catch { } }
                    this.broadcast({ type: "presence", memberCode, connected: false, ready: false });
                }
                this.broadcast({ type: "refresh_required" });
                return response({ success: true });
            });
        }
        if (url.pathname === `/${matchCode}/refresh`) {
            if (!exact(body, [])) return fail("CUSTOM_MATCH_INPUT_INVALID", 400);
            return this.serial(async () => { this.broadcast({ type: "refresh_required" }); return response({ success: true }); });
        }
        if (url.pathname === `/${matchCode}/start`) {
            const accountId = request.headers.get("X-Custom-Match-Account");
            if (!UUID.test(accountId ?? "") || !exact(body, ["expectedVersion", "idempotencyKey"]) || !Number.isSafeInteger(body.expectedVersion) || !IDEMPOTENCY.test(body.idempotencyKey ?? "")) return fail("CUSTOM_MATCH_INPUT_INVALID", 400);
            return this.serial(async () => {
                let detail; try { detail = await this.detail(matchCode, accountId); } catch { return fail("CUSTOM_MATCH_UNAVAILABLE"); }
                if (!detail.actor?.isHost || !detail.actor.isMember) return fail("CUSTOM_MATCH_HOST_REQUIRED", 403);
                if (detail.match.version !== body.expectedVersion) return fail("CUSTOM_MATCH_VERSION_CONFLICT", 409);
                const players = detail.members.filter(member => member.team === "a" || member.team === "b");
                const teamA = players.some(member => member.team === "a"), teamB = players.some(member => member.team === "b");
                const allReady = players.length > 0 && players.every(member => this.members.get(member.memberCode)?.size && this.ready.get(member.memberCode) === true);
                if (!teamA || !teamB || !allReady || !["open", "lobby", "pregame"].includes(detail.match.state)) return fail("CUSTOM_MATCH_NOT_READY", 409);
                try {
                    const result = await callCustomMatchRpc(this.env, "action", { p_match_code: matchCode, p_actor_account_id: accountId,
                        p_expected_version: body.expectedVersion, p_idempotency_key: body.idempotencyKey, p_action: "start", p_payload: {} });
                    if (result.action !== "start" || result.previousVersion !== body.expectedVersion || result.version <= body.expectedVersion) return fail("CUSTOM_MATCH_RESPONSE_INVALID", 502);
                    this.ready.clear(); this.broadcast({ type: "match_state", matchCode, state: "active", matchVersion: result.version });
                    return response(result);
                } catch (error) { return fail(error?.code === "CUSTOM_MATCH_VERSION_CONFLICT" ? error.code : error?.code ?? "CUSTOM_MATCH_UNAVAILABLE", error?.status ?? 503); }
            });
        }
        if (url.pathname === `/${matchCode}/round-open` || url.pathname === `/${matchCode}/vote` || url.pathname === `/${matchCode}/resolve-vote`) {
            const accountId = request.headers.get("X-Custom-Match-Account");
            if (!UUID.test(accountId ?? "")) return fail("CUSTOM_MATCH_ACCESS_DENIED", 403);
            return this.serial(async () => {
                const operation = url.pathname.endsWith("round-open") ? "openVote" : url.pathname.endsWith("resolve-vote") ? "resolveVote" : "castVote";
                const roundCode = body.roundCode;
                const allowedKeys = operation === "castVote" ? ["roundCode", "vote", "idempotencyKey"] : ["roundCode", "expectedVersion", "expectedRoundVersion", "idempotencyKey"];
                if (!exact(body, allowedKeys)) return fail("CUSTOM_MATCH_INPUT_INVALID", 400);
                if (!ROUND.test(roundCode ?? "")) return fail("CUSTOM_MATCH_INPUT_INVALID", 400);
                if (operation === "openVote") {
                    let detail;
                    try { detail = await this.detail(matchCode, accountId); } catch { return fail("CUSTOM_MATCH_UNAVAILABLE"); }
                    if (!detail.actor?.isHost || !detail.actor.isMember) return fail("CUSTOM_MATCH_HOST_REQUIRED", 403);
                    let rounds; try { rounds = await callCustomMatchRpc(this.env, "rounds", { p_match_code: matchCode, p_actor_account_id: accountId }); } catch { return fail("CUSTOM_MATCH_UNAVAILABLE"); }
                    if (!rounds.rounds.some(item => item.roundCode === roundCode && item.state === "active")) return fail("CUSTOM_MATCH_NOT_READY", 409);
                    const result = await this.forwardVote(operation, body, accountId, matchCode);
                    if (result.ok) { await this.state.storage.delete(`vote-type:${roundCode}`); this.broadcast({ type: "vote_window", roundCode, voteType: null }); }
                    return result;
                }
                if (operation === "resolveVote") {
                    let detail; try { detail = await this.detail(matchCode, accountId); } catch { return fail("CUSTOM_MATCH_UNAVAILABLE"); }
                    if (!detail.actor?.isHost || !detail.actor.isMember) return fail("CUSTOM_MATCH_HOST_REQUIRED", 403);
                    let rounds; try { rounds = await callCustomMatchRpc(this.env, "rounds", { p_match_code: matchCode, p_actor_account_id: accountId }); } catch { return fail("CUSTOM_MATCH_UNAVAILABLE"); }
                    if (!rounds.rounds.some(item => item.roundCode === roundCode && item.state === "voting")) return fail("CUSTOM_MATCH_NOT_READY", 409);
                    const result = await this.forwardVote(operation, body, accountId, matchCode);
                    if (result.ok) { await this.state.storage.delete(`vote-type:${roundCode}`); this.broadcast({ type: "vote_window", roundCode, voteType: null }); }
                    return result;
                }
                let detail;
                try { detail = await this.detail(matchCode, accountId); } catch { return fail("CUSTOM_MATCH_UNAVAILABLE"); }
                if (!detail.actor?.isMember) return fail("CUSTOM_MATCH_ACCESS_DENIED", 403);
                let rounds; try { rounds = await callCustomMatchRpc(this.env, "rounds", { p_match_code: matchCode, p_actor_account_id: accountId }); } catch { return fail("CUSTOM_MATCH_UNAVAILABLE"); }
                if (!rounds.rounds.some(item => item.roundCode === roundCode && item.state === "voting")) return fail("CUSTOM_MATCH_NOT_READY", 409);
                const voteType = body.vote?.voteType;
                if (!new Set(["player_target", "skip", "yes_no", "option"]).has(voteType)) return fail("CUSTOM_MATCH_INPUT_INVALID", 400);
                const claim = await this.state.storage.transaction(async storage => {
                    const key = `vote-type:${roundCode}`, current = await storage.get(key);
                    if (current && current !== voteType) return { accepted: false, created: false };
                    if (current === voteType) return { accepted: true, created: false };
                    await storage.put(key, voteType); return { accepted: true, created: true };
                });
                if (!claim.accepted) return fail("CUSTOM_MATCH_VOTE_TYPE_CONFLICT", 409);
                const result = await this.forwardVote(operation, body, accountId, matchCode);
                // A provider/server failure may have committed before its response
                // was lost. Keep the category claim on ambiguous 5xx outcomes so
                // retries or concurrent clients cannot introduce a second vote type.
                if (!result.ok && result.status < 500 && claim.created) await this.state.storage.delete(`vote-type:${roundCode}`);
                if (result.ok) this.broadcast({ type: "vote_window", roundCode, voteType });
                return result;
            });
        }
        return fail("NOT_FOUND", 404);
    }
    async forwardVote(operation, body, accountId, matchCode) {
        const name = operation;
        const input = ["openVote", "resolveVote"].includes(operation)
            ? { matchCode, roundCode: body.roundCode, expectedVersion: body.expectedVersion, expectedRoundVersion: body.expectedRoundVersion, idempotencyKey: body.idempotencyKey }
            : { matchCode, roundCode: body.roundCode, vote: body.vote, idempotencyKey: body.idempotencyKey };
        try {
            const parameters = toCustomMatchRpcParameters(name, validateCustomMatchRequest(name, input), accountId);
            return response(await callCustomMatchRpc(this.env, name, parameters));
        } catch (error) { return fail(error?.code ?? "CUSTOM_MATCH_UNAVAILABLE", error?.status ?? 503); }
    }
    async webSocketMessage(socket, message) {
        if (this.needsResetFanout) { this.needsResetFanout = false; this.broadcast({ type: "readiness_reset" }); }
        await this.serial(async () => {
            const attachment = socket.deserializeAttachment?.(), memberCode = attachment?.memberCode;
            if (!MEMBER.test(memberCode ?? "") || typeof message !== "string" || message.length > 256) { try { socket.close(1008, "invalid message"); } catch { } return; }
            let value; try { value = JSON.parse(message); } catch { try { socket.close(1008, "invalid message"); } catch { } return; }
            let detail;
            try { detail = await this.detail(attachment.matchCode, attachment.accountId); }
            catch { this.send(socket, { type: "unavailable" }); return; }
            const currentMember = detail.members.find(member => member.memberCode === memberCode);
            if (!detail.actor?.isMember || detail.actor.memberCode !== memberCode || !currentMember) {
                this.members.get(memberCode)?.delete(socket);
                if (!this.members.get(memberCode)?.size) { this.members.delete(memberCode); this.ready.set(memberCode, false); }
                this.send(socket, { type: "revoked" }); try { socket.close(1008, "membership changed"); } catch { }
                this.broadcast({ type: "presence", memberCode, connected: Boolean(this.members.get(memberCode)?.size), ready: false });
                return;
            }
            this.memberTeams ??= new Map(); this.memberTeams.set(memberCode, currentMember.team);
            socket.serializeAttachment?.({ ...attachment, team: currentMember.team });
            if (value?.type === "resync" && exact(value, ["type"])) {
                this.send(socket, await this.snapshot(detail));
                return;
            }
            if (value?.type !== "ready" || !exact(value, ["type", "ready"]) || typeof value.ready !== "boolean") { try { socket.close(1008, "invalid message"); } catch { } return; }
            if (currentMember.team === "spectator" && value.ready || !["open", "lobby", "pregame"].includes(detail.match.state)) { this.send(socket, { type: "error", code: "CUSTOM_MATCH_NOT_READY" }); return; }
            this.ready.set(memberCode, value.ready);
            this.broadcast({ type: "presence", memberCode, connected: true, ready: value.ready });
        });
    }
    webSocketClose(socket) { this.remove(socket); }
    webSocketError(socket) { this.remove(socket); }
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        if (!await authorized(request, env)) return fail("CUSTOM_MATCH_RUNTIME_UNAVAILABLE", 503);
        if (url.search || url.hash) return fail("CUSTOM_MATCH_INPUT_INVALID", 400);
        const [operation, matchCode] = url.pathname.split("/").filter(Boolean);
        if (!MATCH.test(matchCode ?? "") || !env.CUSTOM_MATCH_SESSIONS?.idFromName) return fail("CUSTOM_MATCH_INPUT_INVALID", 400);
        if (!["connect", "start", "revoke", "refresh", "round-open", "vote", "resolve-vote"].includes(operation)) return fail("NOT_FOUND", 404);
        const stub = env.CUSTOM_MATCH_SESSIONS.get(env.CUSTOM_MATCH_SESSIONS.idFromName(matchCode));
        const forwarded = new Request(`https://custom-match-session.internal/${matchCode}/${operation}`, request);
        forwarded.headers.set("X-Custom-Match-Internal", "1");
        return stub.fetch(forwarded);
    }
};
