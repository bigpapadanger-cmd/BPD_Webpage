// ============================================================
// BPD GAMING NETWORK
// OCR JOB SUBMISSION
// ============================================================

import {
    getStoredSession
} from "../../../services/common_helpers/reload_sessions.js";

const SUBMIT_JOB_VERSION =
    "ocr-submit-job-1.3";

const JOB_PROGRESS = Object.freeze({
    QUEUED:
        2,
    FAILED:
        100
});

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
        // ====================================================
        // CONFIGURATION
        // ====================================================

        const configurationError =
            validateConfiguration(
                env
            );

        if (
            configurationError
        ) {
            return jsonResponse(
                {
                    success: false,
                    message:
                        configurationError,
                    version:
                        SUBMIT_JOB_VERSION
                },
                503
            );
        }

        // ====================================================
        // CONTENT TYPE
        // ====================================================

        const contentType =
            String(
                request.headers.get(
                    "Content-Type"
                )
                || ""
            )
                .trim()
                .toLowerCase();

        if (
            !contentType.includes(
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
            !session?.sessionData
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

        let formData;

        try {
            formData =
                await request.formData();
        }
        catch {
            return jsonResponse(
                {
                    success: false,
                    message:
                        "Unable to read submitted form data.",
                    version:
                        SUBMIT_JOB_VERSION
                },
                400
            );
        }

        // ====================================================
        // PLAYERS PER TEAM
        // ====================================================

        const playersPerTeam =
            Number(
                formData.get(
                    "playersPerTeam"
                )
            );

        if (
            ![
                1,
                2,
                3,
                4
            ].includes(
                playersPerTeam
            )
        ) {
            return jsonResponse(
                {
                    success: false,
                    message:
                        "playersPerTeam must be 1, 2, 3, or 4.",
                    version:
                        SUBMIT_JOB_VERSION
                },
                400
            );
        }

        // ====================================================
        // EXPECTED PLAYER NAMES
        // ====================================================

        let expectedPlayerNames;

        try {
            expectedPlayerNames =
                JSON.parse(
                    String(
                        formData.get(
                            "expectedPlayerNames"
                        )
                        || "[]"
                    )
                );
        }
        catch {
            expectedPlayerNames =
                [];
        }

        if (
            Array.isArray(
                expectedPlayerNames
            )
        ) {
            expectedPlayerNames =
                expectedPlayerNames.map(
                    function(
                        value
                    ) {
                        return String(
                            value
                            || ""
                        )
                            .trim()
                            .toUpperCase();
                    }
                );
        }

        const expectedCount =
            playersPerTeam
            * 2;

        if (
            !Array.isArray(
                expectedPlayerNames
            )
            || expectedPlayerNames.length !==
                expectedCount
            || expectedPlayerNames.some(
                function(
                    name
                ) {
                    return !name;
                }
            )
            || new Set(
                expectedPlayerNames
            ).size !== expectedCount
        ) {
            return jsonResponse(
                {
                    success: false,
                    message:
                        `Player Names Must Contain Exactly ${expectedCount} Unique Names.`,
                    version:
                        SUBMIT_JOB_VERSION
                },
                400
            );
        }

        // ====================================================
        // IMAGE
        // ====================================================

        const image =
            formData.get(
                "file"
            )
            || formData.get(
                "image"
            );

        if (
            !image
            || typeof image.arrayBuffer !==
                "function"
        ) {
            return jsonResponse(
                {
                    success: false,
                    message:
                        "Missing image.",
                    version:
                        SUBMIT_JOB_VERSION
                },
                400
            );
        }

        if (
            Number.isFinite(
                Number(
                    image.size
                )
            )
            && Number(
                image.size
            ) <= 0
        ) {
            return jsonResponse(
                {
                    success: false,
                    message:
                        "Uploaded image is empty.",
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
            || imageBytes.byteLength <= 0
        ) {
            return jsonResponse(
                {
                    success: false,
                    message:
                        "Image is empty or did not transfer correctly.",
                    version:
                        SUBMIT_JOB_VERSION
                },
                400
            );
        }

        // ====================================================
        // NORMALIZE REQUEST FIELDS
        // ====================================================

        formData.set(
            "playersPerTeam",
            String(
                playersPerTeam
            )
        );

        formData.set(
            "expectedPlayerNames",
            JSON.stringify(
                expectedPlayerNames
            )
        );

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

        // ====================================================
        // TRUSTED SERVER-DERIVED OWNERSHIP
        // ====================================================

        fields.submittedBy =
            submittedBy;

        // ====================================================
        // REQUEST DATA
        // ====================================================

        const requestData = {
            version:
                "ocr-job-request-1.3",

            jobId,

            createdAt:
                now,

            fields
        };

        // ====================================================
        // STATUS DATA
        // ====================================================

        const statusData = {
            version:
                "ocr-job-state-1.3",

            jobId,

            ownerId:
                submittedBy,

            status:
                "queued",

            stage:
                "queued",

            progress:
                JOB_PROGRESS.QUEUED,

            message:
                "Scoreboard queued for processing.",

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
                now,

            attempt:
                0,

            providerJobId:
                null,

            matchId:
                null,

            inputKey,

            requestKey,

            resultKey:
                null,

            benchmarkKey:
                null,

            cloudRuntimeSeconds:
                null,

            error:
                null
        };

        // ====================================================
        // STORE JOB FILES
        // ====================================================

        await Promise.all([
            env.OCR_STORAGE.put(
                inputKey,
                imageBytes,
                {
                    httpMetadata: {
                        contentType:
                            String(
                                image.type
                                || "image/png"
                            )
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

        // ====================================================
        // QUEUE JOB
        // ====================================================

        try {
            await env.OCR_JOB_QUEUE.send(
                {
                    jobId
                }
            );
        }
        catch (
            queueError
        ) {
            const failedAt =
                new Date()
                    .toISOString();

            await env.OCR_STORAGE.put(
                statusKey,
                JSON.stringify(
                    {
                        ...statusData,

                        status:
                            "failed",

                        stage:
                            "queue_failed",

                        progress:
                            JOB_PROGRESS.FAILED,

                        message:
                            "The scoreboard could not be queued for processing.",

                        updatedAt:
                            failedAt,

                        completedAt:
                            failedAt,

                        heartbeatAt:
                            failedAt,

                        error: {
                            code:
                                "QUEUE_SEND_FAILED",

                            message:
                                String(
                                    queueError?.message
                                    || queueError
                                )
                        }
                    },
                    null,
                    2
                ),
                {
                    httpMetadata: {
                        contentType:
                            "application/json"
                    }
                }
            );

            throw queueError;
        }

        // ====================================================
        // RESPONSE
        // ====================================================

        return jsonResponse(
            {
                success: true,

                version:
                    SUBMIT_JOB_VERSION,

                jobId,

                status:
                    statusData.status,

                stage:
                    statusData.stage,

                progress:
                    statusData.progress,

                message:
                    statusData.message,

                uploadStatus:
                    statusData.uploadStatus
            },
            202
        );
    }
    catch (
        error
    ) {
        console.error(
            "OCR job submission failed:",
            error
        );

        return jsonResponse(
            {
                success: false,

                message:
                    "Unable to create OCR job.",

                version:
                    SUBMIT_JOB_VERSION
            },
            500
        );
    }
}

// ============================================================
// CONFIGURATION
// ============================================================

function validateConfiguration(
    env
) {
    if (
        !env.OCR_STORAGE
    ) {
        return "OCR storage is not configured.";
    }

    if (
        !env.OCR_OWNER_SECRET
    ) {
        return "OCR owner hashing is not configured.";
    }

    if (
        !env.OCR_JOB_QUEUE
    ) {
        return "OCR job queue is not configured.";
    }

    return "";
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
            typeof value !==
                "string"
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
                    fields[
                        key
                    ]
                )
            ) {
                fields[
                    key
                ] = [
                    fields[
                        key
                    ]
                ];
            }

            fields[
                key
            ].push(
                value
            );
        }
        else {
            fields[
                key
            ] =
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