import { authorizeRocketLeagueRequest, authorizationErrorResponse } from "../../../services/rl/authorization.js";
"use strict";

/* =========================================================
BPD GAMING NETWORK
OCR JOB SUBMISSION

File:
    functions/api/ocr/jobs/submit_job.js

Public Route:
    POST /api/ocr/jobs/submit_job

Purpose:
    Creates and queues an authenticated Rocket League OCR job.

Description:
    - Requires a valid global BPD session.
    - Requires a linked Epic provider for Rocket League OCR.
    - Uses identity.accounts.id as the canonical job owner.
    - Hashes the account ID before storing ownership metadata.
    - Never accepts browser-supplied ownership information.
    - Stores OCR input, request metadata, and job status.
    - Queues the OCR job for asynchronous processing.

Identity Model:
    session.userId
        = identity.accounts.id

    providers.epic.accountId
        = Epic provider subject

Ownership Model:
    ownerId
        = HMAC-SHA256(identity.accounts.id, OCR_OWNER_SECRET)

    ownerType
        = "account"

    ownerVersion
        = 2

Important:
    - Epic is required because this is Rocket League OCR.
    - Epic account ID is NOT the OCR ownership key.
    - Browser-supplied submittedBy values are discarded.
========================================================= */

import {
    getProviderContext
} from "../../../services/auth/sessions/session_context.js";

import {
    OCR_SOURCE_MODES,
    normalizeOcrImageSourceMode,
    normalizeOcrRosterContract,
    normalizeOcrRosterSize,
    normalizeOcrSourceMode
} from "../../../services/ocr/contracts.js";

/* =========================================================
VERSION
========================================================= */

const SUBMIT_JOB_VERSION =
    "ocr-submit-job-2.0";

const OWNER_TYPE =
    "account";

const OWNER_VERSION =
    2;

const MAX_IMAGE_BYTES =
    10
    * 1024
    * 1024;

const MAX_MATCH_METADATA_BYTES =
    16
    * 1024;

const MAX_ROSTER_NAME_BYTES =
    64;

const ALLOWED_IMAGE_CONTENT_TYPES =
    new Set([
        "image/png",
        "image/jpeg",
        "image/webp"
    ]);

/* =========================================================
PROGRESS
========================================================= */

const JOB_PROGRESS =
    Object.freeze({
        QUEUED:
            2,

        FAILED:
            97
    });

/* =========================================================
MAIN
========================================================= */

export async function onRequestPost(
    context
) {
    const {
        request,
        env
    } =
        context;

    try {
        /* =================================================
        CONFIGURATION
        ================================================= */

        const configurationError =
            validateConfiguration(
                env
            );

        if (
            configurationError
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    message:
                        configurationError,

                    version:
                        SUBMIT_JOB_VERSION
                },
                503
            );
        }

        /* =================================================
        CONTENT TYPE
        ================================================= */

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
                    success:
                        false,

                    message:
                        "Expected multipart/form-data.",

                    version:
                        SUBMIT_JOB_VERSION
                },
                400
            );
        }

        /* =================================================
        GLOBAL BPD SESSION
        ================================================= */

        let verifiedAuthorization;
        try { verifiedAuthorization = await authorizeRocketLeagueRequest(request, env); }
        catch (error) { return authorizationErrorResponse(error); }
        const session = { ...verifiedAuthorization.sessionContext, providers: {
            ...verifiedAuthorization.sessionContext.providers,
            epic: { linked: true, authenticated: true, authorized: true,
                accountId: verifiedAuthorization.provider.subject }
        } };

        if (
            session.authenticated !== true
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    code:
                        "AUTHENTICATION_REQUIRED",

                    message:
                        "Authentication required.",

                    version:
                        SUBMIT_JOB_VERSION
                },
                401
            );
        }

        const accountId =
            normalizeString(
                session.userId
            );

        if (
            !accountId
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    code:
                        "ACCOUNT_IDENTITY_MISSING",

                    message:
                        "Authenticated account identity is unavailable.",

                    version:
                        SUBMIT_JOB_VERSION
                },
                409
            );
        }

        if (
            session.active !== true
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    code:
                        "ACCOUNT_INACTIVE",

                    message:
                        "This BPD account is not active.",

                    version:
                        SUBMIT_JOB_VERSION
                },
                403
            );
        }

        /* =================================================
        EPIC REQUIREMENT

        Rocket League OCR requires a linked Epic identity,
        but Epic is not used as the ownership identifier.
        ================================================= */

        const epic =
            getProviderContext(
                session,
                "epic"
            );

        const epicAccountId =
            normalizeString(
                epic?.accountId
            );

        if (
            epic?.linked !== true
            || !epicAccountId
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    code:
                        "EPIC_ACCOUNT_REQUIRED",

                    message:
                        "A linked Epic account is required for Rocket League OCR.",

                    version:
                        SUBMIT_JOB_VERSION
                },
                403
            );
        }

        /* =================================================
        TRUSTED OWNER

        New jobs are owned by identity.accounts.id rather
        than by the Epic provider subject.
        ================================================= */

        const submittedBy =
            await createOwnerHash(
                accountId,
                env.OCR_OWNER_SECRET
            );

        /* =================================================
        FORM DATA
        ================================================= */

        let formData;

        try {
            formData =
                await request.formData();
        }
        catch {
            return jsonResponse(
                {
                    success:
                        false,

                    message:
                        "Unable to read submitted form data.",

                    version:
                        SUBMIT_JOB_VERSION
                },
                400
            );
        }

        const hasSourceMode = formData.has("sourceMode");
        const sourceMode = hasSourceMode
            ? normalizeOcrSourceMode(formData.get("sourceMode"))
            : null;
        const submissionMode = normalizeOcrImageSourceMode(
            formData.get("submissionMode")
        );

        if ((hasSourceMode && !sourceMode) || !submissionMode) {
            return jsonResponse({
                success: false,
                message: "Invalid OCR submission mode.",
                version: SUBMIT_JOB_VERSION
            }, 400);
        }

        const rawMatchMetadata =
            formData.get(
                "matchMetadata"
            );

        if (
            formData.has(
                "matchMetadata"
            )
            && getUtf8ByteLength(
                rawMatchMetadata
            ) > MAX_MATCH_METADATA_BYTES
        ) {
            return jsonResponse({
                success: false,
                message: "OCR match metadata is too large.",
                version: SUBMIT_JOB_VERSION
            }, 413);
        }

        let playersPerTeam = normalizeOcrRosterSize(
            formData.get("playersPerTeam")
        );
        let expectedPlayerNames = parseJsonArray(
            formData.get("expectedPlayerNames")
        );
        let matchMetadata = parseMatchMetadata(
            rawMatchMetadata
        );

        if (formData.has("matchMetadata") && matchMetadata === null) {
            return jsonResponse({
                success: false,
                message: "Invalid OCR match metadata.",
                version: SUBMIT_JOB_VERSION
            }, 400);
        }

        if (!hasSourceMode) {
            const legacyValidation = validateLegacyRoster(
                playersPerTeam,
                expectedPlayerNames
            );

            if (!legacyValidation.valid) {
                return jsonResponse({
                    success: false,
                    message: legacyValidation.message,
                    version: SUBMIT_JOB_VERSION
                }, 400);
            }

            expectedPlayerNames = legacyValidation.expectedPlayerNames;
        }
        else {
            const team1Roster = matchMetadata?.teams?.find(
                (team) => team.team === 1
            )?.roster ?? null;
            const team2Roster = matchMetadata?.teams?.find(
                (team) => team.team === 2
            )?.roster ?? null;
            const rosterContract = normalizeOcrRosterContract({
                sourceMode,
                playersPerTeam: formData.has("playersPerTeam")
                    ? formData.get("playersPerTeam")
                    : null,
                team1Roster,
                team2Roster
            });

            if (!rosterContract) {
                return jsonResponse({
                    success: false,
                    message: "Invalid OCR roster metadata.",
                    version: SUBMIT_JOB_VERSION
                }, 400);
            }

            playersPerTeam = rosterContract.playersPerTeam;

            if (sourceMode === OCR_SOURCE_MODES.MANUAL) {
                expectedPlayerNames = [
                    ...rosterContract.team1Roster,
                    ...rosterContract.team2Roster
                ].map((name) => name.toUpperCase());
            }
            else if (expectedPlayerNames.length > 0) {
                return jsonResponse({
                    success: false,
                    message: "Automatic OCR cannot accept unstructured player names.",
                    version: SUBMIT_JOB_VERSION
                }, 400);
            }
        }

        /* =================================================
        IMAGE
        ================================================= */

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
                    success:
                        false,

                    message:
                        "Missing image.",

                    version:
                        SUBMIT_JOB_VERSION
                },
                400
            );
        }

        const imageValidation =
            validateOcrImageMetadata(
                image
            );

        if (
            !imageValidation.valid
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    message:
                        imageValidation.message,

                    version:
                        SUBMIT_JOB_VERSION
                },
                imageValidation.status
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
                    success:
                        false,

                    message:
                        "Image is empty or did not transfer correctly.",

                    version:
                        SUBMIT_JOB_VERSION
                },
                400
            );
        }

        if (
            imageBytes.byteLength >
            MAX_IMAGE_BYTES
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    message:
                        "Uploaded image is too large.",

                    version:
                        SUBMIT_JOB_VERSION
                },
                413
            );
        }

        /* =================================================
        NORMALIZE REQUEST FIELDS
        ================================================= */

        formData.set("submissionMode", submissionMode);

        if (hasSourceMode) {
            formData.set("sourceMode", sourceMode);
            formData.set("matchMetadata", JSON.stringify(matchMetadata));
        }

        if (playersPerTeam === null) {
            formData.delete("playersPerTeam");
            formData.delete("expectedPlayerNames");
        }
        else {
            formData.set("playersPerTeam", String(playersPerTeam));
            formData.set("expectedPlayerNames", JSON.stringify(expectedPlayerNames));
        }

        /* =================================================
        JOB
        ================================================= */

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

        fields.imageContentType =
            imageValidation.contentType;

        /* =================================================
        TRUSTED SERVER-DERIVED OWNERSHIP

        submittedBy is retained because downstream Cloud Run
        and existing OCR report structures already use this
        field.

        Its meaning is now the hashed BPD account ID.
        ================================================= */

        fields.submittedBy =
            submittedBy;

        fields.ownerType =
            OWNER_TYPE;

        fields.ownerVersion =
            OWNER_VERSION;

        /* =================================================
        REQUEST DATA
        ================================================= */

        const requestData = {
            version:
                "ocr-job-request-2.0",

            jobId,

            createdAt:
                now,

            ownerId:
                submittedBy,

            ownerType:
                OWNER_TYPE,

            ownerVersion:
                OWNER_VERSION,

            fields
        };

        /* =================================================
        STATUS DATA
        ================================================= */

        const statusData = {
            version:
                "ocr-job-state-2.0",

            jobId,

            ownerId:
                submittedBy,

            ownerType:
                OWNER_TYPE,

            ownerVersion:
                OWNER_VERSION,

            status:
                "queued",

            stage:
                "queued",

            progress:
                JOB_PROGRESS.QUEUED,

            progressSource:
                "worker",

            message:
                "Scoreboard queued for processing.",

            uploadStatus:
                "completed",

            createdAt:
                now,

            startedAt:
                null,

            ocrStartedAt:
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

            requiresPlayerReview:
                false,

            reviewRequired:
                false,

            confirmationStatus:
                null,

            error:
                null
        };

        /* =================================================
        STORE JOB FILES
        ================================================= */

        await Promise.all([
            env.OCR_STORAGE.put(
                inputKey,
                imageBytes,
                {
                    httpMetadata: {
                        contentType:
                            String(
                                imageValidation.contentType
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

        /* =================================================
        QUEUE JOB
        ================================================= */

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

            const failedStatus = {
                ...statusData,

                status:
                    "failed",

                stage:
                    "queue_failed",

                progress:
                    JOB_PROGRESS.FAILED,

                progressSource:
                    "worker",

                message:
                    "The scoreboard could not be queued for processing.",

                updatedAt:
                    failedAt,

                completedAt:
                    failedAt,

                heartbeatAt:
                    failedAt,

                requiresPlayerReview:
                    false,

                reviewRequired:
                    false,

                confirmationStatus:
                    null,

                error: {
                    code:
                        "QUEUE_SEND_FAILED",

                    message:
                        String(
                            queueError?.message
                            || queueError
                        )
                            .replace(
                                /\s+/g,
                                " "
                            )
                            .trim()
                            .slice(
                                0,
                                1200
                            )
                }
            };

            await env.OCR_STORAGE.put(
                statusKey,
                JSON.stringify(
                    failedStatus,
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

            console.error(
                "[OCR SUBMIT] Queue send failed.",
                {
                    jobId,

                    message:
                        failedStatus
                            .error
                            .message
                }
            );

            return jsonResponse(
                {
                    success:
                        false,

                    version:
                        SUBMIT_JOB_VERSION,

                    jobId,

                    status:
                        failedStatus.status,

                    stage:
                        failedStatus.stage,

                    progress:
                        failedStatus.progress,

                    message:
                        failedStatus.message,

                    uploadStatus:
                        failedStatus.uploadStatus,

                    error: {
                        code:
                            failedStatus
                                .error
                                .code
                    }
                },
                503
            );
        }

        /* =================================================
        RESPONSE
        ================================================= */

        return jsonResponse(
            {
                success:
                    true,

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
                success:
                    false,

                message:
                    "Unable to create OCR job.",

                version:
                    SUBMIT_JOB_VERSION
            },
            500
        );
    }
}

/* =========================================================
CONFIGURATION
========================================================= */

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

/* =========================================================
NORMALIZATION
========================================================= */

function normalizeString(
    value
) {
    if (
        typeof value !== "string"
    ) {
        return "";
    }

    return value.trim();
}

function parseJsonArray(value) {
    if (typeof value !== "string") {
        return [];
    }

    try {
        const parsed = JSON.parse(value || "[]");

        return Array.isArray(parsed) ? parsed : [];
    }
    catch {
        return [];
    }
}

function sanitizeOptionalMetadataValue(value) {
    if (value == null) {
        return null;
    }

    if (typeof value !== "string") {
        return null;
    }

    const normalized = value.trim();

    return normalized ? normalized.slice(0, 160) : null;
}

function getUtf8ByteLength(value) {
    return new TextEncoder().encode(
        typeof value === "string"
            ? value
            : ""
    ).byteLength;
}

export function parseMatchMetadata(value) {
    let parsed = {};

    if (value != null && typeof value !== "string") {
        return null;
    }

    if (typeof value === "string" && value.trim()) {
        try {
            parsed = JSON.parse(value);
        }
        catch {
            return null;
        }
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return null;
    }

    const rawTeams = Array.isArray(parsed.teams) ? parsed.teams : [];

    if (
        rawTeams.length > 2
        || rawTeams.some(
            (team) => ![1, 2].includes(
                Number(team?.team)
            )
        )
        || new Set(
            rawTeams.map(
                (team) => Number(team?.team)
            )
        ).size !== rawTeams.length
    ) {
        return null;
    }

    const teams = [1, 2].map((teamNumber) => {
        const source = rawTeams.find(
            (team) => Number(team?.team) === teamNumber
        );
        const roster = normalizeRosterMetadata(
            source?.roster
        );

        return {
            team: teamNumber,
            roster
        };
    });

    if (teams.some((team) => team.roster === undefined)) {
        return null;
    }

    return {
        name: sanitizeOptionalMetadataValue(parsed.name),
        id: sanitizeOptionalMetadataValue(parsed.id),
        season: sanitizeOptionalMetadataValue(parsed.season),
        date: sanitizeOptionalMetadataValue(parsed.date),
        teams
    };
}

function normalizeRosterMetadata(value) {
    if (value == null) {
        return null;
    }

    if (
        !Array.isArray(value)
        || value.length > 16
    ) {
        return undefined;
    }

    const roster = [];

    for (
        const name
        of value
    ) {
        if (typeof name !== "string") {
            return undefined;
        }

        const normalized = name.trim();

        if (
            !normalized
            || getUtf8ByteLength(
                normalized
            ) > MAX_ROSTER_NAME_BYTES
        ) {
            return undefined;
        }

        roster.push(
            normalized
        );
    }

    return roster;
}

export function validateLegacyRoster(playersPerTeam, expectedPlayerNames) {
    if (playersPerTeam === null) {
        return {
            valid: false,
            message: "playersPerTeam must be an integer from 1 through 16."
        };
    }

    const normalizedNames = Array.isArray(expectedPlayerNames)
        ? expectedPlayerNames.map(
            (value) => typeof value === "string"
                ? value.trim().toUpperCase()
                : ""
        )
        : [];
    const expectedCount = playersPerTeam * 2;
    const valid = normalizedNames.length === expectedCount
        && normalizedNames.every(Boolean)
        && normalizedNames.every(
            (name) => getUtf8ByteLength(
                name
            ) <= MAX_ROSTER_NAME_BYTES
        )
        && new Set(normalizedNames).size === expectedCount;

    return {
        valid,
        expectedPlayerNames: normalizedNames,
        message: valid
            ? ""
            : `Player Names Must Contain Exactly ${expectedCount} Unique Names.`
    };
}

export function validateOcrImageMetadata(image) {
    const contentType = String(
        image?.type
        || ""
    )
        .split(";", 1)[0]
        .trim()
        .toLowerCase();

    if (!ALLOWED_IMAGE_CONTENT_TYPES.has(contentType)) {
        return {
            valid: false,
            status: 415,
            message: "Uploaded image must be PNG, JPEG, or WebP."
        };
    }

    const size = Number(image?.size);

    if (!Number.isSafeInteger(size) || size <= 0) {
        return {
            valid: false,
            status: 400,
            message: "Uploaded image is empty."
        };
    }

    if (size > MAX_IMAGE_BYTES) {
        return {
            valid: false,
            status: 413,
            message: "Uploaded image is too large."
        };
    }

    return {
        valid: true,
        contentType
    };
}

/* =========================================================
REQUEST FIELDS
========================================================= */

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
            || key === "ownerId"
            || key === "ownerType"
            || key === "ownerVersion"
        ) {
            continue;
        }

        if (
            typeof value !== "string"
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

/* =========================================================
OWNER HASH
========================================================= */

async function createOwnerHash(
    accountId,
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
                    accountId
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

/* =========================================================
JOB ID
========================================================= */

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

/* =========================================================
RESPONSE
========================================================= */

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
