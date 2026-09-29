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
    if (service.id === "mmr-api") {
        const mmrFacts = [
            `PsyNet state: ${service.psynetState || "unknown"}`,
            `Config ready: ${service.configReady === true ? "yes" : "no"}`,
            service.missingConfig?.length ? `Missing config: ${service.missingConfig.join(", ")}` : null,
            service.lastAuthAttemptAt ? `Last auth attempt: ${readableTime(service.lastAuthAttemptAt)}` : null,
            service.lastAuthSuccessAt ? `Last auth success: ${readableTime(service.lastAuthSuccessAt)}` : null,
            service.lastAuthFailureAt ? `Last auth failure: ${readableTime(service.lastAuthFailureAt)}` : null,
            service.lastFailureStage ? `Failure stage: ${service.lastFailureStage}` : null,
            service.lastFailureCode ? `Failure code: ${service.lastFailureCode}` : null,
            service.lastProviderCode ? `Provider code: ${service.lastProviderCode}` : null,
            service.lastMmrRequestAt ? `Last MMR request: ${readableTime(service.lastMmrRequestAt)}` : null,
            service.lastMmrSuccessAt ? `Last MMR success: ${readableTime(service.lastMmrSuccessAt)}` : null,
            service.lastMmrFailureAt ? `Last MMR failure: ${readableTime(service.lastMmrFailureAt)}` : null,
            service.lastReconnectAttemptAt ? `Last reconnect: ${readableTime(service.lastReconnectAttemptAt)} (${service.lastReconnectResult || "pending"})` : null,
            service.backoffUntil ? `Backoff until: ${readableTime(service.backoffUntil)}` : null,
            service.retryAfterSeconds ? `Retry after: ${service.retryAfterSeconds} seconds` : null,
            `MMR requests: ${service.mmrRequests || 0} total · ${service.mmrSuccesses || 0} succeeded · ${service.mmrFailures || 0} failed`,
            `Rejected: ${service.emptyRequests || 0} empty · ${service.rateLimitedRequests || 0} rate limited`,
            `Limits: ${service.normalLimitPerMinute || 30}/min normal · ${service.emptyLimitPerMinute || 5}/min empty`,
            `Reconnects: ${service.reconnectAttempts || 0} attempted · ${service.reconnectSuccesses || 0} succeeded · ${service.reconnectFailures || 0} failed`
        ].filter(Boolean);
        const list = document.createElement("ul");
        list.className = "worker-status-facts";
        for (const fact of mmrFacts) list.append(textElement("li", fact));
        content.append(list);
    }
    if (Array.isArray(service.dependencies) && service.dependencies.length) {
        content.append(textElement("p", `Dependencies: ${service.dependencies.map(dependency => `${dependency.id}: ${dependency.status}`).join(" · ")}`));
    }
    details.append(content);
    return details;
}

function inventoryStatus(value) {
    const status = String(value || "unknown").toLowerCase();
    if (/missing|invalid|error/.test(status)) return "down";
    if (/unregistered|warning|degraded|partial|design-decision/.test(status)) return "degraded";
    if (/unknown|unresolved|handler-defined|not applicable|historical/.test(status)) return "unknown";
    return "healthy";
}

function diagnosticRow({ title, status, label, details = [] }) {
    const item = document.createElement("li");
    item.className = "system-diagnostic-row";
    const line = document.createElement("div");
    line.className = "system-diagnostic-primary";
    const state = inventoryStatus(status);
    const icon = textElement("span", statusIcon(state), `worker-status-indicator worker-status-${state}`);
    icon.setAttribute("role", "img");
    icon.setAttribute("aria-label", status || state);
    line.append(icon, textElement("strong", title, "system-diagnostic-title"));
    if (label) line.append(textElement("span", label, "system-diagnostic-label"));
    item.append(line);
    if (details.length) {
        const disclosure = document.createElement("details");
        disclosure.className = "system-diagnostic-details";
        disclosure.append(textElement("summary", "Details"));
        const content = document.createElement("div");
        for (const detail of details.filter(Boolean)) content.append(textElement("p", detail));
        disclosure.append(content);
        item.append(disclosure);
    }
    return item;
}

async function loadRouteDiagnostics() {
    const status = document.getElementById("routeDiagnosticsStatus");
    const content = document.getElementById("routeDiagnosticsContent");
    try {
        const response = await fetch("/api/admin/page-settings/route-health", { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } });
        const payload = await response.json();
        if (!response.ok || payload.success !== true) throw new Error("Diagnostics unavailable");
        const routeList = document.getElementById("systemRouteRows");
        routeList.replaceChildren();
        for (const route of payload.routes || []) {
            const targets = (route.targets || []).map(target => typeof target === "string" ? target : `${target.path} (${target.exists ? "found" : "missing"})`);
            routeList.append(diagnosticRow({
                title: route.path,
                status: route.healthStatus || "unknown",
                label: `${route.routeType || "route"} · ${route.healthStatus || "not checked"}`,
                details: [
                    route.handler || route.sourceFiles?.join(", "),
                    `Methods: ${(route.methods || []).join(", ") || "—"}`,
                    `Authentication: ${route.authRequired === true ? "required" : route.authRequired === false ? "not required" : route.authRequired || "not applicable"}`,
                    `Deep link: ${route.routeType === "api" ? "not applicable" : route.deepLinkSupported ? "supported" : "unknown"}`,
                    `Lookup: ${route.lookupKey || "—"} · Case policy: ${route.casePolicy || "—"}`,
                    targets.length ? `Targets: ${targets.join(", ")}` : null
                ]
            }));
        }
        const connections = document.getElementById("systemConnectionRows");
        connections.replaceChildren();
        for (const connection of payload.connections || []) {
            const bindings = Object.entries(connection.bindingsPresent || {}).map(([name, present]) => `${name}: ${present ? "present" : "missing"}`);
            connections.append(diagnosticRow({ title: connection.name, status: connection.status, label: connection.status, details: [...bindings, connection.detail] }));
        }
        const findings = document.getElementById("systemFindingRows");
        findings.replaceChildren();
        for (const finding of payload.knownFindings || []) {
            findings.append(diagnosticRow({ title: finding.path, status: finding.status || finding.category, label: finding.category, details: [finding.detail, finding.owner ? `Owner: ${finding.owner}` : null] }));
        }
        document.getElementById("routeDiagnosticsCount").textContent = `(${(payload.routes || []).length})`;
        document.getElementById("connectionDiagnosticsCount").textContent = `(${(payload.connections || []).length})`;
        document.getElementById("findingDiagnosticsCount").textContent = `(${(payload.knownFindings || []).length})`;
        document.getElementById("routeDiagnosticsGenerated").textContent = `Inventory updated ${readableTime(payload.generatedAt)}`;
        status.textContent = "";
        content.hidden = false;
    } catch {
        status.textContent = "Route diagnostics are unavailable.";
    }
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
        refresh.addEventListener("click", () => {
            message.textContent = "Refreshing status…";
            Promise.all([loadStatus(), loadRouteDiagnostics()]).catch(() => { message.textContent = "Status is unavailable. Please retry later."; });
        });
        await Promise.all([loadStatus(), loadRouteDiagnostics()]);
    } catch { message.textContent = "Status is unavailable. Please retry later."; }
}
