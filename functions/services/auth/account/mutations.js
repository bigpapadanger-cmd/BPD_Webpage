import { authorizeRequest, isAuthorizationError, requireCurrentSessionProvider } from "../authorization.js";
import { destroyRequestSession } from "../sessions/session.js";
import { jsonResponse, methodNotAllowedResponse } from "../../http/responses.js";
import { validateDisplayNameAppropriateness } from "./display_name_validation.js";

const OPERATIONS = Object.freeze({
    profile: { method: "POST", rpc: "update_account_display_name", field: "displayName" },
    deactivate: { method: "POST", rpc: "deactivate_account", confirmation: "DEACTIVATE" },
    delete: { method: "DELETE", rpc: "delete_account", confirmation: "DELETE" }
});
const ERRORS = Object.freeze({
    ACCOUNT_NOT_FOUND: [404, "Account not found."],
    DISPLAY_NAME_REQUIRED: [400, "Enter a display name."],
    DISPLAY_NAME_TOO_SHORT: [400, "Display names must contain at least 3 characters."],
    DISPLAY_NAME_TOO_LONG: [400, "Display names must contain no more than 32 characters."],
    DISPLAY_NAME_INVALID: [400, "That display name contains characters that are not allowed."],
    DISPLAY_NAME_RESERVED: [409, "That display name is reserved."],
    DISPLAY_NAME_INAPPROPRIATE: [400, "That display name isn't allowed. Please choose another name."],
    DISPLAY_NAME_TAKEN: [409, "That display name is already in use."],
    DISPLAY_NAME_CHANGE_COOLDOWN: [409, "Your display name is still within its change cooldown."],
    ACCOUNT_STATE_CONFLICT: [409, "The account changed. Refresh and try again."],
    ACCOUNT_DELETE_CONFLICT: [409, "This account cannot currently be deleted."],
    AUTH_SERVICE_UNAVAILABLE: [503, "Account services are temporarily unavailable. Please try again."],
    INVALID_REQUEST: [400, "Invalid account request."],
    CONFIRMATION_REQUIRED: [400, "Confirm this account action before continuing."],
    ORIGIN_REQUIRED: [403, "Account changes must be made from this website."]
});

function failure(code, metadata = {}) {
    const [status, message] = ERRORS[code] || ERRORS.AUTH_SERVICE_UNAVAILABLE;
    return jsonResponse({ success: false, code, error: code, message,
        ...(code === "DISPLAY_NAME_CHANGE_COOLDOWN" && metadata.hasDisplayNameChangeAvailableAt
            ? { displayNameChangeAvailableAt: metadata.displayNameChangeAvailableAt } : {}),
        ...(status === 503 ? { available: false, authenticated: null } : {}) }, status);
}

function readRpcField(body, camelCase, snakeCase) {
    if (Object.hasOwn(body || {}, camelCase)) return body[camelCase];
    if (Object.hasOwn(body || {}, snakeCase)) return body[snakeCase];
    return undefined;
}

function isTimestampOrNull(value) {
    return value === null || (typeof value === "string"
        && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value)
        && Number.isFinite(Date.parse(value)))
        || (typeof value === "number" && Number.isFinite(value));
}

// Only documented domain errors may cross the database boundary.
function databaseError(body) {
    return ["ACCOUNT_NOT_FOUND", "DISPLAY_NAME_REQUIRED", "DISPLAY_NAME_TOO_SHORT", "DISPLAY_NAME_TOO_LONG",
        "DISPLAY_NAME_INVALID", "DISPLAY_NAME_RESERVED", "DISPLAY_NAME_TAKEN", "DISPLAY_NAME_CHANGE_COOLDOWN",
        "DISPLAY_NAME_INAPPROPRIATE",
        "ACCOUNT_STATE_CONFLICT", "ACCOUNT_DELETE_CONFLICT"]
        .find(code => body?.code === code || body?.message === code || body?.error === code)
        || "AUTH_SERVICE_UNAVAILABLE";
}

export async function handleAccountMutation(request, env, operation) {
    const spec = OPERATIONS[operation];
    if (!spec) return failure("INVALID_REQUEST");
    if (request.method !== spec.method) return methodNotAllowedResponse([spec.method]);
    if (request.headers.get("origin") !== new URL(request.url).origin
        || request.headers.get("sec-fetch-site") === "cross-site") return failure("ORIGIN_REQUIRED");
    if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
        return failure("INVALID_REQUEST");
    }
    let input;
    try { input = await request.json(); } catch { return failure("INVALID_REQUEST"); }
    const field = spec.field || "confirmation";
    if (!input || typeof input !== "object" || Array.isArray(input)
        || Object.keys(input).some(key => key !== field)) return failure("INVALID_REQUEST");
    if (spec.confirmation && input.confirmation !== spec.confirmation) return failure("CONFIRMATION_REQUIRED");
    const displayName = typeof input.displayName === "string" ? input.displayName.trim() : "";
    if (operation === "profile") {
        if (!displayName) return failure("DISPLAY_NAME_REQUIRED");
        if (displayName.length < 3) return failure("DISPLAY_NAME_TOO_SHORT");
        if (displayName.length > 32) return failure("DISPLAY_NAME_TOO_LONG");
        if (/[\u0000-\u001f\u007f]/.test(displayName)) return failure("DISPLAY_NAME_INVALID");
    }

    let authorization;
    try {
        authorization = await authorizeRequest(request, env, {
            account: true,
            action: operation === "profile" ? "manage_profile" : "manage_account"
        });
        authorization = await requireCurrentSessionProvider(authorization, env);
    } catch (error) {
        if (!isAuthorizationError(error) || error.status >= 500) return failure("AUTH_SERVICE_UNAVAILABLE");
        return jsonResponse({ success: false, code: error.code, error: error.code,
            message: error.message, ...(error.status === 401 ? { authenticated: false } : {}) }, error.status);
    }

    if (operation === "profile") {
        const validation = validateDisplayNameAppropriateness(displayName);
        if (!validation.valid) return failure(validation.code);
    }

    let result;
    let displayNameChangedAt;
    let displayNameChangeAvailableAt;
    try {
        const base = env.SUPABASE_URL?.trim().replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
        if (!base || !env.SUPABASE_AUTH) return failure("AUTH_SERVICE_UNAVAILABLE");
        const response = await fetch(`${base}/rest/v1/rpc/${spec.rpc}`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Accept-Profile": "api", "Content-Profile": "api",
                apikey: env.SUPABASE_AUTH, Authorization: `Bearer ${env.SUPABASE_AUTH}` },
            body: JSON.stringify({ p_account_id: authorization.accountId,
                ...(operation === "profile" ? { p_display_name: displayName } : {}) }),
            signal: AbortSignal.timeout(15000)
        });
        result = await response.json();
        if (!response.ok || result?.success === false) {
            const code = databaseError(result);
            const timestamp = readRpcField(result, "displayNameChangeAvailableAt", "display_name_change_available_at");
            return failure(code, { hasDisplayNameChangeAvailableAt: timestamp !== undefined && isTimestampOrNull(timestamp),
                displayNameChangeAvailableAt: timestamp });
        }
        displayNameChangedAt = readRpcField(result, "displayNameChangedAt", "display_name_changed_at");
        displayNameChangeAvailableAt = readRpcField(result, "displayNameChangeAvailableAt", "display_name_change_available_at");
        if (!result || result.accountId !== authorization.accountId
            || (operation === "profile" && (typeof result.displayName !== "string" || !result.displayName.trim()))
            || (operation === "profile" && (!isTimestampOrNull(displayNameChangedAt) || !isTimestampOrNull(displayNameChangeAvailableAt)))
            || (operation === "deactivate" && (result.active !== false || typeof result.changed !== "boolean"))
            || (operation === "delete" && result.deleted !== true)) return failure("AUTH_SERVICE_UNAVAILABLE");
    } catch { return failure("AUTH_SERVICE_UNAVAILABLE"); }

    // Only confirmed removal clears the session. Outages preserve the user's login.
    const headers = operation === "profile" ? {} : { "Set-Cookie": await destroyRequestSession(request, env) };
    return jsonResponse({ success: true,
        ...(operation === "profile" ? {
            displayName: result.displayName,
            displayNameChangedAt,
            displayNameChangeAvailableAt
        }
            : operation === "deactivate" ? { changed: result.changed, active: false } : { deleted: true }) }, 200, headers);
}
