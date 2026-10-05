"use strict";

import { apiFetch } from "/scripts/apiConnection.js";

const ENDPOINT = "/api/rocketleague/leaderboards";
const MODES = new Map([[10, "Ranked Duel · 1v1"], [11, "Ranked Doubles · 2v2"], [13, "Ranked Standard · 3v3"]]);

function element(tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = value;
    return node;
}

function captureLabel(value) {
    const time = Date.parse(value || "");
    return Number.isFinite(time) ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(time) : null;
}

function rankCard(card, position, mode) {
    if (!position) { card.hidden = true; return; }
    card.hidden = false;
    card.querySelector("[data-your-title]").textContent = `${mode} · Your position`;
    card.querySelector("[data-your-value]").textContent = `#${position.globalRank.toLocaleString()}`;
    const captured = captureLabel(position.capturedAt);
    card.querySelector("[data-your-meta]").textContent = `${position.mmr.toLocaleString()} MMR${captured ? ` · Snapshot ${captured}` : ""}`;
}

function renderRows(tbody, rows) {
    tbody.replaceChildren(...rows.map(row => {
        const tr = document.createElement("tr");
        const rank = element("th", "rl-leaderboards__rank", `#${row.globalRank.toLocaleString()}`);
        rank.scope = "row";
        const name = element("td", "rl-leaderboards__player", row.playerName);
        const platform = element("td", "rl-leaderboards__platform", row.platform);
        const mmr = element("td", "rl-leaderboards__mmr", row.mmr.toLocaleString());
        const member = element("td", row.isBpdMember ? "rl-leaderboards__badge" : "rl-leaderboards__not-member", row.isBpdMember ? "BPD Member" : "—");
        tr.append(rank, name, platform, mmr, member);
        return tr;
    }));
}

export function buildLeaderboardUrl({ playlist, page, pageSize, membersOnly, minRank, maxRank, query }) {
    const params = new URLSearchParams({ playlist: String(playlist), page: String(page), pageSize: String(pageSize), membersOnly: String(membersOnly) });
    if (minRank) params.set("minRank", String(minRank));
    if (maxRank) params.set("maxRank", String(maxRank));
    if (query) params.set("q", query);
    return `${ENDPOINT}?${params}`;
}

export async function initializePage() {
    const root = document.querySelector("[data-rl-leaderboards]");
    if (!root) return;
    const form = root.querySelector("[data-filters]");
    const status = root.querySelector("[data-status]");
    const snapshot = root.querySelector("[data-snapshot]");
    const tbody = root.querySelector("[data-rows]");
    const empty = root.querySelector("[data-empty]");
    const previous = root.querySelector("[data-prev]");
    const next = root.querySelector("[data-next]");
    const pageLabel = root.querySelector("[data-page-label]");
    const depth = root.querySelector("[data-depth]");
    const positionCard = root.querySelector("[data-your-rank]");
    let page = 1;
    let sequence = 0;

    async function load() {
        const current = ++sequence;
        const filters = new FormData(form);
        const playlist = Number(filters.get("playlist"));
        const pageSize = Number(filters.get("pageSize"));
        const query = String(filters.get("q") || "").trim();
        const membersOnly = form.elements.membersOnly.checked;
        const minRank = String(filters.get("minRank") || "").trim();
        const maxRank = String(filters.get("maxRank") || "").trim();
        status.textContent = "Loading the latest saved leaderboard…";
        empty.hidden = true;
        previous.disabled = true;
        next.disabled = true;
        try {
            const response = await apiFetch(buildLeaderboardUrl({ playlist, page, pageSize, membersOnly, minRank, maxRank, query }), { method: "GET", credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } });
            const result = await response.json().catch(() => ({}));
            if (current !== sequence || !root.isConnected) return;
            if (!response.ok || result.success !== true || !Array.isArray(result.rows)) throw new Error("unavailable");
            renderRows(tbody, result.rows);
            rankCard(positionCard, result.yourPosition, MODES.get(playlist));
            const captured = captureLabel(result.capturedAt);
            snapshot.textContent = captured ? `Snapshot captured ${captured}` : "No completed snapshot yet";
            if (result.status === "failed" && result.availableDepth > 0) {
                status.textContent = "The latest refresh failed. Showing the previous completed snapshot.";
            } else if (result.status === "failed") {
                status.textContent = "The latest refresh failed and no completed snapshot is available yet.";
            } else if (result.status === "refreshing" && result.availableDepth > 0) {
                status.textContent = "The daily refresh is in progress. Showing the latest completed snapshot.";
            } else if (result.status === "pending" && result.availableDepth === 0) {
                status.textContent = "The first leaderboard snapshot has not been published yet.";
            } else if (result.stale) {
                status.textContent = "This saved leaderboard is from an earlier day and may be out of date.";
            } else {
                status.textContent = `${result.totalEntries.toLocaleString()} players in this view · ${MODES.get(playlist)}`;
            }
            empty.hidden = result.rows.length > 0;
            empty.textContent = query ? "No players match that name in this snapshot." : membersOnly ? "No opted-in BPD members are present in this leaderboard snapshot." : "No entries are available for this mode yet.";
            const pageCount = Math.max(1, Math.ceil(result.totalEntries / pageSize));
            pageLabel.textContent = `Page ${page.toLocaleString()} of ${pageCount.toLocaleString()}`;
            previous.disabled = page <= 1;
            next.disabled = page >= pageCount;
            depth.textContent = `This snapshot contains ${result.availableDepth.toLocaleString()} provider entries. The available depth reflects returned data; it is not presented as a verified top-1,000 list.`;
        } catch {
            if (current !== sequence || !root.isConnected) return;
            renderRows(tbody, []);
            rankCard(positionCard, null, MODES.get(playlist));
            status.textContent = "The leaderboard could not be loaded. Please try again.";
            snapshot.textContent = "";
            depth.textContent = "";
            empty.textContent = "Leaderboard data is temporarily unavailable.";
            empty.hidden = false;
        }
    }

    form.addEventListener("submit", event => { event.preventDefault(); page = 1; void load(); });
    form.elements.playlist.addEventListener("change", () => { page = 1; void load(); });
    form.elements.pageSize.addEventListener("change", () => { page = 1; void load(); });
    form.elements.membersOnly.addEventListener("change", () => { page = 1; void load(); });
    form.elements.minRank.addEventListener("change", () => { page = 1; void load(); });
    form.elements.maxRank.addEventListener("change", () => { page = 1; void load(); });
    previous.addEventListener("click", () => { if (page > 1) { page -= 1; void load(); } });
    next.addEventListener("click", () => { page += 1; void load(); });
    await load();
}
