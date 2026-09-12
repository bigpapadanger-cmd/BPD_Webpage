"use strict";

/* =========================================================
BPD GAMING NETWORK
OCR MATCH IMAGE

File:
    functions/api/ocr/jobs/image.js

Public Route:
    GET /api/ocr/jobs/image?matchId={matchId}

Purpose:
    Returns the stored OCR scoreboard image to the owner.

Description:
    - Requires a valid global BPD session.
    - New OCR results are owned by identity.accounts.id.
    - Existing Epic-owned OCR results remain accessible.
    - Uses originating OCR job metadata when the match report
      does not contain ownership-version metadata.
    - Returns the image only after ownership verification.

Ownership Model:
    Version 2:
        ownerType = "account"
        ownerVersion = 2
        ownerId/submittedBy = HMAC(identity.accounts.id)

    Legacy:
        owner metadata absent
        submittedBy = HMAC(Epic provider subject)
========================================================= */

import {
    getSessionContext,
    getProviderContext
} from "../../../services/auth/sessions/session_context.js";

import {
    getCurrentMatchReport
} from "../../../services/ocr/storage.js";

/* =========================================================
VERSION
========================================================= */

const OCR_GET_IMAGE_VERSION =
    "ocr-get-image-3.0";

const OWNER_TYPE_ACCOUNT =
    "account";

const OWNER_VERSION_ACCOUNT =
    2;

/* =========================================================
MAIN
========================================================= */

export async function onRequestGet(
    context
) {
    const {
        request,
        env
    } = context;

    try {
        /* =================================================
        CONFIGURATION
        ================================================= */

        if (
            !env.OCR_STORAGE
        ) {
            return jsonResponse(
                {
                    success:
                        false,
                    code:
                        "OCR_STORAGE_MISSING",
                    message:
                        "OCR storage is not configured."
                },
                500
            );
        }

        if (
            !env.OCR_OWNER_SECRET
        ) {
            return jsonResponse(
                {
                    success:
                        false,
                    code:
                        "OCR_OWNER_SECRET_MISSING",
                    message:
                        "OCR owner hashing is not configured."
                },
                503
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
            session.authenticated !== true
        ) {
            return jsonResponse(
                {
                    success:
                        false,
                    code:
                        "AUTHENTICATION_REQUIRED",
                    message:
                        "Authentication required."
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
                        "Authenticated account identity is unavailable."
                },
                409
            );
        }

        if (
            session.active !== true
        ) {
            return jsonResponse(
                {
                    success:
                        false,
                    code:
                        "ACCOUNT_INACTIVE",
                    message:
                        "This BPD account is not active."
                },
                403
            );
        }

        /* =================================================
        MATCH ID
        ================================================= */

        const url =
            new URL(
                request.url
            );

        const matchId =
            sanitizeMatchId(
                url.searchParams.get(
                    "matchId"
                )
            );

        if (
            !matchId
        ) {
            return jsonResponse(
                {
                    success:
                        false,
                    code:
                        "MATCH_ID_INVALID",
                    message:
                        "Missing or invalid matchId."
                },
                400
            );
        }

        /* =================================================
        LOAD MATCH REPORT
        ================================================= */

        let reportObject =
            await getCurrentMatchReport(
                env.OCR_STORAGE,
                matchId
            );

        /*
         * Temporary legacy fallback.
         *
         * Current:
         * match-reports/{matchId}/current.json
         *
         * Legacy:
         * match-reports/{matchId}.json
         */
        if (
            !reportObject
        ) {
            reportObject =
                await env.OCR_STORAGE.get(
                    `match-reports/${matchId}.json`
                );
        }

        if (
            !reportObject
        ) {
            return jsonResponse(
                {
                    success:
                        false,
                    code:
                        "MATCH_REPORT_NOT_FOUND",
                    message:
                        "Stored match report was not found."
                },
                404
            );
        }

        let matchReport;

        try {
            matchReport =
                await reportObject.json();
        }
        catch {
            return jsonResponse(
                {
                    success:
                        false,
                    code:
                        "MATCH_REPORT_INVALID",
                    message:
                        "Stored match report is invalid."
                },
                500
            );
        }

        if (
            !matchReport
            || typeof matchReport !==
                "object"
            || Array.isArray(
                matchReport
            )
        ) {
            return jsonResponse(
                {
                    success:
                        false,
                    code:
                        "MATCH_REPORT_INVALID",
                    message:
                        "Stored match report is invalid."
                },
                500
            );
        }

        /* =================================================
        MATCH ID VERIFICATION
        ================================================= */

        const storedMatchId =
            sanitizeMatchId(
                matchReport?.matchId
            );

        if (
            storedMatchId !==
            matchId
        ) {
            return jsonResponse(
                {
                    success:
                        false,
                    code:
                        "MATCH_ID_MISMATCH",
                    message:
                        "Stored match report does not match this match ID."
                },
                409
            );
        }

        /* =================================================
        JOB LINEAGE
        ================================================= */

        const jobId =
            sanitizeJobId(
                matchReport?.jobId
            );

        /* =================================================
        OWNERSHIP RESOLUTION
        ================================================= */

        const ownership =
            await resolveMatchOwnership(
                env,
                matchReport,
                jobId
            );

        if (
            !ownership
        ) {
            return jsonResponse(
                {
                    success:
                        false,
                    code:
                        "MATCH_OWNER_MISSING",
                    message:
                        "Stored match report has no valid owner."
                },
                409
            );
        }

        /* =================================================
        AUTHENTICATED OWNER
        ================================================= */

        const authenticatedOwnerId =
            await resolveAuthenticatedOwnerHash(
                session,
                ownership,
                env.OCR_OWNER_SECRET
            );

        if (
            !authenticatedOwnerId
        ) {
            return jsonResponse(
                {
                    success:
                        false,
                    code:
                        ownership.isLegacy
                            ? "EPIC_ACCOUNT_REQUIRED"
                            : "ACCOUNT_IDENTITY_MISSING",
                    message:
                        ownership.isLegacy
                            ? "A linked Epic account is required to access this legacy OCR image."
                            : "Authenticated account identity is unavailable."
                },
                ownership.isLegacy
                    ? 403
                    : 409
            );
        }

        /* =================================================
        VERIFY OWNERSHIP
        ================================================= */

        if (
            !constantTimeEqual(
                ownership.ownerId,
                authenticatedOwnerId
            )
        ) {
            return jsonResponse(
                {
                    success:
                        false,
                    code:
                        "MATCH_IMAGE_ACCESS_DENIED",
                    message:
                        "You are not authorized to access this OCR image."
                },
                403
            );
        }

        /* =================================================
        LOAD MATCH IMAGE
        ================================================= */

        const imageObject =
            await env.OCR_STORAGE.get(
                `match-images/${matchId}.png`
            );

        if (
            !imageObject
        ) {
            return jsonResponse(
                {
                    success:
                        false,
                    code:
                        "MATCH_IMAGE_NOT_FOUND",
                    message:
                        "Stored match image was not found."
                },
                404
            );
        }

        /* =================================================
        RESPONSE HEADERS
        ================================================= */

        const headers =
            new Headers();

        headers.set(
            "Content-Type",
            imageObject
                .httpMetadata
                ?.contentType
            || "image/png"
        );

        headers.set(
            "Cache-Control",
            "private, no-store"
        );

        headers.set(
            "X-OCR-Image-Version",
            OCR_GET_IMAGE_VERSION
        );

        headers.set(
            "X-OCR-Match-ID",
            matchId
        );

        if (
            imageObject.httpEtag
        ) {
            headers.set(
                "ETag",
                imageObject.httpEtag
            );
        }

        return new Response(
            imageObject.body,
            {
                status:
                    200,
                headers
            }
        );
    }
    catch (
        error
    ) {
        console.error(
            "OCR get image failed:",
            error
        );

        return jsonResponse(
            {
                success:
                    false,
                code:
                    "OCR_IMAGE_LOAD_FAILED",
                message:
                    "Unable to load OCR image."
            },
            500
        );
    }
}

/* =========================================================
OWNERSHIP RESOLUTION
========================================================= */

async function resolveMatchOwnership(
    env,
    matchReport,
    jobId
) {
    const reportOwnerId =
        normalizeString(
            matchReport?.ownerId
            || matchReport?.submittedBy
        );

    const reportOwnerType =
        normalizeString(
            matchReport?.ownerType
        )
            .toLowerCase();

    const reportOwnerVersion =
        normalizePositiveInteger(
            matchReport?.ownerVersion
        );

    if (
        reportOwnerId
        && reportOwnerType ===
            OWNER_TYPE_ACCOUNT
        && reportOwnerVersion ===
            OWNER_VERSION_ACCOUNT
    ) {
        return {
            ownerId:
                reportOwnerId,
            ownerType:
                OWNER_TYPE_ACCOUNT,
            ownerVersion:
                OWNER_VERSION_ACCOUNT,
            isLegacy:
                false
        };
    }

    /*
     * New reports may still only contain submittedBy while
     * the originating job contains ownerType/version.
     */
    if (
        jobId
    ) {
        const jobOwnership =
            await resolveJobOwnership(
                env,
                jobId
            );

        if (
            jobOwnership
        ) {
            if (
                reportOwnerId
                && !constantTimeEqual(
                    reportOwnerId,
                    jobOwnership.ownerId
                )
            ) {
                return null;
            }

            return jobOwnership;
        }
    }

    /*
     * Reports without ownership metadata and without usable
     * job lineage are treated as legacy Epic-owned reports.
     */
    if (
        reportOwnerId
        && !reportOwnerType
        && reportOwnerVersion ===
            null
    ) {
        return {
            ownerId:
                reportOwnerId,
            ownerType:
                "epic",
            ownerVersion:
                1,
            isLegacy:
                true
        };
    }

    return null;
}

/* =========================================================
JOB OWNERSHIP RESOLUTION
========================================================= */

async function resolveJobOwnership(
    env,
    jobId
) {
    const baseKey =
        `ocr-jobs/${jobId}`;

    const statusObject =
        await env.OCR_STORAGE.get(
            `${baseKey}/status.json`
        );

    if (
        statusObject
    ) {
        const statusData =
            await readStoredJson(
                statusObject
            );

        if (
            statusData
            && sanitizeJobId(
                statusData?.jobId
            ) ===
                jobId
        ) {
            const ownership =
                normalizeStoredOwnership(
                    statusData?.ownerId,
                    statusData?.ownerType,
                    statusData?.ownerVersion
                );

            if (
                ownership
            ) {
                return ownership;
            }
        }
    }

    const requestObject =
        await env.OCR_STORAGE.get(
            `${baseKey}/request.json`
        );

    if (
        !requestObject
    ) {
        return null;
    }

    const requestData =
        await readStoredJson(
            requestObject
        );

    if (
        !requestData
        || sanitizeJobId(
            requestData?.jobId
        ) !==
            jobId
    ) {
        return null;
    }

    return normalizeStoredOwnership(
        requestData?.ownerId
            || requestData
                ?.fields
                ?.submittedBy,
        requestData?.ownerType
            || requestData
                ?.fields
                ?.ownerType,
        requestData?.ownerVersion
            ?? requestData
                ?.fields
                ?.ownerVersion
    );
}

function normalizeStoredOwnership(
    ownerId,
    ownerType,
    ownerVersion
) {
    const normalizedOwnerId =
        normalizeString(
            ownerId
        );

    const normalizedOwnerType =
        normalizeString(
            ownerType
        )
            .toLowerCase();

    const normalizedOwnerVersion =
        normalizePositiveInteger(
            ownerVersion
        );

    if (
        !normalizedOwnerId
    ) {
        return null;
    }

    if (
        normalizedOwnerType ===
            OWNER_TYPE_ACCOUNT
        && normalizedOwnerVersion ===
            OWNER_VERSION_ACCOUNT
    ) {
        return {
            ownerId:
                normalizedOwnerId,
            ownerType:
                OWNER_TYPE_ACCOUNT,
            ownerVersion:
                OWNER_VERSION_ACCOUNT,
            isLegacy:
                false
        };
    }

    if (
        !normalizedOwnerType
        && normalizedOwnerVersion ===
            null
    ) {
        return {
            ownerId:
                normalizedOwnerId,
            ownerType:
                "epic",
            ownerVersion:
                1,
            isLegacy:
                true
        };
    }

    return null;
}

/* =========================================================
AUTHENTICATED OWNER
========================================================= */

async function resolveAuthenticatedOwnerHash(
    session,
    ownership,
    secret
) {
    if (
        ownership.ownerType ===
            OWNER_TYPE_ACCOUNT
        && ownership.ownerVersion ===
            OWNER_VERSION_ACCOUNT
    ) {
        const accountId =
            normalizeString(
                session.userId
            );

        if (
            !accountId
        ) {
            return null;
        }

        return createOwnerHash(
            accountId,
            secret
        );
    }

    if (
        ownership.isLegacy ===
            true
    ) {
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
            epic?.linked !== true
            || !epicAccountId
        ) {
            return null;
        }

        return createOwnerHash(
            epicAccountId,
            secret
        );
    }

    return null;
}

/* =========================================================
STORED JSON
========================================================= */

async function readStoredJson(
    object
) {
    try {
        const data =
            JSON.parse(
                await object.text()
            );

        if (
            !data
            || typeof data !==
                "object"
            || Array.isArray(
                data
            )
        ) {
            return null;
        }

        return data;
    }
    catch {
        return null;
    }
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

function normalizePositiveInteger(
    value
) {
    if (
        value === null
        || value === undefined
        || String(
            value
        )
            .trim() ===
            ""
    ) {
        return null;
    }

    const numeric =
        Number(
            value
        );

    if (
        !Number.isInteger(
            numeric
        )
        || numeric <= 0
    ) {
        return null;
    }

    return numeric;
}

/* =========================================================
OWNER HASH
========================================================= */

async function createOwnerHash(
    ownerIdentity,
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
                    ownerIdentity
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
CONSTANT-TIME STRING COMPARE
========================================================= */

function constantTimeEqual(
    first,
    second
) {
    const encoder =
        new TextEncoder();

    const firstBytes =
        encoder.encode(
            String(
                first
                || ""
            )
        );

    const secondBytes =
        encoder.encode(
            String(
                second
                || ""
            )
        );

    const maxLength =
        Math.max(
            firstBytes.length,
            secondBytes.length
        );

    let difference =
        firstBytes.length
        ^ secondBytes.length;

    for (
        let index = 0;
        index < maxLength;
        index += 1
    ) {
        difference |=
            (
                firstBytes[index]
                || 0
            )
            ^ (
                secondBytes[index]
                || 0
            );
    }

    return difference ===
        0;
}

/* =========================================================
JOB ID
========================================================= */

function sanitizeJobId(
    value
) {
    const jobId =
        String(
            value
            || ""
        )
            .trim()
            .toUpperCase();

    return /^[A-Z0-9]{16}$/.test(
        jobId
    )
        ? jobId
        : null;
}

/* =========================================================
MATCH ID
========================================================= */

function sanitizeMatchId(
    value
) {
    const matchId =
        String(
            value
            || ""
        )
            .trim()
            .toUpperCase();

    return /^[A-Z0-9]{16}$/.test(
        matchId
    )
        ? matchId
        : null;
}

/* =========================================================
JSON RESPONSE
========================================================= */

function jsonResponse(
    data,
    status = 200
) {
    return new Response(
        JSON.stringify(
            data
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