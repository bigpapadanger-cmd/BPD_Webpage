"use strict";

/* =========================================================
   BPD GAMING NETWORK
   OCR NOTIFICATIONS
   ========================================================= */

const OCR_NOTIFICATION_VERSION =
    "ocr-notifications-1.7";

const OCR_PENDING_REVIEW_KEY =
    "rocketLeagueOcrPendingReviewsV1";

const OCR_PENDING_FAILURE_KEY =
    "rocketLeagueOcrPendingFailuresV1";

const OCR_ACKNOWLEDGED_JOB_KEY =
    "rocketLeagueOcrAcknowledgedJobsV1";

const OCR_ACCEPTED_RESULT_KEY =
    "rocketLeagueOcrAcceptedResultsV1";

const OCR_ACKNOWLEDGED_JOB_LIMIT =
    100;

const OCR_NOTIFICATION_CONTAINER_ID =
    "ocrNotificationContainer";

const OCR_NOTIFICATION_DURATION_MS =
    15000;

let OCR_NOTIFICATIONS_READY =
    false;

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

/* =========================================================
   STORAGE
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
        console.warn(
            `[OCR NOTIFICATIONS] Invalid ${key} storage was ignored.`,
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

        return true;
    }
    catch (
        error
    ) {
        console.error(
            `[OCR NOTIFICATIONS] Could not save ${key}.`,
            error
        );

        return false;
    }
}

/* =========================================================
   HANDLED JOBS
   ========================================================= */

function readAcknowledgedJobs() {
    return Array.from(
        new Set(
            readStoredArray(
                OCR_ACKNOWLEDGED_JOB_KEY
            )
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
                )
        )
    );
}

function writeAcknowledgedJobs(
    jobIds
) {
    const normalized =
        Array.from(
            new Set(
                (
                    Array.isArray(
                        jobIds
                    )
                        ? jobIds
                        : []
                )
                    .map(
                        normalizeId
                    )
                    .filter(
                        validJobId
                    )
            )
        )
            .slice(
                -OCR_ACKNOWLEDGED_JOB_LIMIT
            );

    return writeStoredArray(
        OCR_ACKNOWLEDGED_JOB_KEY,
        normalized
    );
}

function isJobAcknowledged(
    jobId
) {
    const normalizedJobId =
        normalizeId(
            jobId
        );

    return Boolean(
        validJobId(
            normalizedJobId
        )
        && readAcknowledgedJobs()
            .includes(
                normalizedJobId
            )
    );
}

function rememberAcknowledgedJob(
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

    const jobs =
        readAcknowledgedJobs()
            .filter(
                function(
                    storedJobId
                ) {
                    return (
                        storedJobId !==
                        normalizedJobId
                    );
                }
            );

    jobs.push(
        normalizedJobId
    );

    return writeAcknowledgedJobs(
        jobs
    );
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
    return writeStoredArray(
        OCR_PENDING_REVIEW_KEY,
        reviews
    );
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
        || isJobAcknowledged(
            jobId
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
                detail?.completedAt
                || detail?.createdAt
                || new Date()
                    .toISOString()
            ),
        sourceRoute:
            String(
                detail?.sourceRoute
                || ""
            )
    };

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
                        !== matchId
                    );
                }
            );

    reviews.push(
        pending
    );

    return writePendingReviews(
        reviews
    )
        ? pending
        : null;
}

export function removePendingReview(
    matchId,
    {
        markHandled = true
    } = {}
) {
    const normalizedMatchId =
        normalizeId(
            matchId
        );

    if (
        !validMatchId(
            normalizedMatchId
        )
    ) {
        return null;
    }

    const reviews =
        readPendingReviews();

    const removed =
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
        )
        || null;

    writePendingReviews(
        reviews.filter(
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
        )
    );

    clearNotificationTimer(
        normalizedMatchId
    );

    removeNotificationElement(
        normalizedMatchId
    );

    if (
        markHandled
        && validJobId(
            removed?.jobId
        )
    ) {
        rememberAcknowledgedJob(
            removed.jobId
        );
    }

    return removed;
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
    return writeStoredArray(
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
        || isJobAcknowledged(
            jobId
        )
    ) {
        return null;
    }

    const matchId =
        normalizeId(
            detail?.matchId
        );

    const failure = {
        jobId,
        matchId:
            validMatchId(
                matchId
            )
                ? matchId
                : null,
        status:
            "failed",
        stage:
            String(
                detail?.stage
                || "failed"
            )
                .trim()
                .toLowerCase(),
        errorCode:
            normalizeErrorCode(
                detail?.errorCode
            ),
        message:
            String(
                detail?.message
                || "The scoreboard could not be processed."
            )
                .trim(),
        createdAt:
            String(
                detail?.createdAt
                || new Date()
                    .toISOString()
            ),
        sourceRoute:
            String(
                detail?.sourceRoute
                || ""
            )
    };

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
                        !== jobId
                    );
                }
            );

    failures.push(
        failure
    );

    return writePendingFailures(
        failures
    )
        ? failure
        : null;
}

export function acknowledgeOcrFailure(
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

    if (
        !rememberAcknowledgedJob(
            normalizedJobId
        )
    ) {
        return false;
    }

    writePendingFailures(
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
            )
    );

    clearNotificationTimer(
        normalizedJobId
    );

    removeNotificationElement(
        normalizedJobId
    );

    console.log(
        "[OCR NOTIFICATIONS] Failure acknowledged and removed.",
        {
            jobId:
                normalizedJobId
        }
    );

    return true;
}

/* =========================================================
   LEGACY ACCEPTED STORAGE
   ========================================================= */

export function readAcceptedResults() {
    return readStoredArray(
        OCR_ACCEPTED_RESULT_KEY
    );
}

function clearLegacyAcceptedResults() {
    if (
        readAcceptedResults()
            .length > 0
    ) {
        writeStoredArray(
            OCR_ACCEPTED_RESULT_KEY,
            []
        );
    }
}

/* =========================================================
   NOTIFICATION DOM
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

function clearNotificationTimer(
    id
) {
    const normalizedId =
        normalizeId(
            id
        );

    const timer =
        OCR_NOTIFICATION_TIMERS.get(
            normalizedId
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
        normalizedId
    );
}

function removeNotificationElement(
    id
) {
    const normalizedId =
        normalizeId(
            id
        );

    if (
        !normalizedId
    ) {
        return;
    }

    document.getElementById(
        getNotificationId(
            normalizedId
        )
    )?.remove();
}

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

    clearNotificationTimer(
        normalizedId
    );

    removeNotificationElement(
        normalizedId
    );

    const notification =
        document.createElement(
            "button"
        );

    notification.type =
        "button";

    notification.id =
        getNotificationId(
            normalizedId
        );

    notification.className =
        "ocr-notification";

    if (
        type ===
        "success"
    ) {
        notification.classList.add(
            "ocr-notification-success"
        );
    }
    else if (
        type ===
        "review"
    ) {
        notification.classList.add(
            "ocr-notification-review"
        );
    }
    else if (
        type ===
        "info"
    ) {
        notification.classList.add(
            "ocr-notification-info"
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

    if (
        typeof onClick ===
        "function"
    ) {
        notification.addEventListener(
            "click",
            async function() {
                clearNotificationTimer(
                    normalizedId
                );

                removeNotificationElement(
                    normalizedId
                );

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
    }

    ensureNotificationContainer()
        .appendChild(
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
   OPEN EVENTS
   ========================================================= */

function openResult(
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

function openReview(
    detail
) {
    document.dispatchEvent(
        new CustomEvent(
            "ocr:pending-review-open",
            {
                detail
            }
        )
    );
}

function openFailure(
    detail
) {
    document.dispatchEvent(
        new CustomEvent(
            "ocr:failure-open",
            {
                detail
            }
        )
    );
}

/* =========================================================
   DISPLAY TYPES
   ========================================================= */

function showReviewNotification(
    pending
) {
    if (
        !validJobId(
            pending?.jobId
        )
        || !validMatchId(
            pending?.matchId
        )
        || isJobAcknowledged(
            pending.jobId
        )
    ) {
        return null;
    }

    return createNotification({
        id:
            pending.matchId,
        type:
            "review",
        title:
            "Scoreboard Needs Review",
        description:
            "OCR completed, but one or more scoreboard values need verification.",
        onClick:
            function() {
                openReview(
                    pending
                );
            }
    });
}

function showFailureNotification(
    failure
) {
    if (
        !validJobId(
            failure?.jobId
        )
        || isJobAcknowledged(
            failure.jobId
        )
    ) {
        return null;
    }

    return createNotification({
        id:
            failure.jobId,
        type:
            "failure",
        title:
            "Scoreboard Processing Failed",
        description:
            failure.message
            || "The scoreboard could not be processed.",
        onClick:
            function() {
                openFailure(
                    failure
                );
            }
    });
}

function showAcceptedNotification(
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

    /*
     * Green requires no action and is considered resolved.
     */
    rememberAcknowledgedJob(
        jobId
    );

    return createNotification({
        id:
            matchId,
        type:
            "success",
        title:
            "Scoreboard Accepted",
        description:
            "OCR completed successfully. No review is required.",
        onClick:
            function() {
                openResult({
                    ...detail,
                    jobId,
                    matchId
                });
            }
    });
}

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
        return null;
    }

    return createNotification({
        id:
            (
                "CONFIRMED"
                + matchId
            ),
        type:
            "success",
        title:
            "Scoreboard Confirmed",
        description:
            "Your scoreboard review was submitted successfully.",
        onClick:
            function() {
                openResult({
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

function showMonitorPausedNotification(
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

    return createNotification({
        id:
            (
                "PAUSED"
                + jobId
            ),
        type:
            "info",
        title:
            "Scoreboard Status Paused",
        description:
            String(
                detail?.message
                || "Status checking is temporarily paused."
            )
    });
}

/* =========================================================
   JOB COMPLETED
   ========================================================= */

function handleJobCompleted(
    event
) {
    const detail =
        event?.detail
        || {};

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
        || isJobAcknowledged(
            jobId
        )
    ) {
        return;
    }

    const confirmationStatus =
        normalizeConfirmationStatus(
            detail?.confirmationStatus
        );

    const reviewRequired = (
        detail?.reviewRequired ===
            true
        || confirmationStatus ===
            "pending_review"
    );

    if (
        reviewRequired
    ) {
        const pending =
            addPendingReview({
                ...detail,
                jobId,
                matchId
            });

        if (
            pending
        ) {
            showReviewNotification(
                pending
            );
        }

        return;
    }

    showAcceptedNotification({
        ...detail,
        jobId,
        matchId,
        confirmationStatus:
            confirmationStatus
            || "auto_accepted"
    });
}

/* =========================================================
   JOB FAILED
   ========================================================= */

function handleJobFailed(
    event
) {
    const failure =
        addPendingFailure(
            event?.detail
            || {}
        );

    if (
        failure
    ) {
        showFailureNotification(
            failure
        );
    }
}

/* =========================================================
   REVIEW CONFIRMED
   ========================================================= */

function handleResultsConfirmed(
    event
) {
    const detail =
        event?.detail
        || {};

    const matchId =
        normalizeId(
            detail?.matchId
        );

    const jobId =
        normalizeId(
            detail?.jobId
        );

    if (
        !validMatchId(
            matchId
        )
    ) {
        return;
    }

    const removed =
        removePendingReview(
            matchId,
            {
                markHandled:
                    true
            }
        );

    if (
        validJobId(
            jobId
        )
    ) {
        rememberAcknowledgedJob(
            jobId
        );
    }
    else if (
        validJobId(
            removed?.jobId
        )
    ) {
        rememberAcknowledgedJob(
            removed.jobId
        );
    }

    if (
        detail?.automatic ===
        true
    ) {
        return;
    }

    showConfirmedNotification({
        ...detail,
        jobId:
            validJobId(
                jobId
            )
                ? jobId
                : removed?.jobId
                || "",
        matchId
    });
}

/* =========================================================
   INVALID REVIEW
   ORANGE → RED
   ========================================================= */

function handleInvalidReview(
    event
) {
    const detail =
        event?.detail
        || {};

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
    ) {
        console.error(
            "[OCR NOTIFICATIONS] Invalid review could not become a failure because Job ID is invalid.",
            detail
        );

        return;
    }

    /*
     * Do NOT tombstone this job yet.
     * It is changing state from orange to red.
     */
    if (
        validMatchId(
            matchId
        )
    ) {
        removePendingReview(
            matchId,
            {
                markHandled:
                    false
            }
        );
    }

    const failure =
        addPendingFailure({
            jobId,
            matchId:
                validMatchId(
                    matchId
                )
                    ? matchId
                    : null,
            stage:
                "review_invalid",
            errorCode:
                detail?.errorCode
                || "OCR_REVIEW_INVALID",
            message:
                detail?.message
                || "This scoreboard cannot be reviewed because required stored data is missing or invalid.",
            createdAt:
                new Date()
                    .toISOString()
        });

    if (
        failure
    ) {
        showFailureNotification(
            failure
        );

        console.warn(
            "[OCR NOTIFICATIONS] Review converted from orange to red.",
            {
                jobId,
                matchId:
                    failure.matchId,
                errorCode:
                    failure.errorCode
            }
        );
    }
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
        validJobId(
            jobId
        )
    ) {
        acknowledgeOcrFailure(
            jobId
        );
    }
}

/* =========================================================
   MONITOR PAUSED
   ========================================================= */

function handleMonitorPaused(
    event
) {
    showMonitorPausedNotification(
        event?.detail
        || {}
    );
}

/* =========================================================
   STORAGE REPAIR
   ========================================================= */

function sanitizePendingReviews() {
    const reviews =
        readPendingReviews();

    const sanitized =
        reviews.filter(
            function(
                item
            ) {
                return (
                    validJobId(
                        item?.jobId
                    )
                    && validMatchId(
                        item?.matchId
                    )
                    && !isJobAcknowledged(
                        item.jobId
                    )
                );
            }
        );

    if (
        sanitized.length !==
        reviews.length
    ) {
        writePendingReviews(
            sanitized
        );
    }

    return sanitized;
}

function sanitizePendingFailures() {
    const failures =
        readPendingFailures();

    const sanitized =
        failures.filter(
            function(
                item
            ) {
                return (
                    validJobId(
                        item?.jobId
                    )
                    && !isJobAcknowledged(
                        item.jobId
                    )
                );
            }
        );

    if (
        sanitized.length !==
        failures.length
    ) {
        writePendingFailures(
            sanitized
        );
    }

    return sanitized;
}

function removeHandledVisibleNotifications() {
    const acknowledged =
        new Set(
            readAcknowledgedJobs()
        );

    readPendingReviews()
        .forEach(
            function(
                pending
            ) {
                if (
                    acknowledged.has(
                        normalizeId(
                            pending?.jobId
                        )
                    )
                ) {
                    clearNotificationTimer(
                        pending?.matchId
                    );

                    removeNotificationElement(
                        pending?.matchId
                    );
                }
            }
        );

    readPendingFailures()
        .forEach(
            function(
                failure
            ) {
                const jobId =
                    normalizeId(
                        failure?.jobId
                    );

                if (
                    acknowledged.has(
                        jobId
                    )
                ) {
                    clearNotificationTimer(
                        jobId
                    );

                    removeNotificationElement(
                        jobId
                    );
                }
            }
        );
}

function repairNotificationStorage() {
    writeAcknowledgedJobs(
        readAcknowledgedJobs()
    );

    removeHandledVisibleNotifications();
    sanitizePendingReviews();
    sanitizePendingFailures();
    clearLegacyAcceptedResults();
}

/* =========================================================
   RESTORE
   ========================================================= */

export function restorePendingNotifications() {
    repairNotificationStorage();

    sanitizePendingReviews()
        .forEach(
            function(
                pending
            ) {
                showReviewNotification(
                    pending
                );
            }
        );

    sanitizePendingFailures()
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
   PAGE EVENTS
   ========================================================= */

function handleVisibilityChange() {
    if (
        document.visibilityState ===
        "visible"
    ) {
        restorePendingNotifications();
    }
}

function handleWindowFocus() {
    restorePendingNotifications();
}

function handleStorageChange(
    event
) {
    if (
        event.key ===
            OCR_PENDING_REVIEW_KEY
        || event.key ===
            OCR_PENDING_FAILURE_KEY
        || event.key ===
            OCR_ACKNOWLEDGED_JOB_KEY
    ) {
        restorePendingNotifications();
    }
}

/* =========================================================
   DEBUG
   ========================================================= */

function getNotificationDebugState() {
    return {
        version:
            OCR_NOTIFICATION_VERSION,
        pendingReviews:
            sanitizePendingReviews(),
        pendingFailures:
            sanitizePendingFailures(),
        acknowledgedJobs:
            readAcknowledgedJobs()
    };
}

function installDebugHelper() {
    try {
        Object.defineProperty(
            window,
            "bpdOcrNotificationDebug",
            {
                configurable:
                    true,
                enumerable:
                    false,
                value:
                    function() {
                        const state =
                            getNotificationDebugState();

                        console.log(
                            "[OCR NOTIFICATIONS] Debug state:",
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
            "[OCR NOTIFICATIONS] Debug helper unavailable.",
            error
        );
    }
}

/* =========================================================
   INITIALIZE
   ========================================================= */

export function initializeOcrNotifications() {
    if (
        OCR_NOTIFICATIONS_READY
    ) {
        restorePendingNotifications();

        return true;
    }

    document.addEventListener(
        "ocr:job-completed",
        handleJobCompleted
    );

    document.addEventListener(
        "ocr:job-failed",
        handleJobFailed
    );

    document.addEventListener(
        "ocr:job-monitor-paused",
        handleMonitorPaused
    );

    document.addEventListener(
        "ocr:results-confirmed",
        handleResultsConfirmed
    );

    document.addEventListener(
        "ocr:review-invalid",
        handleInvalidReview
    );

    document.addEventListener(
        "ocr:failure-acknowledged",
        handleFailureAcknowledged
    );

    document.addEventListener(
        "visibilitychange",
        handleVisibilityChange
    );

    window.addEventListener(
        "focus",
        handleWindowFocus
    );

    window.addEventListener(
        "storage",
        handleStorageChange
    );

    OCR_NOTIFICATIONS_READY =
        true;

    installDebugHelper();
    restorePendingNotifications();

    console.log(
        `[OCR NOTIFICATIONS] ${OCR_NOTIFICATION_VERSION} ready.`
    );

    return true;
}