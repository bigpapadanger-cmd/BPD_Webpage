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
    "ocr-training-service-3.1";

const TRAINING_BATCH_MAX_SIZE =
    32;

const TRAINING_STORAGE_CONCURRENCY =
    4;

// ============================================================
// RESPONSE
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
                    "application/json; charset=utf-8",
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

    return difference === 0;
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
                "OCR training authentication is not configured."
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
// NORMALIZATION
// ============================================================

function normalizeText(
    value
) {
    return String(
        value
        ?? ""
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
            value
            ?? ""
        )
            .trim()
            .toLowerCase()
        === "true"
    );
}

function normalizeNullableText(
    value
) {
    const normalized =
        normalizeText(
            value
        );

    return normalized
        || null;
}

// ============================================================
// IMAGE
// ============================================================

function isValidUpload(
    value
) {
    if (
        !value
        || typeof value.arrayBuffer
            !== "function"
    ) {
        return false;
    }

    if (
        typeof value.size === "number"
        && value.size <= 0
    ) {
        return false;
    }

    return true;
}

// ============================================================
// MATCH ID
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
    }
    catch {
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
                result?.success !== false,
            stored:
                false,
            duplicate:
                result?.duplicate === true,
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
            reason:
                result?.reason
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

    return {
        success:
            result?.success !== false,
        stored:
            result?.stored === true,
        duplicate:
            result?.duplicate === true,
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

function buildSampleFailure(
    reason,
    {
        fingerprint =
            null,
        category =
            null,
        confidence =
            null
    } = {}
) {
    return {
        success:
            false,
        stored:
            false,
        duplicate:
            false,
        fingerprint,
        category:
            null,
        requestedCategory:
            category,
        highConfidence:
            false,
        confidence,
        confidenceThreshold:
            null,
        reason,
        currentCount:
            null,
        targetCount:
            null,
        version:
            TRAINING_SERVICE_VERSION
    };
}

// ============================================================
// PROCESS ONE TRAINING SAMPLE
// ============================================================

async function processTrainingSample(
    bucket,
    sample
) {
    const requestedCategory =
        normalizeTrainingCategory(
            sample?.category
        );

    const confidence =
        normalizeNumber(
            sample?.confidence
        );

    const fingerprint =
        normalizeTrainingFingerprint(
            sample?.fingerprint
        );

    const matchValidation =
        normalizeAndValidateMatchId(
            sample?.matchId
        );

    if (
        !matchValidation.valid
    ) {
        return buildSampleFailure(
            "invalid_match_id",
            {
                fingerprint:
                    fingerprint || null,
                category:
                    requestedCategory,
                confidence
            }
        );
    }

    if (
        !isValidUpload(
            sample?.imageFile
        )
    ) {
        return buildSampleFailure(
            "training_image_required",
            {
                fingerprint:
                    fingerprint || null,
                category:
                    requestedCategory,
                confidence
            }
        );
    }

    if (
        !validTrainingFingerprint(
            fingerprint
        )
    ) {
        return buildSampleFailure(
            "invalid_training_fingerprint",
            {
                fingerprint:
                    fingerprint || null,
                category:
                    requestedCategory,
                confidence
            }
        );
    }

    let image;

    try {
        image =
            await sample
                .imageFile
                .arrayBuffer();
    }
    catch (
        error
    ) {
        console.error(
            "OCR TRAINING: Failed to read training image.",
            {
                name:
                    error?.name
                    || "Error",
                message:
                    error?.message
                    || "Unknown error"
            }
        );

        return buildSampleFailure(
            "training_image_read_failed",
            {
                fingerprint,
                category:
                    requestedCategory,
                confidence
            }
        );
    }

    if (
        !image
        || image.byteLength <= 0
    ) {
        return buildSampleFailure(
            "training_image_empty",
            {
                fingerprint,
                category:
                    requestedCategory,
                confidence
            }
        );
    }

    const field =
        normalizeNullableText(
            sample?.field
        );

    const team =
        normalizeInteger(
            sample?.team
        );

    const playerIndex =
        normalizeInteger(
            sample?.playerIndex
        );

    const engine =
        normalizeNullableText(
            sample?.engine
        );

    const approval =
        normalizeNullableText(
            sample?.approval
        );

    const ocrVersion =
        normalizeNullableText(
            sample?.ocrVersion
        );

    const additionalMetadata =
        normalizeAdditionalMetadata(
            sample?.additionalMetadata
        );

    try {
        const result =
            await putTrainingImage(
                bucket,
                {
                    image,
                    matchId:
                        matchValidation.matchId,
                    fingerprint,
                    category:
                        requestedCategory,
                    field,
                    team,
                    playerIndex,
                    confidence,
                    engine,
                    approval,
                    ocrVersion,
                    additionalMetadata
                }
            );

        return normalizeStorageResult(
            result,
            {
                fingerprint,
                category:
                    requestedCategory,
                confidence
            }
        );
    }
    catch (
        error
    ) {
        console.error(
            "OCR TRAINING: Sample storage failed.",
            {
                matchId:
                    matchValidation.matchId,
                fingerprint,
                category:
                    requestedCategory,
                name:
                    error?.name
                    || "Error",
                message:
                    error?.message
                    || "Unknown error"
            }
        );

        return buildSampleFailure(
            "training_storage_failed",
            {
                fingerprint,
                category:
                    requestedCategory,
                confidence
            }
        );
    }
}

// ============================================================
// STORAGE LANE
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
// CATEGORY-AWARE BATCH PROCESSING
//
// Same capped numeric category:
//     sequential
//
// Different categories:
//     concurrent
//
// Bar / undetermined:
//     independent lanes
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

    let nextLaneIndex =
        0;

    async function runLaneWorker() {
        while (
            true
        ) {
            const laneIndex =
                nextLaneIndex;

            nextLaneIndex +=
                1;

            if (
                laneIndex >= lanes.length
            ) {
                return;
            }

            const lane =
                lanes[
                    laneIndex
                ];

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
// SINGLE UPLOAD
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
                    "matchId must be a 16-character alphanumeric ID.",
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
                    "A valid SHA-256 training fingerprint is required.",
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
        result.success
            ? 200
            : 400
    );
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
                    "matchId must be a 16-character alphanumeric ID.",
                results:
                    [],
                version:
                    TRAINING_SERVICE_VERSION
            },
            400
        );
    }

    const ocrVersion =
        normalizeNullableText(
            formData.get(
                "ocrVersion"
            )
        );

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
    }
    catch {
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

    const samples =
        [];

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
            || typeof metadata !== "object"
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

        const resolvedImageField =
            imageField
            || `image_${index}`;

        samples.push({
            imageFile:
                formData.get(
                    resolvedImageField
                ),
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

    let categoryCompleteCount =
        0;

    for (
        const result
        of results
    ) {
        if (
            result?.stored === true
        ) {
            storedCount +=
                1;

            if (
                result.category
                === "undetermined"
            ) {
                undeterminedCount +=
                    1;
            }

            continue;
        }

        if (
            result?.duplicate === true
            || result?.reason
                === "duplicate_training_image"
        ) {
            duplicateCount +=
                1;

            continue;
        }

        if (
            result?.reason
            === "training_category_complete"
        ) {
            categoryCompleteCount +=
                1;

            continue;
        }

        if (
            result?.success !== true
        ) {
            failedCount +=
                1;
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
            categoryCompleteCount,
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

        if (
            !env.OCR_TRAINING
        ) {
            return jsonResponse(
                {
                    success:
                        false,
                    message:
                        "OCR training bucket is not configured.",
                    version:
                        TRAINING_SERVICE_VERSION
                },
                503
            );
        }

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

        const formData =
            await request.formData();

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
    }
    catch (
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
                    "OCR training upload failed.",
                version:
                    TRAINING_SERVICE_VERSION
            },
            500
        );
    }
}