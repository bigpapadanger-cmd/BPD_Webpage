"use strict";

export function element(doc, tag, text, className = "") {
    const node = doc.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
}
function button(doc, label, action, payload, disabled) {
    const node = element(doc, "button", label);
    node.type = "button";
    node.dataset.cmAction = action;
    node.dataset.cmPayload = JSON.stringify(payload);
    node.disabled = disabled;
    node.dataset.protected = "true";
    return node;
}
export function basicLifecycleActions(detail) {
    if (detail.actor?.isHost !== true) return [];
    const state = detail.match.state;
    return [
        ...(state === "created" ? [["open", "Open match"]] : []),
        ...(["open", "lobby"].includes(state) ? [["begin_pregame", "Begin pregame"]] : []),
        ...(["created", "open", "lobby", "pregame"].includes(state) ? [["cancel", "Cancel match"]] : []),
        ...(state === "active" ? [["close", "Close match"]] : []),
        ...(state === "results" ? [["archive", "Archive match"]] : [])
    ];
}
export function renderBrowse(doc, container, matches) {
    container.replaceChildren();
    for (const match of matches) {
        const card = element(doc, "article", undefined, "cm-card");
        const body = element(doc, "div", undefined, "cm-card-body");
        body.append(element(doc, "h3", match.title), element(doc, "p", `${match.state} · ${match.modeKey} · ${match.joinPolicy.replaceAll("_", " ")}`),
            element(doc, "p", `Team A ${match.teamACount}/${match.teamACapacity} · Team B ${match.teamBCount}/${match.teamBCapacity}`), element(doc, "p", `Host: ${match.hostDisplayName}`));
        const link = element(doc, "a", "View match");
        link.href = `/RocketLeague/FindCustomMatches?match=${encodeURIComponent(match.matchCode)}`;
        link.dataset.cmOpen = match.matchCode;
        const actions = element(doc, "div", undefined, "cm-card-actions"); actions.append(link);
        card.append(body, actions); container.append(card);
    }
}
export function renderLobby(doc, container, detail, { locked = false, limits = null, runtimeStatus = "offline", runtimeMembers = [] } = {}) {
    container.replaceChildren();
    if (!detail) return;
    const { match, actor, members } = detail;
    const terminal = ["results", "archived", "cancelled"].includes(match.state);
    container.append(element(doc, "h3", match.title), element(doc, "p", `${match.matchCode} · ${match.state} · version ${match.version} · ${match.visibility} · ${match.joinPolicy.replaceAll("_", " ")}`),
        element(doc, "p", `Host: ${match.hostDisplayName}. Host ownership does not depend on being connected to this page.`));
    const permalink = element(doc, "a", "Match link");
    permalink.href = `/RocketLeague/FindCustomMatches?match=${encodeURIComponent(match.matchCode)}`;
    container.append(permalink);
    if (!actor?.isMember && !terminal) {
        const joins = element(doc, "div", undefined, "cm-actions");
        const canJoin = actor?.eligible === true && actor?.canJoin === true && match.joinPolicy === "open"
            && (["open", "lobby", "pregame"].includes(match.state) || (match.state === "active" && match.allowJoinAfterStart));
        joins.append(button(doc, "Join Team A", "join", { team: "a" }, locked || !canJoin || match.teamACount >= match.teamACapacity),
            button(doc, "Join Team B", "join", { team: "b" }, locked || !canJoin || match.teamBCount >= match.teamBCapacity));
        if (match.allowSpectators) joins.append(button(doc, "Join as spectator", "join", { team: "spectator" }, locked || !canJoin || match.spectatorCount >= match.spectatorCapacity));
        container.append(joins);
        if (match.joinPolicy === "approval") {
            joins.append(button(doc, "Request Team A", "request_join", { team: "a" }, locked || actor?.eligible !== true),
                button(doc, "Request Team B", "request_join", { team: "b" }, locked || actor?.eligible !== true));
            if (match.allowSpectators) joins.append(button(doc, "Request spectator place", "request_join", { team: "spectator" }, locked || actor?.eligible !== true || match.spectatorCount >= match.spectatorCapacity));
        }
        if (match.joinPolicy === "invite_only") {
            const form = element(doc, "form"); form.dataset.cmJoinInvite = "true"; form.className = "cm-actions";
            const field = element(doc, "input"); field.name = "inviteCode"; field.pattern = "CMI[A-Za-z0-9]{12}"; field.maxLength = 15; field.required = true; field.autocomplete = "off"; field.disabled = locked;
            const label = element(doc, "label", "Invite code"); label.append(field);
            const teamLabel = element(doc, "label", "Preferred team (the invitation's assigned team takes priority)"); const preferred = element(doc, "select"); preferred.name = "team"; preferred.disabled = locked;
            for (const [value, title] of [["", "Use invitation assignment"], ["a", "Team A"], ["b", "Team B"], ...(match.allowSpectators ? [["spectator", "Spectator"]] : [])]) { const option = element(doc, "option", title); option.value = value; preferred.append(option); }
            teamLabel.append(preferred);
            const join = button(doc, "Join with invite", "", {}, locked || actor?.eligible !== true); delete join.dataset.cmAction; join.type = "submit";
            form.append(label, teamLabel, join); container.append(form);
        }
    }
    if (actor?.isMember && !terminal) {
        const transferRequired = actor.isHost && members.some(member => member.memberCode !== actor.memberCode);
        container.append(button(doc, "Leave match", "leave", {}, locked || transferRequired));
        if (transferRequired) container.append(element(doc, "p", "Transfer host ownership to another active player before leaving."));
    }
    if (actor?.isMember && actor.team !== "spectator" && !terminal) {
        const me = runtimeMembers.find(member => member.memberCode === actor.memberCode);
        const ready = element(doc, "button", me?.ready ? "Mark not ready" : "Ready up"); ready.id = "cmReady"; ready.type = "button"; ready.dataset.runtimeReady = String(!me?.ready);
        ready.dataset.protected = "true";
        ready.disabled = locked || runtimeStatus !== "connected"; container.append(ready);
        const status = element(doc, "p"); status.dataset.runtimeStatus = "true"; status.setAttribute("role", "status"); container.append(status);
    }
    const teams = element(doc, "div", undefined, "cm-teams");
    for (const [team, name, capacity] of [["a", "Team A", match.teamACapacity], ["b", "Team B", match.teamBCapacity], ["spectator", "Spectators", match.spectatorCapacity ?? null]]) {
        const section = element(doc, "section", undefined, "cm-team");
        const list = members.filter(member => member.team === team);
        section.append(element(doc, "h3", `${name} · ${list.length}${capacity === null ? "" : `/${capacity}`}`));
        if (!list.length) section.append(element(doc, "p", "No members yet."));
        for (const member of list) {
            const row = element(doc, "div", undefined, "cm-member");
            row.append(element(doc, "span", `${member.displayName}${member.memberRole === "host" ? " · Host" : ""}`));
            const live = runtimeMembers.find(item => item.memberCode === member.memberCode);
            const presence = element(doc, "span", live ? `${live.connected ? "Connected" : "Disconnected"} · ${live.ready ? "Ready" : "Not ready"}` : "Presence unavailable");
            presence.dataset.runtimeMember = member.memberCode; row.append(presence);
            if (actor?.isHost && !terminal) {
                const label = element(doc, "label", `Team for ${member.displayName}`);
                const select = element(doc, "select");
                select.dataset.cmAssign = member.memberCode;
                select.dataset.protected = "true";
                for (const [value, text] of [["a", "Team A"], ["b", "Team B"], ["spectator", "Spectator"]]) {
                    if (value === "spectator" && !match.allowSpectators) continue;
                    const option = element(doc, "option", text); option.value = value; select.append(option);
                }
                select.value = member.team; select.disabled = locked;
                label.append(select); row.append(label);
                if (member.memberCode !== actor.memberCode) {
                    row.append(button(doc, "Kick member", "kick_member", { memberCode: member.memberCode }, locked));
                    if (member.team !== "spectator") row.append(button(doc, "Transfer host", "transfer_host", { memberCode: member.memberCode }, locked));
                }
            }
            section.append(row);
        }
        teams.append(section);
    }
    container.append(teams);
    if (actor?.isHost) {
        const controls = element(doc, "section"); controls.append(element(doc, "h3", "Host controls"));
        const actions = element(doc, "div", undefined, "cm-actions");
        for (const [action, label] of basicLifecycleActions(detail)) actions.append(button(doc, label, action, {}, locked));
        const players = runtimeMembers.filter(member => member.team === "a" || member.team === "b");
        const ready = players.length > 0 && players.some(member => member.team === "a") && players.some(member => member.team === "b")
            && players.every(member => member.connected && member.ready);
        const start = button(doc, "Start match", "start", {}, locked || runtimeStatus !== "connected" || !ready);
        start.dataset.runtimeStart = "true";
        actions.append(start); controls.append(actions);
        if (!terminal && limits?.maxSpectatorCapacity && Number.isSafeInteger(match.spectatorCapacity)) {
            const form = element(doc, "form"); form.dataset.cmSpectators = "true"; form.className = "cm-actions";
            const label = element(doc, "label", "Allow spectators"); const enabled = element(doc, "input"); enabled.type = "checkbox"; enabled.name = "allowSpectators"; enabled.checked = match.allowSpectators === true; enabled.disabled = locked; label.append(enabled);
            const capacityLabel = element(doc, "label", "Spectator capacity"); const capacity = element(doc, "input"); capacity.type = "number"; capacity.name = "spectatorCapacity"; capacity.min = String(Math.max(1, match.spectatorCount)); capacity.max = String(limits.maxSpectatorCapacity); capacity.value = String(match.spectatorCapacity); capacity.required = true; capacity.disabled = locked; capacityLabel.append(capacity);
            const save = element(doc, "button", "Save spectator settings"); save.type = "submit"; save.disabled = locked;
            form.append(label, capacityLabel, save); controls.append(form);
        }
        if (["created", "open", "lobby", "pregame"].includes(match.state)) {
            const form = element(doc, "form"); form.dataset.cmResize = "true"; form.className = "cm-actions";
            for (const [key, text, value, count] of [["teamACapacity", "Team A capacity", match.teamACapacity, match.teamACount], ["teamBCapacity", "Team B capacity", match.teamBCapacity, match.teamBCount]]) {
                const label = element(doc, "label", text); const input = element(doc, "input");
                input.name = key; input.type = "number"; input.min = String(Math.max(1, count)); input.step = "1"; input.value = String(value); input.required = true;
                if (limits) input.max = String(limits.maxTeamCapacity); input.disabled = locked || !limits; input.dataset.protected = "true";
                label.append(input); form.append(label);
            }
            const save = element(doc, "button", "Save capacities"); save.type = "submit"; save.disabled = locked || !limits; save.dataset.protected = "true"; form.append(save); controls.append(form);
            const policyLabel = element(doc, "label", "Join policy"); const policy = element(doc, "select"); policy.dataset.cmPolicy = "true"; policy.dataset.protected = "true"; policy.disabled = locked;
            for (const value of ["open", "invite_only", "approval"]) { const option = element(doc, "option", value.replaceAll("_", " ")); option.value = value; policy.append(option); }
            policy.value = match.joinPolicy; policyLabel.append(policy); controls.append(policyLabel);
            controls.append(button(doc, match.allowJoinAfterStart ? "Disable late joins" : "Allow late joins", "set_allow_join_after_start", { allowJoinAfterStart: !match.allowJoinAfterStart }, locked));
        }
        container.append(controls);
    }
}

export function updateLobbyRuntime(container, state, locked) {
    const members = new Map(state.runtimeMembers.map(item => [item.memberCode, item]));
    for (const node of container.querySelectorAll("[data-runtime-member]")) {
        const member = members.get(node.dataset.runtimeMember);
        node.textContent = member ? `${member.connected ? "Connected" : "Disconnected"} · ${member.ready ? "Ready" : "Not ready"}` : "Presence unavailable";
    }
    const ready = container.querySelector("#cmReady");
    if (ready) {
        const mine = members.get(state.detail?.actor?.memberCode);
        ready.textContent = mine?.ready ? "Mark not ready" : "Ready up";
        ready.dataset.runtimeReady = String(!mine?.ready); ready.disabled = locked || state.runtimeStatus !== "connected";
    }
    const status = container.querySelector("[data-runtime-status]");
    if (status) status.textContent = state.runtimeStatus === "connected" ? "Lobby presence is connected." : "Live lobby unavailable or connecting. Use Refresh match to retry.";
    const start = container.querySelector("[data-runtime-start]");
    if (start) {
        const players = state.runtimeMembers.filter(item => ["a", "b"].includes(item.team));
        start.disabled = locked || state.runtimeStatus !== "connected" || !players.some(item => item.team === "a")
            || !players.some(item => item.team === "b") || !players.every(item => item.connected && item.ready);
    }
}

export function renderHostManagement(doc, container, state, { locked = false } = {}) {
    container.replaceChildren();
    if (!state.access || state.accessPending || state.detail?.actor?.isHost !== true) return;
    const pending = state.hostListsPending, disabled = locked || pending;
    container.append(element(doc, "h3", "Invites and membership"));
    const refresh = element(doc, "button", pending ? "Loading host lists…" : "Refresh host lists");
    refresh.id = "cmRefreshHostLists"; refresh.type = "button"; refresh.disabled = pending || state.busy; container.append(refresh);
    const section = (title, key, rows) => {
        const panel = element(doc, "details", undefined, "cm-card");
        panel.append(element(doc, "summary", `${title}${pending ? "" : state.hostListStatus?.[key] === "unavailable" ? " · Unavailable" : ` (${rows.length})`}`));
        if (pending) panel.append(element(doc, "p", "Loading…"));
        else if (state.hostListMessages[key]) panel.append(element(doc, "p", state.hostListMessages[key]));
        container.append(panel); return panel;
    };
    const invites = section("Outstanding invites", "invites", state.invites);
    if (!["results", "archived", "cancelled"].includes(state.detail.match.state)) {
        const form = element(doc, "form"); form.dataset.cmCreateInvite = "true";
        const fields = element(doc, "fieldset"); fields.disabled = disabled; fields.className = "cm-form-grid";
        const uses = element(doc, "input"); uses.name = "maxUses"; uses.type = "number"; uses.min = "1"; uses.max = "100"; uses.step = "1";
        const usesLabel = element(doc, "label", "Maximum uses (optional)"); usesLabel.append(uses);
        const expiry = element(doc, "input"); expiry.name = "expiresAt"; expiry.type = "datetime-local";
        const expiryLabel = element(doc, "label", "Expires at (your local time, optional)"); expiryLabel.append(expiry);
        const teamSelect = element(doc, "select"); teamSelect.name = "team";
        for (const [value, label] of [["", "No assigned team"], ["a", "Team A"], ["b", "Team B"], ["spectator", "Spectator"]]) {
            if (value === "spectator" && !state.detail.match.allowSpectators) continue;
            const option = element(doc, "option", label); option.value = value; teamSelect.append(option);
        }
        const teamLabel = element(doc, "label", "Intended team"); teamLabel.append(teamSelect);
        const create = button(doc, "Create general invite", "", {}, disabled); delete create.dataset.cmAction; create.type = "submit";
        fields.append(usesLabel, expiryLabel, teamLabel, create); form.append(fields); invites.append(form);
        invites.append(element(doc, "p", "Targeted invites are not available yet."));
    }
    for (const invite of state.invites) {
        const row = element(doc, "article", undefined, "cm-card");
        row.append(element(doc, "h4", invite.targetDisplayName ?? "Invite"), element(doc, "code", invite.inviteCode),
            element(doc, "p", `Team: ${invite.intendedTeam ?? "—"} · Used ${invite.useCount} · Remaining ${invite.remainingUses ?? "—"} · Expires ${invite.expiresAt ?? "—"}`));
        const copy = element(doc, "button", "Copy invite code"); copy.type = "button"; copy.dataset.cmCopyInvite = invite.inviteCode;
        row.append(copy, button(doc, "Revoke invite", "revoke_invite", { inviteCode: invite.inviteCode }, disabled)); invites.append(row);
    }
    const requests = section("Pending join requests", "joinRequests", state.joinRequests);
    for (const request of state.joinRequests) {
        const row = element(doc, "article", undefined, "cm-card");
        row.append(element(doc, "h4", request.displayName ?? "Player"), element(doc, "p", `Requested team: ${request.requestedTeam ?? "Not assigned"} · ${request.requestedAt}`));
        row.append(button(doc, "Approve Team A", "approve_join", { requestCode: request.requestCode, team: "a" }, disabled),
            button(doc, "Approve Team B", "approve_join", { requestCode: request.requestCode, team: "b" }, disabled),
            button(doc, "Reject request", "reject_join", { requestCode: request.requestCode }, disabled)); requests.append(row);
        if (request.requestedTeam === "spectator") {
            row.querySelectorAll("button").forEach(node => { if (node.dataset.cmAction === "approve_join") node.remove(); });
            row.append(button(doc, "Approve spectator", "approve_join", { requestCode: request.requestCode, team: "spectator" }, disabled || !state.detail.match.allowSpectators || state.detail.match.spectatorCount >= state.detail.match.spectatorCapacity));
        }
    }
    const history = section("Former members", "memberHistory", state.memberHistory);
    for (const member of state.memberHistory) {
        const row = element(doc, "article", undefined, "cm-card");
        row.append(element(doc, "h4", member.displayName ?? "Former player"), element(doc, "p", `${member.team ?? "No team"} · ${member.memberRole} · ${member.departureReason?.replaceAll("_", " ") ?? "Reason unavailable"}`),
            element(doc, "p", `Joined ${member.joinedAt} · Left ${member.leftAt}`));
        if (member.kickedByDisplayName !== null) row.append(element(doc, "p", `Removed by ${member.kickedByDisplayName}`));
        if (member.rejoinAllowedAt) row.append(element(doc, "p", `Rejoin authorized ${member.rejoinAllowedAt}. Original departure history is retained.`));
        if (member.departureReason === "kicked" || member.canAllowRejoin) row.append(button(doc, "Allow rejoin", "allow_rejoin", { memberCode: member.memberCode }, disabled || !member.canAllowRejoin));
        history.append(row);
    }
}

export function renderCredentials(doc, container, state) {
    container.replaceChildren();
    const detail = state.detail;
    if (!detail || !(detail.actor?.isHost || detail.actor?.isMember) || ["results", "archived", "cancelled"].includes(detail.match.state)) return;
    container.append(element(doc, "h3", "Private Rocket League lobby"), element(doc, "p", "The host creates this lobby manually in Rocket League. Credentials are never a public match identifier."));
    const show = element(doc, "button", state.credentialsPending ? "Checking lobby access…" : "Show lobby credentials");
    show.type = "button"; show.id = "cmShowCredentials"; show.dataset.protected = "true";
    show.disabled = state.busy || state.credentialsPending || !state.access || state.accessPending || Boolean(state.retry);
    container.append(show);
    if (state.credentialsMessage) container.append(element(doc, "p", state.credentialsMessage));
    if (state.credentials) {
        // Secrets are transient DOM text only, never attributes, links, datasets or input defaults.
        container.append(element(doc, "p", `Lobby name: ${state.credentials.lobbyName}`), element(doc, "p", `Lobby password: ${state.credentials.lobbyPassword}`));
        const hide = element(doc, "button", "Hide credentials"); hide.type = "button"; hide.id = "cmHideCredentials"; container.append(hide);
    }
}

export function renderRounds(doc, container, state, { locked = false } = {}) {
    container.replaceChildren();
    const detail = state.detail;
    if (!detail) return;
    const host = detail.actor?.isHost === true, matchCode = detail.match.matchCode;
    container.append(element(doc, "h3", "Rounds"), element(doc, "p", state.roundsMessage || "Round data has not loaded."));
    const refresh = element(doc, "button", "Refresh rounds"); refresh.id = "cmRefreshRounds"; refresh.type = "button"; refresh.disabled = state.roundsPending; container.append(refresh);
    if (detail.match.roundBased && detail.match.state === "active" && host) {
        const begin = button(doc, "Begin next round", "begin_round", {}, locked || state.roundsPending); container.append(begin);
    }
    for (const round of state.rounds) {
        const card = element(doc, "article", undefined, "cm-card");
        card.append(element(doc, "h4", `Round ${round.roundNumber} · ${round.state}`));
        if (round.outcomeType) card.append(element(doc, "p", `Outcome: ${round.outcomeType}${round.outcomeKey ? ` · ${round.outcomeKey}` : ""}`));
        if (host && round.state === "active") card.append(button(doc, "Open voting", "open_vote", { roundCode: round.roundCode }, locked || !Number.isSafeInteger(round.roundVersion)));
        if (host && round.state === "voting") card.append(button(doc, "Resolve vote", "resolve_vote", { roundCode: round.roundCode }, locked || !Number.isSafeInteger(round.roundVersion)));
        if (round.state === "voting" && detail.actor?.isMember && detail.actor.team !== "spectator") {
            const form = element(doc, "form"); form.dataset.cmVote = round.roundCode; form.className = "cm-actions";
            const type = element(doc, "select"); type.dataset.voteType = "true";
            type.setAttribute("aria-label", "Vote choice");
            for (const [value, label] of [["player_target", "Choose a player"], ["skip", "Skip"]]) { const option = element(doc, "option", label); option.value = value; type.append(option); }
            const target = element(doc, "select"); target.dataset.voteTarget = "true";
            target.setAttribute("aria-label", "Player to vote for");
            for (const member of detail.members.filter(member => member.team !== "spectator")) { const option = element(doc, "option", member.displayName); option.value = member.memberCode; target.append(option); }
            target.hidden = type.value !== "player_target";
            const submit = button(doc, "Submit vote", "", {}, locked); delete submit.dataset.cmAction; submit.dataset.cmVoteSubmit = "true";
            submit.type = "submit";
            form.append(type, target, submit);
            card.append(element(doc, "p", "Choose a player or skip. A new accepted ballot replaces your previous ballot."), form);
        }
        const read = button(doc, "View resolved vote", "read_vote_result", { roundCode: round.roundCode }, false); card.append(read);
        const result = state.voteResults?.[round.roundCode];
        if (result?.resolved === true) card.append(element(doc, "p", `Resolved · ${result.result.totalVotesCast} votes · ${result.result.winningVoteCount} winning votes`));
        else if (result) card.append(element(doc, "p", "Voting result is not resolved yet."));
        container.append(card);
    }
}

export function renderPlayerResults(doc, container, state, { locked = false } = {}) {
    container.replaceChildren();
    const detail = state.detail;
    if (!detail) return;
    container.append(element(doc, "h3", "Player results"), element(doc, "p", state.resultMessage || "No results loaded."));
    if (state.lastResultCode) container.append(element(doc, "p", `Share this result reference with the other team: ${state.lastResultCode}`));
    const refresh = element(doc, "button", "Refresh player results"); refresh.id = "cmRefreshResults"; refresh.type = "button"; refresh.disabled = state.resultPending; container.append(refresh);
    if (detail.match.state === "active" && detail.actor?.isMember && detail.actor.team !== "spectator") {
        const form = element(doc, "form"); form.dataset.cmSubmitResult = "true"; form.className = "cm-actions";
        for (const [name, label] of [["teamAScore", "Team A score"], ["teamBScore", "Team B score"]]) {
            const field = element(doc, "input"); field.name = name; field.type = "number"; field.min = "0"; field.step = "1"; field.required = true; field.maxLength = 6;
            const wrapper = element(doc, "label", label); wrapper.append(field); form.append(wrapper);
        }
        const submit = button(doc, "Submit result", "", {}, locked); delete submit.dataset.cmAction; submit.dataset.cmResultSubmit = "true";
        form.append(submit); container.append(form);
    }
    if (["results", "archived"].includes(detail.match.state) && detail.actor?.isMember) {
        const form = element(doc, "form"); form.dataset.cmConfirmResult = "true"; form.className = "cm-actions";
        const field = element(doc, "input"); field.name = "resultCode"; field.pattern = "CMR[A-Za-z0-9]{8}"; field.maxLength = 11; field.required = true; field.autocomplete = "off"; field.value = state.lastResultCode || "";
        const label = element(doc, "label", "Result code from the submitting team"); label.append(field);
        const confirm = button(doc, "Confirm result", "", {}, locked); delete confirm.dataset.cmAction; confirm.dataset.cmResultConfirm = "true";
        form.append(label, confirm); container.append(form);
    }
    for (const player of state.playerResults) {
        const row = element(doc, "article", undefined, "cm-card");
        row.append(element(doc, "h4", `${player.displayName} · ${player.outcome}`), element(doc, "p", `${player.team === "a" ? "Team A" : "Team B"} · Score ${player.teamScore ?? "—"} · Opponent ${player.opponentScore ?? "—"} · Goals ${player.goals ?? "—"} · Assists ${player.assists ?? "—"} · Saves ${player.saves ?? "—"}`));
        if (player.modeResult !== null && player.modeResult !== undefined) row.append(element(doc, "p", "Mode-specific result is unavailable."));
        container.append(row);
    }
}
