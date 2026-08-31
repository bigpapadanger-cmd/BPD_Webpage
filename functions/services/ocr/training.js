"use strict";

import {
    normalizeTrainingCategory,
    putTrainingImage
} from "./trainingStorage.js";


// ============================================================
// BPD GAMING NETWORK
// OCR TRAINING - REQUEST HANDLER
// ============================================================

const TRAINING_SERVICE_VERSION =
    "ocr-training-service-1.0";


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
        && typeof value.arrayBuffer === "function"
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
                        "Method not allowed."
                },
                405
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
                        "OCR training bucket is not configured."
                },
                500
            );
        }


        // ----------------------------------------------------
        // CONTENT TYPE
        // ----------------------------------------------------

        const contentType =
            request.headers.get(
                "content-type"
            ) || "";

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
                        "Expected multipart/form-data."
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
                        "Training image is required."
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
            );

        if (
            matchId.length < 8
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    message:
                        "A valid matchId is required."
                },
                400
            );
        }


        // ----------------------------------------------------
        // CATEGORY
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
            ) || null;

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
            ) || null;

        const approval =
            normalizeText(
                formData.get(
                    "approval"
                )
            ) || null;

        const ocrVersion =
            normalizeText(
                formData.get(
                    "ocrVersion"
                )
            ) || null;


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
                    && typeof parsed === "object"
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


        // ----------------------------------------------------
        // STORE
        //
        // trainingStorage.js handles:
        //
        // - category normalization
        // - category count
        // - 200-target cap
        // - unique ID
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
        // CATEGORY ALREADY COMPLETE
        //
        // This is not an error.
        // The training system successfully determined that
        // this category no longer needs additional examples.
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

                    category:
                        result.category,

                    reason:
                        result.reason,

                    currentCount:
                        result.currentCount
                        ?? null,

                    targetCount:
                        result.targetCount
                        ?? null
                }
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

                category:
                    result.category,

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
                    ?? null
            }
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
                    )
            },
            500
        );
    }
}