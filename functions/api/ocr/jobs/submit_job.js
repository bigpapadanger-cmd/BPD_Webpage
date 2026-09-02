// ============================================================
// BPD GAMING NETWORK
// OCR JOB SUBMISSION
// ============================================================

import {
    getStoredSession
} from "../../../services/common_helpers/reload_sessions.js";

const SUBMIT_JOB_VERSION =
    "ocr-submit-job-1.1";

// ============================================================
// MAIN
// ============================================================

export async function onRequestPost(
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
                    success: false,
                    message:
                        "OCR storage is not configured.",
                    version:
                        SUBMIT_JOB_VERSION
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
                        SUBMIT_JOB_VERSION
                },
                503
            );
        }

        const contentType =
            String(
                request.headers.get(
                    "Content-Type"
                )
                || ""
            );

        if (
            !contentType
                .toLowerCase()
                .includes(
                    "multipart/form-data"
                )
        ) {
            return jsonResponse(
                {
                    success: false,
                    message:
                        "Expected multipart/form-data.",
                    version:
                        SUBMIT_JOB_VERSION
                },
                400
            );
        }

        // ====================================================
        // AUTHENTICATED USER
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
                        SUBMIT_JOB_VERSION
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
                        SUBMIT_JOB_VERSION
                },
                401
            );
        }

        const submittedBy =
            await createOwnerHash(
                epicUniqueId,
                env.OCR_OWNER_SECRET
            );

        // ====================================================
        // FORM DATA
        // ====================================================

        const formData =
            await request.formData();

        const image =
            formData.get(
                "file"
            )
            || formData.get(
                "image"
            );

        if (
            !image
            || typeof image.arrayBuffer
                !== "function"
        ) {
            return jsonResponse(
                {
                    success: false,
                    message:
                        "Missing OCR image.",
                    version:
                        SUBMIT_JOB_VERSION
                },
                400
            );
        }

        const imageBytes =
            await image.arrayBuffer();

        if (
            !imageBytes
            || imageBytes.byteLength === 0
        ) {
            return jsonResponse(
                {
                    success: false,
                    message:
                        "OCR image is empty.",
                    version:
                        SUBMIT_JOB_VERSION
                },
                400
            );
        }

        // ====================================================
        // JOB
        // ====================================================

        const jobId =
            createJobId();

        const now =
            new Date()
                .toISOString();

        const baseKey =
            `ocr-jobs/${jobId}`;

        const inputKey =
            `${baseKey}/input.png`;

        const requestKey =
            `${baseKey}/request.json`;

        const statusKey =
            `${baseKey}/status.json`;

        const fields =
            buildRequestFields(
                formData
            );

        // Browser is never allowed to provide ownership.
        fields.submittedBy =
            submittedBy;

        const requestData = {
            version:
                "ocr-job-request-1.1",

            jobId,

            createdAt:
                now,

            fields
        };

        const statusData = {
            version:
                "ocr-job-state-1.0",

            jobId,

            status:
                "queued",

            stage:
                "queued",

            progress:
                0,

            uploadStatus:
                "completed",

            createdAt:
                now,

            startedAt:
                null,

            updatedAt:
                now,

            completedAt:
                null,

            heartbeatAt:
                null,

            attempt:
                0,

            matchId:
                null,

            inputKey,

            requestKey,

            resultKey:
                null,

            benchmarkKey:
                null,

            error:
                null
        };

        await Promise.all([
            env.OCR_STORAGE.put(
                inputKey,
                imageBytes,
                {
                    httpMetadata: {
                        contentType:
                            image.type
                            || "image/png"
                    },

                    customMetadata: {
                        jobId,
                        uploadedAt:
                            now
                    }
                }
            ),

            env.OCR_STORAGE.put(
                requestKey,
                JSON.stringify(
                    requestData,
                    null,
                    2
                ),
                {
                    httpMetadata: {
                        contentType:
                            "application/json"
                    }
                }
            ),

            env.OCR_STORAGE.put(
                statusKey,
                JSON.stringify(
                    statusData,
                    null,
                    2
                ),
                {
                    httpMetadata: {
                        contentType:
                            "application/json"
                    }
                }
            )
        ]);

        return jsonResponse(
            {
                success: true,
                version:
                    SUBMIT_JOB_VERSION,
                jobId,
                status:
                    "queued",
                stage:
                    "queued",
                progress:
                    0,
                uploadStatus:
                    "completed"
            },
            202
        );
    }
    catch (
        error
    ) {
        console.error(
            "OCR submit job failed:",
            error
        );

        return jsonResponse(
            {
                success: false,
                message:
                    "Unable to create OCR job.",
                error:
                    String(
                        error?.message
                        || error
                    ),
                version:
                    SUBMIT_JOB_VERSION
            },
            500
        );
    }
}

// ============================================================
// REQUEST FIELDS
// ============================================================

function buildRequestFields(
    formData
) {
    const fields = {};

    for (
        const [
            key,
            value
        ]
        of formData.entries()
    ) {
        if (
            key === "image"
            || key === "file"
            || key === "submittedBy"
        ) {
            continue;
        }

        if (
            typeof value
            !== "string"
        ) {
            continue;
        }

        if (
            Object.prototype
                .hasOwnProperty
                .call(
                    fields,
                    key
                )
        ) {
            if (
                !Array.isArray(
                    fields[key]
                )
            ) {
                fields[key] = [
                    fields[key]
                ];
            }

            fields[key].push(
                value
            );
        }
        else {
            fields[key] =
                value;
        }
    }

    return fields;
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
// JOB ID
// ============================================================

function createJobId() {
    return crypto
        .randomUUID()
        .replaceAll(
            "-",
            ""
        )
        .slice(
            0,
            16
        )
        .toUpperCase();
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