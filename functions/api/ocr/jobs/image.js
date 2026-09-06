"use strict";

/* =========================================================
   BPD GAMING NETWORK
   OCR JOB IMAGE
   ========================================================= */

import {
    getStoredSession
} from "../../../services/common_helpers/reload_sessions.js";

const OCR_GET_IMAGE_VERSION =
    "ocr-get-image-1.0";

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
        if (
            !env.OCR_STORAGE
        ) {
            return jsonResponse(
                {
                    success:
                        false,

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

                    message:
                        "OCR owner hashing is not configured."
                },
                503
            );
        }

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
                    success:
                        false,

                    message:
                        "Authentication required."
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
                    success:
                        false,

                    message:
                        "Authenticated account is missing an EpicUniqueId."
                },
                401
            );
        }

        const authenticatedOwnerId =
            await createOwnerHash(
                epicUniqueId,
                env.OCR_OWNER_SECRET
            );

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
                    success:
                        false,

                    message:
                        "Missing or invalid jobId."
                },
                400
            );
        }

        const statusObject =
            await env.OCR_STORAGE.get(
                `ocr-jobs/${jobId}/status.json`
            );

        if (
            !statusObject
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    message:
                        "OCR job was not found."
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
                    success:
                        false,

                    message:
                        "Stored OCR job status is invalid."
                },
                500
            );
        }

        const status =
            String(
                statusData?.status
                || ""
            )
                .trim()
                .toLowerCase();

        if (
            status !==
                "completed"
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    message:
                        "OCR job is not completed."
                },
                409
            );
        }

        const matchId =
            sanitizeMatchId(
                statusData?.matchId
            );

        if (
            !matchId
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    message:
                        "Completed OCR job does not contain a valid matchId."
                },
                409
            );
        }

        const reportObject =
            await env.OCR_STORAGE.get(
                `match-reports/${matchId}.json`
            );

        if (
            !reportObject
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    message:
                        "Match report was not found."
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
                    success:
                        false,

                    message:
                        "Stored match report is invalid."
                },
                500
            );
        }

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

                    message:
                        "Stored match report does not match this OCR job."
                },
                409
            );
        }

        const storedJobId =
            sanitizeJobId(
                matchReport?.jobId
            );

        if (
            storedJobId
            && storedJobId !==
                jobId
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    message:
                        "Stored match report does not match this OCR job."
                },
                409
            );
        }

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
                    success:
                        false,

                    message:
                        "Stored match report has no owner."
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
                    success:
                        false,

                    message:
                        "You are not authorized to access this OCR image."
                },
                403
            );
        }

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

                    message:
                        "Stored match image was not found."
                },
                404
            );
        }

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

                message:
                    "Unable to load OCR image."
            },
            500
        );
    }
}

/* =========================================================
   OWNER HASH
   ========================================================= */

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

    if (
        firstBytes.length !==
            secondBytes.length
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

    if (
        !/^[A-Z0-9]{16}$/.test(
            jobId
        )
    ) {
        return null;
    }

    return jobId;
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

    if (
        !/^[A-Z0-9]{16}$/.test(
            matchId
        )
    ) {
        return null;
    }

    return matchId;
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