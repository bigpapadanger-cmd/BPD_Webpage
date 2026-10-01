"use strict";

import { getAuthState, hasAdminPermission } from "/Framework/Auth/auth.js";
import { getMmrControlModel } from "./mmr_controls.js";
import { ROCKET_LEAGUE_CAPABILITIES, ROCKET_LEAGUE_CAPABILITY_CATEGORIES } from "./rocket_league_capabilities.js";

const REQUIRED_PERMISSION = "admin.settings.manage";
const DEPLOY_PERMISSION = "admin.mmr.deploy";
let requestInFlight = null;
let actionInFlight = false;
let canDeployMmr = false;
let deploymentPollTimer = null;
let lastDeploymentState = null;
let operationPollTimer = null;
let authorizationPollTimer = null;
let authorizationActive = false;

const ACTION_LABELS = {
    recheck: "Recheck", "refresh-eos": "Refresh EOS", "reauthorize-account": "Reauthorize Account",
    "reconnect-psynet": "Reconnect PsyNet", "repair-session": "Repair Session", "run-now": "Run"
};

function textElement(tag, text, className) {
    const element = document.createElement(tag);
    element.textContent = String(text ?? "");
    if (className) element.className = className;
    return element;
}

function startOperationPolling() {
    if (operationPollTimer) return;
    const poll = async () => {
        if (!actionInFlight) { operationPollTimer = null; return; }
        try { await loadStatus(); } catch { /* Keep the current operation result visible. */ }
        operationPollTimer = setTimeout(poll, 7000);
    };
    operationPollTimer = setTimeout(poll, 7000);
}

function stopOperationPolling() {
    if (operationPollTimer) clearTimeout(operationPollTimer);
    operationPollTimer = null;
}

async function postSystemAction(action, extra = {}) {
    const response = await fetch("/api/admin/system-status", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ service: "mmr-api", action, ...extra })
    });
    const payload = await response.json();
    if (!response.ok || payload.success !== true) throw Object.assign(new Error(payload.message || "Operation failed."), { payload, status: response.status });
    return payload;
}

function safeActionFailure(error, fallback) {
    const payload = error?.payload || {};
    const retry = Number(payload.retryAfterSeconds) || 0;
    return retry ? `${fallback} Try again in ${retry} seconds.` : `${fallback} (${payload.code || "MMR_ACTION_FAILED"}).`;
}

async function pollEpicAuthorization(delaySeconds) {
    if (authorizationPollTimer) clearTimeout(authorizationPollTimer);
    authorizationPollTimer = setTimeout(async () => {
        const message = document.getElementById("workerStatusMessage");
        try {
            const payload = await postSystemAction("poll-authorization");
            if (payload.result?.status === "authorized") {
                authorizationActive = false;
                authorizationPollTimer = null;
                message.textContent = "Epic alt-account authorization completed.";
                await loadStatus();
                return;
            }
            message.textContent = "Waiting for Epic authorization…";
            await pollEpicAuthorization(Math.max(5, Number(payload.result?.retryAfter) || delaySeconds));
        } catch (error) {
            authorizationActive = false;
            authorizationPollTimer = null;
            message.textContent = safeActionFailure(error, "Epic authorization stopped");
            await loadStatus().catch(() => {});
        }
    }, Math.max(5, delaySeconds) * 1000);
}

async function startEpicAuthorization(button) {
    if (authorizationActive || actionInFlight) return;
    actionInFlight = true;
    authorizationActive = true;
    button.disabled = true;
    const message = document.getElementById("workerStatusMessage");
    try {
        const payload = await postSystemAction("reauthorize-account");
        const url = payload.result?.url;
        if (!url || !/^https:\/\/www\.epicgames\.com\//.test(url)) throw new Error("Invalid authorization URL");
        window.open(url, "_blank", "noopener,noreferrer");
        message.textContent = "Epic authorization opened in a new tab. Complete it there; this page will check automatically.";
        await pollEpicAuthorization(Math.max(5, Number(payload.result?.interval) || 10));
    } catch (error) {
        authorizationActive = false;
        message.textContent = safeActionFailure(error, "Epic authorization could not start");
    } finally {
        actionInFlight = false;
        button.disabled = authorizationActive;
    }
}

async function runAction(service, action, button) {
    if (actionInFlight || authorizationActive) return;
    if (action === "reauthorize-account") { await startEpicAuthorization(button); return; }
    const confirmations = {
        "reconnect-psynet": "Reconnect BPD MMR API to PsyNet now?",
        "refresh-eos": "Refresh the Epic alt-account authorization now?",
        "repair-session": "Run the deterministic MMR session repair now?",
        "run-now": "Run the RL presence check now?"
    };
    if (confirmations[action] && !window.confirm(confirmations[action])) return;
    actionInFlight = true;
    button.disabled = true;
    const originalText = button.textContent;
    button.textContent = action === "recheck" ? "Rechecking…" : "Repairing…";
    const message = document.getElementById("workerStatusMessage");
    if (service === "mmr-api" && action !== "recheck") startOperationPolling();
    try {
        const response = await fetch("/api/admin/system-status", {
            method: "POST", credentials: "same-origin", cache: "no-store",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ service, action })
        });
        const payload = await response.json();
        if (!response.ok || payload.success !== true) throw Object.assign(new Error(), { payload });
        message.textContent = action === "recheck" ? `${service} status rechecked.` : `${ACTION_LABELS[action] || "MMR operation"} completed${payload.result?.resultCode ? `: ${payload.result.resultCode}` : "."}`;
        await loadStatus();
    } catch (error) {
        message.textContent = safeActionFailure(error, `${originalText} failed`);
    } finally {
        actionInFlight = false;
        stopOperationPolling();
        button.disabled = false;
        button.textContent = originalText;
    }
}

async function updateBuildConfiguration(form) {
    if (actionInFlight || authorizationActive) return;
    const gameVersion = form.elements.gameVersion.value.trim();
    const featureSet = form.elements.featureSet.value.trim();
    const buildSecret = form.elements.buildSecret.value;
    form.elements.buildSecret.value = "";
    if (!gameVersion || !featureSet || !buildSecret || !window.confirm(`Validate Rocket League ${gameVersion} with Feature Set ${featureSet}? The current production configuration stays active if validation fails.`)) return;
    actionInFlight = true;
    startOperationPolling();
    const button = form.querySelector("button");
    button.disabled = true;
    const message = document.getElementById("workerStatusMessage");
    try {
        const payload = await postSystemAction("validate-build", { gameVersion, featureSet, buildSecret });
        message.textContent = payload.reconnectSucceeded ? `Protocol validated as Build ID ${payload.buildId}; PsyNet reconnected.` : `Protocol validated as Build ID ${payload.buildId}; reconnect result: ${payload.reconnectCode || "not connected"}.`;
        await loadStatus();
    } catch (error) {
        message.textContent = safeActionFailure(error, "Protocol validation failed; the current production configuration remains active");
        await loadStatus().catch(() => {});
    } finally {
        form.elements.buildSecret.value = "";
        actionInFlight = false;
        stopOperationPolling();
        button.disabled = false;
    }
}

async function runMmrFunctionalTest(form) {
    if (actionInFlight || authorizationActive) return;
    const playerId = form.elements.playerId.value.trim();
    const output = form.querySelector("[data-mmr-test-result]");
    actionInFlight = true;
    form.querySelector("button").disabled = true;
    output.textContent = "Running read-only MMR lookup…";
    try {
        const payload = await postSystemAction("functional-test", { playerId });
        const result = payload.result || {};
        output.replaceChildren(textElement("p", `Success · ${result.playlistCount || 0} playlists · ${result.responseTimeMs || 0} ms`));
        if (Array.isArray(result.playlists) && result.playlists.length) {
            const list = document.createElement("ul");
            list.className = "worker-status-facts";
            for (const item of result.playlists) list.append(textElement("li", `Playlist ${item.id}: ${item.mmr} MMR · Tier ${item.tier} · Division ${item.division}`));
            output.append(list);
        }
        await loadStatus();
    } catch (error) { output.textContent = safeActionFailure(error, "MMR functional test failed"); }
    finally { actionInFlight = false; form.querySelector("button").disabled = false; }
}

function renderDeployment(deployment) {
    const target = document.getElementById("mmrDeploymentState");
    if (!target) return;
    const lines = [
        `State: ${deployment?.deploymentState || "idle"}`,
        deployment?.triggeredAt ? `Triggered: ${readableTime(deployment.triggeredAt)}` : null,
        deployment?.startedAt ? `Started: ${readableTime(deployment.startedAt)}` : null,
        deployment?.completedAt ? `Completed: ${readableTime(deployment.completedAt)}` : null,
        deployment?.commitSha ? `Commit: ${deployment.commitSha.slice(0, 7)}` : null,
        deployment?.branch ? `Branch: ${deployment.branch}` : null,
        Number.isFinite(deployment?.durationMs) ? `Duration: ${Math.round(deployment.durationMs / 1000)} sec` : null,
        deployment?.verification ? `Post-deploy health: ${deployment.verification.status}${deployment.verification.psynetState ? ` · PsyNet ${deployment.verification.psynetState}` : ""}` : null,
        deployment?.lastDeploymentFailureCode ? `Last failure: ${deployment.lastDeploymentFailureCode}` : null
    ].filter(Boolean);
    target.replaceChildren(...lines.map(line => textElement("li", line)));
    const active = ["queued", "running"].includes(deployment?.deploymentState);
    const button = document.getElementById("mmrDeployButton");
    if (button) button.disabled = actionInFlight || active;
    if (deploymentPollTimer) { clearTimeout(deploymentPollTimer); deploymentPollTimer = null; }
    if (active) deploymentPollTimer = setTimeout(() => { void loadDeploymentStatus(); }, 7000);
    lastDeploymentState = deployment?.deploymentState || "idle";
}

async function loadDeploymentStatus() {
    if (!canDeployMmr) return;
    try {
        const response = await fetch("/api/admin/system-status/mmr-deploy", { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } });
        const payload = await response.json();
        if (response.ok && payload.success === true) {
            const wasActive = ["queued", "running"].includes(lastDeploymentState);
            const isTerminal = ["success", "failed", "cancelled", "unknown"].includes(payload.deployment?.deploymentState);
            if (wasActive && isTerminal) await loadStatus();
            renderDeployment(payload.deployment);
        }
    } catch { /* Existing service status remains usable. */ }
}

async function deployMmrWorker(button) {
    if (actionInFlight || !window.confirm("Redeploy the production MMR Worker?\n\nThis will trigger the existing deployment pipeline for mmr-api-v2.")) return;
    actionInFlight = true;
    button.disabled = true;
    try {
        const response = await fetch("/api/admin/system-status/mmr-deploy", { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ confirm: true }) });
        const payload = await response.json();
        const message = document.getElementById("workerStatusMessage");
        if (!response.ok || payload.success !== true) message.textContent = payload.retryAfterSeconds ? `Redeploy is cooling down for ${payload.retryAfterSeconds} seconds.` : `Redeploy could not start (${payload.error || "MMR_DEPLOY_TRIGGER_FAILED"}).`;
        else { message.textContent = "Production MMR Worker deployment started."; renderDeployment(payload.deployment); }
    } catch { document.getElementById("workerStatusMessage").textContent = "Redeploy could not start."; }
    finally { actionInFlight = false; if (!deploymentPollTimer) button.disabled = false; }
}

function statusIcon(status) {
    return ({ healthy: "✓", degraded: "!", down: "×", unknown: "?" })[String(status).toLowerCase()] || "?";
}

function readableTime(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function renderRocketLeagueCapabilities(services) {
    const target = document.getElementById("rocketLeagueCapabilities");
    if (!target) return;
    const serviceById = new Map(services.map(service => [service.id, service]));
    const fragment = document.createDocumentFragment();
    for (const category of ROCKET_LEAGUE_CAPABILITY_CATEGORIES) {
        const capabilities = ROCKET_LEAGUE_CAPABILITIES.filter(capability => capability.category === category.id);
        if (!capabilities.length) continue;
        const group = document.createElement("section");
        group.className = `rocket-capability-category${category.id === "advanced" ? " rocket-capability-advanced" : ""}`;
        const heading = textElement("h3", category.label);
        const list = document.createElement("ul");
        list.className = "rocket-capability-list";
        for (const capability of capabilities) {
            const service = capability.serviceId ? serviceById.get(capability.serviceId) : null;
            const isActive = capability.status === "active";
            const displayStatus = isActive ? `Active · ${service?.status || "unknown"}` : capability.status === "future" ? "Future" : "Coming Soon";
            const item = document.createElement("li");
            item.className = `rocket-capability-card rocket-capability-${capability.status}${isActive && service ? ` worker-status-${service.status}` : ""}`;
            if (!isActive) item.setAttribute("aria-disabled", "true");
            const titleRow = document.createElement("div");
            titleRow.className = "rocket-capability-title-row";
            const state = isActive ? String(service?.status || "unknown").toLowerCase() : "unknown";
            const indicator = textElement("span", isActive ? statusIcon(state) : capability.status === "future" ? "◇" : "…", `worker-status-indicator worker-status-${state}`);
            indicator.setAttribute("role", "img");
            indicator.setAttribute("aria-label", displayStatus);
            titleRow.append(indicator, textElement("strong", capability.label, "rocket-capability-name"));
            titleRow.append(textElement("span", displayStatus, `rocket-capability-status${isActive ? ` worker-status-${state}` : ""}`));
            item.append(titleRow, textElement("p", capability.purpose, "rocket-capability-purpose"));
            const metadata = [capability.access, Number.isInteger(capability.priority) ? `Priority ${capability.priority}` : null].filter(Boolean);
            item.append(textElement("span", metadata.join(" · "), "rocket-capability-meta"));
            if (isActive) {
                const link = document.createElement("a");
                link.href = "#worker-status-service-mmr-api";
                link.className = "rocket-capability-link";
                link.textContent = "View live service status";
                item.append(link);
            }
            list.append(item);
        }
        group.append(heading, list);
        fragment.append(group);
    }
    target.replaceChildren(fragment);
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
        const componentLabels = {
            worker: "Worker", configuration: "Configuration", eosAuthorization: "EOS Authorization",
            psynetAuthentication: "PsyNet Authentication", psynetSocket: "PsyNet Socket",
            buildConfiguration: "Build Configuration", mmrService: "MMR Service"
        };
        const mmrFacts = [
            `Overall status: ${service.status || "unknown"}`,
            `Root cause: ${service.rootCause || "none"}`,
            `Active repair: ${service.activeRepair || "none"}`,
            ...Object.entries(componentLabels).map(([key, label]) => `${label}: ${service.components?.[key]?.status || "unknown"}${service.components?.[key]?.state ? ` · ${service.components[key].state}` : ""}`),
            service.gameVersion ? `Game version: ${service.gameVersion}` : null,
            service.currentBuildId ? `Current Build ID: ${service.currentBuildId}` : null,
            service.currentFeatureSet ? `Feature Set: ${service.currentFeatureSet}` : null,
            `Configuration generation: ${service.configurationGeneration || 0}`,
            service.buildSource ? `Protocol source: ${service.buildSource}` : null,
            `Build secret configured: ${service.buildSecretConfigured ? "yes" : "no"}`,
            service.lastAuthAttemptAt ? `Last auth attempt: ${readableTime(service.lastAuthAttemptAt)}` : null,
            service.lastAuthSuccessAt ? `Last auth success: ${readableTime(service.lastAuthSuccessAt)}` : null,
            service.lastMmrRequestAt ? `Last MMR request: ${readableTime(service.lastMmrRequestAt)}` : null,
            service.lastMmrSuccessAt ? `Last MMR success: ${readableTime(service.lastMmrSuccessAt)}` : null,
            service.lastMmrFailureAt ? `Last MMR failure: ${readableTime(service.lastMmrFailureAt)}${service.lastMmrFailureCode ? ` · ${service.lastMmrFailureCode}` : ""}` : null,
            service.lastRepairAction ? `Last repair: ${service.lastRepairAction} · ${service.lastRepairResult || "unknown"}` : null,
            service.nextScheduledVersionCheckAt ? `Next scheduled version check: ${readableTime(service.nextScheduledVersionCheckAt)}` : null,
            `MMR requests: ${service.mmrRequests || 0} total · ${service.mmrSuccesses || 0} succeeded · ${service.mmrFailures || 0} failed`
        ].filter(Boolean);
        const list = document.createElement("ul");
        list.className = "worker-status-facts";
        for (const fact of mmrFacts) list.append(textElement("li", fact));
        content.append(list);
        const historical = service.historical || {};
        if (Object.values(historical).some(Boolean)) {
            const history = document.createElement("details");
            history.className = "worker-status-history";
            history.append(textElement("summary", "Historical diagnostics"));
            const historyList = document.createElement("ul"); historyList.className = "worker-status-facts";
            if (historical.lastVersionCheckResult) historyList.append(textElement("li", `Historical version check: ${historical.lastVersionCheckResult}${historical.lastVersionCheckAt ? ` · ${readableTime(historical.lastVersionCheckAt)}` : ""}`));
            if (historical.lastBuildValidationResult) historyList.append(textElement("li", `Historical build validation: ${historical.lastBuildValidationResult}${historical.lastBuildValidationAt ? ` · ${readableTime(historical.lastBuildValidationAt)}` : ""}`));
            if (historical.lastFailureCode) historyList.append(textElement("li", `Historical PsyNet failure: ${historical.lastFailureCode}${historical.lastProviderCode ? ` · ${historical.lastProviderCode}` : ""}`));
            history.append(historyList); content.append(history);
        }
        const controls = getMmrControlModel(service, canDeployMmr);
        if (controls.showOperations) {
            const operations = document.createElement("section"); operations.className = "mmr-operations";
            operations.append(textElement("h4", "MMR Operations"));
            if (controls.showBuildUpdate) {
                const form = document.createElement("form"); form.className = "mmr-build-form"; form.autocomplete = "off";
                const version = document.createElement("input"); version.name = "gameVersion"; version.required = true; version.placeholder = "Game Version"; version.pattern = "\\d{6}\\.\\d{1,8}\\.\\d{1,8}"; version.value = service.gameVersion || "";
                const feature = document.createElement("input"); feature.name = "featureSet"; feature.required = true; feature.placeholder = "Feature Set"; feature.value = service.currentFeatureSet || "";
                const secret = document.createElement("input"); secret.name = "buildSecret"; secret.type = "password"; secret.required = true; secret.placeholder = "Build Secret"; secret.autocomplete = "new-password";
                const update = textElement("button", "Validate Protocol"); update.type = "submit";
                form.append(version, feature, secret, update);
                form.addEventListener("submit", event => { event.preventDefault(); void updateBuildConfiguration(form); });
                operations.append(form);
            }
            if (controls.showFunctionalTest) {
                const form = document.createElement("form"); form.className = "mmr-functional-form"; form.autocomplete = "off";
                form.append(textElement("h5", "MMR Functional Test"));
                const player = document.createElement("input"); player.name = "playerId"; player.required = true; player.placeholder = "Epic|account-id|0"; player.pattern = "Epic\\|[A-Za-z0-9_-]{8,64}\\|0";
                const run = textElement("button", "Run MMR Functional Test"); run.type = "submit";
                const result = textElement("div", "", "mmr-functional-result"); result.dataset.mmrTestResult = "";
                form.append(player, run, result);
                form.addEventListener("submit", event => { event.preventDefault(); void runMmrFunctionalTest(form); });
                operations.append(form);
            }
            if (controls.showDeploy) {
                const deploy = textElement("button", "Redeploy MMR Worker", "mmr-deploy-button"); deploy.type = "button"; deploy.id = "mmrDeployButton";
                const deployment = textElement("ul", "", "worker-status-facts"); deployment.id = "mmrDeploymentState";
                deploy.addEventListener("click", () => { void deployMmrWorker(deploy); });
                operations.append(deploy, deployment);
            }
            content.append(operations);
        }
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
            item.id = `worker-status-service-${service.id}`;
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
            const controls = getMmrControlModel(service, canDeployMmr);
            if (controls.actions.length) {
                const actions = document.createElement("div");
                actions.className = "worker-status-card-actions";
                for (const action of controls.actions) {
                    const button = textElement("button", action === "run-now" ? "▶ Run" : `↻ ${ACTION_LABELS[action] || action}`);
                    button.type = "button";
                    button.disabled = authorizationActive;
                    button.setAttribute("aria-label", `${ACTION_LABELS[action] || action} for ${service.name}`);
                    button.addEventListener("click", () => { void runAction(service.id, action, button); });
                    actions.append(button);
                }
                primary.append(actions);
            }
            item.append(primary, makeDetails(service));
            list.append(item);
        }
        renderRocketLeagueCapabilities(payload.services);
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
        canDeployMmr = hasAdminPermission(DEPLOY_PERMISSION, auth);
        refresh.disabled = false;
        refresh.addEventListener("click", () => {
            message.textContent = "Refreshing status…";
            Promise.all([loadStatus(), loadRouteDiagnostics()]).catch(() => { message.textContent = "Status is unavailable. Please retry later."; });
        });
        await Promise.all([loadStatus(), loadRouteDiagnostics()]);
        await loadDeploymentStatus();
    } catch { message.textContent = "Status is unavailable. Please retry later."; }
}
