import { sanitizeLogMetadata } from "../http/diagnostics.js";
import { authorizeRocketLeagueRequest, authorizationErrorResponse } from "../rl/authorization.js";
import { emitOcrNotificationEvent } from "../notifications/persistence.js";
"use strict";

/* =========================================================
BPD GAMING NETWORK
OCR REQUEST HANDLER

File:
    functions/services/ocr/handler.js

Service:
    Direct OCR request handler

Purpose:
    Authenticates and forwards a Rocket League OCR request
    from Cloudflare to the Cloud Run OCR service.

Description:
    - Requires a valid global BPD session.
    - Requires a linked Epic account for Rocket League OCR.
    - Uses identity.accounts.id as the canonical OCR owner.
    - Replaces all browser-supplied ownership metadata.
    - Forwards trusted ownership metadata to Cloud Run.
    - Preserves the Cloud Run HTTP response status.

Identity Model:
    session.userId
        = identity.accounts.id

    providers.epic.accountId
        = Epic provider subject

Ownership Model:
    submittedBy
        = HMAC-SHA256(identity.accounts.id, OCR_OWNER_SECRET)

    ownerType
        = "account"

    ownerVersion
        = 2

Important:
    - Epic is required for Rocket League access.
    - Epic account ID is NOT the OCR ownership key.
    - No provider tokens are forwarded or stored.
========================================================= */

import {
    getProviderContext
} from "../auth/sessions/session_context.js";

import {
    fetchOcrThroughGoogleWorker
} from "./googleCloudTransport.js";

/* =========================================================
VERSION
========================================================= */

const OCR_HANDLER_VERSION =
    "ocr-handler-3.0";

const OWNER_TYPE =
    "account";

const OWNER_VERSION =
    2;

const IDEMPOTENCY_KEY =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACCOUNT_UUID =
    IDEMPOTENCY_KEY;

/* =========================================================
OWNER HASH
========================================================= */

async function createOwnerHash(
    accountId,
    secret
) {
    const encoder =
        new TextEncoder();

    const key =
        await crypto.subtle.importKey(
            "raw",
            encoder.encode(
                String(
                    secret
                )
            ),
            {
                name:
                    "HMAC",

                hash:
                    "SHA-256"
            },
            false,
            [
                "sign"
            ]
        );

    const signature =
        await crypto.subtle.sign(
            "HMAC",
            key,
            encoder.encode(
                String(
                    accountId
                )
            )
        );

    return Array.from(
        new Uint8Array(
            signature
        )
    )
        .map(
            function(
                byte
            ) {
                return byte
                    .toString(
                        16
                    )
                    .padStart(
                        2,
                        "0"
                    );
            }
        )
        .join(
            ""
        );
}

/* =========================================================
NORMALIZATION
========================================================= */

function normalizeString(
    value
) {
    if (
        typeof value !==
            "string"
    ) {
        return "";
    }

    return value.trim();
}

/* =========================================================
JSON RESPONSE
========================================================= */

function jsonResponse(
    body,
    status = 200
) {
    return new Response(
        JSON.stringify(
            body
        ),
        {
            status,

            headers: {
                "Content-Type":
                    "application/json; charset=utf-8",

                "Cache-Control":
                    "no-store"
            }
        }
    );
}

/* =========================================================
MAIN OCR REQUEST
========================================================= */

export async function handleOCRRequest(
    request,
    env
) {
    let authenticatedAccountId = "";
    let terminalFailureJobId = "";
    let upstreamAttemptStarted = false;
    try {
        /* =================================================
        METHOD
        ================================================= */

        if (
            request.method !==
            "POST"
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    error:
                        "Method not allowed.",

                    handlerVersion:
                        OCR_HANDLER_VERSION
                },
                405
            );
        }

        const idempotencyKey = normalizeString(request.headers.get("Idempotency-Key"));
        if (!idempotencyKey) {
            return jsonResponse({ success: false, code: "IDEMPOTENCY_KEY_REQUIRED", error: "A valid Idempotency-Key is required." }, 400);
        }
        if (!IDEMPOTENCY_KEY.test(idempotencyKey)) {
            return jsonResponse({ success: false, code: "IDEMPOTENCY_KEY_INVALID", error: "The Idempotency-Key is invalid." }, 400);
        }

        /* =================================================
        CONFIGURATION
        ================================================= */

        const ownerSecret =
            normalizeString(
                env.OCR_OWNER_SECRET
            );

        if (
            !ownerSecret
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    error:
                        "OCR owner hashing is not configured.",

                    handlerVersion:
                        OCR_HANDLER_VERSION
                },
                503
            );
        }

        /* =================================================
        CONTENT TYPE
        ================================================= */

        const contentType =
            normalizeString(
                request.headers.get(
                    "Content-Type"
                )
            )
                .toLowerCase();

        if (
            !contentType.includes(
                "multipart/form-data"
            )
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    error:
                        "OCR requests must use multipart/form-data.",

                    handlerVersion:
                        OCR_HANDLER_VERSION
                },
                400
            );
        }

        /* =================================================
        GLOBAL BPD SESSION
        ================================================= */

        let verifiedAuthorization;
        try { verifiedAuthorization = await authorizeRocketLeagueRequest(request, env, "submit_scoreboard"); }
        catch (error) { return authorizationErrorResponse(error); }
        const session = { ...verifiedAuthorization.sessionContext, providers: {
            ...verifiedAuthorization.sessionContext.providers,
            epic: { linked: true, authenticated: true, authorized: true,
                accountId: verifiedAuthorization.provider.subject }
        } };

        if (
            session.authenticated !==
            true
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    code:
                        "AUTHENTICATION_REQUIRED",

                    message:
                        "Authentication required.",

                    handlerVersion:
                        OCR_HANDLER_VERSION
                },
                401
            );
        }

        const accountId =
            normalizeString(
                session.userId
            );

        if (
            !accountId
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    code:
                        "ACCOUNT_IDENTITY_MISSING",

                    message:
                        "Authenticated account identity is unavailable.",

                    handlerVersion:
                        OCR_HANDLER_VERSION
                },
                409
            );
        }

        authenticatedAccountId = accountId;

        if (
            session.active !==
            true
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    code:
                        "ACCOUNT_INACTIVE",

                    message:
                        "This BPD account is not active.",

                    handlerVersion:
                        OCR_HANDLER_VERSION
                },
                403
            );
        }

        /* =================================================
        EPIC REQUIREMENT

        Rocket League OCR requires a linked Epic identity,
        but Epic is not used as the ownership identifier.
        ================================================= */

        const epic =
            getProviderContext(
                session,
                "epic"
            );

        const epicAccountId =
            normalizeString(
                epic?.accountId
            );

        if (
            epic?.linked !==
                true
            || !epicAccountId
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    code:
                        "EPIC_ACCOUNT_REQUIRED",

                    message:
                        "A linked Epic account is required for Rocket League OCR.",

                    handlerVersion:
                        OCR_HANDLER_VERSION
                },
                403
            );
        }

        /* =================================================
        CREATE TRUSTED OWNER ID
        ================================================= */

        const submittedBy =
            await createOwnerHash(
                accountId,
                ownerSecret
            );
        terminalFailureJobId = await createLegacyFailureJobId(
            accountId,
            ownerSecret,
            idempotencyKey
        );

        /* =================================================
        PARSE MULTIPART FORM

        The request is rebuilt as FormData so Cloudflare can
        replace ownership fields before forwarding to Cloud
        Run.
        ================================================= */

        let formData;

        try {
            formData =
                await request.formData();
        }
        catch {
            return jsonResponse(
                {
                    success:
                        false,

                    error:
                        "Unable to read OCR request form data.",

                    handlerVersion:
                        OCR_HANDLER_VERSION
                },
                400
            );
        }

        /* =================================================
        VALIDATE IMAGE
        ================================================= */

        const file =
            formData.get(
                "file"
            )
            || formData.get(
                "image"
            );

        if (
            !file
            || typeof file.arrayBuffer !==
                "function"
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    error:
                        "Missing file upload.",

                    handlerVersion:
                        OCR_HANDLER_VERSION
                },
                400
            );
        }

        if (
            Number.isFinite(
                Number(
                    file.size
                )
            )
            && Number(
                file.size
            ) <= 0
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    error:
                        "Uploaded image is empty.",

                    handlerVersion:
                        OCR_HANDLER_VERSION
                },
                400
            );
        }

        /* =================================================
        FORCE SERVER-DERIVED OWNERSHIP

        set() replaces any browser-supplied value.
        ================================================= */

        formData.set(
            "submittedBy",
            submittedBy
        );

        formData.set(
            "ownerType",
            OWNER_TYPE
        );

        formData.set(
            "ownerVersion",
            String(
                OWNER_VERSION
            )
        );

        /*
         * Explicitly remove alternate ownership fields that a
         * browser might attempt to provide.
         */
        formData.delete(
            "ownerId"
        );

        formData.delete(
            "accountId"
        );

        formData.delete(
            "userId"
        );

        formData.delete(
            "EpicUniqueId"
        );

        formData.delete(
            "epicUniqueId"
        );

        /* =================================================
        FORWARD TO CLOUD RUN

        Do not manually set Content-Type.
        fetch() generates the multipart boundary.
        ================================================= */

        const upstreamHeaders = new Headers();
        upstreamHeaders.set(
            "X-BPD-OCR-Handler-Version",
            OCR_HANDLER_VERSION
        );

        const ocrResponse =
            await fetchOcrThroughGoogleWorker(
                env,
                formData,
                upstreamHeaders,
                undefined,
                () => { upstreamAttemptStarted = true; }
            );

        /* =================================================
        READ UPSTREAM RESPONSE
        ================================================= */

        const responseContentType =
            normalizeString(
                ocrResponse.headers.get(
                    "Content-Type"
                )
            )
                .toLowerCase();

        let result;

        if (
            responseContentType.includes(
                "application/json"
            )
        ) {
            try {
                result =
                    await ocrResponse.json();
            }
            catch {
                result = {
                    success:
                        false,

                    error:
                        "OCR provider returned invalid JSON."
                };
            }
        }
        else {
            const text =
                await ocrResponse.text();

            result = {
                success:
                    ocrResponse.ok,

                message:
                    text
                    || (
                        ocrResponse.ok
                            ? "OCR request completed."
                            : "OCR provider failed."
                    )
            };
        }

        if (!ocrResponse.ok || result?.success === false) {
            await persistLegacyFailureEvent(env, authenticatedAccountId, terminalFailureJobId);
        }

        /* =================================================
        PRESERVE PROVIDER STATUS
        ================================================= */

        return jsonResponse(
            {
                ...(
                    typeof result ===
                        "object"
                    && result !==
                        null
                        ? result
                        : {
                            result
                        }
                ),

                handlerVersion:
                    OCR_HANDLER_VERSION
            },
            ocrResponse.status
        );
    }
    catch (
        error
    ) {
        if (upstreamAttemptStarted && authenticatedAccountId && terminalFailureJobId) {
            await persistLegacyFailureEvent(env, authenticatedAccountId, terminalFailureJobId);
        }
        console.error(
            "OCR request handler failed.",
            sanitizeLogMetadata({
                message:
                    error?.message
                    || "Unknown error"
            })
        );

        return jsonResponse(
            {
                success:
                    false,

                error:
                    "OCR request failed.",

                handlerVersion:
                    OCR_HANDLER_VERSION
            },
            500
        );
    }
}

export async function createLegacyFailureJobId(accountId, secret, idempotencyKey) {
    if (!ACCOUNT_UUID.test(String(accountId || "")) || typeof secret !== "string" || !secret.trim()) {
        throw new TypeError("A verified account and OCR owner secret are required.");
    }
    if (!IDEMPOTENCY_KEY.test(String(idempotencyKey || ""))) {
        throw new TypeError("A valid Idempotency-Key is required.");
    }
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`legacy-ocr-event-v1\0${accountId.toLowerCase()}\0${idempotencyKey.toLowerCase()}`));
    return Array.from(new Uint8Array(digest).slice(0, 8), value => value.toString(16).padStart(2, "0")).join("").toUpperCase();
}

async function persistLegacyFailureEvent(env, accountId, jobId) {
    try {
        await emitOcrNotificationEvent(env, { accountId, jobId, eventType: "failed" });
    } catch (error) {
        console.warn("Legacy OCR failure notification could not be persisted.", sanitizeLogMetadata({
            code: error?.code || "NOTIFICATIONS_UNAVAILABLE"
        }));
    }
}
