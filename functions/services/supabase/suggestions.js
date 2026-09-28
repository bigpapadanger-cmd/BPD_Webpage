"use strict";

const RPC_NAMES = Object.freeze({
    LIST_PUBLIC: "list_website_suggestions",
    CREATE: "create_website_suggestion",
    TOGGLE_VOTE: "toggle_website_suggestion_vote",
    LIST_PENDING: "admin_list_pending_website_suggestions",
    REVIEW: "admin_review_website_suggestion"
});

const ALLOWED_RPCS = new Set(Object.values(RPC_NAMES));
const REQUEST_TIMEOUT_MS = 10000;

export class SuggestionsServiceError extends Error {
    constructor(code, status = 503) {
        super(code);
        this.name = "SuggestionsServiceError";
        this.code = code;
        this.status = status;
    }
}

export async function callSuggestionsRpc(env, rpcName, parameters = {}) {
    if (!ALLOWED_RPCS.has(rpcName)) {
        throw new SuggestionsServiceError("SUGGESTIONS_RPC_NOT_ALLOWED", 500);
    }

    const supabaseUrl = typeof env?.SUPABASE_URL === "string"
        ? env.SUPABASE_URL.trim().replace(/\/+$/, "").replace(/\/rest\/v1$/, "")
        : "";
    const serviceRoleKey = typeof env?.SUPABASE_AUTH === "string"
        ? env.SUPABASE_AUTH.trim()
        : "";

    if (!supabaseUrl || !serviceRoleKey) {
        throw new SuggestionsServiceError("SUGGESTIONS_SERVICE_UNAVAILABLE", 503);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
        const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${rpcName}`, {
            method: "POST",
            headers: {
                apikey: serviceRoleKey,
                Authorization: `Bearer ${serviceRoleKey}`,
                "Content-Type": "application/json",
                Accept: "application/json",
                "Content-Profile": "api",
                "Accept-Profile": "api"
            },
            body: JSON.stringify(parameters),
            signal: controller.signal
        });

        if (!response.ok) {
            const responseText = await response.text();
            let upstreamMessage = "";
            try {
                upstreamMessage = JSON.parse(responseText)?.message || "";
            } catch {
                // Never include raw upstream response text in logs or client errors.
            }
            const knownErrors = {
                SUGGESTION_NOT_FOUND: 404,
                SUGGESTION_NOT_PENDING: 409,
                ACCOUNT_NOT_AVAILABLE: 403,
                REVIEW_STATUS_INVALID: 400
            };
            const knownStatus = knownErrors[upstreamMessage];
            console.error("Suggestions RPC failed.", {
                rpcName,
                status: response.status,
                errorCode: knownStatus ? upstreamMessage : "SUPABASE_RPC_FAILED"
            });
            if (knownStatus) throw new SuggestionsServiceError(upstreamMessage, knownStatus);
            throw new SuggestionsServiceError("SUGGESTIONS_DATA_UNAVAILABLE", 503);
        }

        const responseText = await response.text();
        if (!responseText) return null;

        try {
            return JSON.parse(responseText);
        } catch {
            throw new SuggestionsServiceError("SUGGESTIONS_DATA_INVALID", 502);
        }
    } catch (error) {
        if (error instanceof SuggestionsServiceError) throw error;
        if (error?.name === "AbortError") {
            throw new SuggestionsServiceError("SUGGESTIONS_DATA_TIMEOUT", 503);
        }
        console.error("Suggestions RPC transport failed.", { rpcName });
        throw new SuggestionsServiceError("SUGGESTIONS_DATA_UNAVAILABLE", 503);
    } finally {
        clearTimeout(timeoutId);
    }
}

export const SUGGESTIONS_RPCS = RPC_NAMES;
