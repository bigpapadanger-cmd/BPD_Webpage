"use strict";

import { getAuthState, hasAdminPermission } from "/Framework/Auth/auth.js";

const REQUIRED_PERMISSION = "admin.settings.manage";
const DEPLOY_PERMISSION = "admin.mmr.deploy";
let requestInFlight = null;
let actionInFlight = false;
let canDeployMmr = false;
let deploymentPollTimer = null;
let lastDeploymentState = null;

function textElement(tag, text, className) {
    const element = document.createElement(tag);
    element.textContent = String(text ?? "");
    if (className) element.className = className;
    return element;
}

async function runAction(service, action, button) {
    if (actionInFlight) return;
    if (action === "reconnect" && !window.confirm("Reconnect BPD MMR API to PsyNet now? Use this for maintenance when automatic recovery has not restored the connection.")) return;
    if (action === "check-version" && !window.confirm("Check the Rocket League version source now? This is rate-limited and will keep the current build configuration if no authoritative source is available.")) return;
    if (action === "run-now" && !window.confirm("Run the RL presence check now? This performs the existing presence job and may call its configured game/account services.")) return;
    actionInFlight = true;
    button.disabled = true;
    const originalText = button.textContent;
    button.textContent = action === "reconnect" ? "Reconnecting…" : action === "check-version" ? "Checking version…" : action === "run-now" ? "Running…" : "Rechecking…";
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
        if (service === "mmr-api" && action === "check-version") {
            const resultCode = payload.result?.resultCode;
            message.textContent = resultCode === "RL_VERSION_SOURCE_UNAVAILABLE"
                ? "No authoritative build source is available. The current configuration was kept."
                : resultCode === "RL_VERSION_CHECK_SKIPPED"
                    ? "The current build was checked recently; no new check was needed."
                    : "Rocket League version check completed.";
        } else {
            message.textContent = action === "reconnect" ? "MMR API reconnected to PsyNet." : action === "run-now" ? "Presence run completed." : `${service} status rechecked.`;
        }
        await loadStatus(true);
    } catch {
        message.textContent = `${originalText} failed. Please retry later.`;
    } finally {
        actionInFlight = false;
        button.disabled = false;
        button.textContent = originalText;
    }
}

async function updateBuildConfiguration(form) {
    if (actionInFlight) return;
    const buildId = form.elements.buildId.value.trim();
    const featureSet = form.elements.featureSet.value.trim();
    if (!buildId || !featureSet || !window.confirm(`Validate Build ID ${buildId} and Feature Set ${featureSet} with PsyNet? A successful candidate will be saved and reconnected.`)) return;
    actionInFlight = true;
    const button = form.querySelector("button");
    button.disabled = true;
    try {
        const response = await fetch("/api/admin/system-status", { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ service: "mmr-api", action: "update-build", buildId, featureSet }) });
        const payload = await response.json();
        const message = document.getElementById("workerStatusMessage");
        if (!response.ok || payload.success !== true) message.textContent = `Build update was rejected (${payload.providerCode || payload.error || "RL_BUILD_UPDATE_FAILED"}).`;
        else message.textContent = payload.reconnectSucceeded ? "Build updated and PsyNet reconnected." : `Build updated, but PsyNet reconnect failed (${payload.reconnectCode || "unknown"}).`;
        await loadStatus();
    } catch { document.getElementById("workerStatusMessage").textContent = "Build update failed. Please retry later."; }
    finally { actionInFlight = false; button.disabled = false; }
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
            `Build status: ${service.buildStatus || "unknown"}`,
            service.currentBuildId ? `Current Build ID: ${service.currentBuildId}` : null,
            service.currentFeatureSet ? `Feature set: ${service.currentFeatureSet}` : null,
            service.userAgentSummary ? `User-Agent: ${service.userAgentSummary}` : `User-Agent configured: ${service.userAgentConfigured ? "yes" : "no"}`,
            service.buildSource ? `Build source: ${service.buildSource}` : null,
            service.activeBuild ? `Active: ${service.activeBuild.buildId || "—"} · ${service.activeBuild.featureSet || "—"} · ${service.activeBuild.source || "unknown"}` : null,
            service.fallbackBuild ? `Wrangler fallback: ${service.fallbackBuild.buildId || "—"} · ${service.fallbackBuild.featureSet || "—"}` : null,
            service.lastVersionCheckAt ? `Last version check: ${readableTime(service.lastVersionCheckAt)} (${service.lastVersionCheckResult || "unknown"})` : null,
            service.lastBuildValidationAt ? `Last successful validation: ${readableTime(service.lastBuildValidationAt)} (${service.lastBuildValidationResult || "unknown"})` : null,
            service.versionMismatchDetectedAt ? `Version mismatch detected: ${readableTime(service.versionMismatchDetectedAt)}` : null,
            service.detectedBuildId ? `Detected candidate: ${service.detectedBuildId}${service.detectedFeatureSet ? ` · ${service.detectedFeatureSet}` : ""}` : null,
            service.candidateValidationResult ? `Candidate validation: ${service.candidateValidationResult}` : null,
            service.nextScheduledVersionCheckAt ? `Next scheduled version check: ${readableTime(service.nextScheduledVersionCheckAt)}` : null,
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
        if (service.supportsBuildUpdate) {
            const operations = document.createElement("section");
            operations.className = "mmr-operations";
            operations.append(textElement("h4", "Operations"));
            const form = document.createElement("form");
            form.className = "mmr-build-form";
            const build = document.createElement("input"); build.name = "buildId"; build.required = true; build.placeholder = "Build ID"; build.value = service.activeBuild?.buildId || service.currentBuildId || "";
            const feature = document.createElement("input"); feature.name = "featureSet"; feature.required = true; feature.placeholder = "Feature Set"; feature.value = service.activeBuild?.featureSet || service.currentFeatureSet || "";
            const update = textElement("button", "Update Build Configuration"); update.type = "submit";
            form.append(build, feature, update);
            form.addEventListener("submit", event => { event.preventDefault(); void updateBuildConfiguration(form); });
            operations.append(form);
            if (canDeployMmr) {
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
                    const button = textElement("button", action === "reconnect" ? "↻ Reconnect" : action === "check-version" ? "↻ Check Rocket League Version" : action === "run-now" ? "▶ Run" : "↻ Recheck");
                    button.type = "button";
                    button.setAttribute("aria-label", `${action === "reconnect" ? "Reconnect PsyNet" : action === "check-version" ? "Check Rocket League Version" : action === "run-now" ? "Run presence now" : `Recheck ${service.name}`}`);
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
