// ============================================================
// BPD GAMING NETWORK
// OCR MATCH - R2 OBJECT STORAGE
// ============================================================

const OCR_STORAGE_VERSION =
    "ocr-storage-2.0";

const MATCH_ID_LENGTH =
    16;

const ID_ALPHABET =
    "0123456789ABCDEFGHJKLMNPQRSTUVWXYZ";

// ============================================================
// IDS
// ============================================================

function randomCharacter() {
    const values =
        new Uint32Array(
            1
        );

    crypto.getRandomValues(
        values
    );

    return ID_ALPHABET[
        values[0]
        % ID_ALPHABET.length
    ];
}

export function generateMatchId() {
    let value =
        "";

    for (
        let index = 0;
        index < MATCH_ID_LENGTH;
        index += 1
    ) {
        value +=
            randomCharacter();
    }

    return value;
}

// ============================================================
// ID NORMALIZATION
// ============================================================

function normalizeMatchId(
    value
) {
    const matchId =
        String(
            value
            || ""
        )
            .trim()
            .toUpperCase();

    return /^[A-Z0-9]{16}$/.test(
        matchId
    )
        ? matchId
        : "";
}

function normalizeJobId(
    value
) {
    const jobId =
        String(
            value
            || ""
        )
            .trim()
            .toUpperCase();

    return /^[A-Z0-9]{16}$/.test(
        jobId
    )
        ? jobId
        : "";
}

// ============================================================
// MATCH REPORT KEYS
// ============================================================

export function getMatchReportPrefix(
    matchId
) {
    const normalizedMatchId =
        normalizeMatchId(
            matchId
        );

    if (
        !normalizedMatchId
    ) {
        throw new Error(
            "Invalid matchId."
        );
    }

    return (
        `match-reports/${normalizedMatchId}`
    );
}

export function getCurrentMatchReportKey(
    matchId
) {
    return (
        getMatchReportPrefix(
            matchId
        )
        + "/current.json"
    );
}

export function getOriginalMatchReportKey(
    matchId,
    jobId
) {
    const normalizedJobId =
        normalizeJobId(
            jobId
        );

    if (
        !normalizedJobId
    ) {
        throw new Error(
            "Invalid jobId."
        );
    }

    return (
        getMatchReportPrefix(
            matchId
        )
        + "/original/"
        + normalizedJobId
        + ".json"
    );
}

// ============================================================
// UNIQUE MATCH ID
// ============================================================

export async function createUniqueMatchId(
    bucket
) {
    if (
        !bucket
    ) {
        throw new Error(
            "OCR_STORAGE R2 bucket is unavailable."
        );
    }

    for (
        let attempt = 0;
        attempt < 10;
        attempt += 1
    ) {
        const matchId =
            generateMatchId();

        const imageExists =
            await bucket.head(
                `match-images/${matchId}.png`
            );

        const reportObjects =
            await bucket.list({
                prefix:
                    getMatchReportPrefix(
                        matchId
                    )
                    + "/",
                limit:
                    1
            });

        const reportExists =
            Array.isArray(
                reportObjects?.objects
            )
            && reportObjects.objects.length >
                0;

        if (
            !imageExists
            && !reportExists
        ) {
            return matchId;
        }
    }

    throw new Error(
        "Could not generate a unique match ID."
    );
}

// ============================================================
// STORE MATCH IMAGE
// ============================================================

export async function putMatchImage(
    bucket,
    {
        matchId,
        image,
        contentType =
            "image/png",
        metadata = {}
    }
) {
    if (
        !bucket
    ) {
        throw new Error(
            "OCR_STORAGE R2 bucket is unavailable."
        );
    }

    const normalizedMatchId =
        normalizeMatchId(
            matchId
        );

    if (
        !normalizedMatchId
    ) {
        throw new Error(
            "Invalid matchId."
        );
    }

    if (
        !image
    ) {
        throw new Error(
            "Match image is required."
        );
    }

    const objectKey =
        `match-images/${normalizedMatchId}.png`;

    await bucket.put(
        objectKey,
        image,
        {
            httpMetadata: {
                contentType
            },
            customMetadata: {
                matchId:
                    normalizedMatchId,
                storageVersion:
                    OCR_STORAGE_VERSION,
                ...Object.fromEntries(
                    Object.entries(
                        metadata
                        || {}
                    ).map(
                        ([
                            key,
                            value
                        ]) => [
                            key,
                            String(
                                value
                                ?? ""
                            )
                        ]
                    )
                )
            }
        }
    );

    return {
        success:
            true,
        matchId:
            normalizedMatchId,
        objectKey
    };
}

// ============================================================
// STORE INITIAL MATCH REPORT
// ============================================================

export async function putMatchReport(
    bucket,
    {
        matchId,
        jobId,
        report,
        preserveOriginal = true
    }
) {
    if (
        !bucket
    ) {
        throw new Error(
            "OCR_STORAGE R2 bucket is unavailable."
        );
    }

    const normalizedMatchId =
        normalizeMatchId(
            matchId
        );

    if (
        !normalizedMatchId
    ) {
        throw new Error(
            "Invalid matchId."
        );
    }

    const normalizedJobId =
        normalizeJobId(
            jobId
            || report?.jobId
        );

    if (
        preserveOriginal
        && !normalizedJobId
    ) {
        throw new Error(
            "A valid jobId is required when preserving the original match report."
        );
    }

    if (
        !report
        || typeof report !==
            "object"
        || Array.isArray(
            report
        )
    ) {
        throw new Error(
            "Match report is required."
        );
    }

    const currentKey =
        getCurrentMatchReportKey(
            normalizedMatchId
        );

    const originalKey =
        preserveOriginal
            ? getOriginalMatchReportKey(
                normalizedMatchId,
                normalizedJobId
            )
            : null;

    const payload = {
        ...report,
        jobId:
            normalizedJobId
            || report?.jobId
            || null,
        matchId:
            normalizedMatchId,
        imageKey:
            `match-images/${normalizedMatchId}.png`,
        reportKey:
            currentKey,
        currentReportKey:
            currentKey,
        originalReportKey:
            originalKey,
        storageVersion:
            OCR_STORAGE_VERSION
    };

    if (
        preserveOriginal
        && originalKey
    ) {
        const existingOriginal =
            await bucket.head(
                originalKey
            );

        if (
            !existingOriginal
        ) {
            await bucket.put(
                originalKey,
                JSON.stringify(
                    payload,
                    null,
                    2
                ),
                {
                    httpMetadata: {
                        contentType:
                            "application/json"
                    },
                    customMetadata: {
                        matchId:
                            normalizedMatchId,
                        jobId:
                            normalizedJobId,
                        immutable:
                            "true",
                        storageVersion:
                            OCR_STORAGE_VERSION
                    }
                }
            );
        }
    }

    await bucket.put(
        currentKey,
        JSON.stringify(
            payload,
            null,
            2
        ),
        {
            httpMetadata: {
                contentType:
                    "application/json"
            },
            customMetadata: {
                matchId:
                    normalizedMatchId,
                jobId:
                    normalizedJobId
                    || "",
                mutable:
                    "true",
                storageVersion:
                    OCR_STORAGE_VERSION
            }
        }
    );

    return {
        success:
            true,
        matchId:
            normalizedMatchId,
        jobId:
            normalizedJobId
            || null,
        objectKey:
            currentKey,
        currentKey,
        originalKey,
        report:
            payload
    };
}

// ============================================================
// UPDATE CURRENT MATCH REPORT
// ============================================================

export async function updateCurrentMatchReport(
    bucket,
    matchId,
    report
) {
    if (
        !bucket
    ) {
        throw new Error(
            "OCR_STORAGE R2 bucket is unavailable."
        );
    }

    const normalizedMatchId =
        normalizeMatchId(
            matchId
        );

    if (
        !normalizedMatchId
    ) {
        throw new Error(
            "Invalid matchId."
        );
    }

    if (
        !report
        || typeof report !==
            "object"
        || Array.isArray(
            report
        )
    ) {
        throw new Error(
            "Match report is required."
        );
    }

    const objectKey =
        getCurrentMatchReportKey(
            normalizedMatchId
        );

    const payload = {
        ...report,
        matchId:
            normalizedMatchId,
        imageKey:
            `match-images/${normalizedMatchId}.png`,
        reportKey:
            objectKey,
        currentReportKey:
            objectKey,
        storageVersion:
            OCR_STORAGE_VERSION
    };

    await bucket.put(
        objectKey,
        JSON.stringify(
            payload,
            null,
            2
        ),
        {
            httpMetadata: {
                contentType:
                    "application/json"
            },
            customMetadata: {
                matchId:
                    normalizedMatchId,
                jobId:
                    String(
                        report?.jobId
                        || ""
                    ),
                mutable:
                    "true",
                storageVersion:
                    OCR_STORAGE_VERSION
            }
        }
    );

    return {
        success:
            true,
        matchId:
            normalizedMatchId,
        objectKey,
        report:
            payload
    };
}

// ============================================================
// GET CURRENT MATCH REPORT OBJECT
// ============================================================

export async function getCurrentMatchReport(
    bucket,
    matchId
) {
    if (
        !bucket
    ) {
        throw new Error(
            "OCR_STORAGE R2 bucket is unavailable."
        );
    }

    const objectKey =
        getCurrentMatchReportKey(
            matchId
        );

    return bucket.get(
        objectKey
    );
}

// ============================================================
// GET MATCH REPORT
// ============================================================

export async function getMatchReport(
    bucket,
    matchId
) {
    const object =
        await getCurrentMatchReport(
            bucket,
            matchId
        );

    if (
        !object
    ) {
        return null;
    }

    return object.json();
}

// ============================================================
// GET ORIGINAL MATCH REPORT
// ============================================================

export async function getOriginalMatchReport(
    bucket,
    matchId,
    jobId
) {
    if (
        !bucket
    ) {
        throw new Error(
            "OCR_STORAGE R2 bucket is unavailable."
        );
    }

    const object =
        await bucket.get(
            getOriginalMatchReportKey(
                matchId,
                jobId
            )
        );

    if (
        !object
    ) {
        return null;
    }

    return object.json();
}

// ============================================================
// GET MATCH IMAGE
// ============================================================

export async function getMatchImage(
    bucket,
    matchId
) {
    const normalizedMatchId =
        normalizeMatchId(
            matchId
        );

    if (
        !normalizedMatchId
    ) {
        return null;
    }

    return bucket.get(
        `match-images/${normalizedMatchId}.png`
    );
}

// ============================================================
// DELETE MATCH
// ============================================================

export async function deleteStoredMatch(
    bucket,
    matchId
) {
    if (
        !bucket
    ) {
        throw new Error(
            "OCR_STORAGE R2 bucket is unavailable."
        );
    }

    const normalizedMatchId =
        normalizeMatchId(
            matchId
        );

    if (
        !normalizedMatchId
    ) {
        throw new Error(
            "Invalid matchId."
        );
    }

    const prefix =
        getMatchReportPrefix(
            normalizedMatchId
        )
        + "/";

    let cursor;
    const reportKeys =
        [];

    do {
        const listed =
            await bucket.list({
                prefix,
                cursor
            });

        for (
            const object
            of listed.objects
            || []
        ) {
            reportKeys.push(
                object.key
            );
        }

        cursor =
            listed.truncated
                ? listed.cursor
                : undefined;
    }
    while (
        cursor
    );

    const keysToDelete = [
        `match-images/${normalizedMatchId}.png`,
        ...reportKeys
    ];

    if (
        keysToDelete.length >
        0
    ) {
        await bucket.delete(
            keysToDelete
        );
    }

    return {
        success:
            true,
        deleted:
            true,
        matchId:
            normalizedMatchId,
        deletedObjectCount:
            keysToDelete.length
    };
}