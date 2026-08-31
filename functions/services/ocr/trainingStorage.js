// ============================================================
// BPD GAMING NETWORK
// OCR TRAINING - R2 STORAGE
// ============================================================

const TRAINING_STORAGE_VERSION =
    "ocr-training-storage-1.0";


// ============================================================
// SETTINGS
// ============================================================

const TRAINING_TARGET_PER_CLASS = 200;

const TRAINING_ID_LENGTH = 8;

const TRAINING_ID_ALPHABET =
    "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

const TRAINING_CATEGORIES = new Set([
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

const CAPPED_TRAINING_CATEGORIES = new Set([
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
    length = TRAINING_ID_LENGTH
) {
    let value = "";

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

    let cursor = undefined;
    let count = 0;

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

    } while (cursor);

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
    const maximumAttempts = 10;

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

        if (!existing) {
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
    category,
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

        category:
            normalizeMetadataValue(
                category
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
        && typeof additionalMetadata === "object"
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
// STORE TRAINING IMAGE
// ============================================================

export async function putTrainingImage(
    bucket,
    {
        image,
        matchId,
        category = "undetermined",

        field = null,
        team = null,
        playerIndex = null,

        confidence = null,
        engine = null,

        approval = null,
        ocrVersion = null,

        additionalMetadata = null
    }
) {
    if (!bucket) {
        throw new Error(
            "OCR training R2 bucket is unavailable."
        );
    }

    if (!image) {
        throw new Error(
            "Training image is required."
        );
    }

    const normalizedCategory =
        normalizeTrainingCategory(
            category
        );

    // --------------------------------------------------------
    // CHECK CATEGORY CAP
    // --------------------------------------------------------

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

            stored:
                false,

            category:
                normalizedCategory,

            reason:
                "training_category_complete",

            currentCount:
                categoryStatus.currentCount,

            targetCount:
                categoryStatus.targetCount
        };
    }

    // --------------------------------------------------------
    // CREATE UNIQUE KEY
    // --------------------------------------------------------

    const {
        trainingId,
        objectKey
    } =
        await createUniqueTrainingObjectKey(
            bucket,
            matchId,
            normalizedCategory
        );

    // --------------------------------------------------------
    // BUILD METADATA
    // --------------------------------------------------------

    const customMetadata =
        buildTrainingMetadata({
            matchId,
            trainingId,
            category:
                normalizedCategory,
            field,
            team,
            playerIndex,
            confidence,
            engine,
            approval,
            ocrVersion,
            additionalMetadata
        });

    // --------------------------------------------------------
    // WRITE TO R2
    // --------------------------------------------------------

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

    return {
        success:
            true,

        stored:
            true,

        category:
            normalizedCategory,

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
            categoryStatus.currentCount === null
                ? null
                : categoryStatus.currentCount
                    + 1,

        targetCount:
            categoryStatus.targetCount,

        metadata:
            customMetadata
    };
}


// ============================================================
// MOVE TRAINING IMAGE
//
// Primarily used later for manual review:
//
// undetermined/
//      ↓
// 7/
//
// R2 has no traditional rename operation, so this performs
// copy + delete.
// ============================================================

export async function moveTrainingImage(
    bucket,
    sourceKey,
    destinationCategory
) {
    if (!bucket) {
        throw new Error(
            "OCR training R2 bucket is unavailable."
        );
    }

    const source =
        await bucket.get(
            sourceKey
        );

    if (!source) {
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

    const filename =
        String(
            sourceKey
        )
        .split("/")
        .pop();

    if (!filename) {
        throw new Error(
            "Training object filename could not be resolved."
        );
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

    const destinationKey =
        `${normalizedCategory}/${filename}`;

    const existing =
        await bucket.head(
            destinationKey
        );

    if (existing) {
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

    const customMetadata = {
        ...(
            source.customMetadata
            || {}
        ),

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

    return {
        success:
            true,

        moved:
            true,

        sourceKey,

        destinationKey,

        category:
            normalizedCategory
    };
}


// ============================================================
// DELETE TRAINING IMAGE
// ============================================================

export async function deleteTrainingImage(
    bucket,
    objectKey
) {
    if (!bucket) {
        throw new Error(
            "OCR training R2 bucket is unavailable."
        );
    }

    await bucket.delete(
        objectKey
    );

    return {
        success:
            true,

        deleted:
            true,

        objectKey
    };
}