"use strict";

import {
    putMatchImage,
    putMatchReport
} from "../../../services/ocr/storage.js";

const PROCESS_JOB_VERSION =
    "ocr-process-job-2.2";

const OCR_JOB_STATUS_PREFIX =
    "ocr-jobs";

const OCR_PROGRESS_PREFIX =
    "jobs";

const OCR_EDIT_TIME_ZONE =
    "America/New_York";

const OCR_EDIT_DEADLINE_HOUR =
    23;

const PROCESSING_LEASE_MS =
    120000;

const OCR_PROVIDER_TIMEOUT_MS =
    295000;

const JOB_PROGRESS = Object.freeze({
    STARTING:
        15,
    ACCEPTING:
        16,
    VERIFYING:
        18,
    OCR_ACCEPTED:
        20,
    FINALIZING:
        97,
    COMPLETED:
        100
});

/* =========================================================
   NORMALIZATION
   ========================================================= */

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

function normalizeProgress(
    value
) {
    const numeric =
        Number(
            value
        );

    if (
        !Number.isFinite(
            numeric
        )
    ) {
        return 0;
    }

    return Math.max(
        0,
        Math.min(
            100,
            Math.round(
                numeric
            )
        )
    );
}

function normalizeErrorMessage(
    value
) {
    return String(
        value?.message
        || value
        || "Unknown OCR processing error."
    )
        .replace(
            /\s+/g,
            " "
        )
        .trim()
        .slice(
            0,
            1200
        );
}

/* =========================================================
   EDIT DEADLINE
   ========================================================= */

function getEasternDateParts(
    date
) {
    const formatter =
        new Intl.DateTimeFormat(
            "en-US",
            {
                timeZone:
                    OCR_EDIT_TIME_ZONE,
                year:
                    "numeric",
                month:
                    "2-digit",
                day:
                    "2-digit",
                weekday:
                    "short",
                hour:
                    "2-digit",
                minute:
                    "2-digit",
                second:
                    "2-digit",
                hourCycle:
                    "h23"
            }
        );

    const parts =
        formatter.formatToParts(
            date
        );

    const values =
        {};

    for (
        const part
        of parts
    ) {
        if (
            part.type ===
            "literal"
        ) {
            continue;
        }

        values[
            part.type
        ] =
            part.value;
    }

    return {
        year:
            Number(
                values.year
            ),
        month:
            Number(
                values.month
            ),
        day:
            Number(
                values.day
            ),
        weekday:
            String(
                values.weekday
                || ""
            ),
        hour:
            Number(
                values.hour
            ),
        minute:
            Number(
                values.minute
            ),
        second:
            Number(
                values.second
            )
    };
}

function getWeekdayIndex(
    weekday
) {
    const weekdays = {
        Sun:
            0,
        Mon:
            1,
        Tue:
            2,
        Wed:
            3,
        Thu:
            4,
        Fri:
            5,
        Sat:
            6
    };

    return weekdays[
        weekday
    ];
}

function easternLocalToUtc(
    year,
    month,
    day,
    hour,
    minute = 0,
    second = 0
) {
    const targetAsUtc =
        Date.UTC(
            year,
            month - 1,
            day,
            hour,
            minute,
            second
        );

    let candidate =
        targetAsUtc;

    for (
        let attempt = 0;
        attempt < 4;
        attempt += 1
    ) {
        const parts =
            getEasternDateParts(
                new Date(
                    candidate
                )
            );

        const representedAsUtc =
            Date.UTC(
                parts.year,
                parts.month - 1,
                parts.day,
                parts.hour,
                parts.minute,
                parts.second
            );

        const difference =
            targetAsUtc
            - representedAsUtc;

        if (
            difference === 0
        ) {
            break;
        }

        candidate +=
            difference;
    }

    return candidate;
}

function createEditDeadlineAt(
    fromDate = new Date()
) {
    const parts =
        getEasternDateParts(
            fromDate
        );

    const weekdayIndex =
        getWeekdayIndex(
            parts.weekday
        );

    if (
        !Number.isInteger(
            weekdayIndex
        )
    ) {
        throw new Error(
            "Unable to determine Eastern Time weekday."
        );
    }

    let daysUntilSunday =
        (
            7
            - weekdayIndex
        )
        % 7;

    if (
        weekdayIndex === 0
        && (
            parts.hour >
                OCR_EDIT_DEADLINE_HOUR
            || (
                parts.hour ===
                    OCR_EDIT_DEADLINE_HOUR
                && (
                    parts.minute > 0
                    || parts.second > 0
                )
            )
        )
    ) {
        daysUntilSunday =
            7;
    }

    const calendarDate =
        new Date(
            Date.UTC(
                parts.year,
                parts.month - 1,
                parts.day
                + daysUntilSunday
            )
        );

    const deadlineYear =
        calendarDate
            .getUTCFullYear();

    const deadlineMonth =
        calendarDate
            .getUTCMonth()
        + 1;

    const deadlineDay =
        calendarDate
            .getUTCDate();

    const deadlineMs =
        easternLocalToUtc(
            deadlineYear,
            deadlineMonth,
            deadlineDay,
            OCR_EDIT_DEADLINE_HOUR,
            0,
            0
        );

    return new Date(
        deadlineMs
    )
        .toISOString();
}

/* =========================================================
   JSON
   ========================================================= */

function jsonResponse(
    body,
    status = 200
) {
    return new Response(
        JSON.stringify(
            body,
            null,
            2
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

async function readJsonResponse(
    response
) {
    const text =
        await response.text();

    if (
        !text
    ) {
        return null;
    }

    try {
        return JSON.parse(
            text
        );
    }
    catch {
        return null;
    }
}

/* =========================================================
   AUTH
   ========================================================= */

function requestAuthorized(
    request,
    env
) {
    const expected =
        String(
            env?.OCR_JOB_PROCESS_SECURE_TOKEN
            || ""
        )
            .trim();

    const received =
        String(
            request.headers.get(
                "X-OCR-Job-Token"
            )
            || ""
        )
            .trim();

    return Boolean(
        expected
        && received
        && expected === received
    );
}

/* =========================================================
   STATUS STORAGE
   ========================================================= */

function getStatusKey(
    jobId
) {
    return (
        `${OCR_JOB_STATUS_PREFIX}/${jobId}/status.json`
    );
}

function getRequestKey(
    jobId
) {
    return (
        `${OCR_JOB_STATUS_PREFIX}/${jobId}/request.json`
    );
}

function getInputKey(
    jobId
) {
    return (
        `${OCR_JOB_STATUS_PREFIX}/${jobId}/input.png`
    );
}

function getResultKey(
    jobId
) {
    return (
        `${OCR_JOB_STATUS_PREFIX}/${jobId}/result.json`
    );
}

function getProgressKey(
    jobId
) {
    return (
        `${OCR_PROGRESS_PREFIX}/${jobId}.json`
    );
}

async function readR2Json(
    bucket,
    key
) {
    const object =
        await bucket.get(
            key
        );

    if (
        !object
    ) {
        return null;
    }

    try {
        return await object.json();
    }
    catch {
        return null;
    }
}

async function writeR2Json(
    bucket,
    key,
    value
) {
    await bucket.put(
        key,
        JSON.stringify(
            value,
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
}

async function readJobStatus(
    env,
    jobId
) {
    const status =
        await readR2Json(
            env.OCR_STORAGE,
            getStatusKey(
                jobId
            )
        );

    if (
        !status
        || typeof status !==
            "object"
        || Array.isArray(
            status
        )
    ) {
        const error =
            new Error(
                "OCR job status was not found."
            );

        error.code =
            "JOB_STATUS_NOT_FOUND";

        error.httpStatus =
            404;

        throw error;
    }

    return status;
}

async function writeJobStatus(
    env,
    jobId,
    status
) {
    await writeR2Json(
        env.OCR_STORAGE,
        getStatusKey(
            jobId
        ),
        status
    );
}

/* =========================================================
   STATUS TRANSITION
   ========================================================= */

async function transitionStatus(
    env,
    jobId,
    currentStatus,
    {
        status = null,
        stage = null,
        progress = null,
        message = null,
        heartbeat = true,
        completed = false,
        matchId = null,
        resultKey = null,
        editDeadlineAt = undefined,
        requiresPlayerReview = undefined,
        reviewRequired = undefined,
        confirmationStatus = undefined,
        error = undefined
    } = {}
) {
    const now =
        new Date()
            .toISOString();

    const next = {
        ...currentStatus
    };

    if (
        status !== null
    ) {
        next.status =
            status;
    }

    if (
        stage !== null
    ) {
        next.stage =
            String(
                stage
            );
    }

    if (
        progress !== null
    ) {
        next.progress =
            Math.max(
                normalizeProgress(
                    next.progress
                ),
                normalizeProgress(
                    progress
                )
            );
    }

    if (
        message !== null
    ) {
        next.message =
            String(
                message
            );
    }

    if (
        matchId
    ) {
        next.matchId =
            normalizeMatchId(
                matchId
            )
            || next.matchId
            || null;
    }

    if (
        resultKey
    ) {
        next.resultKey =
            String(
                resultKey
            );
    }

    if (
        editDeadlineAt !==
            undefined
    ) {
        next.editDeadlineAt =
            editDeadlineAt;
    }

    if (
        requiresPlayerReview !==
            undefined
    ) {
        next.requiresPlayerReview =
            requiresPlayerReview ===
            true;
    }

    if (
        reviewRequired !==
            undefined
    ) {
        next.reviewRequired =
            reviewRequired ===
            true;
    }

    if (
        confirmationStatus !==
            undefined
    ) {
        next.confirmationStatus =
            confirmationStatus;
    }

    if (
        error !== undefined
    ) {
        next.error =
            error;
    }

    next.updatedAt =
        now;

    if (
        heartbeat
    ) {
        next.heartbeatAt =
            now;
    }

    if (
        completed
    ) {
        next.completedAt =
            now;
    }

    await writeJobStatus(
        env,
        jobId,
        next
    );

    return next;
}

/* =========================================================
   PROCESSING LEASE
   ========================================================= */

function isLeaseActive(
    status
) {
    if (
        status?.status !==
            "processing"
    ) {
        return false;
    }

    const timestamp =
        Date.parse(
            status?.heartbeatAt
            || status?.updatedAt
            || ""
        );

    if (
        !Number.isFinite(
            timestamp
        )
    ) {
        return false;
    }

    const age =
        Date.now()
        - timestamp;

    return (
        age >= 0
        && age <
            PROCESSING_LEASE_MS
    );
}

/* =========================================================
   REQUEST PAYLOAD
   ========================================================= */

async function readJobRequest(
    env,
    jobId
) {
    const requestData =
        await readR2Json(
            env.OCR_STORAGE,
            getRequestKey(
                jobId
            )
        );

    if (
        !requestData
        || typeof requestData !==
            "object"
        || Array.isArray(
            requestData
        )
    ) {
        const error =
            new Error(
                "OCR job request was not found."
            );

        error.code =
            "JOB_REQUEST_NOT_FOUND";

        error.httpStatus =
            404;

        throw error;
    }

    if (
        !requestData.fields
        || typeof requestData.fields !==
            "object"
        || Array.isArray(
            requestData.fields
        )
    ) {
        const error =
            new Error(
                "OCR job request fields were not found."
            );

        error.code =
            "JOB_REQUEST_FIELDS_NOT_FOUND";

        error.httpStatus =
            422;

        throw error;
    }

    return requestData;
}

function getRequestFields(
    requestData
) {
    if (
        requestData?.fields
        && typeof requestData.fields ===
            "object"
        && !Array.isArray(
            requestData.fields
        )
    ) {
        return requestData.fields;
    }

    return {};
}

async function readJobImage(
    env,
    jobId
) {
    const object =
        await env.OCR_STORAGE.get(
            getInputKey(
                jobId
            )
        );

    if (
        !object
    ) {
        const error =
            new Error(
                "OCR job image was not found."
            );

        error.code =
            "JOB_IMAGE_NOT_FOUND";

        error.httpStatus =
            404;

        throw error;
    }

    const bytes =
        await object.arrayBuffer();

    if (
        !bytes
        || bytes.byteLength <= 0
    ) {
        const error =
            new Error(
                "OCR job image is empty."
            );

        error.code =
            "JOB_IMAGE_EMPTY";

        error.httpStatus =
            422;

        throw error;
    }

    return bytes;
}

/* =========================================================
   CLOUD RUN FETCH
   ========================================================= */

async function fetchWithTimeout(
    url,
    options,
    timeoutMs
) {
    const controller =
        new AbortController();

    const timeout =
        setTimeout(
            function() {
                controller.abort(
                    "OCR provider timeout"
                );
            },
            timeoutMs
        );

    try {
        return await fetch(
            url,
            {
                ...options,
                signal:
                    controller.signal
            }
        );
    }
    finally {
        clearTimeout(
            timeout
        );
    }
}

function buildProviderHeaders(
    env,
    jobId
) {
    const headers =
        new Headers();

    headers.set(
        "Accept",
        "application/json"
    );

    headers.set(
        "X-API-Key",
        String(
            env.OCR_API_KEY
            || ""
        )
    );

    headers.set(
        "X-BPD-OCR-Job-ID",
        jobId
    );

    return headers;
}

/* =========================================================
   PROVIDER REQUEST
   ========================================================= */

async function callOcrProvider(
    env,
    jobId,
    requestData,
    imageBytes
) {
    if (
        !String(
            env.OCR_API_URL
            || ""
        )
            .trim()
    ) {
        const error =
            new Error(
                "OCR_API_URL is not configured."
            );

        error.code =
            "OCR_API_URL_MISSING";

        error.httpStatus =
            500;

        throw error;
    }

    if (
        !String(
            env.OCR_API_KEY
            || ""
        )
            .trim()
    ) {
        const error =
            new Error(
                "OCR_API_KEY is not configured."
            );

        error.code =
            "OCR_API_KEY_MISSING";

        error.httpStatus =
            500;

        throw error;
    }

    const fields =
        getRequestFields(
            requestData
        );

    const formData =
        new FormData();

    const imageBlob =
        new Blob(
            [
                imageBytes
            ],
            {
                type:
                    "image/png"
            }
        );

    formData.set(
        "image",
        imageBlob,
        "scoreboard.png"
    );

    if (
        fields?.expectedPlayerNames !==
            undefined
    ) {
        let expectedPlayerNames =
            fields.expectedPlayerNames;

        if (
            typeof expectedPlayerNames ===
                "string"
        ) {
            try {
                expectedPlayerNames =
                    JSON.parse(
                        expectedPlayerNames
                    );
            }
            catch {
                expectedPlayerNames =
                    [];
            }
        }

        if (
            Array.isArray(
                expectedPlayerNames
            )
        ) {
            formData.set(
                "expectedPlayerNames",
                JSON.stringify(
                    expectedPlayerNames
                )
            );
        }
    }

    if (
        fields?.matchType
    ) {
        formData.set(
            "matchType",
            String(
                fields.matchType
            )
        );
    }

    if (
        fields?.matchSeason
    ) {
        formData.set(
            "matchSeason",
            String(
                fields.matchSeason
            )
        );
    }

    if (
        fields?.submittedBy
    ) {
        formData.set(
            "submittedBy",
            String(
                fields.submittedBy
            )
        );
    }

    if (
        fields?.submissionMode
    ) {
        formData.set(
            "submissionMode",
            String(
                fields.submissionMode
            )
        );
    }

    const response =
        await fetchWithTimeout(
            env.OCR_API_URL,
            {
                method:
                    "POST",
                headers:
                    buildProviderHeaders(
                        env,
                        jobId
                    ),
                body:
                    formData
            },
            OCR_PROVIDER_TIMEOUT_MS
        );

    const responseData =
        await readJsonResponse(
            response
        );

    if (
        !response.ok
    ) {
        const error =
            new Error(
                responseData?.message
                || responseData?.error?.message
                || `OCR provider returned HTTP ${response.status}.`
            );

        error.code =
            responseData?.code
            || responseData?.error?.code
            || "OCR_PROVIDER_REJECTED";

        error.httpStatus =
            response.status;

        error.providerData =
            responseData;

        throw error;
    }

    if (
        !responseData
        || typeof responseData !==
            "object"
        || Array.isArray(
            responseData
        )
    ) {
        const error =
            new Error(
                "OCR provider returned an invalid JSON response."
            );

        error.code =
            "OCR_PROVIDER_INVALID_RESPONSE";

        error.httpStatus =
            502;

        throw error;
    }

    return responseData;
}
/* =========================================================
   RESULT EXTRACTION
   ========================================================= */

function getProviderResult(
    providerData
) {
    if (
        providerData?.matchReport
        && typeof providerData.matchReport ===
            "object"
        && !Array.isArray(
            providerData.matchReport
        )
    ) {
        return providerData.matchReport;
    }

    if (
        providerData?.result
        && typeof providerData.result ===
            "object"
        && !Array.isArray(
            providerData.result
        )
    ) {
        return providerData.result;
    }

    return null;
}

function resultRequiresReview(
    result
) {
    if (
        result?.requiresPlayerReview ===
            true
        || result?.reviewRequired ===
            true
    ) {
        return true;
    }

    const teams =
        Array.isArray(
            result?.teams
        )
            ? result.teams
            : [];

    for (
        const team
        of teams
    ) {
        const players =
            Array.isArray(
                team?.players
            )
                ? team.players
                : [];

        for (
            const player
            of players
        ) {
            const reviewFields =
                player?.reviewFields;

            if (
                !reviewFields
                || typeof reviewFields !==
                    "object"
                || Array.isArray(
                    reviewFields
                )
            ) {
                continue;
            }

            for (
                const field
                of Object.values(
                    reviewFields
                )
            ) {
                if (
                    field?.requiresVerification ===
                        true
                ) {
                    return true;
                }
            }
        }
    }

    return false;
}

/* =========================================================
   RESULT PERSISTENCE
   ========================================================= */

async function persistResult(
    env,
    jobId,
    providerData,
    requestData,
    imageBytes
) {
    const result =
        getProviderResult(
            providerData
        );

    if (
        !result
    ) {
        const error =
            new Error(
                "OCR provider did not return a match result."
            );

        error.code =
            "OCR_RESULT_MISSING";

        error.httpStatus =
            422;

        throw error;
    }

    const matchId =
        normalizeMatchId(
            providerData?.matchId
            || result?.matchId
        );

    if (
        !matchId
    ) {
        const error =
            new Error(
                "OCR provider did not return a valid match ID."
            );

        error.code =
            "MATCH_ID_MISSING";

        error.httpStatus =
            422;

        throw error;
    }

    const fields =
        getRequestFields(
            requestData
        );

    const submittedBy =
        String(
            fields?.submittedBy
            || ""
        )
            .trim();

    if (
        !submittedBy
    ) {
        const error =
            new Error(
                "Trusted OCR job ownership data is missing."
            );

        error.code =
            "OCR_OWNER_MISSING";

        error.httpStatus =
            500;

        throw error;
    }

    const requiresPlayerReview =
        resultRequiresReview(
            result
        );

    const confirmationStatus =
        requiresPlayerReview
            ? "pending_review"
            : "auto_accepted";

    const storedAt =
        new Date()
            .toISOString();

    const editDeadlineAt =
        createEditDeadlineAt(
            new Date(
                storedAt
            )
        );

    const storedResult = {
        ...providerData,

        jobId,

        matchId,

        submittedBy,

        requiresPlayerReview,

        reviewRequired:
            requiresPlayerReview,

        confirmationStatus,

        editDeadlineAt,

        storedAt
    };

    await writeR2Json(
        env.OCR_STORAGE,
        getResultKey(
            jobId
        ),
        storedResult
    );

    const matchReport = {
        ...result,

        jobId,

        matchId,

        submittedBy,

        requiresPlayerReview,

        reviewRequired:
            requiresPlayerReview,

        confirmationStatus,

        editDeadlineAt,

        hasDisputes:
            false,

        disputeCount:
            0,

        adjustmentCount:
            0,

        storedAt
    };

    await putMatchImage(
        env.OCR_STORAGE,
        {
            matchId,

            image:
                imageBytes,

            contentType:
                "image/png",

            metadata: {
                jobId,
                submittedBy
            }
        }
    );

    const matchReportStorage =
        await putMatchReport(
            env.OCR_STORAGE,
            {
                matchId,
                jobId,

                report:
                    matchReport,

                preserveOriginal:
                    true
            }
        );

    return {
        matchId,

        requiresPlayerReview,

        confirmationStatus,

        editDeadlineAt,

        resultKey:
            getResultKey(
                jobId
            ),

        currentReportKey:
            matchReportStorage.currentKey,

        originalReportKey:
            matchReportStorage.originalKey
    };
}

/* =========================================================
   PROGRESS CLEANUP
   ========================================================= */

async function deleteProgressObject(
    env,
    jobId
) {
    if (
        !env?.OCR_PROGRESS
    ) {
        return;
    }

    try {
        await env.OCR_PROGRESS.delete(
            getProgressKey(
                jobId
            )
        );
    }
    catch (
        error
    ) {
        console.warn(
            "[OCR PROCESS] Temporary progress cleanup failed.",
            {
                jobId,

                message:
                    normalizeErrorMessage(
                        error
                    )
            }
        );
    }
}

/* =========================================================
   USER-FRIENDLY FAILURE
   ========================================================= */

function buildFailureMessage(
    error
) {
    const code =
        String(
            error?.code
            || ""
        )
            .trim()
            .toUpperCase();

    if (
        code.includes(
            "IMAGE"
        )
    ) {
        return (
            "We couldn't read the uploaded image. "
            + "Please try another screenshot or image."
        );
    }

    if (
        code.includes(
            "HEADER"
        )
        || code.includes(
            "SCOREBOARD"
        )
        || code.includes(
            "PREFLIGHT"
        )
    ) {
        return (
            "We couldn't reliably identify a Rocket League scoreboard in this image."
        );
    }

    if (
        code.includes(
            "ROW"
        )
        || code.includes(
            "PLAYER"
        )
    ) {
        return (
            "We found the scoreboard, but couldn't reliably line up all player rows."
        );
    }

    if (
        code.includes(
            "TIMEOUT"
        )
    ) {
        return (
            "Image processing took too long to finish. Please try again."
        );
    }

    return (
        "We couldn't finish processing this scoreboard. Please review the image and try again."
    );
}

/* =========================================================
   FAILURE WRITE
   ========================================================= */

async function markFailed(
    env,
    jobId,
    currentStatus,
    error
) {
    const now =
        new Date()
            .toISOString();

    const code =
        String(
            error?.code
            || "OCR_PROCESS_FAILED"
        )
            .trim()
            .toUpperCase();

    const technicalMessage =
        normalizeErrorMessage(
            error
        );

    const userMessage =
        buildFailureMessage(
            error
        );

    const nextStatus = {
        ...currentStatus,

        status:
            "failed",

        stage:
            "failed",

        progress:
            Math.min(
                JOB_PROGRESS.FINALIZING,
                normalizeProgress(
                    currentStatus?.progress
                )
            ),

        message:
            userMessage,

        requiresPlayerReview:
            false,

        reviewRequired:
            false,

        confirmationStatus:
            null,

        editDeadlineAt:
            null,

        failureSummary:
            `[${code}] ${technicalMessage}`,

        error: {
            code,

            message:
                technicalMessage,

            userMessage
        },

        updatedAt:
            now,

        heartbeatAt:
            now,

        completedAt:
            now
    };

    await writeJobStatus(
        env,
        jobId,
        nextStatus
    );

    await deleteProgressObject(
        env,
        jobId
    );

    return nextStatus;
}

/* =========================================================
   MAIN PROCESS
   ========================================================= */

async function processJob(
    request,
    env
) {
    if (
        !env?.OCR_STORAGE
    ) {
        return jsonResponse(
            {
                success:
                    false,

                message:
                    "OCR_STORAGE is not configured."
            },
            500
        );
    }

    if (
        !requestAuthorized(
            request,
            env
        )
    ) {
        return jsonResponse(
            {
                success:
                    false,

                message:
                    "Unauthorized."
            },
            401
        );
    }

    let body;

    try {
        body =
            await request.json();
    }
    catch {
        return jsonResponse(
            {
                success:
                    false,

                message:
                    "Invalid JSON request."
            },
            400
        );
    }

    const jobId =
        normalizeJobId(
            body?.jobId
        );

    if (
        !jobId
    ) {
        return jsonResponse(
            {
                success:
                    false,

                message:
                    "Missing or invalid jobId."
            },
            400
        );
    }

    let currentStatus;

    try {
        currentStatus =
            await readJobStatus(
                env,
                jobId
            );
    }
    catch (
        error
    ) {
        return jsonResponse(
            {
                success:
                    false,

                code:
                    error?.code
                    || "JOB_STATUS_NOT_FOUND",

                message:
                    normalizeErrorMessage(
                        error
                    )
            },
            Number(
                error?.httpStatus
                || 404
            )
        );
    }

    const normalizedStatus =
        String(
            currentStatus?.status
            || ""
        )
            .trim()
            .toLowerCase();

    if (
        normalizedStatus ===
            "completed"
        || normalizedStatus ===
            "failed"
    ) {
        return jsonResponse(
            {
                success:
                    true,

                duplicate:
                    true,

                terminal:
                    true,

                jobId,

                status:
                    normalizedStatus,

                matchId:
                    currentStatus?.matchId
                    || null,

                confirmationStatus:
                    currentStatus
                        ?.confirmationStatus
                    || null,

                requiresPlayerReview:
                    currentStatus
                        ?.requiresPlayerReview ===
                    true,

                editDeadlineAt:
                    currentStatus
                        ?.editDeadlineAt
                    || null,

                resultKey:
                    currentStatus
                        ?.resultKey
                    || null,

                version:
                    PROCESS_JOB_VERSION
            },
            200
        );
    }

    if (
        isLeaseActive(
            currentStatus
        )
    ) {
        return jsonResponse(
            {
                success:
                    true,

                duplicate:
                    true,

                processing:
                    true,

                jobId,

                status:
                    "processing",

                stage:
                    currentStatus?.stage
                    || null,

                progress:
                    normalizeProgress(
                        currentStatus?.progress
                    ),

                version:
                    PROCESS_JOB_VERSION
            },
            202
        );
    }

    currentStatus =
        await transitionStatus(
            env,
            jobId,
            currentStatus,
            {
                status:
                    "processing",

                stage:
                    "starting",

                progress:
                    JOB_PROGRESS.STARTING,

                message:
                    "Starting OCR processing.",

                requiresPlayerReview:
                    false,

                reviewRequired:
                    false,

                confirmationStatus:
                    null,

                editDeadlineAt:
                    null,

                error:
                    null
            }
        );

    let requestData;
    let imageBytes;

    try {
        currentStatus =
            await transitionStatus(
                env,
                jobId,
                currentStatus,
                {
                    stage:
                        "accepting",

                    progress:
                        JOB_PROGRESS.ACCEPTING,

                    message:
                        "Loading OCR submission."
                }
            );

        [
            requestData,
            imageBytes
        ] =
            await Promise.all([
                readJobRequest(
                    env,
                    jobId
                ),

                readJobImage(
                    env,
                    jobId
                )
            ]);

        currentStatus =
            await transitionStatus(
                env,
                jobId,
                currentStatus,
                {
                    stage:
                        "verifying",

                    progress:
                        JOB_PROGRESS.VERIFYING,

                    message:
                        "Verifying OCR submission."
                }
            );

        const providerData =
            await callOcrProvider(
                env,
                jobId,
                requestData,
                imageBytes
            );

        currentStatus =
            await transitionStatus(
                env,
                jobId,
                currentStatus,
                {
                    stage:
                        "ocr_accepted",

                    progress:
                        JOB_PROGRESS.OCR_ACCEPTED,

                    message:
                        "OCR result received."
                }
            );

        currentStatus =
            await transitionStatus(
                env,
                jobId,
                currentStatus,
                {
                    stage:
                        "finalizing",

                    progress:
                        JOB_PROGRESS.FINALIZING,

                    message:
                        "Saving OCR result."
                }
            );

        const persisted =
            await persistResult(
                env,
                jobId,
                providerData,
                requestData,
                imageBytes
            );

        const completedAt =
            new Date()
                .toISOString();

        const completedStatus = {
            ...currentStatus,

            status:
                "completed",

            stage:
                "completed",

            progress:
                JOB_PROGRESS.COMPLETED,

            progressSource:
                "cloudflare",

            message:
                persisted.requiresPlayerReview
                    ? "OCR complete. Player review is required."
                    : "OCR complete.",

            matchId:
                persisted.matchId,

            resultKey:
                persisted.resultKey,

            currentReportKey:
                persisted.currentReportKey,

            originalReportKey:
                persisted.originalReportKey,

            requiresPlayerReview:
                persisted.requiresPlayerReview,

            reviewRequired:
                persisted.requiresPlayerReview,

            confirmationStatus:
                persisted.confirmationStatus,

            editDeadlineAt:
                persisted.editDeadlineAt,

            error:
                null,

            updatedAt:
                completedAt,

            heartbeatAt:
                completedAt,

            completedAt
        };

        await writeJobStatus(
            env,
            jobId,
            completedStatus
        );

        await deleteProgressObject(
            env,
            jobId
        );

        return jsonResponse(
            {
                success:
                    true,

                jobId,

                matchId:
                    persisted.matchId,

                status:
                    "completed",

                progress:
                    JOB_PROGRESS.COMPLETED,

                resultKey:
                    persisted.resultKey,

                currentReportKey:
                    persisted.currentReportKey,

                originalReportKey:
                    persisted.originalReportKey,

                requiresPlayerReview:
                    persisted.requiresPlayerReview,

                reviewRequired:
                    persisted.requiresPlayerReview,

                confirmationStatus:
                    persisted.confirmationStatus,

                editDeadlineAt:
                    persisted.editDeadlineAt,

                version:
                    PROCESS_JOB_VERSION
            },
            200
        );
    }
    catch (
        error
    ) {
        console.error(
            "[OCR PROCESS] Job processing failed.",
            {
                jobId,

                code:
                    error?.code
                    || null,

                message:
                    normalizeErrorMessage(
                        error
                    )
            }
        );

        try {
            await markFailed(
                env,
                jobId,
                currentStatus,
                error
            );
        }
        catch (
            statusError
        ) {
            console.error(
                "[OCR PROCESS] Failed to persist terminal failure status.",
                {
                    jobId,

                    message:
                        normalizeErrorMessage(
                            statusError
                        )
                }
            );
        }

        return jsonResponse(
            {
                success:
                    false,

                jobId,

                status:
                    "failed",

                code:
                    String(
                        error?.code
                        || "OCR_PROCESS_FAILED"
                    ),

                message:
                    buildFailureMessage(
                        error
                    ),

                version:
                    PROCESS_JOB_VERSION
            },
            Number(
                error?.httpStatus
                || 500
            )
        );
    }
}

/* =========================================================
   PAGES FUNCTION
   ========================================================= */

export async function onRequestPost(
    context
) {
    return processJob(
        context.request,
        context.env
    );
}