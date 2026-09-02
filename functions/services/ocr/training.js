"use strict";

import {
    normalizeTrainingCategory,
    normalizeTrainingFingerprint,
    validTrainingFingerprint,
    putTrainingImage
} from "./trainingStorage.js";


// ============================================================
// BPD GAMING NETWORK
// OCR TRAINING - REQUEST HANDLER
// ============================================================

const TRAINING_SERVICE_VERSION =
    "ocr-training-service-2.1";


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
        //
        // Only the internal OCR service should be able to
        // create training samples.
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
        // ----------------------------------------------------

        const formData =
            await request.formData();


        // ----------------------------------------------------
        // IMAGE
        // ----------------------------------------------------

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


        // ----------------------------------------------------
        // IMAGE SIZE
        // ----------------------------------------------------

        if (
            imageFile.size !== undefined
            && imageFile.size <= 0
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    message:
                        "Training image is empty.",

                    version:
                        TRAINING_SERVICE_VERSION
                },
                400
            );
        }


        // ----------------------------------------------------
        // MATCH ID
        // ----------------------------------------------------

        const matchId =
            normalizeText(
                formData.get(
                    "matchId"
                )
            )
            .toUpperCase();

        if (
            !/^[A-Z0-9]{16}$/.test(
                matchId
            )
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


        // ----------------------------------------------------
        // FINGERPRINT
        // ----------------------------------------------------

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


        // ----------------------------------------------------
        // REQUESTED CATEGORY
        //
        // This is only the OCR-proposed category.
        //
        // trainingStorage.js remains authoritative for:
        //
        // - confidence threshold
        // - undetermined routing
        // - duplicate rejection
        // - category caps
        // ----------------------------------------------------

        const category =
            normalizeTrainingCategory(
                formData.get(
                    "category"
                )
            );


        // ----------------------------------------------------
        // OPTIONAL METADATA
        // ----------------------------------------------------

        const field =
            normalizeText(
                formData.get(
                    "field"
                )
            )
            || null;

        const team =
            normalizeInteger(
                formData.get(
                    "team"
                )
            );

        const playerIndex =
            normalizeInteger(
                formData.get(
                    "playerIndex"
                )
            );

        const confidence =
            normalizeNumber(
                formData.get(
                    "confidence"
                )
            );

        const engine =
            normalizeText(
                formData.get(
                    "engine"
                )
            )
            || null;

        const approval =
            normalizeText(
                formData.get(
                    "approval"
                )
            )
            || null;

        const ocrVersion =
            normalizeText(
                formData.get(
                    "ocrVersion"
                )
            )
            || null;


        // ----------------------------------------------------
        // ADDITIONAL METADATA
        // ----------------------------------------------------

        let additionalMetadata =
            null;

        const rawAdditionalMetadata =
            formData.get(
                "metadata"
            );

        if (
            rawAdditionalMetadata
        ) {
            try {
                const parsed =
                    JSON.parse(
                        String(
                            rawAdditionalMetadata
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
                    additionalMetadata =
                        parsed;
                }

            } catch {
                additionalMetadata =
                    null;
            }
        }


        // ----------------------------------------------------
        // IMAGE BYTES
        // ----------------------------------------------------

        const image =
            await imageFile.arrayBuffer();

        if (
            !image
            || image.byteLength === 0
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    message:
                        "Training image is empty.",

                    version:
                        TRAINING_SERVICE_VERSION
                },
                400
            );
        }


        // ----------------------------------------------------
        // STORE
        //
        // trainingStorage.js handles:
        //
        // - fingerprint reservation
        // - durable duplicate rejection
        // - confidence-based category routing
        // - undetermined fallback
        // - category count
        // - 200-target digit cap
        // - unique training ID
        // - R2 object key
        // - metadata
        // - R2 write
        // ----------------------------------------------------

        const result =
            await putTrainingImage(
                env.OCR_TRAINING,
                {
                    image,

                    matchId,

                    fingerprint,

                    category,

                    field,

                    team,

                    playerIndex,

                    confidence,

                    engine,

                    approval,

                    ocrVersion,

                    additionalMetadata: {
                        trainingServiceVersion:
                            TRAINING_SERVICE_VERSION,

                        ...(
                            additionalMetadata
                            || {}
                        )
                    }
                }
            );


        // ----------------------------------------------------
        // NOT STORED
        //
        // Examples:
        //
        // duplicate_training_image
        // training_category_complete
        //
        // These are valid training decisions, not API errors.
        // ----------------------------------------------------

        if (
            result?.stored === false
        ) {
            return jsonResponse(
                {
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
                },
                200
            );
        }


        // ----------------------------------------------------
        // SUCCESS
        // ----------------------------------------------------

        return jsonResponse(
            {
                success:
                    true,

                stored:
                    true,

                duplicate:
                    false,

                fingerprint:
                    result.fingerprint
                    ?? fingerprint,

                category:
                    result.category,

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

                routingReason:
                    result.routingReason
                    ?? null,

                matchId:
                    result.matchId,

                trainingId:
                    result.trainingId,

                objectKey:
                    result.objectKey,

                currentCount:
                    result.currentCount
                    ?? null,

                targetCount:
                    result.targetCount
                    ?? null,

                version:
                    TRAINING_SERVICE_VERSION
            },
            200
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