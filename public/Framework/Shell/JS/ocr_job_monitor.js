"use strict";

/* =========================================================
   BPD GAMING NETWORK
   OCR JOB MONITOR
   ========================================================= */

import {
    OCR_JOB_STATUS_URL
} from "/scripts/apiRoutes.js";

import {
    apiFetch
} from "/scripts/apiConnection.js";

const OCR_JOB_MONITOR_VERSION =
    "ocr-job-monitor-1.0";

const OCR_ACTIVE_JOB_KEY =
    "rocketLeagueOcrActiveJobV1";

const OCR_ACTIVE_JOB_ROUTE_KEY =
    "rocketLeagueOcrActiveJobRouteV1";

const OCR_HANDLED_JOB_KEY =
    "rocketLeagueOcrAcknowledgedJobsV1";

const OCR_INITIAL_CHECK_SCHEDULE_MS = [
    5000,
    10000,
    15000,
    18000,
    21000,
    25000,
    30000,
    35000
];

const OCR_TAIL_POLL_MS =
    15000;

const OCR_QUEUE_STALE_MS =
    120000;

const OCR_PROCESSING_STALE_MS =
    120000;

const OCR_MAX_STALE_CHECKS =
    3;

const OCR_MAX_ACTIVE_JOB_MS =
    600000;

const OCR_CONFIRMATION_STATUSES =
    new Set([
        "pending_review",
        "auto_accepted",
        "confirmed",
        "confirmed_with_disputes"
    ]);

let OCR_JOB_MONITOR_READY =
    false;

let OCR_JOB_MONITOR_POLLING =
    false;

let OCR_JOB_MONITOR_TIMER =
    null;

let OCR_JOB_MONITOR_ACTIVE_JOB_ID =
    "";

let OCR_JOB_MONITOR_CHECK_RUNNING =
    false;

let OCR_JOB_MONITOR_CHECK_INDEX =
    0;

let OCR_JOB_MONITOR_STARTED_AT =
    0;

let OCR_JOB_MONITOR_STALE_CHECKS =
    0;

let OCR_JOB_MONITOR_LAST_SIGNATURE =
    "";

/* =========================================================
   NORMALIZATION
   ========================================================= */

function normalizeId(
    value
) {
    return String(
        value
        || ""
    )
        .trim()
        .toUpperCase();
}

function validJobId(
    value
) {
    return /^[A-Z0-9]{16}$/.test(
        normalizeId(
            value
        )
    );
}

function validMatchId(
    value
) {
    return /^[A-Z0-9]{16}$/.test(
        normalizeId(
            value
        )
    );
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

function normalizeConfirmationStatus(
    value
) {
    const status =
        String(
            value
            || ""
        )
            .trim()
            .toLowerCase();

    return OCR_CONFIRMATION_STATUSES.has(
        status
    )
        ? status
        : "";
}

function normalizeStatus(
    value
) {
    return String(
        value
        || ""
    )
        .trim()
        .toLowerCase();
}

function normalizeStage(
    value
) {
    return String(
        value
        || ""
    )
        .trim()
        .toLowerCase();
}

function normalizeMessage(
    value
) {
    return String(
        value
        || ""
    )
        .trim();
}

function normalizeErrorCode(
    value,
    fallback =
        "OCR_FAILED"
) {
    return String(
        value
        || fallback
    )
        .trim()
        .toUpperCase();
}

function isObject(
    value
) {
    return Boolean(
        value
        && typeof value ===
            "object"
        && !Array.isArray(
            value
        )
    );
}

/* =========================================================
   STORAGE
   ========================================================= */

function getStoredActiveJobId() {
    try {
        const jobId =
            normalizeId(
                localStorage.getItem(
                    OCR_ACTIVE_JOB_KEY
                )
            );

        return validJobId(
            jobId
        )
            ? jobId
            : "";
    }
    catch (
        error
    ) {
        console.error(
            "[OCR JOB MONITOR] Could not read active Job ID.",
            error
        );

        return "";
    }
}

function getStoredActiveJobRoute() {
    try {
        const route =
            String(
                localStorage.getItem(
                    OCR_ACTIVE_JOB_ROUTE_KEY
                )
                || ""
            )
                .trim();

        return route.startsWith(
            "/"
        )
            ? route
            : "";
    }
    catch {
        return "";
    }
}

function clearStoredActiveJob() {
    try {
        localStorage.removeItem(
            OCR_ACTIVE_JOB_KEY
        );

        localStorage.removeItem(
            OCR_ACTIVE_JOB_ROUTE_KEY
        );

        return true;
    }
    catch (
        error
    ) {
        console.error(
            "[OCR JOB MONITOR] Could not clear active job.",
            error
        );

        return false;
    }
}

function readHandledJobIds() {
    try {
        const parsed =
            JSON.parse(
                localStorage.getItem(
                    OCR_HANDLED_JOB_KEY
                )
                || "[]"
            );

        if (
            !Array.isArray(
                parsed
            )
        ) {
            return [];
        }

        return parsed
            .map(
                function(
                    item
                ) {
                    return normalizeId(
                        typeof item ===
                            "string"
                            ? item
                            : item?.jobId
                    );
                }
            )
            .filter(
                validJobId
            );
    }
    catch {
        return [];
    }
}

function isJobHandled(
    jobId
) {
    const normalizedJobId =
        normalizeId(
            jobId
        );

    if (
        !validJobId(
            normalizedJobId
        )
    ) {
        return false;
    }

    return readHandledJobIds()
        .includes(
            normalizedJobId
        );
}

/* =========================================================
   RESPONSE
   ========================================================= */

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
        const error =
            new Error(
                "OCR status service returned an invalid response."
            );

        error.status =
            response.status;

        error.code =
            "INVALID_JSON_RESPONSE";

        throw error;
    }
}

/* =========================================================
   JOB STATUS API
   ========================================================= */

async function getOcrJob(
    jobId
) {
    const normalizedJobId =
        normalizeId(
            jobId
        );

    if (
        !validJobId(
            normalizedJobId
        )
    ) {
        const error =
            new Error(
                "Invalid OCR Job ID."
            );

        error.status =
            409;

        error.code =
            "JOB_ID_INVALID";

        throw error;
    }

    const response =
        await apiFetch(
            (
                OCR_JOB_STATUS_URL
                + "?jobId="
                + encodeURIComponent(
                    normalizedJobId
                )
            ),
            {
                method:
                    "GET",
                credentials:
                    "same-origin",
                cache:
                    "no-store",
                headers: {
                    "Accept":
                        "application/json"
                }
            }
        );

    const data =
        await readJsonResponse(
            response
        );

    if (
        !response.ok
        || data?.success !==
            true
    ) {
        const error =
            new Error(
                data?.message
                || "Unable to retrieve OCR job status."
            );

        error.status =
            response.status;

        error.code =
            data?.code
            || null;

        throw error;
    }

    if (
        !isObject(
            data?.job
        )
    ) {
        const error =
            new Error(
                "OCR job data was not returned."
            );

        error.status =
            409;

        error.code =
            "JOB_DATA_MISSING";

        throw error;
    }

    return normalizeJob(
        normalizedJobId,
        data.job
    );
}

/* =========================================================
   JOB NORMALIZATION
   ========================================================= */

function normalizeJob(
    jobId,
    job
) {
    const status =
        normalizeStatus(
            job?.status
        );

    if (
        !status
    ) {
        const error =
            new Error(
                "OCR job status was not returned."
            );

        error.status =
            409;

        error.code =
            "JOB_STATUS_MISSING";

        throw error;
    }

    const matchId =
        normalizeId(
            job?.matchId
        );

    return {
        ...job,
        jobId:
            normalizeId(
                jobId
            ),
        matchId:
            validMatchId(
                matchId
            )
                ? matchId
                : null,
        status,
        stage:
            normalizeStage(
                job?.stage
            ),
        message:
            normalizeMessage(
                job?.message
            ),
        progress:
            normalizeProgress(
                job?.progress
            ),
        confirmedProgress:
            normalizeProgress(
                job?.confirmedProgress
                ?? job?.progress
            ),
        simulatedProgress:
            normalizeProgress(
                job?.simulatedProgress
                ?? 0
            ),
        progressSource:
            normalizeStage(
                job?.progressSource
                || "stored"
            ),
        reviewRequired:
            (
                job?.reviewRequired ===
                    true
                || job?.requiresPlayerReview ===
                    true
            ),
        confirmationStatus:
            normalizeConfirmationStatus(
                job?.confirmationStatus
            )
    };
}

/* =========================================================
   TIMESTAMPS
   ========================================================= */

function parseTimestamp(
    value
) {
    const timestamp =
        Date.parse(
            String(
                value
                || ""
            )
        );

    return Number.isFinite(
        timestamp
    )
        ? timestamp
        : null;
}

function getJobCreatedAt(
    job
) {
    return parseTimestamp(
        job?.createdAt
    );
}

function getJobActivityAt(
    job
) {
    const candidates = [
        job?.heartbeatAt,
        job?.updatedAt,
        job?.ocrStartedAt,
        job?.startedAt,
        job?.createdAt
    ];

    for (
        const candidate
        of candidates
    ) {
        const timestamp =
            parseTimestamp(
                candidate
            );

        if (
            timestamp !==
            null
        ) {
            return timestamp;
        }
    }

    return null;
}

/* =========================================================
   PROGRESS SIGNATURE
   ========================================================= */

function getProgressSignature(
    job
) {
    return [
        job?.status,
        job?.stage,
        job?.progress,
        job?.confirmedProgress,
        job?.simulatedProgress,
        job?.progressSource,
        job?.updatedAt,
        job?.heartbeatAt
    ]
        .map(
            function(
                value
            ) {
                return String(
                    value
                    ?? ""
                );
            }
        )
        .join(
            "|"
        );
}

function recordProgressState(
    job
) {
    const signature =
        getProgressSignature(
            job
        );

    if (
        !OCR_JOB_MONITOR_LAST_SIGNATURE
        || signature !==
            OCR_JOB_MONITOR_LAST_SIGNATURE
    ) {
        OCR_JOB_MONITOR_LAST_SIGNATURE =
            signature;

        OCR_JOB_MONITOR_STALE_CHECKS =
            0;

        return true;
    }

    OCR_JOB_MONITOR_STALE_CHECKS +=
        1;

    return false;
}

/* =========================================================
   STALE DETECTION
   ========================================================= */

function isQueueStale(
    job
) {
    const createdAt =
        getJobCreatedAt(
            job
        );

    return Boolean(
        createdAt !==
        null
        && Date.now()
            - createdAt >=
            OCR_QUEUE_STALE_MS
    );
}

function isProcessingStale(
    job
) {
    if (
        OCR_JOB_MONITOR_STALE_CHECKS <
        OCR_MAX_STALE_CHECKS
    ) {
        return false;
    }

    const activityAt =
        getJobActivityAt(
            job
        );

    return Boolean(
        activityAt !==
        null
        && Date.now()
            - activityAt >=
            OCR_PROCESSING_STALE_MS
    );
}

function isPastClientLifetime(
    job
) {
    const createdAt =
        getJobCreatedAt(
            job
        );

    return Boolean(
        createdAt !==
        null
        && Date.now()
            - createdAt >=
            OCR_MAX_ACTIVE_JOB_MS
    );
}

/* =========================================================
   EVENT DISPATCH
   ========================================================= */

function dispatchProgress(
    job
) {
    document.dispatchEvent(
        new CustomEvent(
            "ocr:job-progress",
            {
                detail: {
                    jobId:
                        job.jobId,
                    matchId:
                        job.matchId,
                    status:
                        job.status,
                    stage:
                        job.stage,
                    progress:
                        job.progress,
                    confirmedProgress:
                        job.confirmedProgress,
                    simulatedProgress:
                        job.simulatedProgress,
                    progressSource:
                        job.progressSource,
                    message:
                        job.message,
                    startedAt:
                        job?.startedAt
                        || null,
                    ocrStartedAt:
                        job?.ocrStartedAt
                        || null,
                    updatedAt:
                        job?.updatedAt
                        || null,
                    heartbeatAt:
                        job?.heartbeatAt
                        || null,
                    reviewRequired:
                        job.reviewRequired,
                    confirmationStatus:
                        job.confirmationStatus,
                    version:
                        OCR_JOB_MONITOR_VERSION
                }
            }
        )
    );
}

function dispatchCompleted(
    job
) {
    document.dispatchEvent(
        new CustomEvent(
            "ocr:job-completed",
            {
                detail: {
                    jobId:
                        job.jobId,
                    matchId:
                        job.matchId,
                    reviewRequired:
                        job.reviewRequired,
                    confirmationStatus:
                        job.confirmationStatus
                        || (
                            job.reviewRequired
                                ? "pending_review"
                                : "auto_accepted"
                        ),
                    sourceRoute:
                        getStoredActiveJobRoute(),
                    completedAt:
                        job?.completedAt
                        || job?.updatedAt
                        || new Date()
                            .toISOString()
                }
            }
        )
    );
}

function dispatchFailure(
    {
        jobId,
        matchId = null,
        stage = "failed",
        errorCode = "OCR_FAILED",
        message = "The scoreboard could not be processed.",
        createdAt = null,
        sourceRoute = ""
    }
) {
    const normalizedJobId =
        normalizeId(
            jobId
        );

    if (
        !validJobId(
            normalizedJobId
        )
    ) {
        console.error(
            "[OCR JOB MONITOR] Refused to dispatch failure with invalid Job ID.",
            jobId
        );

        return false;
    }

    document.dispatchEvent(
        new CustomEvent(
            "ocr:job-failed",
            {
                detail: {
                    jobId:
                        normalizedJobId,
                    matchId:
                        validMatchId(
                            matchId
                        )
                            ? normalizeId(
                                matchId
                            )
                            : null,
                    stage:
                        normalizeStage(
                            stage
                        )
                        || "failed",
                    errorCode:
                        normalizeErrorCode(
                            errorCode
                        ),
                    message:
                        normalizeMessage(
                            message
                        )
                        || "The scoreboard could not be processed.",
                    createdAt:
                        createdAt
                        || new Date()
                            .toISOString(),
                    sourceRoute:
                        sourceRoute
                        || getStoredActiveJobRoute()
                }
            }
        )
    );

    return true;
}

/* =========================================================
   FAILURE BUILDING
   ========================================================= */

function failActiveJob(
    jobId,
    job,
    {
        stage,
        errorCode,
        message
    }
) {
    const normalizedJobId =
        normalizeId(
            jobId
        );

    const sourceRoute =
        getStoredActiveJobRoute();

    stopOcrJobMonitor();
    clearStoredActiveJob();

    if (
        !validJobId(
            normalizedJobId
        )
        || isJobHandled(
            normalizedJobId
        )
    ) {
        return;
    }

    dispatchFailure({
        jobId:
            normalizedJobId,
        matchId:
            job?.matchId
            || null,
        stage:
            stage
            || job?.stage
            || "failed",
        errorCode:
            errorCode
            || job?.error?.code
            || "OCR_FAILED",
        message:
            message
            || job?.error?.userMessage
            || job?.message
            || job?.error?.message
            || "The scoreboard could not be processed.",
        createdAt:
            job?.completedAt
            || job?.updatedAt
            || null,
        sourceRoute
    });
}

/* =========================================================
   TERMINAL JOBS
   ========================================================= */

function handleCompletedJob(
    job
) {
    const sourceRoute =
        getStoredActiveJobRoute();

    stopOcrJobMonitor();
    clearStoredActiveJob();

    if (
        isJobHandled(
            job.jobId
        )
    ) {
        return;
    }

    if (
        !validMatchId(
            job.matchId
        )
    ) {
        dispatchFailure({
            jobId:
                job.jobId,
            stage:
                "completed_without_match",
            errorCode:
                "MATCH_ID_MISSING",
            message:
                "Scoreboard processing completed without a valid match ID.",
            createdAt:
                job?.completedAt
                || job?.updatedAt
                || null,
            sourceRoute
        });

        return;
    }

    document.dispatchEvent(
        new CustomEvent(
            "ocr:job-completed",
            {
                detail: {
                    jobId:
                        job.jobId,
                    matchId:
                        job.matchId,
                    reviewRequired:
                        job.reviewRequired,
                    confirmationStatus:
                        job.confirmationStatus
                        || (
                            job.reviewRequired
                                ? "pending_review"
                                : "auto_accepted"
                        ),
                    sourceRoute,
                    completedAt:
                        job?.completedAt
                        || job?.updatedAt
                        || new Date()
                            .toISOString()
                }
            }
        )
    );
}

function handleFailedJob(
    job
) {
    failActiveJob(
        job.jobId,
        job,
        {
            stage:
                job.stage
                || "failed",
            errorCode:
                job?.error?.code
                || "OCR_FAILED",
            message:
                job?.error?.userMessage
                || job.message
                || job?.error?.message
                || "The scoreboard could not be processed."
        }
    );
}

/* =========================================================
   POLL CONTROL
   ========================================================= */

export function stopOcrJobMonitor() {
    OCR_JOB_MONITOR_POLLING =
        false;

    OCR_JOB_MONITOR_ACTIVE_JOB_ID =
        "";

    OCR_JOB_MONITOR_CHECK_INDEX =
        0;

    OCR_JOB_MONITOR_STARTED_AT =
        0;

    OCR_JOB_MONITOR_STALE_CHECKS =
        0;

    OCR_JOB_MONITOR_LAST_SIGNATURE =
        "";

    if (
        OCR_JOB_MONITOR_TIMER
    ) {
        clearTimeout(
            OCR_JOB_MONITOR_TIMER
        );

        OCR_JOB_MONITOR_TIMER =
            null;
    }
}

function scheduleNextCheck(
    jobId
) {
    const normalizedJobId =
        normalizeId(
            jobId
        );

    if (
        !OCR_JOB_MONITOR_POLLING
        || !validJobId(
            normalizedJobId
        )
        || OCR_JOB_MONITOR_ACTIVE_JOB_ID !==
            normalizedJobId
    ) {
        return;
    }

    if (
        isJobHandled(
            normalizedJobId
        )
    ) {
        stopOcrJobMonitor();
        clearStoredActiveJob();

        return;
    }

    if (
        OCR_JOB_MONITOR_TIMER
    ) {
        clearTimeout(
            OCR_JOB_MONITOR_TIMER
        );
    }

    const initialSchedule =
        OCR_JOB_MONITOR_CHECK_INDEX <
        OCR_INITIAL_CHECK_SCHEDULE_MS
            .length;

    const elapsed =
        Math.max(
            0,
            Date.now()
            - OCR_JOB_MONITOR_STARTED_AT
        );

    const delay =
        initialSchedule
            ? Math.max(
                0,
                OCR_INITIAL_CHECK_SCHEDULE_MS[
                    OCR_JOB_MONITOR_CHECK_INDEX
                ]
                - elapsed
            )
            : OCR_TAIL_POLL_MS;

    OCR_JOB_MONITOR_TIMER =
        setTimeout(
            function() {
                OCR_JOB_MONITOR_TIMER =
                    null;

                OCR_JOB_MONITOR_CHECK_INDEX +=
                    1;

                void checkActiveJob();
            },
            delay
        );
}

/* =========================================================
   ACTIVE JOB CHECK
   ========================================================= */

async function checkActiveJob() {
    if (
        OCR_JOB_MONITOR_CHECK_RUNNING
    ) {
        return;
    }

    const jobId =
        getStoredActiveJobId();

    if (
        !jobId
    ) {
        stopOcrJobMonitor();

        return;
    }

    if (
        OCR_JOB_MONITOR_ACTIVE_JOB_ID !==
        jobId
    ) {
        stopOcrJobMonitor();

        return;
    }

    if (
        isJobHandled(
            jobId
        )
    ) {
        stopOcrJobMonitor();
        clearStoredActiveJob();

        return;
    }

    OCR_JOB_MONITOR_CHECK_RUNNING =
        true;

    try {
        const job =
            await getOcrJob(
                jobId
            );

        if (
            isJobHandled(
                jobId
            )
        ) {
            stopOcrJobMonitor();
            clearStoredActiveJob();

            return;
        }

        dispatchProgress(
            job
        );

        if (
            job.status ===
            "completed"
        ) {
            handleCompletedJob(
                job
            );

            return;
        }

        if (
            job.status ===
            "failed"
        ) {
            handleFailedJob(
                job
            );

            return;
        }

        if (
            isPastClientLifetime(
                job
            )
        ) {
            failActiveJob(
                jobId,
                job,
                {
                    stage:
                        "client_job_timeout",
                    errorCode:
                        "CLIENT_JOB_TIMEOUT",
                    message:
                        "Scoreboard processing exceeded the allowed processing window. Please submit the image again."
                }
            );

            return;
        }

        if (
            job.status ===
            "queued"
            && isQueueStale(
                job
            )
        ) {
            failActiveJob(
                jobId,
                job,
                {
                    stage:
                        "queue_stalled",
                    errorCode:
                        "QUEUE_STALLED",
                    message:
                        "The scoreboard remained queued for more than two minutes. Please submit the image again."
                }
            );

            return;
        }

        recordProgressState(
            job
        );

        if (
            job.status !==
                "queued"
            && isProcessingStale(
                job
            )
        ) {
            failActiveJob(
                jobId,
                job,
                {
                    stage:
                        "processing_stalled",
                    errorCode:
                        "PROCESSING_STALLED",
                    message:
                        "The scoreboard reader stopped reporting progress. Please submit the image again."
                }
            );

            return;
        }

        scheduleNextCheck(
            jobId
        );
    }
    catch (
        error
    ) {
        const status =
            Number(
                error?.status
            );

        console.warn(
            "[OCR JOB MONITOR] Status check failed.",
            {
                jobId,
                status:
                    status
                    || null,
                code:
                    error?.code
                    || null,
                message:
                    error?.message
                    || null
            }
        );

        if (
            isJobHandled(
                jobId
            )
        ) {
            stopOcrJobMonitor();
            clearStoredActiveJob();

            return;
        }

        if (
            status === 404
        ) {
            failActiveJob(
                jobId,
                null,
                {
                    stage:
                        "job_unavailable",
                    errorCode:
                        "JOB_NOT_FOUND",
                    message:
                        "The previous scoreboard job could not be found. You can submit another image."
                }
            );

            return;
        }

        if (
            status === 409
        ) {
            failActiveJob(
                jobId,
                null,
                {
                    stage:
                        "job_invalid",
                    errorCode:
                        error?.code
                        || "JOB_INVALID",
                    message:
                        "The previous scoreboard job is no longer valid. You can submit another image."
                }
            );

            return;
        }

        if (
            status === 401
        ) {
            stopOcrJobMonitor();

            document.dispatchEvent(
                new CustomEvent(
                    "ocr:job-monitor-paused",
                    {
                        detail: {
                            jobId,
                            reason:
                                "AUTHENTICATION_REQUIRED",
                            message:
                                "OCR status checking paused because your session is no longer authenticated."
                        }
                    }
                )
            );

            return;
        }

        if (
            status === 403
        ) {
            stopOcrJobMonitor();

            document.dispatchEvent(
                new CustomEvent(
                    "ocr:job-monitor-paused",
                    {
                        detail: {
                            jobId,
                            reason:
                                "JOB_ACCESS_DENIED",
                            message:
                                "OCR status checking paused because this job can no longer be accessed."
                        }
                    }
                )
            );

            return;
        }

        if (
            typeof navigator !==
                "undefined"
            && navigator.onLine ===
                false
        ) {
            stopOcrJobMonitor();

            document.dispatchEvent(
                new CustomEvent(
                    "ocr:job-monitor-paused",
                    {
                        detail: {
                            jobId,
                            reason:
                                "OFFLINE",
                            message:
                                "OCR status checking paused while the browser is offline."
                        }
                    }
                )
            );

            return;
        }

        scheduleNextCheck(
            jobId
        );
    }
    finally {
        OCR_JOB_MONITOR_CHECK_RUNNING =
            false;
    }
}

/* =========================================================
   START / RESUME
   ========================================================= */

export function checkActiveOcrSubmission() {
    const jobId =
        getStoredActiveJobId();

    if (
        !jobId
    ) {
        stopOcrJobMonitor();

        return false;
    }

    if (
        isJobHandled(
            jobId
        )
    ) {
        stopOcrJobMonitor();
        clearStoredActiveJob();

        return false;
    }

    if (
        OCR_JOB_MONITOR_CHECK_RUNNING
    ) {
        return true;
    }

    if (
        OCR_JOB_MONITOR_POLLING
        && OCR_JOB_MONITOR_ACTIVE_JOB_ID ===
            jobId
    ) {
        return true;
    }

    stopOcrJobMonitor();

    OCR_JOB_MONITOR_ACTIVE_JOB_ID =
        jobId;

    OCR_JOB_MONITOR_POLLING =
        true;

    OCR_JOB_MONITOR_CHECK_INDEX =
        0;

    OCR_JOB_MONITOR_STARTED_AT =
        Date.now();

    OCR_JOB_MONITOR_STALE_CHECKS =
        0;

    OCR_JOB_MONITOR_LAST_SIGNATURE =
        "";

    scheduleNextCheck(
        jobId
    );

    return true;
}

/* =========================================================
   PAGE / STORAGE EVENTS
   ========================================================= */

function handleVisibilityChange() {
    if (
        document.visibilityState ===
        "visible"
    ) {
        checkActiveOcrSubmission();
    }
}

function handleWindowFocus() {
    checkActiveOcrSubmission();
}

function handleOnline() {
    checkActiveOcrSubmission();
}

function handleStorageChange(
    event
) {
    if (
        event.key ===
            OCR_ACTIVE_JOB_KEY
        || event.key ===
            OCR_HANDLED_JOB_KEY
    ) {
        checkActiveOcrSubmission();
    }
}

/* =========================================================
   DEBUG
   ========================================================= */

function getDebugState() {
    return {
        version:
            OCR_JOB_MONITOR_VERSION,
        activeJobId:
            getStoredActiveJobId()
            || null,
        activeJobRoute:
            getStoredActiveJobRoute()
            || null,
        polling:
            OCR_JOB_MONITOR_POLLING,
        pollingJobId:
            OCR_JOB_MONITOR_ACTIVE_JOB_ID
            || null,
        checkRunning:
            OCR_JOB_MONITOR_CHECK_RUNNING,
        checkIndex:
            OCR_JOB_MONITOR_CHECK_INDEX,
        staleChecks:
            OCR_JOB_MONITOR_STALE_CHECKS
    };
}

function installDebugHelper() {
    try {
        Object.defineProperty(
            window,
            "bpdOcrJobMonitorDebug",
            {
                configurable:
                    true,
                enumerable:
                    false,
                value:
                    function() {
                        const state =
                            getDebugState();

                        console.log(
                            "[OCR JOB MONITOR] Debug state:",
                            state
                        );

                        return state;
                    }
            }
        );
    }
    catch (
        error
    ) {
        console.warn(
            "[OCR JOB MONITOR] Debug helper unavailable.",
            error
        );
    }
}

/* =========================================================
   INITIALIZE
   ========================================================= */

export function initializeOcrJobMonitor() {
    if (
        OCR_JOB_MONITOR_READY
    ) {
        checkActiveOcrSubmission();

        return true;
    }

    document.addEventListener(
        "visibilitychange",
        handleVisibilityChange
    );

    window.addEventListener(
        "focus",
        handleWindowFocus
    );

    window.addEventListener(
        "online",
        handleOnline
    );

    window.addEventListener(
        "storage",
        handleStorageChange
    );

    OCR_JOB_MONITOR_READY =
        true;

    installDebugHelper();
    checkActiveOcrSubmission();

    console.log(
        `[OCR JOB MONITOR] ${OCR_JOB_MONITOR_VERSION} ready.`
    );

    return true;
}