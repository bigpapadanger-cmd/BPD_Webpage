"use strict";

import {
    normalizeTrainingCategory,
    normalizeTrainingFingerprint,
    validTrainingFingerprint,
    resolveTrainingCategory,
    putTrainingImage
} from "./trainingStorage.js";

// ============================================================
// BPD GAMING NETWORK
// OCR TRAINING - REQUEST HANDLER
// ============================================================

const TRAINING_SERVICE_VERSION =
    "ocr-training-service-3.0";

const TRAINING_BATCH_MAX_SIZE =
    32;

const TRAINING_STORAGE_CONCURRENCY =
    4;


// ============================================================
// RESPONSE HELPER
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
// AUTHENTICATION
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
        )
        .trim();

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
    const encoder =
        new TextEncoder();

    const a =
        encoder.encode(
            String(
                first || ""
            )
        );

    const b =
        encoder.encode(
            String(
                second || ""
            )
        );

    if (
        a.length
        !== b.length
    ) {
        return false;
    }

    let result =
        0;

    for (
        let index = 0;
        index < a.length;
        index += 1
    ) {
        result |=
            a[
                index
            ]
            ^ b[
                index
            ];
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
        )
        .trim();

    if (
        !expectedToken
    ) {
        return {
            valid:
                false,

            status:
                503,

            reason:
                (
                    "OCR training authentication "
                    + "is not configured."
                )
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
// NORMALIZATION HELPERS
// ============================================================

function normalizeText(
    value
) {
    return String(
        value ?? ""
    )
        .trim();
}


function normalizeInteger(
    value
) {
    if (
        value === null
        || value === undefined
        || value === ""
    ) {
        return null;
    }

    const parsed =
        Number.parseInt(
            String(
                value
            ),
            10
        );

    return Number.isFinite(
        parsed
    )
        ? parsed
        : null;
}


function normalizeNumber(
    value
) {
    if (
        value === null
        || value === undefined
        || value === ""
    ) {
        return null;
    }

    const parsed =
        Number(
            value
        );

    return Number.isFinite(
        parsed
    )
        ? parsed
        : null;
}


function normalizeBoolean(
    value
) {
    return (
        String(
            value ?? ""
        )
        .trim()
        .toLowerCase()
        === "true"
    );
}


// ============================================================
// IMAGE VALIDATION
// ============================================================

function isValidUpload(
    value
) {
    return (
        value
        && typeof value.arrayBuffer
            === "function"
    );
}


// ============================================================
// MATCH ID VALIDATION
// ============================================================

function normalizeAndValidateMatchId(
    value
) {
    const matchId =
        normalizeText(
            value
        )
        .toUpperCase();

    return {
        matchId,

        valid:
            /^[A-Z0-9]{16}$/.test(
                matchId
            )
    };
}


// ============================================================
// ADDITIONAL METADATA
// ============================================================

function normalizeAdditionalMetadata(
    value
) {
    if (
        !value
    ) {
        return null;
    }

    if (
        typeof value === "object"
        && !Array.isArray(
            value
        )
    ) {
        return value;
    }

    try {
        const parsed =
            JSON.parse(
                String(
                    value
                )
            );

        if (
            parsed
            && typeof parsed
                === "object"
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
// STORAGE RESULT
// ============================================================

function normalizeStorageResult(
    result,
    {
        fingerprint,
        category,
        confidence
    }
) {
    if (
        result?.stored === false
    ) {
        return {
            success:
                true,

            stored:
                false,

            duplicate:
                result.duplicate
                === true,

            fingerprint:
                result.fingerprint
                ?? fingerprint,

            category:
                result.category
                ?? null,

            requestedCategory:
                result.requestedCategory
                ?? category,

            highConfidence:
                result.highConfidence
                ?? false,

            confidence:
                result.confidence
                ?? confidence,

            confidenceThreshold:
                result.confidenceThreshold
                ?? null,

            reason:
                result.reason
                ?? null,

            currentCount:
                result.currentCount
                ?? null,

            targetCount:
                result.targetCount
                ?? null,

            version:
                TRAINING_SERVICE_VERSION
        };
    }

    return {
        success:
            true,

        stored:
            true,

        duplicate:
            false,

        fingerprint:
            result?.fingerprint
            ?? fingerprint,

        category:
            result?.category
            ?? null,

        requestedCategory:
            result?.requestedCategory
            ?? category,

        highConfidence:
            result?.highConfidence
            ?? false,

        confidence:
            result?.confidence
            ?? confidence,

        confidenceThreshold:
            result?.confidenceThreshold
            ?? null,

        routingReason:
            result?.routingReason
            ?? null,

        matchId:
            result?.matchId
            ?? null,

        trainingId:
            result?.trainingId
            ?? null,

        objectKey:
            result?.objectKey
            ?? null,

        currentCount:
            result?.currentCount
            ?? null,

        targetCount:
            result?.targetCount
            ?? null,

        version:
            TRAINING_SERVICE_VERSION
    };
}


// ============================================================
// PROCESS ONE TRAINING SAMPLE
//
// This is the common path used by BOTH:
//
// - legacy single uploads
// - new batch uploads
//
// trainingStorage.js remains authoritative for:
//
// - fingerprint reservation
// - durable duplicate rejection
// - confidence-based category routing
// - undetermined fallback
// - category count
// - 500-target digit cap (Determined by TRAINING_TARGET_PER_CLASS)
// - unique training ID
// - R2 object key
// - metadata
// - R2 write
// ============================================================

// ============================================================
// STORAGE LANE
//
// Numeric categories 0-9 are capped.
//
// Every sample that ultimately routes to the same capped
// numeric category is assigned to the same sequential lane.
//
// Examples:
//
// requested 7 @ 0.98
//      ↓
// final 7
//      ↓
// lane "category:7"
//
// requested 7 @ 0.70
//      ↓
// final undetermined
//      ↓
// uncapped lane
//
// Bar and undetermined are not subject to the numeric class
// cap, so they do not need same-category serialization.
// ============================================================

function getTrainingStorageLane(
    sample,
    index
) {
    const routing =
        resolveTrainingCategory(
            sample?.category,
            sample?.confidence
        );

    const finalCategory =
        routing.category;

    if (
        /^[0-9]$/.test(
            finalCategory
        )
    ) {
        return {
            key:
                `category:${finalCategory}`,

            category:
                finalCategory,

            capped:
                true
        };
    }

    return {
        key:
            `uncapped:${index}`,

        category:
            finalCategory,

        capped:
            false
    };
}


// ============================================================
// BOUNDED CATEGORY-AWARE BATCH PROCESSING
//
// Rules:
//
// 1. Up to TRAINING_STORAGE_CONCURRENCY lanes may operate at
//    the same time.
//
// 2. Samples belonging to the same capped numeric category
//    are always stored sequentially.
//
// 3. Different numeric categories may operate concurrently.
//
// 4. Bar / undetermined samples are uncapped and therefore
//    receive independent lanes.
//
// Example:
//
// 7,7,7,3,3,9,bar,undetermined
//
// possible execution:
//
// lane 1: 7 -> 7 -> 7
// lane 2: 3 -> 3
// lane 3: 9
// lane 4: bar
//
// then the next available worker takes undetermined.
//
// This prevents same-batch category-count races without
// removing useful R2 concurrency.
// ============================================================

async function processTrainingBatch(
    bucket,
    samples
) {
    const results =
        new Array(
            samples.length
        );

    if (
        samples.length === 0
    ) {
        return results;
    }

    // ========================================================
    // BUILD STORAGE LANES
    // ========================================================

    const laneMap =
        new Map();

    for (
        let index = 0;
        index < samples.length;
        index += 1
    ) {
        const sample =
            samples[
                index
            ];

        const lane =
            getTrainingStorageLane(
                sample,
                index
            );

        if (
            !laneMap.has(
                lane.key
            )
        ) {
            laneMap.set(
                lane.key,
                {
                    key:
                        lane.key,

                    category:
                        lane.category,

                    capped:
                        lane.capped,

                    entries:
                        []
                }
            );
        }

        laneMap.get(
            lane.key
        ).entries.push({
            index,

            sample
        });
    }

    const lanes =
        Array.from(
            laneMap.values()
        );

    // ========================================================
    // SHARED LANE POINTER
    //
    // JavaScript execution within this request is cooperative.
    // Each worker claims one lane before awaiting storage.
    // ========================================================

    let nextLaneIndex =
        0;

    async function runLaneWorker() {

        while (
            true
        ) {
            const laneIndex =
                nextLaneIndex;

            nextLaneIndex += 1;

            if (
                laneIndex
                >= lanes.length
            ) {
                return;
            }

            const lane =
                lanes[
                    laneIndex
                ];

            // =================================================
            // PROCESS THIS LANE SEQUENTIALLY
            //
            // This is the important category-cap protection.
            //
            // If four "7" samples are in this lane, sample two
            // cannot count the category until sample one has
            // completed its storage operation.
            // =================================================

            for (
                const entry
                of lane.entries
            ) {
                results[
                    entry.index
                ] =
                    await processTrainingSample(
                        bucket,
                        entry.sample
                    );
            }
        }
    }

    // ========================================================
    // START BOUNDED LANE WORKERS
    // ========================================================

    const workerCount =
        Math.min(
            TRAINING_STORAGE_CONCURRENCY,
            lanes.length
        );

    const workers =
        [];

    for (
        let index = 0;
        index < workerCount;
        index += 1
    ) {
        workers.push(
            runLaneWorker()
        );
    }

    await Promise.all(
        workers
    );

    return results;
}

// ============================================================
// LEGACY SINGLE UPLOAD
// ============================================================

async function handleSingleTrainingUpload(
    formData,
    env
) {
    const matchValidation =
        normalizeAndValidateMatchId(
            formData.get(
                "matchId"
            )
        );

    if (
        !matchValidation.valid
    ) {
        return jsonResponse(
            {
                success:
                    false,

                message:
                    (
                        "matchId must be a "
                        + "16-character alphanumeric ID."
                    ),

                version:
                    TRAINING_SERVICE_VERSION
            },
            400
        );
    }

    const imageFile =
        formData.get(
            "image"
        )
        || formData.get(
            "file"
        );

    if (
        !isValidUpload(
            imageFile
        )
    ) {
        return jsonResponse(
            {
                success:
                    false,

                message:
                    "Training image is required.",

                version:
                    TRAINING_SERVICE_VERSION
            },
            400
        );
    }

    const fingerprint =
        normalizeTrainingFingerprint(
            formData.get(
                "fingerprint"
            )
        );

    if (
        !validTrainingFingerprint(
            fingerprint
        )
    ) {
        return jsonResponse(
            {
                success:
                    false,

                message:
                    (
                        "A valid SHA-256 training "
                        + "fingerprint is required."
                    ),

                version:
                    TRAINING_SERVICE_VERSION
            },
            400
        );
    }

    const result =
        await processTrainingSample(
            env.OCR_TRAINING,
            {
                imageFile,

                matchId:
                    matchValidation.matchId,

                fingerprint,

                category:
                    formData.get(
                        "category"
                    ),

                field:
                    formData.get(
                        "field"
                    ),

                team:
                    formData.get(
                        "team"
                    ),

                playerIndex:
                    formData.get(
                        "playerIndex"
                    ),

                confidence:
                    formData.get(
                        "confidence"
                    ),

                engine:
                    formData.get(
                        "engine"
                    ),

                approval:
                    formData.get(
                        "approval"
                    ),

                ocrVersion:
                    formData.get(
                        "ocrVersion"
                    ),

                additionalMetadata:
                    formData.get(
                        "metadata"
                    )
            }
        );

    return jsonResponse(
        result,
        (
            result.success
            ? 200
            : 400
        )
    );
}


// ============================================================
// BOUNDED BATCH PROCESSING
//
// A batch may contain up to 32 images.
//
// Storage is processed in groups of four.
//
// Example:
//
// 32 samples
//
// 0-3   -> concurrent
// wait
// 4-7   -> concurrent
// wait
// ...
//
// This avoids creating 32 simultaneous R2 storage pipelines.
// ============================================================

async function processTrainingBatch(
    bucket,
    samples
) {
    const results =
        new Array(
            samples.length
        );

    for (
        let start = 0;
        start < samples.length;
        start += TRAINING_STORAGE_CONCURRENCY
    ) {
        const group =
            samples.slice(
                start,
                start
                + TRAINING_STORAGE_CONCURRENCY
            );

        const groupResults =
            await Promise.all(
                group.map(
                    (
                        sample
                    ) =>
                        processTrainingSample(
                            bucket,
                            sample
                        )
                )
            );

        for (
            let offset = 0;
            offset < groupResults.length;
            offset += 1
        ) {
            results[
                start
                + offset
            ] =
                groupResults[
                    offset
                ];
        }
    }

    return results;
}


// ============================================================
// BATCH UPLOAD
// ============================================================

async function handleBatchTrainingUpload(
    formData,
    env
) {
    const matchValidation =
        normalizeAndValidateMatchId(
            formData.get(
                "matchId"
            )
        );

    if (
        !matchValidation.valid
    ) {
        return jsonResponse(
            {
                success:
                    false,

                message:
                    (
                        "matchId must be a "
                        + "16-character alphanumeric ID."
                    ),

                results:
                    [],

                version:
                    TRAINING_SERVICE_VERSION
            },
            400
        );
    }

    const ocrVersion =
        normalizeText(
            formData.get(
                "ocrVersion"
            )
        )
        || null;

    const rawBatchMetadata =
        formData.get(
            "batchMetadata"
        );

    if (
        !rawBatchMetadata
    ) {
        return jsonResponse(
            {
                success:
                    false,

                message:
                    "batchMetadata is required.",

                results:
                    [],

                version:
                    TRAINING_SERVICE_VERSION
            },
            400
        );
    }

    let batchMetadata;

    try {
        batchMetadata =
            JSON.parse(
                String(
                    rawBatchMetadata
                )
            );

    } catch {
        return jsonResponse(
            {
                success:
                    false,

                message:
                    "batchMetadata must contain valid JSON.",

                results:
                    [],

                version:
                    TRAINING_SERVICE_VERSION
            },
            400
        );
    }

    if (
        !Array.isArray(
            batchMetadata
        )
    ) {
        return jsonResponse(
            {
                success:
                    false,

                message:
                    "batchMetadata must be an array.",

                results:
                    [],

                version:
                    TRAINING_SERVICE_VERSION
            },
            400
        );
    }

    if (
        batchMetadata.length === 0
    ) {
        return jsonResponse(
            {
                success:
                    false,

                message:
                    "Training batch is empty.",

                results:
                    [],

                version:
                    TRAINING_SERVICE_VERSION
            },
            400
        );
    }

    if (
        batchMetadata.length
        > TRAINING_BATCH_MAX_SIZE
    ) {
        return jsonResponse(
            {
                success:
                    false,

                message:
                    (
                        "Training batch exceeds "
                        + `${TRAINING_BATCH_MAX_SIZE} samples.`
                    ),

                results:
                    [],

                version:
                    TRAINING_SERVICE_VERSION
            },
            400
        );
    }

    const samples = [];

    for (
        let index = 0;
        index < batchMetadata.length;
        index += 1
    ) {
        const metadata =
            batchMetadata[
                index
            ];

        if (
            !metadata
            || typeof metadata
                !== "object"
            || Array.isArray(
                metadata
            )
        ) {
            samples.push({
                imageFile:
                    null,

                matchId:
                    matchValidation.matchId,

                fingerprint:
                    "",

                category:
                    "undetermined",

                ocrVersion
            });

            continue;
        }

        const imageField =
            normalizeText(
                metadata.imageField
            );

        const expectedImageField =
            `image_${index}`;

        const resolvedImageField =
            (
                imageField
                || expectedImageField
            );

        const imageFile =
            formData.get(
                resolvedImageField
            );

        samples.push({
            imageFile,

            matchId:
                matchValidation.matchId,

            fingerprint:
                metadata.fingerprint,

            category:
                metadata.category,

            field:
                metadata.field,

            team:
                metadata.team,

            playerIndex:
                metadata.playerIndex,

            confidence:
                metadata.confidence,

            engine:
                metadata.engine,

            approval:
                metadata.approval,

            ocrVersion,

            additionalMetadata:
                metadata.metadata
        });
    }

    const results =
        await processTrainingBatch(
            env.OCR_TRAINING,
            samples
        );

    let storedCount =
        0;

    let duplicateCount =
        0;

    let failedCount =
        0;

    let undeterminedCount =
        0;

    for (
        const result
        of results
    ) {
        if (
            result?.stored
            === true
        ) {
            storedCount += 1;

            if (
                result.category
                === "undetermined"
            ) {
                undeterminedCount += 1;
            }

            continue;
        }

        if (
            result?.duplicate
            === true
            || result?.reason
                === "duplicate_training_image"
        ) {
            duplicateCount += 1;

            continue;
        }

        if (
            result?.success
            !== true
        ) {
            failedCount += 1;
        }
    }

    return jsonResponse(
        {
            success:
                failedCount === 0,

            batch:
                true,

            attemptedCount:
                samples.length,

            storedCount,

            duplicateCount,

            undeterminedCount,

            failedCount,

            results,

            version:
                TRAINING_SERVICE_VERSION
        },
        200
    );
}


// ============================================================
// MAIN HANDLER
// ============================================================

export async function handleOCRTrainingUpload(
    request,
    env
) {
    try {

        // ----------------------------------------------------
        // METHOD
        // ----------------------------------------------------

        if (
            request.method !== "POST"
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    message:
                        "Method not allowed.",

                    version:
                        TRAINING_SERVICE_VERSION
                },
                405
            );
        }


        // ----------------------------------------------------
        // AUTHENTICATION
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
                        authentication.reason,

                    version:
                        TRAINING_SERVICE_VERSION
                },
                authentication.status
            );
        }


        // ----------------------------------------------------
        // BUCKET
        // ----------------------------------------------------

        if (
            !env.OCR_TRAINING
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    message:
                        (
                            "OCR training bucket "
                            + "is not configured."
                        ),

                    version:
                        TRAINING_SERVICE_VERSION
                },
                503
            );
        }


        // ----------------------------------------------------
        // CONTENT TYPE
        // ----------------------------------------------------

        const contentType =
            String(
                request.headers.get(
                    "content-type"
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
                    success:
                        false,

                    message:
                        "Expected multipart/form-data.",

                    version:
                        TRAINING_SERVICE_VERSION
                },
                400
            );
        }


        // ----------------------------------------------------
        // FORM DATA
        //
        // Multipart parsing occurs once regardless of whether
        // this is a single sample or a batch.
        // ----------------------------------------------------

        const formData =
            await request.formData();


        // ----------------------------------------------------
        // BATCH OR SINGLE
        // ----------------------------------------------------

        const batchRequest =
            normalizeBoolean(
                formData.get(
                    "batch"
                )
            );

        if (
            batchRequest
        ) {
            return handleBatchTrainingUpload(
                formData,
                env
            );
        }

        return handleSingleTrainingUpload(
            formData,
            env
        );

    } catch (
        error
    ) {
        console.error(
            "OCR training upload failed:",
            error
        );

        return jsonResponse(
            {
                success:
                    false,

                message:
                    (
                        error?.message
                        || "OCR training upload failed."
                    ),

                version:
                    TRAINING_SERVICE_VERSION
            },
            500
        );
    }
}