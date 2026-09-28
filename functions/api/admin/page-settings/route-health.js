"use strict";

import {
    ADMIN_PERMISSIONS,
    authorizeAdminPermission
} from "../../../services/admin/permissions.js";
import {
    PAGE_ROUTE_INVENTORY,
    API_ROUTE_INVENTORY,
    WORKER_ROUTE_INVENTORY,
    WORKER_SCHEDULE_INVENTORY,
    WORKER_QUEUE_INVENTORY
} from "../../../services/admin/generatedApiRouteInventory.js";

const CONNECTIONS = Object.freeze([
    { name: "Supabase", bindings: ["SUPABASE_URL", "SUPABASE_AUTH"] },
    { name: "Authentication sessions", bindings: ["AUTH_SESSIONS"] },
    { name: "Rocket League stats cache", bindings: ["RL_STATS_CACHE"] },
    { name: "OCR storage", bindings: ["OCR_STORAGE"] },
    { name: "OCR training", bindings: ["OCR_TRAINING"] },
    { name: "OCR progress", bindings: ["OCR_PROGRESS"] },
    { name: "OCR job queue", bindings: ["OCR_JOB_QUEUE"] },
    { name: "Google WIF / Cloud Run OCR", bindings: [
        "OCR_GCP_PROJECT_NUMBER", "OCR_GCP_WORKLOAD_IDENTITY_POOL_ID",
        "OCR_GCP_WORKLOAD_IDENTITY_PROVIDER_ID", "OCR_GCP_SERVICE_ACCOUNT_EMAIL",
        "OCR_GCP_MTLS", "OCR_GCP_X509_CERT_CHAIN", "OCR_API_URL", "OCR_API_KEY"
    ] },
    { name: "Discord role authorization", bindings: [
        "DISCORD_AUTHZ_GUILD_ID", "DISCORD_AUTHZ_BOT_TOKEN",
        "DISCORD_AUTHZ_ADMIN_ROLE_ID", "DISCORD_AUTHZ_MOD_ROLE_ID",
        "DISCORD_AUTHZ_LEAGUE_STAFF_ROLE_ID"
    ] },
    { name: "MMR API", bindings: ["MMR_API_URL", "MMR_API_KEY"] },
    { name: "RL presence monitor", bindings: ["RL_PRESENCE_MONITOR_URL"] },
    { name: "CurseForge", bindings: ["CURSEFORGE_API_KEY"] },
    { name: "Epic OAuth", bindings: ["EPIC_CLIENT_ID", "EPIC_CLIENT_SECRET", "EPIC_REDIRECT_URI"] },
    { name: "Google AdSense Privacy & Messaging", bindings: [], statusOverride: "External/Unresolved", detail: "Consent message configuration is managed in AdSense, not Pages." },
    { name: "Discord OAuth provider", bindings: [], statusOverride: "External/Unresolved", detail: "Provider credentials and enablement are managed in Supabase." },
    { name: "Google OAuth provider", bindings: [], statusOverride: "External/Unresolved", detail: "Provider credentials and enablement are managed in Supabase." },
    { name: "Steam OAuth provider", bindings: [], statusOverride: "External/Unresolved", detail: "Provider credentials and enablement are managed outside the Pages runtime." },
    { name: "Turnstile", bindings: ["TURNSTILE_SECRET_KEY"] }
]);

export function buildRouteHealthPayload(env, generatedAt = new Date().toISOString()) {
    const connectionStatus = (bindings) => {
    const configured = bindings.filter((name) => Boolean(env?.[name])).length;
    return configured === bindings.length
        ? "Configured"
        : configured === 0
            ? "Missing Configuration"
            : "Validation Warning";
    };

    const connections = CONNECTIONS.map(({ name, bindings, statusOverride, detail }) => ({
        name,
        status: statusOverride || connectionStatus(bindings),
        bindingsPresent: Object.fromEntries(bindings.map((key) => [key, Boolean(env?.[key])])),
        ...(detail ? { detail } : {})
    }));

    return {
        success: true,
        readOnly: true,
        generatedAt,
        routes: [
            ...PAGE_ROUTE_INVENTORY,
            ...API_ROUTE_INVENTORY,
            ...WORKER_ROUTE_INVENTORY,
            ...WORKER_SCHEDULE_INVENTORY,
            ...WORKER_QUEUE_INVENTORY
        ],
        connections,
        knownFindings: [
            { category: "design-decision-required", path: "/api/faq", detail: "Frontend callers exist; no local handler or authoritative data contract is established." },
            { category: "design-decision-required", path: "/api/faq/upvote", detail: "Frontend callers exist; no local handler or authoritative data contract is established." },
            { category: "unregistered-page", path: "/RocketLeague/WeeklyMatches", detail: "Legacy standalone files and navigation references exist; no SPA route registration is present." },
            { category: "unregistered-page", path: "/RocketLeague/PrivateMatches", detail: "Legacy standalone files and navigation references exist; no SPA route registration is present." },
            { category: "unregistered-page", path: "/Admin/MatchManagement", detail: "Admin sidebar reference is not in the human route registry." },
            { category: "unregistered-page", path: "/Admin/UserManagement", detail: "Admin sidebar reference is not in the human route registry." },
            { category: "missing-handler", path: "/api/auth/discord/callback", detail: "The Functions entry file is empty; current Discord OAuth uses the shared Supabase callback path." },
            { category: "missing-handler", path: "/api/auth/steam/login", detail: "The Functions entry file is empty; no local login handler is implemented." },
            { category: "missing-handler", path: "/api/auth/steam/callback", detail: "The Functions entry file is empty; no local callback handler is implemented." },
            { category: "historical-stale-reference", path: "/css/nsc/reset.css", detail: "No current checkout reference or matching asset was found." },
            { category: "historical-unresolved", path: "/get-profile", status: 502, owner: "external/unresolved" },
            { category: "historical-unresolved", path: "/", status: 504, owner: "external/unresolved" },
            { category: "historical-unresolved", path: "/Framework/Shell/HTML/Sidebar/hover", status: 504, owner: "external/unresolved" }
        ]
    };
}

function json(body, status = 200) {
    return Response.json(body, {
        status,
        headers: { "Cache-Control": "no-store" }
    });
}

export async function onRequestGet(context) {
    try {
        await authorizeAdminPermission(
            context.request,
            context.env,
            ADMIN_PERMISSIONS.ADMIN_SETTINGS_MANAGE
        );
    } catch (error) {
        const status = [401, 403].includes(Number(error?.status))
            ? Number(error.status)
            : 503;
        return json({
            success: false,
            error: status === 401
                ? "AUTHENTICATION_REQUIRED"
                : status === 403
                    ? "ADMIN_PERMISSION_REQUIRED"
                    : "AUTHORIZATION_UNAVAILABLE"
        }, status);
    }

    return json(buildRouteHealthPayload(context.env));
}
