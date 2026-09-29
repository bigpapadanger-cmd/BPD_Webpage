"use strict";

import { getAuthState, hasAdminPermission } from "/Framework/Auth/auth.js";

const REQUIRED_PERMISSION = "admin.settings.manage";
let requestInFlight = null;
let actionInFlight = false;

function textElement(tag, text, className) {
    const element = document.createElement(tag);
    element.textContent = String(text ?? "");
    if (className) element.className = className;
    return element;
}

async function runAction(service, action, button) {
    if (actionInFlight) return;
    if (action === "reconnect" && !window.confirm("Reconnect BPD MMR API to PsyNet now? Use this for maintenance when automatic recovery has not restored the connection.")) return;
    if (action === "run-now" && !window.confirm("Run the RL presence check now? This performs the existing presence job and may call its configured game/account services.")) return;
    actionInFlight = true;
    button.disabled = true;
    const originalText = button.textContent;
    button.textContent = action === "reconnect" ? "Reconnecting…" : action === "run-now" ? "Running…" : "Rechecking…";
    const message = document.getElementById("workerStatusMessage");
    try {
        const response = await fetch("/api/admin/system-status", {
            method: "POST",
            credentials: "same-origin",
            cache: "no-store",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ service, action })
        });
        const payload = await response.json();
        if (!response.ok || payload.success !== true) {
            const retry = Number(payload.retryAfterSeconds) || 0;
            message.textContent = retry ? `${originalText} is unavailable for ${retry} seconds.` : `${originalText} failed. Please retry later.`;
            return;
        }
        message.textContent = action === "reconnect" ? "MMR API reconnected to PsyNet." : action === "run-now" ? "Presence run completed." : `${service} status rechecked.`;
        await loadStatus(true);
    } catch {
        message.textContent = `${originalText} failed. Please retry later.`;
    } finally {
        actionInFlight = false;
        button.disabled = false;
        button.textContent = originalText;
    }
}

function statusIcon(status) {
    return ({ healthy: "✓", degraded: "!", down: "×", unknown: "?" })[String(status).toLowerCase()] || "?";
}

function readableTime(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function makeDetails(service) {
    const details = document.createElement("details");
    details.className = "worker-status-details";
    const summary = textElement("summary", "Details");
    details.append(summary);
    const content = document.createElement("div");
    content.className = "worker-status-detail-content";
    const message = service.message || service.detail;
    if (message) content.append(textElement("p", message));
    const facts = [
        service.checkedAt ? `Checked ${readableTime(service.checkedAt)}` : null,
        Number.isFinite(service.responseTimeMs) ? `${service.responseTimeMs} ms response` : null,
        service.lastSuccessfulAt ? `Last healthy ${readableTime(service.lastSuccessfulAt)}` : null,
        service.lastInvocationAt ? `Last run ${readableTime(service.lastInvocationAt)}` : null,
        service.lastFailureAt ? `Last issue ${readableTime(service.lastFailureAt)}` : null
    ].filter(Boolean);
    if (facts.length) content.append(textElement("p", facts.join(" · ")));
    if (Array.isArray(service.dependencies) && service.dependencies.length) {
        content.append(textElement("p", `Dependencies: ${service.dependencies.map(dependency => `${dependency.id}: ${dependency.status}`).join(" · ")}`));
    }
    details.append(content);
    return details;
}

async function loadStatus() {
    if (requestInFlight) return requestInFlight;
    requestInFlight = (async () => {
        const response = await fetch("/api/admin/system-status", { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } });
        const payload = await response.json();
        if (!response.ok || payload.success !== true || !Array.isArray(payload.services)) throw new Error("Status unavailable");
        const list = document.getElementById("workerStatusServices");
        list.replaceChildren();
        for (const service of payload.services) {
            const item = document.createElement("li");
            item.className = "worker-status-row";
            const status = String(service.status || "unknown").toLowerCase();
            const primary = document.createElement("div");
            primary.className = "worker-status-primary";
            const indicator = textElement("span", statusIcon(status), `worker-status-indicator worker-status-${status}`);
            indicator.setAttribute("role", "img");
            indicator.setAttribute("aria-label", status);
            const identity = document.createElement("div");
            identity.className = "worker-status-identity";
            identity.append(textElement("strong", service.name, "worker-status-name"), textElement("span", status, `worker-status-label worker-status-${status}`));
            primary.append(indicator, identity);
            if (Array.isArray(service.actions) && service.actions.length) {
                const actions = document.createElement("div");
                actions.className = "worker-status-card-actions";
                for (const action of service.actions) {
                    const button = textElement("button", action === "reconnect" ? "↻ Reconnect" : action === "run-now" ? "▶ Run" : "↻ Recheck");
                    button.type = "button";
                    button.setAttribute("aria-label", `${action === "reconnect" ? "Reconnect PsyNet" : action === "run-now" ? "Run presence now" : `Recheck ${service.name}`}`);
                    button.addEventListener("click", () => { void runAction(service.id, action, button); });
                    actions.append(button);
                }
                primary.append(actions);
            }
            item.append(primary, makeDetails(service));
            list.append(item);
        }
        document.getElementById("workerStatusGenerated").textContent = `Updated ${readableTime(payload.generatedAt)}`;
        document.getElementById("workerStatusMessage").textContent = "";
    })().finally(() => { requestInFlight = null; });
    return requestInFlight;
}

export async function initializePage() {
    const message = document.getElementById("workerStatusMessage");
    const refresh = document.getElementById("workerStatusRefresh");
    if (!message || !refresh) return;
    try {
        const auth = await getAuthState({ force: true });
        if (!hasAdminPermission(REQUIRED_PERMISSION, auth)) { message.textContent = "You do not have permission to view worker status."; return; }
        refresh.disabled = false;
        refresh.addEventListener("click", () => { message.textContent = "Refreshing status…"; loadStatus().catch(() => { message.textContent = "Status is unavailable. Please retry later."; }); });
        await loadStatus();
    } catch { message.textContent = "Status is unavailable. Please retry later."; }
}
