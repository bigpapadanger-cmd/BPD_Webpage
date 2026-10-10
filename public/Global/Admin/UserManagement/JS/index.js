"use strict";
import { boundedJson } from "/scripts/boundedRequest.js";
import { apiFetch } from "/scripts/apiConnection.js";
import { initializeAdminAccordions } from "../../Shared/JS/accordion.js";
const initializedPages = new WeakSet();

const PAGE_SIZE = 30;
const STATUS_LABELS = { active: "Active", inactive: "Inactive", suspended: "Suspended", banned: "Banned", removed: "Removed" };
const PROVIDER_LABELS = { epic: "Epic", discord: "Discord", google: "Google", steam: "Steam" };
const state = { tab: "users", page: 1, busy: false, openId: null, list: null, detail: null, notes: [], detailHistory: [], instance: 0 };
let listGeneration = 0;
let pageLifetime;

const byId = id => document.getElementById(id);
const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined && text !== null) node.textContent = String(text); return node; };
const date = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : "Not recorded";
function status(message, type = "info") { const node = byId("umStatus"); if (!node) return; node.textContent = message; node.dataset.state = type; }
function setBusy(value) {
    state.busy = value;
    document.querySelectorAll(".um-action-form button, .um-action-form input, .um-action-form select, .um-action-form textarea, #umRefresh, #umTabs button").forEach(node => { node.disabled = value; });
}

async function request(path, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
        const { response, payload } = await boundedJson(path, { credentials: "same-origin", cache: "no-store", ...options, signal: pageLifetime?.signal ?? controller.signal }, { fetcher: apiFetch });
        if (!response.ok || payload?.success !== true) throw new Error(payload?.message || "The request could not be completed.");
        return payload;
    } catch (error) {
        if (error?.name === "AbortError") throw new Error("The request timed out. Try again.");
        throw error;
    } finally { clearTimeout(timer); }
}

function queryString() {
    const form = byId("umFilters");
    const params = new URLSearchParams(new FormData(form));
    params.set("page", String(state.page));
    if (state.tab === "suspended") params.set("status", "suspended");
    if (state.tab === "banned") params.set("status", "banned");
    return params.toString();
}

async function loadList() {
    const instance = state.instance;
    const generation = ++listGeneration;
    state.page = Math.max(1, state.page);
    status("Loading accounts…");
    byId("umUsers").hidden = false;
    byId("umHistory").hidden = true;
    try {
        const list = await request(`/api/admin/user-management?${queryString()}`);
        if (instance !== state.instance || generation !== listGeneration) return;
        state.list = list;
        renderList();
        status(`${state.list.pagination.total.toLocaleString()} accounts · ${state.list.permissions.role ? state.list.permissions.role.toUpperCase() : "No management role"}`, "success");
    } catch (error) { if (instance === state.instance && generation === listGeneration) { byId("umUsers").replaceChildren(el("p", "um-empty", error.message)); status(error.message, "error"); } }
}

function renderList() {
    const target = byId("umUsers");
    target.replaceChildren();
    const rows = state.list.users;
    if (!rows.length) target.append(el("p", "um-empty", "No accounts match these filters."));
    rows.forEach(user => target.append(renderUser(user)));
    const pagination = state.list.pagination;
    byId("umPagination").hidden = false;
    byId("umPrevious").disabled = state.page <= 1;
    byId("umNext").disabled = !pagination.hasMore;
    byId("umPageLabel").textContent = `Page ${state.page} · ${pagination.total.toLocaleString()} accounts`;
}

function renderUser(user) {
    const card = el("article", "um-card");
    const summary = el("button", "um-card-summary");
    summary.type = "button";
    summary.setAttribute("aria-expanded", String(state.openId === user.accountId));
    const main = el("span", "um-card-main");
    main.append(el("span", "um-card-title", user.displayName || "Unnamed account"));
    const meta = el("span", "um-card-meta");
    const chip = el("span", "um-chip", STATUS_LABELS[user.status] || user.status); chip.dataset.status = user.status; meta.append(chip);
    meta.append(el("span", "um-chip", user.role ? user.role.toUpperCase() : "No management role"));
    user.providers.forEach(provider => {
        const badge = el("span", "um-provider");
        const icons = { epic: "/Assets/images/framework_icons/epic-symbol-white.svg", discord: "/Assets/images/framework_icons/discord-symbol-white.png", google: "/Assets/images/framework_icons/google-symbol-white.png" };
        if (icons[provider]) { const icon = el("img"); icon.src = icons[provider]; icon.alt = ""; icon.width = 16; icon.height = 16; badge.append(icon); }
        badge.append(document.createTextNode(PROVIDER_LABELS[provider] || provider));
        badge.setAttribute("aria-label", `${PROVIDER_LABELS[provider] || provider} connected`); meta.append(badge);
    });
    meta.append(el("span", "um-muted", `Created ${date(user.createdAt)}`));
    meta.append(el("span", "um-muted", `Last seen ${date(user.lastSeenAt)}`));
    meta.append(el("span", "um-muted", user.rocketLeague.exists ? `RL account · ${user.rocketLeague.active ? "active" : "disabled"}` : "No RL account"));
    meta.append(el("span", "um-muted", `Registration ${user.rocketLeague.registrationStatus || "unknown"}`));
    meta.append(el("span", "um-muted", `${user.moderation.historyCount} history records`));
    main.append(meta); summary.append(main, el("span", "um-card-toggle", state.openId === user.accountId ? "Close details" : "View details"));
    summary.addEventListener("click", () => toggleDetails(user.accountId));
    card.append(summary);
    if (state.openId === user.accountId) {
        const detail = el("div", "um-detail");
        if (state.detail) detail.append(renderDetail(state.detail));
        else detail.append(el("p", "um-muted", "Loading account details…"));
        card.append(detail);
    }
    return card;
}

async function toggleDetails(accountId) {
    if (state.busy) return;
    if (state.openId === accountId) { state.openId = null; state.detail = null; updateDetails(); return; }
    const instance = state.instance;
    state.openId = accountId; state.detail = null; state.notes = []; state.detailHistory = []; updateDetails();
    try {
        const [detail, notes, history] = await Promise.all([
            request(`/api/admin/user-management/${encodeURIComponent(accountId)}`),
            request(`/api/admin/user-management/${encodeURIComponent(accountId)}/notes`),
            request(`/api/admin/user-management/history?targetAccountId=${encodeURIComponent(accountId)}&page=1`)
        ]);
        if (instance !== state.instance || state.openId !== accountId) return;
        state.detail = detail; state.notes = notes.notes; state.detailHistory = history.events; updateDetails();
    } catch (error) { if (instance === state.instance && state.openId === accountId) { state.detail = { error: error.message }; updateDetails(); } }
}

function updateDetails() {
    for (const [index, card] of [...byId("umUsers").children].entries()) {
        const open = state.list?.users[index]?.accountId === state.openId;
        const summary = card.querySelector(".um-card-summary");
        if (!summary) continue;
        summary.setAttribute("aria-expanded", String(open));
        card.querySelector(".um-card-toggle").textContent = open ? "Close details" : "View details";
        card.querySelector(".um-detail")?.remove();
        if (open) { const box = el("div", "um-detail"); box.append(state.detail ? renderDetail(state.detail) : el("p", "um-muted", "Loading account details…")); card.append(box); }
    }
}

function section(title, entries) {
    const box = el("section", "um-section"); box.append(el("h3", "", title));
    const dl = el("dl", "um-kv");
    for (const [key, value] of entries) { const term = el("dt", "", key), description = el("dd", "", value === null || value === undefined || value === "" ? "Not recorded" : typeof value === "boolean" ? value ? "Yes" : "No" : value); dl.append(term, description); }
    box.append(dl); return box;
}

function renderDetail(detail) {
    if (detail.error) return el("p", "um-status", detail.error);
    const grid = el("div", "um-detail-grid");
    const account = detail.account, rl = detail.rocketLeague, permissions = detail.permissions;
    grid.append(section("Account", [["Display name", account.displayName], ["Active", account.active ? "Yes" : "No"], ["Management role", account.managementRole || "None"], ["Created", date(account.createdAt)], ["Last seen", date(account.lastSeenAt)]]));
    grid.append(section("Connected Accounts", detail.providers.map(provider => ["Provider", provider.provider])));
    grid.append(section("Rocket League", [["Profile exists", rl.exists ? "Yes" : "No"], ["Active", rl.active ? "Yes" : "No"], ["Role", rl.role], ["Platform", rl.primaryPlatform || rl.rlPlatform], ["Registration", rl.registration?.status], ["Registration completed", date(rl.registration?.completedAt)]]));
    grid.append(section("Preferences", [["Find Players visibility", rl.preferences?.findProfileEnabled], ["Share online status", rl.preferences?.showOnlineStatus]]));
    grid.append(section("Presence", [["Rocket League presence", rl.presence?.state], ["Checked", date(rl.presence?.checkedAt)], ["MMR refreshed", date(rl.refresh?.mmrLastSuccessAt)], ["Career stats refreshed", date(rl.refresh?.careerStatsLastSuccessAt)]]));
    grid.append(section("Moderation", [["Suspended", detail.moderation.suspended ? "Yes" : "No"], ["Suspension reason", detail.moderation.suspension?.reason], ["Suspension ends", date(detail.moderation.suspension?.expiresAt)], ["Banned", detail.moderation.banned ? "Yes" : "No"], ["Ban reason", detail.moderation.ban?.reason], ["Removed", detail.moderation.removed ? "Yes" : "No"], ["History entries", detail.moderation.historyCount]]));
    grid.append(renderNotes(detail, permissions));
    const history = el("section", "um-section um-event-section"); history.append(el("h3", "", "Account activity"));
    if (!state.detailHistory.length) history.append(el("p", "um-muted", "No history entries."));
    else {
        const events = el("ol", "um-event-list");
        for (const item of state.detailHistory) {
            const event = el("li", "um-event");
            event.append(el("strong", "", item.eventType.replaceAll("_", " ")), el("time", "um-muted", date(item.occurredAt)));
            if (item.reason) event.append(el("p", "", item.reason));
            event.append(el("span", "um-muted", `By ${item.actorDisplayName || "System"}`)); events.append(event);
        }
        history.append(events);
    }
    grid.append(history);
    const actions = renderActions(detail, permissions);
    const wrap = el("div", "um-account-detail"); wrap.append(actions, grid); return wrap;
}

function renderNotes(detail, permissions) {
    const box = el("section", "um-section"); box.append(el("h3", "", "Admin Notes"));
    if (state.notes.length) state.notes.forEach(note => box.append(el("p", "um-note", `${note.note} · ${note.createdByDisplayName || "Staff"} · ${date(note.createdAt)}`)));
    else box.append(el("p", "um-muted", "No notes."));
    if (permissions.canAddNote) box.append(actionForm("add-note", [{ name: "note", label: "Add note", type: "textarea", required: true }], "Save note"));
    return box;
}

function actionForm(action, fields, label, extra = {}) {
    const form = el("form", "um-action-form"); form.dataset.action = action;
    fields.forEach(field => {
        const wrapper = el("label", "", field.label); let input;
        if (field.type === "select") { input = el("select"); (field.options || []).forEach(([value, name]) => { const option = el("option", "", name); option.value = value; input.append(option); }); }
        else if (field.type === "textarea") input = el("textarea");
        else { input = el("input"); input.type = field.type || "text"; }
        input.name = field.name; if (field.required) input.required = true; if (field.maxLength) input.maxLength = field.maxLength;
        input.disabled = state.busy;
        wrapper.append(input); form.append(wrapper);
    });
    const submit = el("button", "um-button", label); submit.type = "submit"; submit.disabled = state.busy; form.append(submit);
    if (extra.danger) { form.dataset.confirm = extra.confirm || "Confirm this action?"; submit.dataset.danger = "true"; }
    form.addEventListener("submit", handleMutation); return form;
}

function renderActions(detail, permissions) {
    const box = el("section", "um-section um-account-actions"); box.append(el("h3", "", "Account actions"), el("p", "um-muted", "Available controls depend on your permissions and this account’s current state. Changes require a reason and are recorded in history."));
    const actorRole = state.list?.permissions?.role;
    if (permissions.canSuspend && !detail.moderation.suspended && !detail.moderation.banned && !detail.moderation.removed)
            box.append(actionForm("suspend", [{ name: "durationDays", label: "Duration", type: "select", options: [3,7,14,21,30,60,90,180,360].map(day => [String(day), `${day} days`]) }, { name: "reason", label: "Reason", required: true }], "Suspend account", { danger: true, confirm: "Suspend this account for the selected duration?" }));
    if (permissions.canLiftSuspension && detail.moderation.suspended) box.append(actionForm("lift-suspension", [{ name: "reason", label: "Reason", required: true }], "Lift suspension"));
    if (rlExists(detail)) {
        const rlOptions = [];
        if (detail.rocketLeague.active && permissions.canDisableRocketLeague) rlOptions.push(["false", "Disable Rocket League"]);
        if (!detail.rocketLeague.active && permissions.canEnableRocketLeague) rlOptions.push(["true", "Enable Rocket League"]);
        if (rlOptions.length) box.append(actionForm("set-rl-active", [{ name: "active", label: "Rocket League account", type: "select", options: rlOptions }, { name: "reason", label: "Reason", required: true }], "Update RL access"));
    }
    if (permissions.canBan && !detail.moderation.banned && !detail.moderation.removed) box.append(actionForm("ban", [{ name: "reason", label: "Permanent ban reason", required: true }], "Permanently ban", { danger: true, confirm: "Permanently ban this account? This creates identity restrictions." }));
    if (permissions.canReinstate && detail.moderation.banned) box.append(actionForm("reinstate", [{ name: "reason", label: "Reason", required: true }], "Reinstate account", { danger: true }));
    if (permissions.canRemove && !detail.moderation.removed) box.append(actionForm("remove", [{ name: "reason", label: "Removal reason", required: true }], "Remove account", { danger: true, confirm: "Soft-remove this account? This disables the BPD account and Rocket League account and creates identity restrictions. Records are retained; this is not a hard delete." }));
    const adminCannotManageAdmin = actorRole === "admin" && detail.account.managementRole === "admin";
    if (permissions.canManage && !detail.moderation.removed && !adminCannotManageAdmin) {
        const roleOptions = [];
        const mayRemoveCurrentRole = Boolean(detail.account.managementRole) && (actorRole === "owner" || (actorRole === "admin" && detail.account.managementRole !== "admin"));
        if (mayRemoveCurrentRole) roleOptions.push(["", "Remove management role"]);
        roleOptions.push(["staff", "Staff"], ["moderator", "Moderator"]);
        if (actorRole === "owner") roleOptions.push(["admin", "Admin"]);
        box.append(actionForm("set-role", [{ name: "role", label: "Management role", type: "select", options: roleOptions }, { name: "reason", label: "Reason", required: true }], "Update role", { danger: true, confirm: "Change this account's User Management role?" }));
    }
    const controls = [...box.querySelectorAll("form")];
    if (!controls.length) box.append(el("p", "um-muted", "No management actions are available for this account."));
    else {
        const grid = el("div", "um-action-grid");
        for (const form of controls) {
            const action = el("details", "um-action-choice");
            action.append(el("summary", "", form.querySelector('button[type="submit"]').textContent));
            if (form.dataset.action === "remove") action.append(el("p", "um-muted", "Soft removal disables access and retains records. This does not permanently delete the account."));
            action.append(form); grid.append(action);
        }
        box.append(grid);
    }
    return box;
}
function rlExists(detail) { return detail.rocketLeague?.exists === true; }

async function handleMutation(event) {
    event.preventDefault();
    if (state.busy || !state.openId) return;
    const instance = state.instance;
    const form = event.currentTarget;
    if (form.dataset.confirm && !window.confirm(form.dataset.confirm)) return;
    const data = new FormData(form), body = { action: form.dataset.action };
    for (const [key, raw] of data.entries()) body[key] = key === "durationDays" ? Number(raw) : key === "active" ? raw === "true" : String(raw);
    setBusy(true); status("Saving change…");
    try {
        const suffix = body.action === "add-note" ? "notes" : "actions";
        await request(`/api/admin/user-management/${encodeURIComponent(state.openId)}/${suffix}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        if (instance !== state.instance) return;
        status("Change saved.", "success");
        await Promise.all([loadList(), toggleDetailsAfterMutation(state.openId)]);
    } catch (error) { if (instance === state.instance) status(error.message, "error"); }
    finally { setBusy(false); }
}

async function toggleDetailsAfterMutation(accountId) {
    try {
        const [detail, notes, history] = await Promise.all([
            request(`/api/admin/user-management/${encodeURIComponent(accountId)}`),
            request(`/api/admin/user-management/${encodeURIComponent(accountId)}/notes`),
            request(`/api/admin/user-management/history?targetAccountId=${encodeURIComponent(accountId)}&page=1`)
        ]);
        state.openId = accountId; state.detail = detail; state.notes = notes.notes; state.detailHistory = history.events; renderList();
    } catch (error) { state.detail = { error: error.message }; renderList(); }
}

async function loadHistory() {
    const instance = state.instance;
    const generation = ++listGeneration;
    status("Loading management history…"); byId("umHistory").hidden = false; byId("umUsers").hidden = true; byId("umPagination").hidden = true;
    try {
        const result = await request(`/api/admin/user-management/history?page=${state.page}`);
        if (instance !== state.instance || generation !== listGeneration) return;
        const list = byId("umHistory"); list.replaceChildren();
        if (!result.events.length) list.append(el("p", "um-empty", "No management history yet."));
        result.events.forEach(event => {
            const card = el("article", "um-card um-history-card");
            card.append(el("strong", "", event.targetDisplayName || "Account activity"), el("p", "um-card-meta", `${event.eventType} · ${date(event.occurredAt)}`));
            if (event.reason) card.append(el("p", "", event.reason));
            card.append(el("p", "um-muted", `By ${event.actorDisplayName || "System"}`)); list.append(card);
        });
        byId("umPagination").hidden = false; byId("umPrevious").disabled = state.page <= 1; byId("umNext").disabled = !result.pagination.hasMore; byId("umPageLabel").textContent = `Page ${state.page} · ${result.pagination.total.toLocaleString()} events`;
        status(`${result.pagination.total.toLocaleString()} history events`, "success");
    } catch (error) { if (instance === state.instance && generation === listGeneration) { byId("umHistory").replaceChildren(el("p", "um-empty", error.message)); status(error.message, "error"); } }
}

async function loadCurrent() { if (state.tab === "history") return loadHistory(); return loadList(); }

export async function initializePage() {
    const root = document.querySelector(".admin-user-management");
    if (!root) return;
    pageLifetime?.abort();
    pageLifetime = new AbortController();
    const lifetime = pageLifetime;
    document.addEventListener("bpd:page-loaded", () => { if (!root.isConnected) { lifetime.abort(); state.instance++; listGeneration++; } }, { signal: lifetime.signal });
    window.addEventListener("pagehide", () => lifetime.abort(), { signal: lifetime.signal });
    initializeAdminAccordions(root);
    if (initializedPages.has(root)) { await loadCurrent(); return; }
    initializedPages.add(root);
    state.instance++; state.tab = "users"; state.page = 1; state.busy = false; state.openId = null; state.list = null; state.detail = null; state.notes = []; state.detailHistory = [];
    byId("umFilters").addEventListener("submit", event => { event.preventDefault(); state.page = 1; loadCurrent(); });
    byId("umRefresh").addEventListener("click", loadCurrent);
    byId("umTabs").addEventListener("click", event => {
        const button = event.target.closest("[data-tab]"); if (!button || state.busy) return;
        state.tab = button.dataset.tab; state.page = 1;
        root.querySelectorAll("[data-tab]").forEach(tab => tab.setAttribute("aria-pressed", String(tab === button)));
        byId("umFilters").hidden = state.tab === "history";
        byId("umFilterSection").hidden = state.tab === "history";
        const statusFilter = byId("umFilters").elements.namedItem("status");
        if (state.tab === "suspended" || state.tab === "banned") { statusFilter.value = state.tab; statusFilter.disabled = true; }
        else { statusFilter.value = "active"; statusFilter.disabled = false; }
        loadCurrent();
    });
    byId("umPrevious").addEventListener("click", () => { if (!state.busy && state.page > 1) { state.page--; loadCurrent(); } });
    byId("umNext").addEventListener("click", () => { if (!state.busy) { state.page++; loadCurrent(); } });
    try { await loadCurrent(); } catch (error) { status(error.message || "User Management could not be loaded.", "error"); }
}
