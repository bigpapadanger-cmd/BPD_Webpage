"use strict";

/* =========================================================
   BPD GAMING NETWORK
   GLOBAL OCR NOTIFICATIONS
   ========================================================= */

import {
    OCR_JOB_STATUS_URL
} from "/scripts/apiRoutes.js";

import {
    apiFetch
} from "/scripts/apiConnection.js";

const OCR_NOTIFICATION_VERSION =
    "ocr-notifications-1.4";

const OCR_ACTIVE_JOB_KEY =
    "rocketLeagueOcrActiveJobV1";

const OCR_ACTIVE_JOB_ROUTE_KEY =
    "rocketLeagueOcrActiveJobRouteV1";

const OCR_PENDING_REVIEW_KEY =
    "rocketLeagueOcrPendingReviewsV1";

const OCR_PENDING_FAILURE_KEY =
    "rocketLeagueOcrPendingFailuresV1";

const OCR_ACCEPTED_RESULT_KEY =
    "rocketLeagueOcrAcceptedResultsV1";

const OCR_NOTIFICATION_CONTAINER_ID =
    "ocrNotificationContainer";

const OCR_NOTIFICATION_DURATION_MS =
    15
    * 1000;

const OCR_NOTIFICATION_CHECK_SCHEDULE_MS = [
    2000,
    5000,
    9000,
    13000,
    17000,
    21000,
    25000,
    30000
];

const OCR_NOTIFICATION_QUEUE_STALE_MS =
    2
    * 60
    * 1000;

const OCR_NOTIFICATION_PROCESSING_STALE_MS =
    120
    * 1000;

const OCR_NOTIFICATION_MAX_STALE_CHECKS =
    3;

const OCR_NOTIFICATION_TAIL_POLL_MS =
    10
    * 1000;

const OCR_NOTIFICATION_MAX_ACTIVE_JOB_MS =
    10
    * 60
    * 1000;

let OCR_NOTIFICATIONS_READY =
    false;

let OCR_NOTIFICATION_POLLING =
    false;

let OCR_NOTIFICATION_POLL_TIMER =
    null;

let OCR_NOTIFICATION_ACTIVE_JOB_ID =
    "";

let OCR_NOTIFICATION_CHECK_RUNNING =
    false;

let OCR_NOTIFICATION_CHECK_INDEX =
    0;

let OCR_NOTIFICATION_BURST_STARTED_AT =
    0;

let OCR_NOTIFICATION_STALE_CHECKS =
    0;

let OCR_NOTIFICATION_LAST_PROGRESS_SIGNATURE =
    "";

const OCR_NOTIFICATION_TIMERS =
    new Map();

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

function normalizeClientProgress(
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

    return [
        "pending_review",
        "auto_accepted",
        "confirmed",
        "confirmed_with_disputes"
    ].includes(
        status
    )
        ? status
        : "";
}

/* =========================================================
   GENERIC LOCAL STORAGE
   ========================================================= */

function readStoredArray(
    key
) {
    try {
        const parsed =
            JSON.parse(
                localStorage.getItem(
                    key
                )
                || "[]"
            );

        return Array.isArray(
            parsed
        )
            ? parsed
            : [];
    }
    catch (
        error
    ) {
        console.error(
            `[OCR NOTIFICATIONS] Could not read ${key}.`,
            error
        );

        return [];
    }
}

function writeStoredArray(
    key,
    values
) {
    try {
        localStorage.setItem(
            key,
            JSON.stringify(
                Array.isArray(
                    values
                )
                    ? values
                    : []
            )
        );
    }
    catch (
        error
    ) {
        console.error(
            `[OCR NOTIFICATIONS] Could not save ${key}.`,
            error
        );
    }
}

/* =========================================================
   ACTIVE JOB STORAGE
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
            "[OCR NOTIFICATIONS] Could not read active job.",
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
    catch (
        error
    ) {
        console.error(
            "[OCR NOTIFICATIONS] Could not read active job route.",
            error
        );

        return "";
    }
}

function clearStoredActiveJob() {
    OCR_NOTIFICATION_ACTIVE_JOB_ID =
        "";

    try {
        localStorage.removeItem(
            OCR_ACTIVE_JOB_KEY
        );

        localStorage.removeItem(
            OCR_ACTIVE_JOB_ROUTE_KEY
        );
    }
    catch (
        error
    ) {
        console.error(
            "[OCR NOTIFICATIONS] Could not clear active job.",
            error
        );
    }
}

/* =========================================================
   PENDING REVIEWS
   ========================================================= */

export function readPendingReviews() {
    return readStoredArray(
        OCR_PENDING_REVIEW_KEY
    );
}

function writePendingReviews(
    reviews
) {
    writeStoredArray(
        OCR_PENDING_REVIEW_KEY,
        reviews
    );
}

function getPendingReview(
    matchId
) {
    const normalizedMatchId =
        normalizeId(
            matchId
        );

    return readPendingReviews()
        .find(
            function(
                pending
            ) {
                return (
                    normalizeId(
                        pending?.matchId
                    )
                    === normalizedMatchId
                );
            }
        )
        || null;
}

function addPendingReview(
    detail
) {
    const jobId =
        normalizeId(
            detail?.jobId
        );

    const matchId =
        normalizeId(
            detail?.matchId
        );

    if (
        !validJobId(
            jobId
        )
        || !validMatchId(
            matchId
        )
    ) {
        return null;
    }

    const pending = {
        jobId,
        matchId,

        confirmationStatus:
            "pending_review",

        reviewRequired:
            true,

        createdAt:
            String(
                detail?.createdAt
                || new Date()
                    .toISOString()
            ),

        sourceRoute:
            String(
                detail?.sourceRoute
                || getStoredActiveJobRoute()
                || ""
            )
    };

    const reviews =
        readPendingReviews();

    const existingIndex =
        reviews.findIndex(
            function(
                item
            ) {
                return (
                    normalizeId(
                        item?.matchId
                    )
                    === matchId
                );
            }
        );

    if (
        existingIndex >= 0
    ) {
        reviews[
            existingIndex
        ] = {
            ...reviews[
                existingIndex
            ],
            ...pending
        };
    }
    else {
        reviews.push(
            pending
        );
    }

    writePendingReviews(
        reviews
    );

    return pending;
}

export function removePendingReview(
    matchId
) {
    const normalizedMatchId =
        normalizeId(
            matchId
        );

    const reviews =
        readPendingReviews()
            .filter(
                function(
                    item
                ) {
                    return (
                        normalizeId(
                            item?.matchId
                        )
                        !== normalizedMatchId
                    );
                }
            );

    writePendingReviews(
        reviews
    );

    clearNotificationTimer(
        normalizedMatchId
    );

    removeNotificationElement(
        normalizedMatchId
    );
}

/* =========================================================
   PENDING FAILURES
   ========================================================= */

export function readPendingFailures() {
    return readStoredArray(
        OCR_PENDING_FAILURE_KEY
    );
}

function writePendingFailures(
    failures
) {
    writeStoredArray(
        OCR_PENDING_FAILURE_KEY,
        failures
    );
}

function addPendingFailure(
    detail
) {
    const jobId =
        normalizeId(
            detail?.jobId
        );

    if (
        !validJobId(
            jobId
        )
    ) {
        return null;
    }

    const job =
        detail?.job
        && typeof detail.job ===
            "object"
            ? detail.job
            : {};

    const failure = {
        jobId,

        status:
            "failed",

        stage:
            String(
                job?.stage
                || "failed"
            )
                .trim()
                .toLowerCase(),

        message:
            String(
                job?.error?.userMessage
                || job?.message
                || job?.error?.message
                || detail?.message
                || "The scoreboard could not be processed."
            )
                .trim(),

        errorCode:
            String(
                job?.error?.code
                || detail?.reason
                || "OCR_FAILED"
            )
                .trim()
                .toUpperCase(),

        createdAt:
            String(
                job?.completedAt
                || job?.updatedAt
                || new Date()
                    .toISOString()
            ),

        sourceRoute:
            String(
                detail?.sourceRoute
                || detail?.reviewRoute
                || getStoredActiveJobRoute()
                || ""
            )
    };

    const failures =
        readPendingFailures();

    const existingIndex =
        failures.findIndex(
            function(
                item
            ) {
                return (
                    normalizeId(
                        item?.jobId
                    )
                    === jobId
                );
            }
        );

    if (
        existingIndex >= 0
    ) {
        failures[
            existingIndex
        ] = {
            ...failures[
                existingIndex
            ],
            ...failure
        };
    }
    else {
        failures.push(
            failure
        );
    }

    writePendingFailures(
        failures
    );

    return failure;
}

export function acknowledgeOcrFailure(
    jobId
) {
    const normalizedJobId =
        normalizeId(
            jobId
        );

    const failures =
        readPendingFailures()
            .filter(
                function(
                    item
                ) {
                    return (
                        normalizeId(
                            item?.jobId
                        )
                        !== normalizedJobId
                    );
                }
            );

    writePendingFailures(
        failures
    );

    clearNotificationTimer(
        normalizedJobId
    );

    removeNotificationElement(
        normalizedJobId
    );
}

/* =========================================================
   ACCEPTED RESULTS
   ========================================================= */

export function readAcceptedResults() {
    return readStoredArray(
        OCR_ACCEPTED_RESULT_KEY
    );
}

function writeAcceptedResults(
    results
) {
    writeStoredArray(
        OCR_ACCEPTED_RESULT_KEY,
        results
    );
}

function addAcceptedResult(
    detail
) {
    const jobId =
        normalizeId(
            detail?.jobId
        );

    const matchId =
        normalizeId(
            detail?.matchId
        );

    if (
        !validJobId(
            jobId
        )
        || !validMatchId(
            matchId
        )
    ) {
        return null;
    }

    const accepted = {
        jobId,
        matchId,

        confirmationStatus:
            normalizeConfirmationStatus(
                detail?.confirmationStatus
            )
            || "auto_accepted",

        createdAt:
            String(
                detail?.createdAt
                || new Date()
                    .toISOString()
            )
    };

    const results =
        readAcceptedResults();

    const existingIndex =
        results.findIndex(
            function(
                item
            ) {
                return (
                    normalizeId(
                        item?.matchId
                    )
                    === matchId
                );
            }
        );

    if (
        existingIndex >= 0
    ) {
        results[
            existingIndex
        ] = {
            ...results[
                existingIndex
            ],
            ...accepted
        };
    }
    else {
        results.push(
            accepted
        );
    }

    writeAcceptedResults(
        results
    );

    return accepted;
}

/* =========================================================
   NOTIFICATION CONTAINER
   ========================================================= */

function ensureNotificationContainer() {
    let container =
        document.getElementById(
            OCR_NOTIFICATION_CONTAINER_ID
        );

    if (
        container
    ) {
        return container;
    }

    container =
        document.createElement(
            "div"
        );

    container.id =
        OCR_NOTIFICATION_CONTAINER_ID;

    container.className =
        "ocr-notification-container";

    document.body.appendChild(
        container
    );

    return container;
}

/* =========================================================
   NOTIFICATION HELPERS
   ========================================================= */

function getNotificationId(
    id
) {
    return (
        "ocr-notification-"
        + normalizeId(
            id
        )
    );
}

function removeNotificationElement(
    id
) {
    document.getElementById(
        getNotificationId(
            id
        )
    )?.remove();
}

function clearNotificationTimer(
    id
) {
    const key =
        normalizeId(
            id
        );

    const timer =
        OCR_NOTIFICATION_TIMERS.get(
            key
        );

    if (
        !timer
    ) {
        return;
    }

    clearTimeout(
        timer
    );

    OCR_NOTIFICATION_TIMERS.delete(
        key
    );
}

/* =========================================================
   NOTIFICATION UI
   ========================================================= */

function createNotification(
    {
        id,
        type,
        title,
        description,
        onClick
    }
) {
    const normalizedId =
        normalizeId(
            id
        );

    if (
        !normalizedId
    ) {
        return null;
    }

    const notificationId =
        getNotificationId(
            normalizedId
        );

    removeNotificationElement(
        normalizedId
    );

    clearNotificationTimer(
        normalizedId
    );

    const container =
        ensureNotificationContainer();

    const notification =
        document.createElement(
            "button"
        );

    notification.type =
        "button";

    notification.id =
        notificationId;

    notification.className =
        "ocr-notification";

    if (
        type === "success"
    ) {
        notification.classList.add(
            "ocr-notification-success"
        );
    }
    else if (
        type === "review"
    ) {
        notification.classList.add(
            "ocr-notification-review"
        );
    }
    else {
        notification.classList.add(
            "ocr-notification-failure"
        );
    }

    const dot =
        document.createElement(
            "span"
        );

    dot.className =
        "ocr-notification-dot";

    const content =
        document.createElement(
            "div"
        );

    content.className =
        "ocr-notification-content";

    const titleElement =
        document.createElement(
            "div"
        );

    titleElement.className =
        "ocr-notification-title";

    titleElement.textContent =
        String(
            title
            || ""
        );

    const descriptionElement =
        document.createElement(
            "div"
        );

    descriptionElement.className =
        "ocr-notification-description";

    descriptionElement.textContent =
        String(
            description
            || ""
        );

    content.append(
        titleElement,
        descriptionElement
    );

    notification.append(
        dot,
        content
    );

    notification.addEventListener(
        "click",
        async function() {
            clearNotificationTimer(
                normalizedId
            );

            removeNotificationElement(
                normalizedId
            );

            if (
                typeof onClick !==
                    "function"
            ) {
                return;
            }

            try {
                await onClick();
            }
            catch (
                error
            ) {
                console.error(
                    "[OCR NOTIFICATIONS] Notification action failed.",
                    error
                );
            }
        }
    );

    container.appendChild(
        notification
    );

    const timer =
        setTimeout(
            function() {
                OCR_NOTIFICATION_TIMERS.delete(
                    normalizedId
                );

                removeNotificationElement(
                    normalizedId
                );
            },
            OCR_NOTIFICATION_DURATION_MS
        );

    OCR_NOTIFICATION_TIMERS.set(
        normalizedId,
        timer
    );

    return notification;
}

/* =========================================================
   JSON
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
        throw new Error(
            "Server returned invalid JSON."
        );
    }
}

/* =========================================================
   GET JOB STATUS
   ========================================================= */

async function getOcrJob(
    jobId
) {
    const response =
        await apiFetch(
            (
                OCR_JOB_STATUS_URL
                + "?jobId="
                + encodeURIComponent(
                    jobId
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
                || "Unable to read OCR job."
            );

        error.status =
            response.status;

        throw error;
    }

    const storedJob =
        (
            data?.job
            && typeof data.job ===
                "object"
            && !Array.isArray(
                data.job
            )
        )
            ? data.job
            : {};

    const status =
        String(
            storedJob?.status
            || ""
        )
            .trim()
            .toLowerCase();

    if (
        !status
    ) {
        const error =
            new Error(
                "OCR job status was not returned."
            );

        error.status =
            response.status;

        throw error;
    }

    return {
        ...storedJob,

        status,

        stage:
            String(
                storedJob?.stage
                || ""
            )
                .trim()
                .toLowerCase(),

        progress:
            normalizeClientProgress(
                storedJob?.progress
            ),

        confirmedProgress:
            normalizeClientProgress(
                storedJob?.confirmedProgress
                ?? storedJob?.progress
            ),

        simulatedProgress:
            normalizeClientProgress(
                storedJob?.simulatedProgress
                ?? 0
            ),

        progressSource:
            String(
                storedJob?.progressSource
                || "stored"
            )
                .trim()
                .toLowerCase(),

        message:
            String(
                storedJob?.message
                || ""
            )
                .trim(),

        reviewRequired:
            storedJob?.reviewRequired ===
                true,

        confirmationStatus:
            normalizeConfirmationStatus(
                storedJob?.confirmationStatus
            ),

        matchId:
            normalizeId(
                storedJob?.matchId
            )
            || null
    };
}

/* =========================================================
   OPEN GLOBAL RESULT / REVIEW
   ========================================================= */

function openOcrResult(
    detail
) {
    document.dispatchEvent(
        new CustomEvent(
            "ocr:result-open",
            {
                detail
            }
        )
    );
}

function openPendingReview(
    pending
) {
    document.dispatchEvent(
        new CustomEvent(
            "ocr:pending-review-open",
            {
                detail:
                    pending
            }
        )
    );
}

function openPendingFailure(
    failure
) {
    document.dispatchEvent(
        new CustomEvent(
            "ocr:failure-open",
            {
                detail:
                    failure
            }
        )
    );
}

/* =========================================================
   REVIEW NOTIFICATION
   ========================================================= */

function showReviewNotification(
    pending
) {
    createNotification({
        id:
            pending.matchId,

        type:
            "review",

        title:
            "Scoreboard Needs Review",

        description:
            "OCR completed. Tap to review the detected values.",

        onClick:
            async function() {
                openPendingReview(
                    pending
                );
            }
    });
}

/* =========================================================
   FAILURE NOTIFICATION
   ========================================================= */

function showFailureNotification(
    failure
) {
    createNotification({
        id:
            failure.jobId,

        type:
            "failure",

        title:
            "Scoreboard Processing Failed",

        description:
            "Tap to view failure details.",

        onClick:
            async function() {
                openPendingFailure(
                    failure
                );
            }
    });
}

/* =========================================================
   ACCEPTED NOTIFICATION
   ========================================================= */

function showAcceptedNotification(
    accepted
) {
    createNotification({
        id:
            accepted.matchId,

        type:
            "success",

        title:
            "Scoreboard Accepted",

        description:
            "OCR completed successfully. Tap to view the result.",

        onClick:
            async function() {
                openOcrResult(
                    accepted
                );
            }
    });
}

/* =========================================================
   CONFIRMED NOTIFICATION
   ========================================================= */

function showConfirmedNotification(
    detail
) {
    const matchId =
        normalizeId(
            detail?.matchId
        );

    if (
        !validMatchId(
            matchId
        )
    ) {
        return;
    }

    createNotification({
        id:
            "CONFIRMED"
            + matchId,

        type:
            "success",

        title:
            "Scoreboard Confirmed",

        description:
            "Review submitted. Tap to view the confirmed scoreboard.",

        onClick:
            async function() {
                openOcrResult({
                    ...detail,
                    matchId,
                    confirmationStatus:
                        normalizeConfirmationStatus(
                            detail?.confirmationStatus
                        )
                        || "confirmed"
                });
            }
    });
}

/* =========================================================
   POLLING STATE
   ========================================================= */

function stopOcrNotificationPolling() {
    OCR_NOTIFICATION_POLLING =
        false;

    OCR_NOTIFICATION_ACTIVE_JOB_ID =
        "";

    OCR_NOTIFICATION_CHECK_INDEX =
        0;

    OCR_NOTIFICATION_BURST_STARTED_AT =
        0;

    OCR_NOTIFICATION_STALE_CHECKS =
        0;

    OCR_NOTIFICATION_LAST_PROGRESS_SIGNATURE =
        "";

    if (
        OCR_NOTIFICATION_POLL_TIMER
    ) {
        clearTimeout(
            OCR_NOTIFICATION_POLL_TIMER
        );

        OCR_NOTIFICATION_POLL_TIMER =
            null;
    }
}

/* =========================================================
   PROGRESS / STALE DETECTION
   ========================================================= */

function getOcrProgressSignature(
    job
) {
    return [
        String(
            job?.status
            || ""
        )
            .trim()
            .toLowerCase(),

        String(
            job?.stage
            || ""
        )
            .trim()
            .toLowerCase(),

        String(
            normalizeClientProgress(
                job?.progress
            )
        ),

        String(
            job?.confirmedProgress
            ?? ""
        ),

        String(
            job?.simulatedProgress
            ?? ""
        ),

        String(
            job?.progressSource
            || ""
        )
            .trim()
            .toLowerCase(),

        String(
            job?.updatedAt
            || ""
        ),

        String(
            job?.heartbeatAt
            || ""
        )
    ]
        .join(
            "|"
        );
}

function hasOcrJobProgressed(
    job
) {
    const signature =
        getOcrProgressSignature(
            job
        );

    if (
        !OCR_NOTIFICATION_LAST_PROGRESS_SIGNATURE
    ) {
        OCR_NOTIFICATION_LAST_PROGRESS_SIGNATURE =
            signature;

        OCR_NOTIFICATION_STALE_CHECKS =
            0;

        return true;
    }

    if (
        signature !==
        OCR_NOTIFICATION_LAST_PROGRESS_SIGNATURE
    ) {
        OCR_NOTIFICATION_LAST_PROGRESS_SIGNATURE =
            signature;

        OCR_NOTIFICATION_STALE_CHECKS =
            0;

        return true;
    }

    OCR_NOTIFICATION_STALE_CHECKS +=
        1;

    return false;
}

function getOcrJobActivityTimestamp(
    job
) {
    const candidates = [
        job?.heartbeatAt,
        job?.updatedAt,
        job?.startedAt,
        job?.createdAt
    ];

    for (
        const candidate
        of candidates
    ) {
        const parsed =
            Date.parse(
                String(
                    candidate
                    || ""
                )
            );

        if (
            Number.isFinite(
                parsed
            )
        ) {
            return parsed;
        }
    }

    return null;
}

function getOcrJobCreatedTimestamp(
    job
) {
    const createdAt =
        Date.parse(
            String(
                job?.createdAt
                || ""
            )
        );

    return Number.isFinite(
        createdAt
    )
        ? createdAt
        : null;
}

function isOcrQueueStale(
    job
) {
    const createdAt =
        getOcrJobCreatedTimestamp(
            job
        );

    if (
        !Number.isFinite(
            createdAt
        )
    ) {
        return false;
    }

    return (
        Date.now()
        - createdAt
        >= OCR_NOTIFICATION_QUEUE_STALE_MS
    );
}

function isOcrProcessingStale(
    job
) {
    if (
        OCR_NOTIFICATION_STALE_CHECKS <
        OCR_NOTIFICATION_MAX_STALE_CHECKS
    ) {
        return false;
    }

    const activityAt =
        getOcrJobActivityTimestamp(
            job
        );

    if (
        !Number.isFinite(
            activityAt
        )
    ) {
        return false;
    }

    return (
        Date.now()
        - activityAt
        >= OCR_NOTIFICATION_PROCESSING_STALE_MS
    );
}

function isOcrJobPastClientLifetime(
    job
) {
    const createdAt =
        getOcrJobCreatedTimestamp(
            job
        );

    if (
        !Number.isFinite(
            createdAt
        )
    ) {
        return false;
    }

    return (
        Date.now()
        - createdAt
        >= OCR_NOTIFICATION_MAX_ACTIVE_JOB_MS
    );
}

/* =========================================================
   FAILURE HANDLING
   ========================================================= */

function finalizeFailure(
    jobId,
    job,
    extra = {}
) {
    const sourceRoute =
        getStoredActiveJobRoute();

    stopOcrNotificationPolling();
    clearStoredActiveJob();

    const failure =
        addPendingFailure({
            jobId,
            job,
            sourceRoute,
            ...extra
        });

    if (
        failure
    ) {
        showFailureNotification(
            failure
        );
    }

    document.dispatchEvent(
        new CustomEvent(
            "ocr:job-failed",
            {
                detail: {
                    jobId,
                    job,
                    failure,
                    ...extra
                }
            }
        )
    );
}

/* =========================================================
   ABANDON JOB
   ========================================================= */

function abandonActiveOcrJob(
    jobId,
    job,
    {
        stage,
        message,
        reason
    }
) {
    const abandonedJob = {
        ...(
            job
            && typeof job ===
                "object"
                ? job
                : {}
        ),

        jobId,

        status:
            "failed",

        stage:
            String(
                stage
                || "client_polling_stopped"
            ),

        message:
            String(
                message
                || "OCR processing stopped responding."
            ),

        error: {
            code:
                String(
                    reason
                    || "CLIENT_POLLING_STOPPED"
                ),

            userMessage:
                String(
                    message
                    || "OCR processing stopped responding."
                ),

            message:
                String(
                    message
                    || "OCR processing stopped responding."
                )
        }
    };

    console.warn(
        "[OCR NOTIFICATIONS] Releasing stalled OCR job.",
        {
            version:
                OCR_NOTIFICATION_VERSION,

            jobId,

            reason:
                abandonedJob
                    .error
                    .code,

            status:
                job?.status
                || null,

            stage:
                job?.stage
                || null,

            progress:
                job?.progress
                ?? null
        }
    );

    finalizeFailure(
        jobId,
        abandonedJob,
        {
            abandoned:
                true,

            reason:
                abandonedJob
                    .error
                    .code
        }
    );
}

/* =========================================================
   POLL SCHEDULING
   ========================================================= */

function scheduleActiveOcrCheck(
    jobId
) {
    if (
        !OCR_NOTIFICATION_POLLING
        || OCR_NOTIFICATION_ACTIVE_JOB_ID !==
            jobId
    ) {
        return;
    }

    if (
        OCR_NOTIFICATION_POLL_TIMER
    ) {
        clearTimeout(
            OCR_NOTIFICATION_POLL_TIMER
        );

        OCR_NOTIFICATION_POLL_TIMER =
            null;
    }

    const usingInitialSchedule =
        OCR_NOTIFICATION_CHECK_INDEX <
        OCR_NOTIFICATION_CHECK_SCHEDULE_MS
            .length;

    const elapsed =
        Math.max(
            0,
            Date.now()
            - OCR_NOTIFICATION_BURST_STARTED_AT
        );

    const delay =
        usingInitialSchedule
            ? Math.max(
                0,
                OCR_NOTIFICATION_CHECK_SCHEDULE_MS[
                    OCR_NOTIFICATION_CHECK_INDEX
                ]
                - elapsed
            )
            : OCR_NOTIFICATION_TAIL_POLL_MS;

    OCR_NOTIFICATION_POLL_TIMER =
        setTimeout(
            function() {
                OCR_NOTIFICATION_POLL_TIMER =
                    null;

                OCR_NOTIFICATION_CHECK_INDEX +=
                    1;

                void runActiveOcrCheck();
            },
            delay
        );
}

function startOcrNotificationCheckBurst() {
    const jobId =
        getStoredActiveJobId();

    if (
        !jobId
    ) {
        stopOcrNotificationPolling();

        return;
    }

    if (
        OCR_NOTIFICATION_CHECK_RUNNING
    ) {
        return;
    }

    if (
        OCR_NOTIFICATION_POLLING
        && OCR_NOTIFICATION_ACTIVE_JOB_ID ===
            jobId
    ) {
        return;
    }

    if (
        OCR_NOTIFICATION_POLL_TIMER
    ) {
        clearTimeout(
            OCR_NOTIFICATION_POLL_TIMER
        );

        OCR_NOTIFICATION_POLL_TIMER =
            null;
    }

    OCR_NOTIFICATION_ACTIVE_JOB_ID =
        jobId;

    OCR_NOTIFICATION_POLLING =
        true;

    OCR_NOTIFICATION_CHECK_INDEX =
        0;

    OCR_NOTIFICATION_BURST_STARTED_AT =
        Date.now();

    OCR_NOTIFICATION_STALE_CHECKS =
        0;

    OCR_NOTIFICATION_LAST_PROGRESS_SIGNATURE =
        "";

    scheduleActiveOcrCheck(
        jobId
    );
}

/* =========================================================
   COMPLETED JOB
   ========================================================= */

function handleCompletedJob(
    jobId,
    job
) {
    const matchId =
        normalizeId(
            job?.matchId
        );

    if (
        !validMatchId(
            matchId
        )
    ) {
        abandonActiveOcrJob(
            jobId,
            job,
            {
                stage:
                    "completed_without_match",

                reason:
                    "MATCH_ID_MISSING",

                message:
                    "OCR completed without returning a match ID."
            }
        );

        return;
    }

    const sourceRoute =
        getStoredActiveJobRoute();

    const confirmationStatus =
        normalizeConfirmationStatus(
            job?.confirmationStatus
        );

    const reviewRequired =
        job?.reviewRequired ===
            true
        || confirmationStatus ===
            "pending_review";

    stopOcrNotificationPolling();
    clearStoredActiveJob();

    let pending =
        null;

    let accepted =
        null;

    if (
        reviewRequired
    ) {
        pending =
            addPendingReview({
                jobId,
                matchId,
                sourceRoute
            });

        if (
            pending
        ) {
            showReviewNotification(
                pending
            );
        }
    }
    else {
        accepted =
            addAcceptedResult({
                jobId,
                matchId,
                confirmationStatus:
                    confirmationStatus
                    || "auto_accepted"
            });

        if (
            accepted
        ) {
            showAcceptedNotification(
                accepted
            );
        }
    }

    document.dispatchEvent(
        new CustomEvent(
            "ocr:job-completed",
            {
                detail: {
                    jobId,
                    matchId,
                    job,
                    pending,
                    accepted,
                    confirmationStatus:
                        confirmationStatus
                        || (
                            reviewRequired
                                ? "pending_review"
                                : "auto_accepted"
                        )
                }
            }
        )
    );
}

/* =========================================================
   FAILED JOB
   ========================================================= */

function handleFailedJob(
    jobId,
    job
) {
    finalizeFailure(
        jobId,
        job
    );
}

/* =========================================================
   ACTIVE JOB CHECK
   ========================================================= */

async function runActiveOcrCheck() {
    if (
        OCR_NOTIFICATION_CHECK_RUNNING
    ) {
        return;
    }

    const jobId =
        getStoredActiveJobId();

    if (
        !jobId
        || OCR_NOTIFICATION_ACTIVE_JOB_ID !==
            jobId
    ) {
        stopOcrNotificationPolling();

        return;
    }

    OCR_NOTIFICATION_CHECK_RUNNING =
        true;

    try {
        const job =
            await getOcrJob(
                jobId
            );

        const status =
            String(
                job?.status
                || ""
            )
                .trim()
                .toLowerCase();

        if (
            status !== "completed"
            && status !== "failed"
            && isOcrJobPastClientLifetime(
                job
            )
        ) {
            abandonActiveOcrJob(
                jobId,
                job,
                {
                    stage:
                        "client_job_timeout",

                    reason:
                        "CLIENT_JOB_TIMEOUT",

                    message:
                        "The scoreboard job exceeded the allowed processing window. You can submit another image."
                }
            );

            return;
        }

        document.dispatchEvent(
            new CustomEvent(
                "ocr:job-progress",
                {
                    detail: {
                        jobId,

                        job,

                        status,

                        stage:
                            String(
                                job?.stage
                                || ""
                            )
                                .trim()
                                .toLowerCase(),

                        progress:
                            normalizeClientProgress(
                                job?.progress
                            ),

                        confirmedProgress:
                            normalizeClientProgress(
                                job?.confirmedProgress
                                ?? job?.progress
                            ),

                        simulatedProgress:
                            normalizeClientProgress(
                                job?.simulatedProgress
                                ?? 0
                            ),

                        progressSource:
                            String(
                                job?.progressSource
                                || "stored"
                            )
                                .trim()
                                .toLowerCase(),

                        message:
                            String(
                                job?.message
                                || ""
                            )
                                .trim(),

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
                            job?.reviewRequired ===
                                true,

                        confirmationStatus:
                            normalizeConfirmationStatus(
                                job?.confirmationStatus
                            ),

                        version:
                            OCR_NOTIFICATION_VERSION
                    }
                }
            )
        );

        if (
            status === "completed"
        ) {
            handleCompletedJob(
                jobId,
                job
            );

            return;
        }

        if (
            status === "failed"
        ) {
            handleFailedJob(
                jobId,
                job
            );

            return;
        }

        if (
            status === "queued"
            && isOcrQueueStale(
                job
            )
        ) {
            abandonActiveOcrJob(
                jobId,
                job,
                {
                    stage:
                        "queue_stalled",

                    reason:
                        "QUEUE_STALLED",

                    message:
                        "The scoreboard job remained queued for more than two minutes. Please try the upload again."
                }
            );

            return;
        }

        hasOcrJobProgressed(
            job
        );

        if (
            status !== "queued"
            && isOcrProcessingStale(
                job
            )
        ) {
            abandonActiveOcrJob(
                jobId,
                job,
                {
                    stage:
                        "processing_stalled",

                    reason:
                        "PROCESSING_STALLED",

                    message:
                        "The scoreboard reader stopped reporting progress. You can try the upload again."
                }
            );

            return;
        }

        scheduleActiveOcrCheck(
            jobId
        );
    }
    catch (
        error
    ) {
        console.warn(
            "[OCR NOTIFICATIONS] OCR status check failed.",
            error
        );

        const status =
            Number(
                error?.status
            );

        if (
            status === 404
            || status === 409
        ) {
            abandonActiveOcrJob(
                jobId,
                null,
                {
                    stage:
                        "job_unavailable",

                    reason:
                        status === 404
                            ? "JOB_NOT_FOUND"
                            : "JOB_INVALID",

                    message:
                        "The previous scoreboard job is no longer available. You can submit another image."
                }
            );

            return;
        }

        if (
            status === 401
            || status === 403
        ) {
            abandonActiveOcrJob(
                jobId,
                null,
                {
                    stage:
                        "job_access_lost",

                    reason:
                        status === 401
                            ? "AUTHENTICATION_REQUIRED"
                            : "JOB_ACCESS_DENIED",

                    message:
                        "The previous scoreboard job can no longer be accessed. You can submit another image."
                }
            );

            return;
        }

        if (
            !navigator.onLine
        ) {
            stopOcrNotificationPolling();

            return;
        }

        scheduleActiveOcrCheck(
            jobId
        );
    }
    finally {
        OCR_NOTIFICATION_CHECK_RUNNING =
            false;
    }
}

/* =========================================================
   PUBLIC ACTIVE CHECK
   ========================================================= */

export function checkActiveOcrSubmission() {
    startOcrNotificationCheckBurst();
}

/* =========================================================
   RESTORE PERSISTENT NOTIFICATIONS
   ========================================================= */

export function restorePendingNotifications() {
    readPendingReviews()
        .forEach(
            function(
                pending
            ) {
                showReviewNotification(
                    pending
                );
            }
        );

    readPendingFailures()
        .forEach(
            function(
                failure
            ) {
                showFailureNotification(
                    failure
                );
            }
        );
}

/* =========================================================
   CONFIRMATION
   ========================================================= */

function handleResultsConfirmed(
    event
) {
    const matchId =
        normalizeId(
            event?.detail?.matchId
        );

    if (
        !validMatchId(
            matchId
        )
    ) {
        return;
    }

    removePendingReview(
        matchId
    );

    addAcceptedResult({
        jobId:
            normalizeId(
                event?.detail?.jobId
            ),

        matchId,

        confirmationStatus:
            normalizeConfirmationStatus(
                event?.detail?.confirmationStatus
            )
            || (
                event?.detail?.hasDisputes ===
                    true
                    ? "confirmed_with_disputes"
                    : "confirmed"
            )
    });

    if (
        event?.detail?.automatic ===
            true
    ) {
        return;
    }

    showConfirmedNotification({
        ...event.detail,
        matchId
    });
}

/* =========================================================
   FAILURE ACKNOWLEDGED
   ========================================================= */

function handleFailureAcknowledged(
    event
) {
    const jobId =
        normalizeId(
            event?.detail?.jobId
        );

    if (
        !validJobId(
            jobId
        )
    ) {
        return;
    }

    acknowledgeOcrFailure(
        jobId
    );
}

/* =========================================================
   VISIBILITY / ONLINE
   ========================================================= */

function handleVisibilityChange() {
    if (
        document.visibilityState ===
        "visible"
    ) {
        checkActiveOcrSubmission();
        restorePendingNotifications();
    }
}

function handleWindowFocus() {
    checkActiveOcrSubmission();
}

function handleOnline() {
    checkActiveOcrSubmission();
    restorePendingNotifications();
}

/* =========================================================
   STORAGE
   ========================================================= */

function handleStorageChange(
    event
) {
    if (
        event.key ===
        OCR_ACTIVE_JOB_KEY
    ) {
        checkActiveOcrSubmission();

        return;
    }

    if (
        event.key ===
        OCR_PENDING_REVIEW_KEY
        || event.key ===
            OCR_PENDING_FAILURE_KEY
    ) {
        restorePendingNotifications();
    }
}

/* =========================================================
   INITIALIZE
   ========================================================= */

export function initializeOcrNotifications() {
    if (
        OCR_NOTIFICATIONS_READY
    ) {
        checkActiveOcrSubmission();
        restorePendingNotifications();

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

    document.addEventListener(
        "ocr:results-confirmed",
        handleResultsConfirmed
    );

    document.addEventListener(
        "ocr:failure-acknowledged",
        handleFailureAcknowledged
    );

    OCR_NOTIFICATIONS_READY =
        true;

    checkActiveOcrSubmission();
    restorePendingNotifications();

    console.log(
        `[OCR NOTIFICATIONS] ${OCR_NOTIFICATION_VERSION} ready.`
    );

    return true;
}