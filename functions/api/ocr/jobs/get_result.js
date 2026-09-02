// ============================================================
// BPD GAMING NETWORK
// OCR JOB RESULT
// ============================================================

import {
    getStoredSession
} from "../../../services/common_helpers/reload_sessions.js";

const GET_RESULT_VERSION =
    "ocr-get-result-1.0";

// ============================================================
// MAIN
// ============================================================

export async function onRequestGet(
    context
) {
    const {
        request,
        env
    } = context;

    try {
        // ====================================================
        // CONFIGURATION
        // ====================================================

        if (
            !env.OCR_STORAGE
        ) {
            return jsonResponse(
                {
                    success: false,
                    message:
                        "OCR storage is not configured.",
                    version:
                        GET_RESULT_VERSION
                },
                500
            );
        }

        if (
            !env.OCR_OWNER_SECRET
        ) {
            return jsonResponse(
                {
                    success: false,
                    message:
                        "OCR owner hashing is not configured.",
                    version:
                        GET_RESULT_VERSION
                },
                503
            );
        }

        // ====================================================
        // AUTHENTICATION
        // ====================================================

        const session =
            await getStoredSession(
                request,
                env
            );

        if (
            !session
            || !session.sessionData
        ) {
            return jsonResponse(
                {
                    success: false,
                    message:
                        "Authentication required.",
                    version:
                        GET_RESULT_VERSION
                },
                401
            );
        }

        const epicUniqueId =
            String(
                session
                    .sessionData
                    .EpicUniqueId
                || ""
            )
            .trim();

        if (
            !epicUniqueId
        ) {
            return jsonResponse(
                {
                    success: false,
                    message:
                        "Authenticated account is missing an EpicUniqueId.",
                    version:
                        GET_RESULT_VERSION
                },
                401
            );
        }

        const authenticatedOwnerId =
            await createOwnerHash(
                epicUniqueId,
                env.OCR_OWNER_SECRET
            );

        // ====================================================
        // JOB ID
        // ====================================================

        const url =
            new URL(
                request.url
            );

        const jobId =
            sanitizeJobId(
                url.searchParams.get(
                    "jobId"
                )
            );

        if (
            !jobId
        ) {
            return jsonResponse(
                {
                    success: false,
                    message:
                        "Missing or invalid jobId.",
                    version:
                        GET_RESULT_VERSION
                },
                400
            );
        }

        // ====================================================
        // LOAD JOB STATUS
        // ====================================================

        const statusKey =
            `ocr-jobs/${jobId}/status.json`;

        const statusObject =
            await env.OCR_STORAGE.get(
                statusKey
            );

        if (
            !statusObject
        ) {
            return jsonResponse(
                {
                    success: false,
                    message:
                        "OCR job was not found.",
                    jobId,
                    version:
                        GET_RESULT_VERSION
                },
                404
            );
        }

        let statusData;

        try {
            statusData =
                JSON.parse(
                    await statusObject.text()
                );
        }
        catch {
            return jsonResponse(
                {
                    success: false,
                    message:
                        "Stored OCR job status is invalid.",
                    jobId,
                    version:
                        GET_RESULT_VERSION
                },
                500
            );
        }

        // ====================================================
        // JOB STATE
        // ====================================================

        const status =
            String(
                statusData?.status
                || ""
            )
            .trim()
            .toLowerCase();

        if (
            status === "failed"
        ) {
            return jsonResponse(
                {
                    success: false,
                    jobId,
                    status:
                        "failed",
                    message:
                        statusData?.error
                            ?.message
                        || "OCR job failed.",
                    version:
                        GET_RESULT_VERSION
                },
                409
            );
        }

        if (
            status !== "completed"
        ) {
            return jsonResponse(
                {
                    success: false,
                    jobId,
                    status:
                        status
                        || "unknown",
                    stage:
                        statusData?.stage
                        || null,
                    progress:
                        Number(
                            statusData?.progress
                            || 0
                        ),
                    message:
                        "OCR job is not completed yet.",
                    version:
                        GET_RESULT_VERSION
                },
                409
            );
        }

        // ====================================================
        // MATCH ID
        // ====================================================

        const matchId =
            sanitizeMatchId(
                statusData?.matchId
            );

        if (
            !matchId
        ) {
            return jsonResponse(
                {
                    success: false,
                    jobId,
                    message:
                        "Completed OCR job does not contain a valid matchId.",
                    version:
                        GET_RESULT_VERSION
                },
                409
            );
        }

        // ====================================================
        // LOAD MATCH REPORT
        // ====================================================

        const reportKey =
            `match-reports/${matchId}.json`;

        const reportObject =
            await env.OCR_STORAGE.get(
                reportKey
            );

        if (
            !reportObject
        ) {
            return jsonResponse(
                {
                    success: false,
                    jobId,
                    matchId,
                    message:
                        "Completed match report was not found.",
                    version:
                        GET_RESULT_VERSION
                },
                404
            );
        }

        let matchReport;

        try {
            matchReport =
                JSON.parse(
                    await reportObject.text()
                );
        }
        catch {
            return jsonResponse(
                {
                    success: false,
                    jobId,
                    matchId,
                    message:
                        "Stored match report is invalid.",
                    version:
                        GET_RESULT_VERSION
                },
                500
            );
        }

        // ====================================================
        // MATCH ID VERIFICATION
        // ====================================================

        const storedMatchId =
            sanitizeMatchId(
                matchReport?.matchId
            );

        if (
            storedMatchId
            !== matchId
        ) {
            return jsonResponse(
                {
                    success: false,
                    jobId,
                    matchId,
                    message:
                        "Stored match report does not match this OCR job.",
                    version:
                        GET_RESULT_VERSION
                },
                409
            );
        }

        // ====================================================
        // OWNERSHIP VERIFICATION
        // ====================================================

        const submittedBy =
            String(
                matchReport?.submittedBy
                || ""
            )
            .trim();

        if (
            !submittedBy
        ) {
            return jsonResponse(
                {
                    success: false,
                    jobId,
                    matchId,
                    message:
                        "Stored match report has no owner.",
                    version:
                        GET_RESULT_VERSION
                },
                409
            );
        }

        if (
            !constantTimeEqual(
                submittedBy,
                authenticatedOwnerId
            )
        ) {
            return jsonResponse(
                {
                    success: false,
                    message:
                        "You are not authorized to access this OCR result.",
                    version:
                        GET_RESULT_VERSION
                },
                403
            );
        }

        // ====================================================
        // RESPONSE
        // ====================================================

        return jsonResponse(
            {
                success: true,

                version:
                    GET_RESULT_VERSION,

                jobId,

                providerJobId:
                    statusData?.providerJobId
                    || null,

                status:
                    "completed",

                stage:
                    "completed",

                progress:
                    100,

                matchId,

                resultKey:
                    statusData?.resultKey
                    || reportKey,

                benchmarkKey:
                    statusData?.benchmarkKey
                    || null,

                matchReport
            },
            200
        );
    }
    catch (
        error
    ) {
        console.error(
            "OCR get result failed:",
            error
        );

        return jsonResponse(
            {
                success: false,
                message:
                    "Unable to load OCR result.",
                error:
                    String(
                        error?.message
                        || error
                    ),
                version:
                    GET_RESULT_VERSION
            },
            500
        );
    }
}

// ============================================================
// OWNER HASH
// ============================================================

async function createOwnerHash(
    epicUniqueId,
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
                    epicUniqueId
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

// ============================================================
// CONSTANT-TIME STRING COMPARE
// ============================================================

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

    if (
        firstBytes.length
        !== secondBytes.length
    ) {
        return false;
    }

    let difference =
        0;

    for (
        let index = 0;
        index < firstBytes.length;
        index += 1
    ) {
        difference |=
            firstBytes[
                index
            ]
            ^ secondBytes[
                index
            ];
    }

    return difference === 0;
}

// ============================================================
// JOB ID
// ============================================================

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

    if (
        !/^[A-Z0-9]{16}$/.test(
            jobId
        )
    ) {
        return null;
    }

    return jobId;
}

// ============================================================
// MATCH ID
// ============================================================

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

    if (
        !/^[A-Z0-9]{16}$/.test(
            matchId
        )
    ) {
        return null;
    }

    return matchId;
}

// ============================================================
// RESPONSE
// ============================================================

function jsonResponse(
    data,
    status=200
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