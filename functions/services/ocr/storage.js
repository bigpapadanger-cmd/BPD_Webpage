// ============================================================
// BPD GAMING NETWORK
// OCR MATCH - R2 OBJECT STORAGE
// ============================================================

const OCR_STORAGE_VERSION =
    "ocr-storage-1.0";


const MATCH_ID_LENGTH = 16;

const ID_ALPHABET =
    "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";


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
    let value = "";

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
// UNIQUE MATCH ID
// ============================================================

export async function createUniqueMatchId(
    bucket
) {
    if (!bucket) {
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

        const reportExists =
            await bucket.head(
                `match-reports/${matchId}.json`
            );

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
    if (!bucket) {
        throw new Error(
            "OCR_STORAGE R2 bucket is unavailable."
        );
    }

    if (!image) {
        throw new Error(
            "Match image is required."
        );
    }

    const objectKey =
        `match-images/${matchId}.png`;

    await bucket.put(
        objectKey,
        image,
        {
            httpMetadata: {
                contentType
            },

            customMetadata: {
                matchId:
                    String(
                        matchId
                    ),

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

        matchId,

        objectKey
    };
}


// ============================================================
// STORE MATCH REPORT
// ============================================================

export async function putMatchReport(
    bucket,
    {
        matchId,
        report
    }
) {
    if (!bucket) {
        throw new Error(
            "OCR_STORAGE R2 bucket is unavailable."
        );
    }

    if (
        !report
        || typeof report
        !== "object"
    ) {
        throw new Error(
            "Match report is required."
        );
    }

    const objectKey =
        `match-reports/${matchId}.json`;

    const payload = {
        ...report,

        matchId,

        imageKey:
            `match-images/${matchId}.png`,

        reportKey:
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
                    String(
                        matchId
                    ),

                storageVersion:
                    OCR_STORAGE_VERSION
            }
        }
    );

    return {
        success:
            true,

        matchId,

        objectKey,

        report:
            payload
    };
}


// ============================================================
// GET MATCH REPORT
// ============================================================

export async function getMatchReport(
    bucket,
    matchId
) {
    const key =
        `match-reports/${matchId}.json`;

    const object =
        await bucket.get(
            key
        );

    if (!object) {
        return null;
    }

    return await object.json();
}


// ============================================================
// GET MATCH IMAGE
// ============================================================

export async function getMatchImage(
    bucket,
    matchId
) {
    return bucket.get(
        `match-images/${matchId}.png`
    );
}


// ============================================================
// DELETE MATCH
// ============================================================

export async function deleteStoredMatch(
    bucket,
    matchId
) {
    await bucket.delete([
        `match-images/${matchId}.png`,
        `match-reports/${matchId}.json`
    ]);

    return {
        success:
            true,

        deleted:
            true,

        matchId
    };
}