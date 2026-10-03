import { getSessionContext } from "../sessions/session_context.js";
import { clearCookie } from "../sessions/session.js";
import { AUTH_STATE_COOKIE } from "../../config/api_vars.js";
import { getOAuthClearCookies } from "./state.js";
import { redirect } from "../../common_helpers/responses.js";

const PUBLIC_CODES = new Set([
    "AUTH_REQUIRED", "ACCOUNT_INACTIVE", "ACCOUNT_IDENTITY_MISSING",
    "PROVIDER_IDENTITY_ALREADY_LINKED", "PROVIDER_REAUTHORIZATION_MISMATCH",
    "PROVIDER_NOT_LINKED", "OAUTH_ACCOUNT_MISMATCH", "OAUTH_PROVIDER_REJECTED",
    "IDENTITY_CONFLICT", "SESSION_IDENTITY_CONFLICT"
]);

const FAILURE_STAGES = Object.freeze({
    OAUTH_CODE_EXCHANGE_FAILED: "supabase_code_exchange",
    OAUTH_USER_VALIDATION_FAILED: "supabase_user_validation",
    AUTHENTICATION_STATE_WRITE_FAILED: "bpd_session_finalization",
    PROVIDER_REAUTHORIZATION_FAILED: "provider_reauthorization",
    OAUTH_ACCOUNT_MISMATCH: "account_context_validation"
});

function isSafeDebugId(value) {
    return typeof value === "string" && /^[0-9a-f-]{36}$/iu.test(value);
}

// Callback failures are browser navigation responses. Never forward upstream
// messages, tokens, or arbitrary error strings into the destination URL.
export async function completeOAuthCallback(request, env, callback) {
    let response;
    try {
        response = await callback();
        if (response.status < 400) return response;
    } catch {
        response = new Response(null, { status: 503 });
    }

    let body = null;
    try { body = await response.json(); } catch { /* Optional error body. */ }
    const candidate = body?.code || body?.error;
    let debugId = isSafeDebugId(body?.debugId)
        ? body.debugId
        : response.status >= 500 ? crypto.randomUUID() : null;
    let code = response.status >= 500
        ? "AUTH_SERVICE_UNAVAILABLE"
        : PUBLIC_CODES.has(candidate) ? candidate : "OAUTH_CALLBACK_FAILED";

    if (response.status >= 500) {
        console.error("OAUTH CALLBACK: Server-side completion failed.", {
            debugId,
            stage: FAILURE_STAGES[candidate] || "callback_processing",
            responseStatus: response.status
        });
    }

    let destination = "/Login";
    try {
        const session = await getSessionContext(request, env);
        if (session.authenticated === true) destination = "/Account";
    } catch {
        // An unavailable session store is not evidence of logout.
        destination = "/Account";
        code = "AUTH_SERVICE_UNAVAILABLE";
        debugId ||= crypto.randomUUID();
        console.error("OAUTH CALLBACK: Session state could not be resolved.", {
            debugId,
            stage: "post_callback_session_resolution"
        });
    }
    const url = new URL(destination, request.url);
    url.searchParams.set("error", code);
    if (debugId) url.searchParams.set("debugId", debugId);
    return redirect(url.pathname + url.search, [
        ...getOAuthClearCookies(request),
        clearCookie(request, AUTH_STATE_COOKIE)
    ]);
}
