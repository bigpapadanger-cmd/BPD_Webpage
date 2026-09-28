"use strict";

import { getAuthState, hasAdminPermission } from "/Framework/Auth/auth.js";

const REQUIRED_PERMISSION = "admin.settings.manage";

function node(tag, text) {
    const element = document.createElement(tag);
    element.textContent = String(text ?? "");
    return element;
}

export async function initializePage() {
    const status = document.getElementById("pageSettingsStatus");
    const content = document.getElementById("pageSettingsContent");
    if (!status || !content) return;

    try {
        const auth = await getAuthState({ force: true });
        if (!hasAdminPermission(REQUIRED_PERMISSION, auth)) {
            status.textContent = "You do not have permission to view Page Settings.";
            return;
        }

        const response = await fetch("/api/admin/page-settings/route-health", {
            credentials: "same-origin",
            headers: { Accept: "application/json" }
        });
        const payload = await response.json();
        if (!response.ok || payload.success !== true) throw new Error("Request failed");

        const routes = document.getElementById("pageRouteRows");
        for (const route of payload.routes) {
            const row = document.createElement("tr");
            const authLabel = route.authRequired === true
                ? "Required"
                : route.authRequired === false
                    ? "Not required"
                    : route.authRequired || "Not applicable";
            const deepLinkLabel = route.routeType === "api"
                ? "Not applicable"
                : route.deepLinkSupported ? "Supported" : "Unknown";
            const valueList = [
                route.path,
                route.routeType,
                route.lookupKey || "—",
                route.casePolicy,
                route.handler || route.sourceFiles?.join(", ") || "—",
                route.methods.join(", ") || "—",
                authLabel,
                deepLinkLabel,
                route.healthStatus || "handler-defined",
                route.targets?.map((target) => typeof target === "string"
                    ? target
                    : `${target.path} (${target.exists ? "found" : "missing"})`).join(", ") || "—"
            ];
            for (const value of valueList) {
                row.append(node("td", value));
            }
            routes.append(row);
        }

        const connections = document.getElementById("connectionRows");
        for (const item of payload.connections) {
            const presence = Object.entries(item.bindingsPresent || {})
                .map(([name, present]) => `${name} ${present ? "present" : "missing"}`)
                .join(", ");
            const suffix = [presence, item.detail].filter(Boolean).join("; ");
            connections.append(node("li", `${item.name}: ${item.status}${suffix ? ` — ${suffix}` : ""}`));
        }

        const findings = document.getElementById("findingRows");
        for (const item of payload.knownFindings) {
            findings.append(node("li", `${item.category} — ${item.path}: ${item.detail ?? item.owner ?? ""}`));
        }

        document.getElementById("pageSettingsGeneratedAt").textContent = `Generated ${payload.generatedAt}`;
        status.textContent = "Diagnostics loaded.";
        content.hidden = false;
    } catch {
        status.textContent = "Page diagnostics are unavailable. Please retry later.";
    }
}

