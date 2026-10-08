"use strict";

import { apiFetch } from "/scripts/apiConnection.js";
import { createCustomMatchController, requestCustomMatch, isMatchCode } from "./client.js";
import { renderBrowse, renderLobby, updateLobbyRuntime, renderCredentials, renderRounds, renderPlayerResults, renderHostManagement, element } from "./view.js";

const disposeKey = Symbol.for("bpd.customMatches.dispose");
export async function initializePage() {
    const root = document.getElementById("customMatchesPage");
    if (!root) return;
    // Router imports entry modules with a new routeLoad URL. Cleanup therefore
    // belongs to the actual root, not a module-local singleton.
    root[disposeKey]?.();
    const lifetime = new AbortController();
    const get = id => root.querySelector(`#${id}`);
    let controller, lastLimits = null, lastNotice = "", noticeTimer;
    const sectionKeys = new Map();
    // Preserve only editable non-credential controls within the same match.
    const section = (id, key, draw) => {
        const serialized = JSON.stringify(key);
        if (sectionKeys.get(id) === serialized) return;
        const target = get(id), active = document.activeElement;
        const fields = [...target.querySelectorAll("input,select,textarea")];
        const saved = fields.map(node => ({ value: node.value, checked: node.checked, start: node.selectionStart, end: node.selectionEnd }));
        const focused = fields.indexOf(active), buttons = [...target.querySelectorAll("button,summary,a")];
        const focusButton = buttons.indexOf(active), disclosures = [...target.querySelectorAll("details")].map(node => node.open);
        const sameMatch = target.dataset.renderMatch === String(controller?.state.selected ?? "");
        draw(); sectionKeys.set(id, serialized); target.dataset.renderMatch = String(controller?.state.selected ?? "");
        if (!sameMatch) return;
        const next = [...target.querySelectorAll("input,select,textarea")];
        if (next.length === fields.length) next.forEach((node, index) => {
            if (node.tagName !== fields[index].tagName || node.name !== fields[index].name || node.dataset.cmAssign || node.dataset.cmPolicy || (node.dataset.voteType && node.disabled)) return;
            node.value = saved[index].value; node.checked = saved[index].checked;
            if (index === focused && !node.disabled) { node.focus({ preventScroll: true }); try { node.setSelectionRange(saved[index].start, saved[index].end); } catch {} }
        });
        target.querySelectorAll("details").forEach((node, index) => { node.open = disclosures[index] ?? false; });
        if (focusButton >= 0) target.querySelectorAll("button,summary,a")[focusButton]?.focus({ preventScroll: true });
    };
    const render = state => {
        if (lifetime.signal.aborted || !root.isConnected) return;
        try {
            const locked = !state.access || state.accessPending || state.detailPending || state.busy || state.credentialsPending || Boolean(state.retry);
            get("cmAccessStatus").textContent = state.accessMessage;
            get("cmCheckAccess").disabled = state.accessPending || state.busy;
            get("cmCreateFields").disabled = locked || !state.limits || !state.limits.modes.some(mode => !mode.usesRounds && !mode.usesVoting);
            get("cmReloadLimits").disabled = state.busy;
            if (state.limits && state.limits !== lastLimits) {
                lastLimits = state.limits;
                const select = get("cmMode"); const previous = select.value;
                select.replaceChildren();
                for (const mode of state.limits.modes) {
                    const option = element(document, "option", `${mode.displayName}${mode.usesRounds || mode.usesVoting ? " (tools later)" : ""}`);
                    option.value = mode.modeKey; option.disabled = mode.usesRounds || mode.usesVoting; select.append(option);
                }
                const available = state.limits.modes.filter(mode => !mode.usesRounds && !mode.usesVoting);
                select.value = available.some(mode => mode.modeKey === previous) ? previous : available[0]?.modeKey ?? "";
                const form = get("cmCreateForm");
                const mode = available.find(item => item.modeKey === select.value);
                form.elements.teamACapacity.max = form.elements.teamBCapacity.max = String(state.limits.maxTeamCapacity);
                if (mode) { form.elements.teamACapacity.value = String(mode.defaultTeamACapacity); form.elements.teamBCapacity.value = String(mode.defaultTeamBCapacity); }
                form.elements.allowJoinAfterStart.checked = state.limits.defaultAllowJoinAfterStart;
                form.elements.allowSpectators.checked = false;
                form.elements.allowSpectators.disabled = !Number.isSafeInteger(state.limits.maxSpectatorCapacity);
                form.elements.spectatorCapacity.value = String(state.limits.defaultSpectatorCapacity ?? "");
                form.elements.spectatorCapacity.max = String(state.limits.maxSpectatorCapacity ?? "");
                form.elements.spectatorCapacity.disabled = true;
                get("cmLimitsNote").textContent = `Up to ${state.limits.maxTeamCapacity} per team; ${state.limits.maxTotalParticipants} total. Asymmetric teams are supported.`;
                root.querySelectorAll("[data-capacity]").forEach(button => { button.disabled = Number(button.dataset.capacity) > state.limits.maxTeamCapacity || Number(button.dataset.capacity) * 2 > state.limits.maxTotalParticipants; });
            }
            if (!state.limits) get("cmLimitsNote").textContent = "Modes / limits unavailable or loading. Create stays locked until they are confirmed.";
            get("cmBrowseStatus").textContent = state.browseMessage;
            get("cmPrevious").disabled = state.browsePending || state.page <= 1;
            get("cmNext").disabled = state.browsePending || !state.hasMore;
            get("cmRefreshBrowse").disabled = state.browsePending;
            get("cmPageNumber").textContent = `Page ${state.page}`;
            section("cmMatches", state.matches, () => renderBrowse(document, get("cmMatches"), state.matches));
            get("cmLobbyPanel").hidden = !state.selected;
            get("cmLobbyStatus").textContent = state.detailMessage;
            get("cmRefreshDetail").disabled = state.busy || state.detailPending;
            section("cmLobby", [state.detail, locked, state.limits], () => renderLobby(document, get("cmLobby"), state.detail, { locked, limits: state.limits }));
            updateLobbyRuntime(get("cmLobby"), state, locked);
            // Credentials are intentionally excluded from UI preservation/caches.
            renderCredentials(document, get("cmCredentials"), state);
            section("cmHostManagement", [state.detail?.actor, state.access, state.accessPending, locked, state.invites, state.joinRequests, state.memberHistory, state.hostListsPending, state.hostListMessages, state.hostListStatus], () => renderHostManagement(document, get("cmHostManagement"), state, { locked }));
            section("cmRounds", [state.detail, locked, state.rounds, state.roundsPending, state.roundsMessage, state.voteTypes, state.voteResults], () => renderRounds(document, get("cmRounds"), state, { locked }));
            section("cmResults", [state.detail, locked, state.playerResults, state.resultPending, state.resultMessage, state.lastResultCode], () => renderPlayerResults(document, get("cmResults"), state, { locked }));
            get("cmRetryMutation").hidden = !state.retry;
            get("cmRetryMutation").disabled = state.busy || !state.access;
            if (lastNotice !== state.message) {
                clearTimeout(noticeTimer); lastNotice = state.message;
                get("cmNotice").textContent = state.message; get("cmNotice").dataset.tone = state.tone;
                if (state.tone === "success") noticeTimer = setTimeout(() => { if (!lifetime.signal.aborted) get("cmNotice").textContent = ""; }, 8000);
            }
        } catch {
            get("cmCredentials").replaceChildren();
            root.querySelectorAll("[data-protected], #cmCreateFields").forEach(node => { node.disabled = true; });
            get("cmNotice").textContent = "Match display unavailable. Reload this page to recover.";
            get("cmNotice").dataset.tone = "error";
        }
    };
    controller = createCustomMatchController({ call: (path, options) => requestCustomMatch(path, { ...options, signal: lifetime.signal, fetcher: apiFetch }), publish: render });
    const observer = new MutationObserver(() => { if (!root.isConnected) root[disposeKey]?.(); });
    root[disposeKey] = () => { lifetime.abort(); clearTimeout(noticeTimer); controller.dispose(); get("cmCredentials").replaceChildren(); observer.disconnect(); };
    if (root.parentNode) observer.observe(root.parentNode, { childList: true });
    document.addEventListener("bpd:page-loaded", () => { if (!root.isConnected) root[disposeKey]?.(); }, { signal: lifetime.signal });
    window.addEventListener("pagehide", () => root[disposeKey]?.(), { signal: lifetime.signal });
    window.addEventListener("blur", () => controller.clearCredentials(), { signal: lifetime.signal });
    document.addEventListener("visibilitychange", () => {
        if (document.hidden) { controller.clearCredentials(); controller.disconnectRuntime(); }
        else if (controller.state.detail) controller.connectRuntime(controller.state.selected);
    }, { signal: lifetime.signal });
    const run = operation => { void Promise.resolve().then(operation).catch(() => { if (root.isConnected && !lifetime.signal.aborted) { get("cmNotice").textContent = "Unable to complete that action. Refresh the match before trying again."; get("cmCreateFields").disabled = true; root.querySelectorAll("[data-protected]").forEach(node => { node.disabled = true; }); } }); };
    root.addEventListener("click", event => {
        const target = event.target.closest("button,a"); if (!target || target.disabled) return;
        const open = target.dataset.cmOpen;
        if (open && isMatchCode(open)) {
            event.preventDefault();
            if (controller.state.busy || controller.state.retry) return;
            history.replaceState(history.state, "", `/RocketLeague/FindCustomMatches?match=${encodeURIComponent(open)}`);
            run(() => controller.detail(open));
        } else if (target.dataset.cmAction) {
            if (["kick_member", "transfer_host"].includes(target.dataset.cmAction) && !window.confirm(target.dataset.cmAction === "kick_member" ? "Remove this member from the match? They cannot rejoin until the host explicitly permits it." : "Transfer durable host ownership to this player?")) return;
            const payload = JSON.parse(target.dataset.cmPayload);
            const handlers = { begin_round: () => controller.beginRound(), open_vote: () => controller.openVote(controller.state.rounds.find(item => item.roundCode === payload.roundCode)),
                resolve_vote: () => controller.resolveVote(controller.state.rounds.find(item => item.roundCode === payload.roundCode)),
                read_vote_result: () => controller.voteResult(payload.roundCode) };
            run(() => handlers[target.dataset.cmAction] ? handlers[target.dataset.cmAction]() : controller.action(target.dataset.cmAction, payload));
        } else if (target.dataset.cmCopyInvite) {
            void Promise.resolve().then(() => navigator.clipboard.writeText(target.dataset.cmCopyInvite)).then(() => {
                if (!lifetime.signal.aborted) controller.notify("Invite code copied.", "success");
            }).catch(() => { if (!lifetime.signal.aborted) controller.notify("Copy unavailable. Select the displayed invite code to copy it.", "error"); });
        } else if (target.dataset.runtimeReady) run(() => controller.setReady(target.dataset.runtimeReady === "true"));
        else if (target.dataset.capacity) {
            const form = get("cmCreateForm"); form.elements.teamACapacity.value = form.elements.teamBCapacity.value = target.dataset.capacity;
        } else {
            const handlers = { cmCheckAccess: () => controller.access(), cmReloadLimits: () => controller.limits(), cmRefreshBrowse: () => controller.browse(),
                cmPrevious: () => controller.browse(controller.state.page - 1), cmNext: () => controller.browse(controller.state.page + 1), cmRefreshDetail: () => controller.refreshDetail(), cmRetryMutation: () => controller.retry(),
                cmShowCredentials: () => controller.credentials(), cmHideCredentials: () => controller.clearCredentials(),
                cmRefreshRounds: () => controller.loadRounds(), cmRefreshResults: () => controller.loadPlayerResults(), cmRefreshHostLists: () => controller.loadHostLists() };
            if (handlers[target.id]) run(handlers[target.id]);
        }
    }, { signal: lifetime.signal });
    root.addEventListener("change", event => {
        const target = event.target;
        if (target.dataset.voteType) {
            const form = target.closest("form"), kind = target.value;
            form.querySelector("[data-vote-target]").hidden = kind !== "player_target";
        }
        if (target.dataset.cmAssign) run(() => controller.action("assign_team", { memberCode: target.dataset.cmAssign, team: target.value }));
        if (target.dataset.cmPolicy) run(() => controller.action("set_join_policy", { joinPolicy: target.value }));
        if (target.id === "cmMode") {
            const mode = controller.state.limits?.modes.find(item => item.modeKey === target.value);
            if (mode) { const form = get("cmCreateForm"); form.elements.teamACapacity.value = String(mode.defaultTeamACapacity); form.elements.teamBCapacity.value = String(mode.defaultTeamBCapacity); }
        }
        if (target.name === "visibility") get("cmCreateForm").elements.joinPolicy.value = target.value === "private" ? "invite_only" : "open";
        if (target.name === "allowSpectators") get("cmCreateForm").elements.spectatorCapacity.disabled = !target.checked;
    }, { signal: lifetime.signal });
    root.addEventListener("submit", event => {
        event.preventDefault(); const form = event.target;
        if (form.id === "cmBrowseForm") run(() => controller.browse(1, form.elements.state.value));
        else if (form.id === "cmCreateForm") {
            if (get("cmCreateFields").disabled) return;
            const f = form.elements;
            run(() => controller.create({ title: f.title.value.trim(), modeKey: f.modeKey.value, visibility: f.visibility.value, joinPolicy: f.joinPolicy.value,
                teamACapacity: Number(f.teamACapacity.value), teamBCapacity: Number(f.teamBCapacity.value), allowJoinAfterStart: f.allowJoinAfterStart.checked,
                allowSpectators: f.allowSpectators.checked, ...(f.allowSpectators.checked ? { spectatorCapacity: Number(f.spectatorCapacity.value) } : {}),
                region: f.region.value.trim() || null, mapName: f.mapName.value.trim() || null }));
        } else if (form.dataset.cmCreateInvite) {
            const f = form.elements, payload = {};
            if (f.maxUses.value) payload.maxUses = Number(f.maxUses.value);
            if (f.team.value) payload.team = f.team.value;
            if (f.expiresAt.value) { const expiry = new Date(f.expiresAt.value); payload.expiresAt = Number.isFinite(expiry.getTime()) ? expiry.toISOString() : f.expiresAt.value; }
            run(() => controller.action("create_invite", payload));
        } else if (form.dataset.cmJoinInvite) run(() => controller.action("join_with_invite", { inviteCode: form.elements.inviteCode.value.trim(), ...(form.elements.team.value ? { team: form.elements.team.value } : {}) }));
        else if (form.dataset.cmResize) run(() => controller.action("resize", { teamACapacity: Number(form.elements.teamACapacity.value), teamBCapacity: Number(form.elements.teamBCapacity.value) }));
        else if (form.dataset.cmSpectators) run(() => controller.action("set_spectator_settings", { allowSpectators: form.elements.allowSpectators.checked, spectatorCapacity: Number(form.elements.spectatorCapacity.value) }));
        else if (form.dataset.cmVote) {
            const kind = form.querySelector("[data-vote-type]")?.value;
            const vote = kind === "skip" ? { voteType: kind }
                : { voteType: kind, targetMemberCode: form.querySelector("[data-vote-target]")?.value };
            run(() => controller.castVote(controller.state.rounds.find(item => item.roundCode === form.dataset.cmVote), vote));
        } else if (form.dataset.cmSubmitResult) run(() => controller.submitResult(Number(form.elements.teamAScore.value), Number(form.elements.teamBScore.value)));
        else if (form.dataset.cmConfirmResult) run(() => controller.confirmResult(form.elements.resultCode.value.trim()));
    }, { signal: lifetime.signal });
    try {
        await Promise.all([controller.access(), controller.limits(), controller.browse()]);
        const code = new URL(location.href).searchParams.get("match");
        if (code && !lifetime.signal.aborted) await controller.detail(code);
    } catch {
        if (!lifetime.signal.aborted) get("cmAccessStatus").textContent = "Custom Match initialization unavailable. Reload this page to retry.";
    }
}
