// ============================================================
// BPD GAMING NETWORK
// OCR MATCH - INTERNAL STORAGE SERVICE
// ============================================================

import {
    putMatchImage,
    putMatchReport
} from "./storage.js";


const STORE_MATCH_VERSION =
    "ocr-store-match-1.0";


// ============================================================
// JSON RESPONSE
// ============================================================

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
                    "application/json",

                "Cache-Control":
                    "no-store"
            }
        }
    );
}


// ============================================================
// AUTH
// ============================================================

function getBearerToken(
    request
) {
    const authorization =
        String(
            request.headers.get(
                "Authorization"
            )
            || ""
        ).trim();

    if (
        !authorization.startsWith(
            "Bearer "
        )
    ) {
        return "";
    }

    return authorization
        .slice(
            7
        )
        .trim();
}


function constantTimeEqual(
    first,
    second
) {
    const a =
        new TextEncoder().encode(
            String(
                first
                || ""
            )
        );

    const b =
        new TextEncoder().encode(
            String(
                second
                || ""
            )
        );

    if (
        a.length
        !== b.length
    ) {
        return false;
    }

    let result = 0;

    for (
        let index = 0;
        index < a.length;
        index += 1
    ) {
        result |=
            a[index]
            ^ b[index];
    }

    return result === 0;
}


function validateInternalRequest(
    request,
    env
) {
    const expectedToken =
        String(
            env.OCR_STORAGE_TOKEN
            || ""
        ).trim();

    if (!expectedToken) {
        return {
            valid:
                false,

            status:
                503,

            reason:
                "OCR storage authentication is not configured."
        };
    }

    const receivedToken =
        getBearerToken(
            request
        );

    if (
        !receivedToken
        || !constantTimeEqual(
            receivedToken,
            expectedToken
        )
    ) {
        return {
            valid:
                false,

            status:
                401,

            reason:
                "Unauthorized."
        };
    }

    return {
        valid:
            true
    };
}


// ============================================================
// MATCH ID
// ============================================================

function normalizeMatchId(
    value
) {
    return String(
        value
        || ""
    )
        .trim()
        .toUpperCase();
}


function validMatchId(
    value
) {
    return /^[A-Z0-9]{16}$/.test(
        value
    );
}


// ============================================================
// REPORT PARSING
// ============================================================

function parseMatchReport(
    rawValue
) {
    if (
        rawValue === null
        || typeof rawValue === "undefined"
    ) {
        return null;
    }

    if (
        typeof rawValue === "object"
        && typeof rawValue.arrayBuffer
            !== "function"
    ) {
        return rawValue;
    }

    try {
        const parsed =
            JSON.parse(
                String(
                    rawValue
                )
            );

        if (
            parsed
            && typeof parsed === "object"
            && !Array.isArray(
                parsed
            )
        ) {
            return parsed;
        }

    } catch {
        return null;
    }

    return null;
}


// ============================================================
// MAIN STORE-MATCH HANDLER
// ============================================================

export async function handleStoreMatch(
    request,
    env
) {
    try {
        // ----------------------------------------------------
        // METHOD
        // ----------------------------------------------------

        if (
            request.method
            !== "POST"
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    message:
                        "Method not allowed."
                },
                405
            );
        }

        // ----------------------------------------------------
        // AUTH
        // ----------------------------------------------------

        const authentication =
            validateInternalRequest(
                request,
                env
            );

        if (
            !authentication.valid
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    message:
                        authentication.reason
                },
                authentication.status
            );
        }

        // ----------------------------------------------------
        // R2
        // ----------------------------------------------------

        if (
            !env.OCR_STORAGE
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    message:
                        "OCR_STORAGE R2 binding is unavailable."
                },
                503
            );
        }

        // ----------------------------------------------------
        // MULTIPART
        // ----------------------------------------------------

        const formData =
            await request.formData();

        const image =
            formData.get(
                "image"
            );

        const matchId =
            normalizeMatchId(
                formData.get(
                    "matchId"
                )
            );

        const matchReport =
            parseMatchReport(
                formData.get(
                    "matchReport"
                )
            );

        // ----------------------------------------------------
        // VALIDATION
        // ----------------------------------------------------

        if (
            !validMatchId(
                matchId
            )
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    message:
                        "matchId must be a 16-character alphanumeric ID."
                },
                400
            );
        }

        if (
            !image
            || typeof image.arrayBuffer
            !== "function"
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    message:
                        "Match image is required."
                },
                400
            );
        }

        if (
            !matchReport
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    message:
                        "matchReport must contain valid JSON."
                },
                400
            );
        }

        if (
            matchReport.matchId
            && normalizeMatchId(
                matchReport.matchId
            )
            !== matchId
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    message:
                        "matchReport.matchId does not match matchId."
                },
                400
            );
        }

        // ----------------------------------------------------
        // IMAGE BYTES
        // ----------------------------------------------------

        const imageBytes =
            await image.arrayBuffer();

        if (
            !imageBytes
            || imageBytes.byteLength
            === 0
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    message:
                        "Match image is empty."
                },
                400
            );
        }

        // ----------------------------------------------------
        // CONTENT TYPE
        // ----------------------------------------------------

        const contentType =
            String(
                image.type
                || "image/png"
            );

        // ----------------------------------------------------
        // STORE IMAGE
        // ----------------------------------------------------

        const imageResult =
            await putMatchImage(
                env.OCR_STORAGE,
                {
                    matchId,

                    image:
                        imageBytes,

                    contentType,

                    metadata: {
                        submittedBy:
                            matchReport.submittedBy
                            || "",

                        matchType:
                            matchReport.matchType
                            || "",

                        matchSeason:
                            matchReport.matchSeason
                            || "",

                        ocrVersion:
                            matchReport.ocrVersion
                            || ""
                    }
                }
            );

        // ----------------------------------------------------
        // STORE REPORT
        // ----------------------------------------------------

        const reportResult =
            await putMatchReport(
                env.OCR_STORAGE,
                {
                    matchId,

                    report:
                        matchReport
                }
            );

        // ----------------------------------------------------
        // SUCCESS
        // ----------------------------------------------------

        return jsonResponse(
            {
                success:
                    true,

                stored:
                    true,

                matchId,

                imageKey:
                    imageResult.objectKey,

                reportKey:
                    reportResult.objectKey,

                version:
                    STORE_MATCH_VERSION
            },
            200
        );

    } catch (error) {
        return jsonResponse(
            {
                success:
                    false,

                message:
                    "Match storage failed.",

                error:
                    String(
                        error?.message
                        || error
                    ),

                version:
                    STORE_MATCH_VERSION
            },
            500
        );
    }
}