"use strict";

/* =========================================================
   BPD GAMING NETWORK
   GLOBAL OCR NOTIFICATIONS
   ========================================================= */

import {
    OCR_JOB_RESULT_URL,
    OCR_JOB_STATUS_URL
} from "/scripts/apiRoutes.js";

import {
    apiFetch
} from "/scripts/apiConnection.js";

const OCR_NOTIFICATION_VERSION =
    "ocr-notifications-1.2";

const OCR_ACTIVE_JOB_KEY =
    "rocketLeagueOcrActiveJobV1";

const OCR_ACTIVE_JOB_ROUTE_KEY =
    "rocketLeagueOcrActiveJobRouteV1";

const OCR_PENDING_REVIEW_KEY =
    "rocketLeagueOcrPendingReviewsV1";

const OCR_REVIEW_OPEN_REQUEST_KEY =
    "rocketLeagueOcrReviewOpenRequestV1";

const OCR_FAILURE_OPEN_REQUEST_KEY =
    "rocketLeagueOcrFailureOpenRequestV1";

const OCR_NOTIFICATION_CONTAINER_ID =
    "ocrNotificationContainer";

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

let OCR_NOTIFICATION_QUEUED_CHECKS =
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
    try {
        const reviews =
            JSON.parse(
                localStorage.getItem(
                    OCR_PENDING_REVIEW_KEY
                )
                || "[]"
            );

        return Array.isArray(
            reviews
        )
            ? reviews
            : [];
    }
    catch (
        error
    ) {
        console.error(
            "[OCR NOTIFICATIONS] Could not read pending reviews.",
            error
        );

        return [];
    }
}

function writePendingReviews(
    reviews
) {
    try {
        localStorage.setItem(
            OCR_PENDING_REVIEW_KEY,
            JSON.stringify(
                Array.isArray(
                    reviews
                )
                    ? reviews
                    : []
            )
        );
    }
    catch (
        error
    ) {
        console.error(
            "[OCR NOTIFICATIONS] Could not save pending reviews.",
            error
        );
    }
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
        || !matchId
    ) {
        return null;
    }

    const pending = {
        jobId,
        matchId,

        matchSize:
            String(
                detail?.matchSize
                || detail?.matchType
                || ""
            ),

        reviewRoute:
            String(
                detail?.reviewRoute
                || getStoredActiveJobRoute()
                || ""
            ),

        createdAt:
            String(
                detail?.createdAt
                || new Date()
                    .toISOString()
            ),

        clicked:
            detail?.clicked === true
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

function markPendingReviewClicked(
    matchId
) {
    const normalizedMatchId =
        normalizeId(
            matchId
        );

    const reviews =
        readPendingReviews();

    const pending =
        reviews.find(
            function(
                item
            ) {
                return (
                    normalizeId(
                        item?.matchId
                    )
                    === normalizedMatchId
                );
            }
        );

    if (
        !pending
    ) {
        return null;
    }

    pending.clicked =
        true;

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
        onClick,
        remainingMs = 0
    }
) {
    const notificationId =
        getNotificationId(
            id
        );

    removeNotificationElement(
        id
    );

    clearNotificationTimer(
        id
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
                id
            );

            removeNotificationElement(
                id
            );

            if (
                typeof onClick ===
                "function"
            ) {
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
        }
    );

    container.appendChild(
        notification
    );

    const timeout =
        Math.max(
            0,
            Number(
                remainingMs
            )
            || 0
        );

    if (
        timeout <= 0
    ) {
        return notification;
    }

    const timer =
        setTimeout(
            function() {
                OCR_NOTIFICATION_TIMERS.delete(
                    normalizeId(
                        id
                    )
                );

                removeNotificationElement(
                    id
                );
            },
            timeout
        );

    OCR_NOTIFICATION_TIMERS.set(
        normalizeId(
            id
        ),
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
        || !data?.job
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

    return data.job;
}

/* =========================================================
   GET RESULT
   ========================================================= */

async function getOcrResult(
    jobId
) {
    const response =
        await apiFetch(
            (
                OCR_JOB_RESULT_URL
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
        throw new Error(
            data?.message
            || "Unable to load OCR result."
        );
    }

    const result =
        (
            data?.result
            && typeof data.result ===
                "object"
        )
            ? data.result
            : (
                data?.matchReport
                && typeof data.matchReport ===
                    "object"
                    ? data.matchReport
                    : null
            );

    if (
        !result
    ) {
        throw new Error(
            "OCR result was not returned."
        );
    }

    return result;
}

/* =========================================================
   ROUTE NAVIGATION
   ========================================================= */

async function navigateToOcrRoute(
    route
) {
    const destination =
        String(
            route
            || ""
        )
            .trim();

    if (
        !destination.startsWith(
            "/"
        )
    ) {
        return false;
    }

    const current =
        (
            window.location.pathname
            + window.location.search
            + window.location.hash
        );

    if (
        destination ===
            current
        || destination ===
            window.location.pathname
    ) {
        return true;
    }

    const router =
        Reflect.get(
            window,
            "BPDRouter"
        );

    if (
        router
        && typeof router.navigate ===
            "function"
    ) {
        try {
            await router.navigate(
                destination
            );

            return true;
        }
        catch (
            error
        ) {
            console.error(
                "[OCR NOTIFICATIONS] Router navigation failed.",
                error
            );
        }
    }

    window.location.assign(
        destination
    );

    return true;
}

/* =========================================================
   OPEN REVIEW
   ========================================================= */

async function openPendingReview(
    pending
) {
    const updatedPending =
        markPendingReviewClicked(
            pending?.matchId
        )
        || pending;

    const reviewRoute =
        String(
            updatedPending?.reviewRoute
            || ""
        )
            .trim();

    const currentRoute =
        String(
            document.body
                ?.dataset
                ?.currentRoute
            || window.location.pathname
            || ""
        )
            .trim();

    if (
        !reviewRoute
        || reviewRoute ===
            currentRoute
    ) {
        document.dispatchEvent(
            new CustomEvent(
                "ocr:pending-review-open",
                {
                    detail:
                        updatedPending
                }
            )
        );

        return;
    }

    try {
        sessionStorage.setItem(
            OCR_REVIEW_OPEN_REQUEST_KEY,
            JSON.stringify(
                updatedPending
            )
        );
    }
    catch (
        error
    ) {
        console.error(
            "[OCR NOTIFICATIONS] Could not preserve review request.",
            error
        );
    }

    const navigated =
        await navigateToOcrRoute(
            reviewRoute
        );

    if (
        navigated
    ) {
        return;
    }

    document.dispatchEvent(
        new CustomEvent(
            "ocr:pending-review-open",
            {
                detail:
                    updatedPending
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

        remainingMs:
            0,

        onClick:
            async function() {
                await openPendingReview(
                    pending
                );
            }
    });
}

/* =========================================================
   FAILURE NOTIFICATION
   ========================================================= */

function showFailureNotification(
    detail
) {
    const jobId =
        normalizeId(
            detail?.jobId
        );

    const failureId =
        jobId
        || (
            "FAIL"
            + Date.now()
        );

    const failureMessage =
        String(
            detail?.job
                ?.error
                ?.message
            || detail?.job
                ?.message
            || detail?.message
            || "The scoreboard could not be processed."
        )
            .trim();

    createNotification({
        id:
            failureId,

        type:
            "failure",

        title:
            "Scoreboard Processing Failed",

        description:
            failureMessage,

        remainingMs:
            0,

        onClick:
            async function() {
                const failureDetail = {
                    ...detail,

                    message:
                        failureMessage
                };

                const reviewRoute =
                    String(
                        detail?.reviewRoute
                        || ""
                    )
                        .trim();

                const currentRoute =
                    String(
                        document.body
                            ?.dataset
                            ?.currentRoute
                        || window.location.pathname
                        || ""
                    )
                        .trim();

                if (
                    !reviewRoute
                    || reviewRoute ===
                        currentRoute
                ) {
                    document.dispatchEvent(
                        new CustomEvent(
                            "ocr:failure-open",
                            {
                                detail:
                                    failureDetail
                            }
                        )
                    );

                    return;
                }

                try {
                    sessionStorage.setItem(
                        OCR_FAILURE_OPEN_REQUEST_KEY,
                        JSON.stringify(
                            failureDetail
                        )
                    );
                }
                catch (
                    error
                ) {
                    console.error(
                        "[OCR NOTIFICATIONS] Could not preserve OCR failure.",
                        error
                    );
                }

                await navigateToOcrRoute(
                    reviewRoute
                );
            }
    });
}

/* =========================================================
   CONFIRMED NOTIFICATION
   ========================================================= */

function showConfirmedNotification(
    matchId
) {
    createNotification({
        id:
            "CONFIRMED"
            + normalizeId(
                matchId
            ),

        type:
            "success",

        title:
            "Scoreboard Confirmed",

        description:
            "The scoreboard results were confirmed.",

        remainingMs:
            5000
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

    OCR_NOTIFICATION_QUEUED_CHECKS =
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
    const reviewRoute =
        getStoredActiveJobRoute();

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

    stopOcrNotificationPolling();
    clearStoredActiveJob();

    const detail = {
        jobId,
        reviewRoute,

        job:
            abandonedJob,

        abandoned:
            true,

        reason:
            abandonedJob
                .error
                .code
    };

    showFailureNotification(
        detail
    );

    document.dispatchEvent(
        new CustomEvent(
            "ocr:job-failed",
            {
                detail
            }
        )
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

    OCR_NOTIFICATION_QUEUED_CHECKS =
        0;

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
        !matchId
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

    const pending =
        addPendingReview({
            jobId,
            matchId,

            matchSize:
                job?.matchSize
                || job?.matchType
                || "",

            reviewRoute:
                getStoredActiveJobRoute()
        });

    stopOcrNotificationPolling();
    clearStoredActiveJob();

    if (
        pending
    ) {
        showReviewNotification(
            pending
        );
    }

    document.dispatchEvent(
        new CustomEvent(
            "ocr:job-completed",
            {
                detail: {
                    jobId,
                    matchId,
                    job
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
    const reviewRoute =
        getStoredActiveJobRoute();

    stopOcrNotificationPolling();
    clearStoredActiveJob();

    const detail = {
        jobId,
        reviewRoute,
        job
    };

    showFailureNotification(
        detail
    );

    document.dispatchEvent(
        new CustomEvent(
            "ocr:job-failed",
            {
                detail
            }
        )
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

                        message:
                            String(
                                job?.message
                                || ""
                            )
                                .trim(),

                        updatedAt:
                            job?.updatedAt
                            || null,

                        heartbeatAt:
                            job?.heartbeatAt
                            || null,

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
        ) {
            OCR_NOTIFICATION_QUEUED_CHECKS +=
                1;

            if (
                isOcrQueueStale(
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
        }
        else {
            OCR_NOTIFICATION_QUEUED_CHECKS =
                0;
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
   RESTORE PENDING REVIEWS
   ========================================================= */

export function restorePendingNotifications() {
    readPendingReviews()
        .forEach(
            function(
                pending
            ) {
                if (
                    pending?.clicked ===
                    true
                ) {
                    const currentRoute =
                        String(
                            document.body
                                ?.dataset
                                ?.currentRoute
                            || window.location.pathname
                            || ""
                        )
                            .trim();

                    const reviewRoute =
                        String(
                            pending?.reviewRoute
                            || ""
                        )
                            .trim();

                    if (
                        reviewRoute
                        && currentRoute ===
                            reviewRoute
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

                    return;
                }

                showReviewNotification(
                    pending
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
        !matchId
    ) {
        return;
    }

    removePendingReview(
        matchId
    );

    if (
        event?.detail?.automatic ===
        true
    ) {
        return;
    }

    showConfirmedNotification(
        matchId
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

    OCR_NOTIFICATIONS_READY =
        true;

    checkActiveOcrSubmission();
    restorePendingNotifications();

    console.log(
        `[OCR NOTIFICATIONS] ${OCR_NOTIFICATION_VERSION} ready.`
    );

    return true;
}