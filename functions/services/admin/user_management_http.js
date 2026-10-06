"use strict";

import { mapUserManagementError, UserManagementError } from "./user_management.js";
import { readJsonBody } from "../http/json.js";

const HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
export function userManagementJson(body, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: HEADERS });
}

export function userManagementErrorResponse(error) {
    const { status, code } = mapUserManagementError(error);
    const messages = {
        AUTHENTICATION_REQUIRED: "Sign in to continue.",
        USER_MANAGEMENT_FORBIDDEN: "You do not have permission to view or manage this account.",
        TARGET_ACCOUNT_PROTECTED: "This account is protected from your role.",
        ACCOUNT_NOT_FOUND: "The selected account could not be found.",
        ROCKET_LEAGUE_ACCOUNT_NOT_FOUND: "This account has no Rocket League profile.",
        ACCOUNT_ALREADY_SUSPENDED: "This account is already suspended.",
        ACCOUNT_ALREADY_BANNED: "This account is already banned.",
        ACCOUNT_ALREADY_REMOVED: "This account is already removed.",
        NO_ACTIVE_SUSPENSION: "There is no active suspension to lift.",
        USER_MANAGEMENT_INPUT_INVALID: "Check the information and try again.",
        USER_MANAGEMENT_QUERY_INVALID: "The requested list filters are invalid.",
        USER_MANAGEMENT_RESPONSE_INVALID: "User Management returned an invalid response.",
        USER_MANAGEMENT_TIMEOUT: "User Management took too long to respond. Try again.",
        USER_MANAGEMENT_UNAVAILABLE: "User Management is temporarily unavailable. Try again."
    };
    if (status >= 500) console.error("[USER MANAGEMENT API] Request failed.", { code });
    return userManagementJson({ success: false, error: code, message: messages[code] || (status >= 500 ? messages.USER_MANAGEMENT_UNAVAILABLE : "The request could not be completed.") }, status);
}

export async function readUserManagementJson(request) {
    if (request.headers.get("origin") !== new URL(request.url).origin) {
        throw new UserManagementError("USER_MANAGEMENT_INPUT_INVALID", 403);
    }
    if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
        throw new UserManagementError("USER_MANAGEMENT_INPUT_INVALID", 415);
    }
    const result = await readJsonBody(request, 12288);
    if (result.tooLarge) throw new UserManagementError("USER_MANAGEMENT_INPUT_INVALID", 413);
    if (!result.success) throw new UserManagementError("USER_MANAGEMENT_INPUT_INVALID", 400);
    return result.data;
}

export function requireMethod(request, methods) {
    const method = String(request?.method || "").toUpperCase();
    if (!methods.includes(method)) return userManagementJson({ success: false, error: "METHOD_NOT_ALLOWED", message: "Method not allowed." }, 405);
    return null;
}
