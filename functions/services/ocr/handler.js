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
    getSessionContext,
    getProviderContext
} from "../auth/sessions/session_context.js";

/* =========================================================
VERSION
========================================================= */

const OCR_HANDLER_VERSION =
    "ocr-handler-3.0";

const OWNER_TYPE =
    "account";

const OWNER_VERSION =
    2;

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

        /* =================================================
        CONFIGURATION
        ================================================= */

        if (
            !env.OCR_API_URL
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    error:
                        "OCR API URL is not configured.",

                    handlerVersion:
                        OCR_HANDLER_VERSION
                },
                503
            );
        }

        if (
            !env.OCR_API_KEY
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    error:
                        "OCR API authentication is not configured.",

                    handlerVersion:
                        OCR_HANDLER_VERSION
                },
                503
            );
        }

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

        const session =
            await getSessionContext(
                request,
                env
            );

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

        const upstreamHeaders =
            new Headers();

        upstreamHeaders.set(
            "X-API-Key",
            env.OCR_API_KEY
        );

        upstreamHeaders.set(
            "X-BPD-OCR-Handler-Version",
            OCR_HANDLER_VERSION
        );

        const ocrResponse =
            await fetch(
                env.OCR_API_URL,
                {
                    method:
                        "POST",

                    headers:
                        upstreamHeaders,

                    body:
                        formData
                }
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
        console.error(
            "OCR request handler failed.",
            {
                message:
                    error?.message
                    || "Unknown error"
            }
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