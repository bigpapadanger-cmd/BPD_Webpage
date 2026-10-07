"use strict";

export const API = "/api/rocketleague/custom-matches";
export const isMatchCode = value => typeof value === "string" && /^CM[A-Za-z0-9]{8}$/.test(value);
const messages = {
    CUSTOM_MATCH_VERSION_CONFLICT: "This match changed. Its current state has been refreshed; review it before trying again.",
    CUSTOM_MATCH_NOT_FOUND: "This match was not found or is not available to you.",
    CUSTOM_MATCH_TEAM_FULL: "That team is full. Refresh the match to see available places.",
    CUSTOM_MATCH_ALREADY_JOINED: "You already joined this match.",
    CUSTOM_MATCH_HOST_REQUIRED: "Only the current host can do that.",
    CUSTOM_MATCH_HOST_TRANSFER_REQUIRED: "Transfer host ownership before leaving with other members present.",
    CUSTOM_MATCH_JOIN_AFTER_START_DISABLED: "This match does not allow joins after start.",
    CUSTOM_MATCH_JOIN_FORBIDDEN: "Joining this match is not allowed.",
    CUSTOM_MATCH_JOIN_AUTHORIZATION_REQUIRED: "This match requires an invitation or approval. Those tools are not available yet.",
    CUSTOM_MATCH_SIGN_IN_REQUIRED: "Sign in to BPD to use Custom Matches.",
    CUSTOM_MATCH_ACCESS_DENIED: "An active, registered Rocket League account with required consent is needed.",
    ACCOUNT_ACCESS_RESTRICTED: "Account access is restricted.",
    CUSTOM_MATCH_INPUT_INVALID: "Check the fields and configured capacity limits.",
    CUSTOM_MATCH_RUNTIME_UNAVAILABLE: "The live lobby session is unavailable. Refresh the match or try again shortly.",
    CUSTOM_MATCH_NOT_READY: "Every player on both teams must be connected and ready before the host can start.",
    CUSTOM_MATCH_VOTE_TYPE_CONFLICT: "This voting window already uses a different vote type.",
    CUSTOM_MATCH_ACTION_NOT_AVAILABLE: "That operation is not available in this phase."
};
export const errorMessage = error => messages[error?.code] ?? "Custom Matches is temporarily unavailable. Refresh or retry in a moment.";

export async function requestCustomMatch(path, { method = "GET", body, signal, fetcher = fetch, timeoutMs = 45000 } = {}) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) controller.abort();
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
            controller.abort();
            reject(Object.assign(new Error("Custom Match request timed out."), { code: "CUSTOM_MATCH_TIMEOUT", status: 504 }));
        }, timeoutMs);
    });
    try {
        return await Promise.race([timeout, (async () => {
            const response = await fetcher(`${API}${path}`, { method, credentials: "same-origin", cache: "no-store", signal: controller.signal,
                headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
            const value = await response.json().catch(() => null);
            if (!response.ok || value?.success !== true) {
                throw Object.assign(new Error("Custom Match request failed."), { code: value?.code ?? "CUSTOM_MATCH_UNAVAILABLE", status: response.ok ? 502 : response.status });
            }
            return value;
        })()]);
    } catch (error) {
        if (signal?.aborted) throw Object.assign(new Error("Page changed."), { name: "AbortError" });
        if (typeof error?.status === "number") throw error;
        throw Object.assign(new Error("Custom Match request unavailable."), { code: "CUSTOM_MATCH_UNAVAILABLE", status: 503 });
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
    }
}

export function createCustomMatchController({ call, publish, makeKey = () => crypto.randomUUID() }) {
    const state = { access: false, accessPending: true, accessMessage: "Checking Rocket League access…", limits: null,
        matches: [], page: 1, hasMore: false, total: 0, filter: "", browsePending: false, browseMessage: "Loading public matches…",
        selected: null, detail: null, detailPending: false, detailMessage: "", busy: false, retry: null, message: "", tone: "info",
        credentials: null, credentialsPending: false, credentialsMessage: "", runtimeStatus: "offline", runtimeMembers: [], voteTypes: {},
        rounds: [], roundsPending: false, roundsMessage: "", playerResults: [], resultPending: false, resultMessage: "", voteResults: {}, lastResultCode: "",
        invites: [], joinRequests: [], memberHistory: [], hostListsPending: false, hostListMessages: {}, hostListStatus: {} };
    let disposed = false, browseGeneration = 0, detailGeneration = 0, limitsGeneration = 0;
    let hostListsGeneration = 0;
    let runtimeSocket = null, reconnectTimer, reconnectAttempt = 0;
    let detailFlight = null, refreshAfterMutation = false, runtimeStopped = false;
    const emit = () => { if (!disposed) publish(state); };
    const notice = (message, tone = "info") => { state.message = message; state.tone = tone; emit(); };
    let credentialGeneration = 0, credentialTimer;
    function clearCredentials() {
        credentialGeneration++; clearTimeout(credentialTimer);
        state.credentials = null; state.credentialsPending = false; state.credentialsMessage = "";
        emit();
    }
    function disconnectRuntime() {
        clearTimeout(reconnectTimer); reconnectTimer = null;
        const socket = runtimeSocket; runtimeSocket = null;
        if (socket && socket.readyState < 2) { socket.onclose = null; socket.close(); }
        state.runtimeStatus = "offline"; state.runtimeMembers = []; emit();
    }
    function connectRuntime(matchCode = state.selected) {
        if (disposed || runtimeStopped || !isMatchCode(matchCode) || !state.access || !state.detail?.actor?.isMember
            || state.detail.match.matchCode !== matchCode || ["archived", "cancelled"].includes(state.detail.match.state)) return;
        if (runtimeSocket && runtimeSocket.readyState < 2) return;
        disconnectRuntime(); state.runtimeStatus = "connecting"; emit();
        try {
            const scheme = location.protocol === "https:" ? "wss:" : "ws:";
            const socket = new WebSocket(`${scheme}//${location.host}${API}/${matchCode}/runtime`); runtimeSocket = socket;
            socket.onopen = () => { if (runtimeSocket !== socket) return; state.runtimeStatus = "connected"; socket.send(JSON.stringify({ type: "resync" })); emit(); };
            socket.onmessage = event => {
                if (runtimeSocket !== socket || typeof event.data !== "string" || event.data.length > 65536) return;
                let value; try { value = JSON.parse(event.data); } catch { return; }
                if (value.type === "snapshot" && value.matchCode === matchCode && Array.isArray(value.members)
                    && value.members.every(item => typeof item.memberCode === "string" && typeof item.displayName === "string" && ["a", "b", "spectator"].includes(item.team) && typeof item.connected === "boolean" && typeof item.ready === "boolean")) {
                    state.runtimeMembers = value.members; state.runtimeStatus = "connected";
                    if (value.voteTypes && typeof value.voteTypes === "object" && !Array.isArray(value.voteTypes)) state.voteTypes = value.voteTypes;
                } else if (value.type === "presence" && typeof value.memberCode === "string" && typeof value.connected === "boolean" && typeof value.ready === "boolean") {
                    state.runtimeMembers = state.runtimeMembers.map(item => item.memberCode === value.memberCode ? { ...item, connected: value.connected, ready: value.ready } : item);
                } else if (value.type === "match_state" && value.matchCode === matchCode) {
                    state.runtimeMembers = state.runtimeMembers.map(item => ({ ...item, ready: false }));
                } else if (value.type === "readiness_reset") {
                    state.runtimeMembers = state.runtimeMembers.map(item => ({ ...item, ready: false }));
                } else if (value.type === "refresh_required") {
                    if (state.busy) { refreshAfterMutation = true; return; }
                    void detail(matchCode); return;
                } else if (value.type === "vote_window" && typeof value.roundCode === "string"
                    && (value.voteType === null || ["player_target", "skip", "yes_no", "option"].includes(value.voteType))) {
                    state.voteTypes = { ...state.voteTypes, [value.roundCode]: value.voteType };
                } else if (value.type === "revoked") {
                    runtimeStopped = true; disconnectRuntime(); void detail(matchCode); return;
                } else if (value.type === "unavailable") state.runtimeStatus = "unavailable";
                emit();
            };
            socket.onclose = event => {
                if (runtimeSocket !== socket || disposed) return;
                runtimeSocket = null; state.runtimeStatus = "offline"; state.runtimeMembers = state.runtimeMembers.map(item => ({ ...item, connected: false, ready: false })); emit();
                if ([1008, 4001, 4003, 4401, 4403].includes(event?.code) || reconnectAttempt >= 6) {
                    runtimeStopped = true; state.runtimeStatus = "unavailable"; emit(); return;
                }
                const delay = Math.min(30000, 1000 * (2 ** reconnectAttempt++)) + Math.floor(Math.random() * 500);
                reconnectTimer = setTimeout(() => connectRuntime(matchCode), delay);
            };
            socket.onerror = () => { try { socket.close(); } catch { } };
        } catch { state.runtimeStatus = "unavailable"; emit(); }
    }
    function setReady(ready) { if (runtimeSocket?.readyState === WebSocket.OPEN) runtimeSocket.send(JSON.stringify({ type: "ready", ready })); }
    async function credentials() {
        if (disposed || state.busy || state.retry || state.credentialsPending || !state.access || !state.detail
            || !(state.detail.actor?.isHost || state.detail.actor?.isMember)
            || ["results", "archived", "cancelled"].includes(state.detail.match.state)) return;
        clearCredentials();
        const generation = credentialGeneration, matchCode = state.detail.match.matchCode;
        state.credentialsPending = true; state.credentialsMessage = "Checking current lobby access…"; emit();
        try {
            const value = await call(`/${matchCode}/credentials`);
            if (disposed || generation !== credentialGeneration) return;
            if (value.matchCode !== state.selected || typeof value.credentials?.lobbyName !== "string" || typeof value.credentials?.lobbyPassword !== "string" || !/^[a-z0-9]{10}$/.test(value.credentials?.lobbyName ?? "")
                || !/^[a-z0-9]{10}$/.test(value.credentials?.lobbyPassword ?? "")) throw new Error();
            state.credentials = { lobbyName: value.credentials.lobbyName, lobbyPassword: value.credentials.lobbyPassword };
            state.credentialsMessage = "Private lobby credentials — hidden automatically after 10 seconds or when you leave this view.";
            credentialTimer = setTimeout(clearCredentials, 10000);
        } catch (error) {
            if (disposed || generation !== credentialGeneration) return;
            state.credentials = null;
            rejectAccess(error);
            // Losing credential permission also invalidates cached member controls.
            if (["CUSTOM_MATCH_CREDENTIALS_FORBIDDEN", "CUSTOM_MATCH_CREDENTIALS_UNAVAILABLE"].includes(error?.code)) {
                await detail(matchCode);
                if (disposed || state.selected !== matchCode) return;
                state.credentialsMessage = "Lobby credentials are not available to you in the current match state.";
                emit();
            } else state.credentialsMessage = errorMessage(error);
        } finally {
            if (generation === credentialGeneration) { state.credentialsPending = false; emit(); }
        }
    }
    const rejectAccess = error => {
        if (["CUSTOM_MATCH_SIGN_IN_REQUIRED", "CUSTOM_MATCH_ACCESS_DENIED", "ACCOUNT_ACCESS_RESTRICTED"].includes(error?.code)) {
            state.access = false; state.detail = null; state.accessMessage = errorMessage(error); clearHostLists();
            runtimeStopped = true; disconnectRuntime(); clearCredentials();
        }
    };
    function clearHostLists() {
        hostListsGeneration++; state.invites = []; state.joinRequests = []; state.memberHistory = [];
        state.hostListsPending = false; state.hostListMessages = {}; state.hostListStatus = {};
    }
    async function loadHostLists() {
        if (disposed || !state.access || state.accessPending || !state.detail?.actor?.isHost) { clearHostLists(); emit(); return; }
        clearCredentials();
        const matchCode = state.selected, generation = ++hostListsGeneration;
        state.invites = []; state.joinRequests = []; state.memberHistory = [];
        state.hostListsPending = true; state.hostListMessages = {}; state.hostListStatus = {}; emit();
        const current = () => !disposed && generation === hostListsGeneration && state.selected === matchCode && state.access && state.detail?.actor?.isHost;
        try {
            await Promise.all([["invites", "invites", "invites"], ["join-requests", "requests", "joinRequests"], ["member-history", "members", "memberHistory"]].map(async ([path, field, target]) => {
                try {
                    const value = await call(`/${matchCode}/${path}`);
                    if (!current()) return;
                    if (value.matchCode !== matchCode || !Array.isArray(value[field])) throw new Error();
                    state[target] = value[field]; state.hostListStatus[target] = "ready"; state.hostListMessages[target] = value[field].length ? "" : "None found.";
                } catch (error) {
                    if (!current()) return;
                    if (error?.code === "CUSTOM_MATCH_HOST_REQUIRED") {
                        state.detail = { ...state.detail, actor: { ...state.detail.actor, isHost: false } };
                        clearHostLists(); notice("Host access changed. Refresh the match to verify current ownership.", "error"); return;
                    }
                    rejectAccess(error);
                    if (current()) { state.hostListStatus[target] = "unavailable"; state.hostListMessages[target] = "This list is temporarily unavailable. Refresh host lists to retry."; }
                }
            }));
        } finally { if (generation === hostListsGeneration) { state.hostListsPending = false; emit(); } }
    }
    async function access() {
        if (state.busy) return;
        clearHostLists();
        disconnectRuntime();
        clearCredentials();
        state.accessPending = true; state.access = false; state.accessMessage = "Checking Rocket League access…"; emit();
        try {
            const value = await call("/access");
            if (value.allowed !== true) throw new Error();
            state.access = true; state.accessMessage = "Rocket League access verified.";
        } catch (error) { state.access = false; state.accessMessage = errorMessage(error); }
        finally { state.accessPending = false; emit(); }
    }
    async function limits() {
        const generation = ++limitsGeneration;
        state.limits = null; emit();
        try {
            const value = await call("/limits");
            if (disposed || generation !== limitsGeneration) return;
            if (!Array.isArray(value.modes) || !Number.isSafeInteger(value.maxTeamCapacity) || !Number.isSafeInteger(value.maxTotalParticipants)) throw new Error();
            state.limits = value;
        } catch (error) { if (generation === limitsGeneration) notice("Modes and limits could not be loaded. Use Reload modes / limits to try again.", "error"); }
        emit();
    }
    async function browse(page = state.page, filter = state.filter) {
        const generation = ++browseGeneration;
        state.browsePending = true; state.browseMessage = "Loading public matches…"; state.matches = []; emit();
        try {
            const query = new URLSearchParams({ page: String(page), pageSize: "30", ...(filter ? { state: filter } : {}) });
            const value = await call(`?${query}`);
            if (generation !== browseGeneration || disposed) return;
            if (!Array.isArray(value.matches) || value.matches.some(item => !isMatchCode(item.matchCode)) || !Number.isSafeInteger(value.page) || typeof value.hasMore !== "boolean") throw new Error();
            Object.assign(state, { matches: value.matches, page: value.page, hasMore: value.hasMore, total: value.total, filter,
                browseMessage: value.matches.length ? `${value.total} public matches · saved match data, not live player presence.` : "No public matches found for this filter." });
        } catch (error) { if (generation === browseGeneration) { state.hasMore = false; state.browseMessage = errorMessage(error); } }
        finally { if (generation === browseGeneration) { state.browsePending = false; emit(); } }
    }
    function detail(matchCode = state.selected) {
        if (detailFlight?.matchCode === matchCode) return detailFlight.promise;
        const promise = readDetail(matchCode).finally(() => { if (detailFlight?.promise === promise) detailFlight = null; });
        detailFlight = { matchCode, promise };
        return promise;
    }
    async function readDetail(matchCode) {
        if (!isMatchCode(matchCode)) { notice("Enter a valid Custom Match code.", "error"); return; }
        const generation = ++detailGeneration;
        clearHostLists();
        const changedMatch = state.selected !== matchCode;
        if (changedMatch) { state.lastResultCode = ""; disconnectRuntime(); runtimeStopped = false; reconnectAttempt = 0; }
        clearCredentials();
        state.selected = matchCode; if (changedMatch) state.detail = null;
        state.detailPending = true; state.detailMessage = "Loading match…"; emit();
        try {
            const value = await call(`/${encodeURIComponent(matchCode)}`);
            if (generation !== detailGeneration || disposed) return;
            if (value.match?.matchCode !== matchCode || !Number.isSafeInteger(value.match.version) || !Array.isArray(value.members)) throw new Error();
            state.detail = value; state.detailMessage = "Saved match state. Use Refresh match to check for changes.";
            // Coalesce the authoritative read, not independent host-list work.
            if (detailFlight?.matchCode === matchCode) detailFlight = null;
            if (value.actor?.isMember) connectRuntime(matchCode); else disconnectRuntime();
            if (value.actor?.isHost) await loadHostLists();
            if (disposed || generation !== detailGeneration || !state.detail) return;
            void loadRounds(matchCode);
            if (["results", "archived"].includes(value.match.state)) void loadPlayerResults(matchCode);
        } catch (error) { if (generation === detailGeneration) { state.detail = null; disconnectRuntime(); rejectAccess(error); state.detailMessage = errorMessage(error); } }
        finally { if (generation === detailGeneration) { state.detailPending = false; emit(); } }
    }
    async function sendMutation(transaction) {
        if (state.busy || state.credentialsPending || !state.access || disposed) return;
        clearCredentials();
        state.busy = true; state.retry = null; refreshAfterMutation = false; notice("Saving match change…");
        try {
            const value = await call(transaction.path, { method: "POST", body: JSON.parse(transaction.body) });
            if (transaction.storeResultCode && /^CMR[A-Za-z0-9]{8}$/.test(value.resultCode ?? "")) state.lastResultCode = value.resultCode;
            const matchCode = transaction.matchCode ?? value.match?.matchCode;
            if (!isMatchCode(matchCode)) throw Object.assign(new Error(), { status: 502 });
            // A pre-mutation read cannot establish the post-mutation version.
            if (detailFlight) await detailFlight.promise;
            refreshAfterMutation = false;
            await detail(matchCode);
            notice(state.detail ? "Match change saved successfully." : "Match change saved, but the updated detail could not be loaded. Refresh match.", state.detail ? "success" : "error");
        } catch (error) {
            rejectAccess(error);
            if (error?.code === "CUSTOM_MATCH_VERSION_CONFLICT") {
                await detail(transaction.matchCode);
                notice(state.detail ? errorMessage(error) : "This match changed, but its latest state could not be loaded. Refresh match before acting again.", "error");
            } else {
                if (!error?.status || error.status >= 500) state.retry = transaction;
                else if (transaction.matchCode && state.access && [403, 409].includes(error.status)) await detail(transaction.matchCode);
                notice(errorMessage(error), "error");
            }
        } finally { state.busy = false; refreshAfterMutation = false; emit(); }
    }
    async function create(options) {
        if (!state.access || !state.limits || state.busy || state.retry) return;
        const mode = state.limits.modes.find(item => item.modeKey === options.modeKey);
        if (!mode || mode.usesRounds || mode.usesVoting || !Number.isSafeInteger(options.teamACapacity) || !Number.isSafeInteger(options.teamBCapacity)
            || options.teamACapacity < 1 || options.teamBCapacity < 1 || options.teamACapacity > state.limits.maxTeamCapacity || options.teamBCapacity > state.limits.maxTeamCapacity
            || options.teamACapacity + options.teamBCapacity > state.limits.maxTotalParticipants) { notice("Check the configured capacities and select a supported basic mode.", "error"); return; }
        await sendMutation({ path: "", body: JSON.stringify({ idempotencyKey: makeKey(), options }) });
    }
    async function action(action, payload = {}) {
        if (!state.access || state.busy || state.retry || !state.detail) return;
        const { match } = state.detail;
        await sendMutation({ path: `/${match.matchCode}/actions`, matchCode: match.matchCode,
            body: JSON.stringify({ action, payload, expectedVersion: match.version, idempotencyKey: makeKey() }) });
    }
    async function loadRounds(matchCode = state.selected) {
        if (!isMatchCode(matchCode)) return;
        state.roundsPending = true; state.roundsMessage = "Loading rounds…"; emit();
        try {
            const value = await call(`/${matchCode}/rounds`);
            if (state.selected !== matchCode || !Array.isArray(value.rounds)) return;
            state.rounds = value.rounds; state.roundsMessage = value.rounds.length ? `${value.rounds.length} saved rounds.` : "No rounds are available yet.";
        } catch { if (state.selected === matchCode) state.roundsMessage = "Round data is temporarily unavailable."; }
        finally { if (state.selected === matchCode) { state.roundsPending = false; emit(); } }
    }
    async function loadPlayerResults(matchCode = state.selected) {
        if (!isMatchCode(matchCode)) return;
        state.resultPending = true; state.resultMessage = "Loading player results…"; emit();
        try {
            const value = await call(`/${matchCode}/results`);
            if (state.selected !== matchCode || !Array.isArray(value.players)) return;
            state.playerResults = value.players; state.resultMessage = value.players.length ? "Saved player results." : "No player results are available yet.";
        } catch { if (state.selected === matchCode) state.resultMessage = "Player results are temporarily unavailable."; }
        finally { if (state.selected === matchCode) { state.resultPending = false; emit(); } }
    }
    async function loadVoteResult(roundCode) {
        if (!isMatchCode(state.selected) || !/^CMRD[A-Za-z0-9]{8}$/.test(roundCode ?? "")) return;
        try { const value = await call(`/${state.selected}/rounds/${roundCode}/result`); state.voteResults = { ...state.voteResults, [roundCode]: value }; emit(); }
        catch { state.voteResults = { ...state.voteResults, [roundCode]: { resolved: false, roundCode } }; emit(); }
    }
    function mutation(path, body, includeMatchVersion = true) {
        if (!state.detail || state.busy || state.retry) return Promise.resolve();
        return sendMutation({ path: `/${state.detail.match.matchCode}/${path}`, matchCode: state.detail.match.matchCode,
            body: JSON.stringify({ ...body, idempotencyKey: makeKey(), ...(includeMatchVersion ? { expectedVersion: state.detail.match.version } : {}) }) });
    }
    const beginRound = () => mutation("rounds/begin", {});
    const openVote = round => mutation(`rounds/${round.roundCode}/open-vote`, { expectedRoundVersion: round.roundVersion });
    const resolveVote = round => mutation(`rounds/${round.roundCode}/resolve`, { expectedRoundVersion: round.roundVersion });
    const castVote = (round, vote) => mutation(`rounds/${round.roundCode}/vote`, { vote }, false);
    const submitResult = (teamAScore, teamBScore) => {
        if (!state.detail || state.busy || state.retry) return Promise.resolve();
        return sendMutation({ path: `/${state.detail.match.matchCode}/results/submit`, matchCode: state.detail.match.matchCode,
            body: JSON.stringify({ teamAScore, teamBScore, expectedVersion: state.detail.match.version, idempotencyKey: makeKey() }), storeResultCode: true });
    };
    const confirmResult = resultCode => mutation(`results/${resultCode}/confirm`, {});
    async function voteResult(roundCode) { await loadVoteResult(roundCode); }
    emit();
    return { state, access, limits, browse, detail, create, action, credentials, clearCredentials, connectRuntime, disconnectRuntime, setReady, notify: notice,
        loadRounds, loadPlayerResults, loadHostLists, voteResult, beginRound, openVote, resolveVote, castVote, submitResult, confirmResult,
        retry: () => state.retry ? sendMutation(state.retry) : Promise.resolve(),
        refreshDetail: async () => { if (state.busy) return; state.retry = null; runtimeStopped = false; reconnectAttempt = 0; await detail(); },
        dispose: () => { disposed = true; clearHostLists(); clearCredentials(); disconnectRuntime(); browseGeneration++; detailGeneration++; } };
}
