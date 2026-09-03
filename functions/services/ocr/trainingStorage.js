// ============================================================
// BPD GAMING NETWORK
// OCR TRAINING - R2 STORAGE
// ============================================================

const TRAINING_STORAGE_VERSION =
    "ocr-training-storage-2.0";

// ============================================================
// SETTINGS
// ============================================================

const TRAINING_TARGET_PER_CLASS =
    500;

const TRAINING_HIGH_CONFIDENCE_THRESHOLD =
    0.95;

const TRAINING_ID_LENGTH =
    8;

const TRAINING_ID_ALPHABET =
    "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

const TRAINING_CATEGORIES =
    new Set([
        "0",
        "1",
        "2",
        "3",
        "4",
        "5",
        "6",
        "7",
        "8",
        "9",
        "bar",
        "undetermined"
    ]);

const CAPPED_TRAINING_CATEGORIES =
    new Set([
        "0",
        "1",
        "2",
        "3",
        "4",
        "5",
        "6",
        "7",
        "8",
        "9"
    ]);

const NUMERIC_TRAINING_CATEGORIES =
    new Set([
        "0",
        "1",
        "2",
        "3",
        "4",
        "5",
        "6",
        "7",
        "8",
        "9"
    ]);

const FINGERPRINT_PREFIX =
    "_fingerprints";

// ============================================================
// CATEGORY HELPERS
// ============================================================

export function normalizeTrainingCategory(
    category
) {
    const normalized =
        String(
            category ?? ""
        )
        .trim()
        .toLowerCase();

    if (
        TRAINING_CATEGORIES.has(
            normalized
        )
    ) {
        return normalized;
    }

    return "undetermined";
}


export function isCappedTrainingCategory(
    category
) {
    return CAPPED_TRAINING_CATEGORIES.has(
        normalizeTrainingCategory(
            category
        )
    );
}


// ============================================================
// CONFIDENCE
// ============================================================

function normalizeConfidence(
    value
) {
    if (
        value === null
        || value === undefined
        || value === ""
    ) {
        return null;
    }

    const numeric =
        Number(
            value
        );

    if (
        !Number.isFinite(
            numeric
        )
    ) {
        return null;
    }

    return Math.max(
        0,
        Math.min(
            1,
            numeric
        )
    );
}


// ============================================================
// FINAL CATEGORY ROUTING
//
// Numeric classes are trusted only when:
// - OCR supplied a specific digit class
// - confidence meets threshold
//
// Anything weaker goes to undetermined.
//
// Bar remains its own explicit category.
// ============================================================

export function resolveTrainingCategory(
    requestedCategory,
    confidence
) {
    const normalizedCategory =
        normalizeTrainingCategory(
            requestedCategory
        );

    if (
        normalizedCategory === "bar"
    ) {
        return {
            requestedCategory:
                normalizedCategory,

            category:
                "bar",

            highConfidence:
                true,

            confidence:
                normalizeConfidence(
                    confidence
                ),

            threshold:
                TRAINING_HIGH_CONFIDENCE_THRESHOLD,

            reason:
                "bar_training_sample"
        };
    }

    const normalizedConfidence =
        normalizeConfidence(
            confidence
        );

    if (
        NUMERIC_TRAINING_CATEGORIES.has(
            normalizedCategory
        )
        && normalizedConfidence !== null
        && normalizedConfidence
            >= TRAINING_HIGH_CONFIDENCE_THRESHOLD
    ) {
        return {
            requestedCategory:
                normalizedCategory,

            category:
                normalizedCategory,

            highConfidence:
                true,

            confidence:
                normalizedConfidence,

            threshold:
                TRAINING_HIGH_CONFIDENCE_THRESHOLD,

            reason:
                "high_confidence_numeric_sample"
        };
    }

    return {
        requestedCategory:
            normalizedCategory,

        category:
            "undetermined",

        highConfidence:
            false,

        confidence:
            normalizedConfidence,

        threshold:
            TRAINING_HIGH_CONFIDENCE_THRESHOLD,

        reason:
            "requires_training_review"
    };
}


// ============================================================
// FINGERPRINT
// ============================================================

export function normalizeTrainingFingerprint(
    fingerprint
) {
    return String(
        fingerprint ?? ""
    )
        .trim()
        .toLowerCase();
}


export function validTrainingFingerprint(
    fingerprint
) {
    return /^[a-f0-9]{64}$/.test(
        normalizeTrainingFingerprint(
            fingerprint
        )
    );
}


function buildFingerprintKey(
    fingerprint
) {
    const normalized =
        normalizeTrainingFingerprint(
            fingerprint
        );

    if (
        !validTrainingFingerprint(
            normalized
        )
    ) {
        throw new Error(
            "Training fingerprint must be a valid SHA-256 value."
        );
    }

    return (
        `${FINGERPRINT_PREFIX}/`
        + `${normalized}.json`
    );
}


// ============================================================
// ID HELPERS
// ============================================================

function randomAlphabetCharacter() {
    const randomValues =
        new Uint32Array(
            1
        );

    crypto.getRandomValues(
        randomValues
    );

    const index =
        randomValues[0]
        % TRAINING_ID_ALPHABET.length;

    return TRAINING_ID_ALPHABET[
        index
    ];
}


export function generateTrainingId(
    length =
        TRAINING_ID_LENGTH
) {
    let value =
        "";

    for (
        let index = 0;
        index < length;
        index += 1
    ) {
        value +=
            randomAlphabetCharacter();
    }

    return value;
}


// ============================================================
// MATCH ID HELPERS
// ============================================================

function normalizeMatchId(
    matchId
) {
    return String(
        matchId ?? ""
    )
        .trim()
        .toUpperCase()
        .replace(
            /[^A-Z0-9]/g,
            ""
        );
}


function getMatchPrefix(
    matchId
) {
    const normalized =
        normalizeMatchId(
            matchId
        );

    if (
        normalized.length < 8
    ) {
        throw new Error(
            "matchId must contain at least 8 alphanumeric characters."
        );
    }

    return normalized.slice(
        0,
        8
    );
}


// ============================================================
// OBJECT KEY GENERATION
// ============================================================

export function buildTrainingObjectKey(
    matchId,
    category,
    trainingId
) {
    const normalizedCategory =
        normalizeTrainingCategory(
            category
        );

    const matchPrefix =
        getMatchPrefix(
            matchId
        );

    const normalizedTrainingId =
        String(
            trainingId ?? ""
        )
        .trim()
        .toUpperCase();

    return (
        `${normalizedCategory}/`
        + `${matchPrefix}_`
        + `${normalizedTrainingId}.png`
    );
}


// ============================================================
// CATEGORY COUNTS
// ============================================================

export async function getTrainingCategoryCount(
    bucket,
    category
) {
    if (!bucket) {
        throw new Error(
            "OCR training R2 bucket is unavailable."
        );
    }

    const normalizedCategory =
        normalizeTrainingCategory(
            category
        );

    const prefix =
        `${normalizedCategory}/`;

    let cursor =
        undefined;

    let count =
        0;

    do {
        const result =
            await bucket.list({
                prefix,

                cursor,

                limit:
                    TRAINING_TARGET_PER_CLASS
            });

        count +=
            result.objects.length;

        if (
            count
            >= TRAINING_TARGET_PER_CLASS
        ) {
            return count;
        }

        cursor =
            result.truncated
                ? result.cursor
                : undefined;

    } while (
        cursor
    );

    return count;
}


// ============================================================
// CATEGORY CAP STATUS
// ============================================================

export async function getTrainingCategoryStatus(
    bucket,
    category
) {
    const normalizedCategory =
        normalizeTrainingCategory(
            category
        );

    if (
        !isCappedTrainingCategory(
            normalizedCategory
        )
    ) {
        return {
            category:
                normalizedCategory,

            capped:
                false,

            currentCount:
                null,

            targetCount:
                null,

            accepting:
                true
        };
    }

    const currentCount =
        await getTrainingCategoryCount(
            bucket,
            normalizedCategory
        );

    return {
        category:
            normalizedCategory,

        capped:
            true,

        currentCount,

        targetCount:
            TRAINING_TARGET_PER_CLASS,

        accepting:
            currentCount
            < TRAINING_TARGET_PER_CLASS
    };
}


// ============================================================
// UNIQUE OBJECT KEY
// ============================================================

async function createUniqueTrainingObjectKey(
    bucket,
    matchId,
    category
) {
    const maximumAttempts =
        10;

    for (
        let attempt = 0;
        attempt < maximumAttempts;
        attempt += 1
    ) {
        const trainingId =
            generateTrainingId();

        const objectKey =
            buildTrainingObjectKey(
                matchId,
                category,
                trainingId
            );

        const existing =
            await bucket.head(
                objectKey
            );

        if (
            !existing
        ) {
            return {
                trainingId,
                objectKey
            };
        }
    }

    throw new Error(
        "Could not generate a unique training object key."
    );
}


// ============================================================
// METADATA
// ============================================================

function normalizeMetadataValue(
    value
) {
    if (
        value === null
        || value === undefined
    ) {
        return "";
    }

    if (
        typeof value === "object"
    ) {
        return JSON.stringify(
            value
        );
    }

    return String(
        value
    );
}


function buildTrainingMetadata({
    matchId,
    trainingId,
    fingerprint,
    category,
    requestedCategory,
    highConfidence,
    confidenceThreshold,

    field = null,
    team = null,
    playerIndex = null,

    confidence = null,
    engine = null,

    approval = null,
    ocrVersion = null,

    additionalMetadata = null
}) {
    const metadata = {
        matchId:
            normalizeMetadataValue(
                matchId
            ),

        trainingId:
            normalizeMetadataValue(
                trainingId
            ),

        fingerprint:
            normalizeMetadataValue(
                fingerprint
            ),

        category:
            normalizeMetadataValue(
                category
            ),

        requestedCategory:
            normalizeMetadataValue(
                requestedCategory
            ),

        highConfidence:
            normalizeMetadataValue(
                highConfidence
            ),

        confidenceThreshold:
            normalizeMetadataValue(
                confidenceThreshold
            ),

        field:
            normalizeMetadataValue(
                field
            ),

        team:
            normalizeMetadataValue(
                team
            ),

        playerIndex:
            normalizeMetadataValue(
                playerIndex
            ),

        confidence:
            normalizeMetadataValue(
                confidence
            ),

        engine:
            normalizeMetadataValue(
                engine
            ),

        approval:
            normalizeMetadataValue(
                approval
            ),

        ocrVersion:
            normalizeMetadataValue(
                ocrVersion
            ),

        storageVersion:
            TRAINING_STORAGE_VERSION
    };

    if (
        additionalMetadata
        && typeof additionalMetadata
            === "object"
    ) {
        for (
            const [
                key,
                value
            ]
            of Object.entries(
                additionalMetadata
            )
        ) {
            metadata[
                String(
                    key
                )
            ] =
                normalizeMetadataValue(
                    value
                );
        }
    }

    return metadata;
}


// ============================================================
// FINGERPRINT RESERVATION
//
// Uses an R2 conditional write.
//
// If two requests attempt to store the same fingerprint at the
// same time, only the first reservation is accepted.
//
// Cloudflare R2 returns null when the condition fails.
// ============================================================

async function reserveTrainingFingerprint(
    bucket,
    {
        fingerprint,
        matchId,
        category
    }
) {
    const fingerprintKey =
        buildFingerprintKey(
            fingerprint
        );

    const headers =
        new Headers();

    headers.set(
        "If-None-Match",
        "*"
    );

    const reservation =
        await bucket.put(
            fingerprintKey,
            JSON.stringify({
                fingerprint:
                    normalizeTrainingFingerprint(
                        fingerprint
                    ),

                state:
                    "reserved",

                matchId:
                    normalizeMatchId(
                        matchId
                    ),

                category,

                objectKey:
                    null,

                createdAt:
                    new Date()
                        .toISOString()
            }),
            {
                onlyIf:
                    headers,

                httpMetadata: {
                    contentType:
                        "application/json"
                },

                customMetadata: {
                    fingerprint:
                        normalizeTrainingFingerprint(
                            fingerprint
                        ),

                    state:
                        "reserved",

                    category:
                        String(
                            category
                        )
                }
            }
        );

    return {
        reserved:
            reservation !== null,

        fingerprintKey
    };
}


// ============================================================
// FINALIZE FINGERPRINT
// ============================================================

async function finalizeTrainingFingerprint(
    bucket,
    {
        fingerprint,
        fingerprintKey,
        matchId,
        category,
        objectKey,
        trainingId
    }
) {
    await bucket.put(
        fingerprintKey,
        JSON.stringify({
            fingerprint:
                normalizeTrainingFingerprint(
                    fingerprint
                ),

            state:
                "stored",

            matchId:
                normalizeMatchId(
                    matchId
                ),

            category,

            objectKey,

            trainingId,

            updatedAt:
                new Date()
                    .toISOString()
        }),
        {
            httpMetadata: {
                contentType:
                    "application/json"
            },

            customMetadata: {
                fingerprint:
                    normalizeTrainingFingerprint(
                        fingerprint
                    ),

                state:
                    "stored",

                category:
                    String(
                        category
                    ),

                objectKey:
                    String(
                        objectKey
                    )
            }
        }
    );
}


// ============================================================
// STORE TRAINING IMAGE
// ============================================================

export async function putTrainingImage(
    bucket,
    {
        image,
        matchId,

        fingerprint,

        category =
            "undetermined",

        field =
            null,

        team =
            null,

        playerIndex =
            null,

        confidence =
            null,

        engine =
            null,

        approval =
            null,

        ocrVersion =
            null,

        additionalMetadata =
            null
    }
) {
    if (
        !bucket
    ) {
        throw new Error(
            "OCR training R2 bucket is unavailable."
        );
    }

    if (
        !image
    ) {
        throw new Error(
            "Training image is required."
        );
    }

    const normalizedFingerprint =
        normalizeTrainingFingerprint(
            fingerprint
        );

    if (
        !validTrainingFingerprint(
            normalizedFingerprint
        )
    ) {
        throw new Error(
            "A valid SHA-256 training fingerprint is required."
        );
    }

    // ========================================================
    // DETERMINE TRUSTED DESTINATION
    // ========================================================

    const routing =
        resolveTrainingCategory(
            category,
            confidence
        );

    const normalizedCategory =
        routing.category;

    // ========================================================
    // RESERVE UNIQUE FINGERPRINT
    //
    // This happens before category counting and image writing.
    //
    // Duplicate images never consume training capacity.
    // ========================================================

    const fingerprintReservation =
        await reserveTrainingFingerprint(
            bucket,
            {
                fingerprint:
                    normalizedFingerprint,

                matchId,

                category:
                    normalizedCategory
            }
        );

    if (
        !fingerprintReservation.reserved
    ) {
        return {
            success:
                true,

            stored:
                false,

            duplicate:
                true,

            fingerprint:
                normalizedFingerprint,

            category:
                normalizedCategory,

            requestedCategory:
                routing.requestedCategory,

            reason:
                "duplicate_training_image"
        };
    }

    let trainingImageStored =
        false;

    let objectKey =
        null;

    try {

        // ====================================================
        // CHECK CATEGORY CAP
        // ====================================================

        const categoryStatus =
            await getTrainingCategoryStatus(
                bucket,
                normalizedCategory
            );

        if (
            !categoryStatus.accepting
        ) {
            await bucket.delete(
                fingerprintReservation
                    .fingerprintKey
            );

            return {
                success:
                    true,

                stored:
                    false,

                duplicate:
                    false,

                category:
                    normalizedCategory,

                requestedCategory:
                    routing.requestedCategory,

                highConfidence:
                    routing.highConfidence,

                confidence:
                    routing.confidence,

                reason:
                    "training_category_complete",

                currentCount:
                    categoryStatus.currentCount,

                targetCount:
                    categoryStatus.targetCount
            };
        }

        // ====================================================
        // CREATE UNIQUE IMAGE KEY
        // ====================================================

        const {
            trainingId,
            objectKey:
                generatedObjectKey
        } =
            await createUniqueTrainingObjectKey(
                bucket,
                matchId,
                normalizedCategory
            );

        objectKey =
            generatedObjectKey;

        // ====================================================
        // BUILD METADATA
        // ====================================================

        const customMetadata =
            buildTrainingMetadata({
                matchId,

                trainingId,

                fingerprint:
                    normalizedFingerprint,

                category:
                    normalizedCategory,

                requestedCategory:
                    routing.requestedCategory,

                highConfidence:
                    routing.highConfidence,

                confidenceThreshold:
                    routing.threshold,

                field,

                team,

                playerIndex,

                confidence:
                    routing.confidence,

                engine,

                approval,

                ocrVersion,

                additionalMetadata
            });

        // ====================================================
        // WRITE IMAGE
        // ====================================================

        await bucket.put(
            objectKey,
            image,
            {
                httpMetadata: {
                    contentType:
                        "image/png"
                },

                customMetadata
            }
        );

        trainingImageStored =
            true;

        // ====================================================
        // FINALIZE FINGERPRINT INDEX
        // ====================================================

        await finalizeTrainingFingerprint(
            bucket,
            {
                fingerprint:
                    normalizedFingerprint,

                fingerprintKey:
                    fingerprintReservation
                        .fingerprintKey,

                matchId,

                category:
                    normalizedCategory,

                objectKey,

                trainingId
            }
        );

        return {
            success:
                true,

            stored:
                true,

            duplicate:
                false,

            category:
                normalizedCategory,

            requestedCategory:
                routing.requestedCategory,

            highConfidence:
                routing.highConfidence,

            confidence:
                routing.confidence,

            confidenceThreshold:
                routing.threshold,

            routingReason:
                routing.reason,

            fingerprint:
                normalizedFingerprint,

            matchId:
                normalizeMatchId(
                    matchId
                ),

            matchPrefix:
                getMatchPrefix(
                    matchId
                ),

            trainingId,

            objectKey,

            currentCount:
                categoryStatus.currentCount
                === null
                    ? null
                    : categoryStatus.currentCount
                        + 1,

            targetCount:
                categoryStatus.targetCount,

            metadata:
                customMetadata
        };

    } catch (
        error
    ) {

        // ====================================================
        // ROLLBACK
        //
        // If image write succeeded but fingerprint finalization
        // failed, delete both so a later retry can safely store
        // the sample.
        // ====================================================

        if (
            trainingImageStored
            && objectKey
        ) {
            try {
                await bucket.delete(
                    objectKey
                );
            } catch {
                // Ignore rollback cleanup errors.
            }
        }

        try {
            await bucket.delete(
                fingerprintReservation
                    .fingerprintKey
            );
        } catch {
            // Ignore rollback cleanup errors.
        }

        throw error;
    }
}


// ============================================================
// MOVE TRAINING IMAGE
//
// Used after manual/user review:
//
// undetermined/
//      ↓
// 7/
//
// R2 has no rename operation, so this uses copy + delete.
// ============================================================

export async function moveTrainingImage(
    bucket,
    sourceKey,
    destinationCategory
) {
    if (
        !bucket
    ) {
        throw new Error(
            "OCR training R2 bucket is unavailable."
        );
    }

    const source =
        await bucket.get(
            sourceKey
        );

    if (
        !source
    ) {
        return {
            success:
                false,

            moved:
                false,

            reason:
                "training_object_not_found"
        };
    }

    const normalizedCategory =
        normalizeTrainingCategory(
            destinationCategory
        );

    if (
        !NUMERIC_TRAINING_CATEGORIES.has(
            normalizedCategory
        )
        && normalizedCategory
            !== "bar"
    ) {
        return {
            success:
                false,

            moved:
                false,

            reason:
                "invalid_destination_category"
        };
    }

    const categoryStatus =
        await getTrainingCategoryStatus(
            bucket,
            normalizedCategory
        );

    if (
        !categoryStatus.accepting
    ) {
        return {
            success:
                true,

            moved:
                false,

            reason:
                "training_category_complete",

            category:
                normalizedCategory,

            currentCount:
                categoryStatus.currentCount,

            targetCount:
                categoryStatus.targetCount
        };
    }

    const filename =
        String(
            sourceKey
        )
        .split("/")
        .pop();

    if (
        !filename
    ) {
        throw new Error(
            "Training object filename could not be resolved."
        );
    }

    const destinationKey =
        `${normalizedCategory}/${filename}`;

    const existing =
        await bucket.head(
            destinationKey
        );

    if (
        existing
    ) {
        return {
            success:
                false,

            moved:
                false,

            reason:
                "destination_already_exists",

            destinationKey
        };
    }

    const sourceMetadata = {
        ...(
            source.customMetadata
            || {}
        )
    };

    const fingerprint =
        normalizeTrainingFingerprint(
            sourceMetadata.fingerprint
        );

    const customMetadata = {
        ...sourceMetadata,

        category:
            normalizedCategory,

        approval:
            "manual"
    };

    await bucket.put(
        destinationKey,
        source.body,
        {
            httpMetadata:
                source.httpMetadata,

            customMetadata
        }
    );

    await bucket.delete(
        sourceKey
    );

    // ========================================================
    // UPDATE FINGERPRINT LOCATION
    // ========================================================

    if (
        validTrainingFingerprint(
            fingerprint
        )
    ) {
        const fingerprintKey =
            buildFingerprintKey(
                fingerprint
            );

        await bucket.put(
            fingerprintKey,
            JSON.stringify({
                fingerprint,

                state:
                    "stored",

                matchId:
                    normalizeMatchId(
                        sourceMetadata.matchId
                    ),

                category:
                    normalizedCategory,

                objectKey:
                    destinationKey,

                trainingId:
                    sourceMetadata.trainingId
                    || null,

                updatedAt:
                    new Date()
                        .toISOString()
            }),
            {
                httpMetadata: {
                    contentType:
                        "application/json"
                },

                customMetadata: {
                    fingerprint,

                    state:
                        "stored",

                    category:
                        normalizedCategory,

                    objectKey:
                        destinationKey
                }
            }
        );
    }

    return {
        success:
            true,

        moved:
            true,

        sourceKey,

        destinationKey,

        category:
            normalizedCategory,

        fingerprint:
            fingerprint
            || null
    };
}


// ============================================================
// DELETE TRAINING IMAGE
// ============================================================

export async function deleteTrainingImage(
    bucket,
    objectKey
) {
    if (
        !bucket
    ) {
        throw new Error(
            "OCR training R2 bucket is unavailable."
        );
    }

    const existing =
        await bucket.head(
            objectKey
        );

    const fingerprint =
        normalizeTrainingFingerprint(
            existing
                ?.customMetadata
                ?.fingerprint
        );

    await bucket.delete(
        objectKey
    );

    if (
        validTrainingFingerprint(
            fingerprint
        )
    ) {
        await bucket.delete(
            buildFingerprintKey(
                fingerprint
            )
        );
    }

    return {
        success:
            true,

        deleted:
            true,

        objectKey,

        fingerprint:
            fingerprint
            || null
    };
}