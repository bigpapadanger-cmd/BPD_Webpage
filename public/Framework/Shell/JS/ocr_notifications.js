"use strict";

/* =========================================================
   BPD GAMING NETWORK
   GLOBAL OCR NOTIFICATIONS
   ========================================================= */

const OCR_ACTIVE_JOB_KEY =
    "rocketLeagueOcrActiveJobV1";

const OCR_ACTIVE_JOB_ROUTE_KEY =
    "rocketLeagueOcrActiveJobRouteV1";

const OCR_PENDING_REVIEW_KEY =
    "rocketLeagueOcrPendingReviewsV1";

const OCR_REVIEW_OPEN_REQUEST_KEY =
    "rocketLeagueOcrReviewOpenRequestV1";

const OCR_JOB_STATUS_URL =
    "/api/ocr/jobs/get_job";

const OCR_JOB_RESULT_URL =
    "/api/ocr/jobs/get_result";

const OCR_CONFIRM_URL =
    "/api/ocr/confirm";

const OCR_NOTIFICATION_CONTAINER_ID =
    "ocrNotificationContainer";

const OCR_NOTIFICATION_CHECK_SCHEDULE_MS = [
    1000,
    4000,
    8000,
    15000,
    20000,
    30000
];

const OCR_NOTIFICATION_MAX_QUEUED_CHECKS =
    3;

const OCR_NOTIFICATION_MAX_STALE_CHECKS =
    3;

const OCR_NOTIFICATION_DISPLAY_MS =
    12500;

const OCR_RESULT_FIELD_ORDER = [
    "score",
    "goals",
    "assists",
    "demos",
    "saves",
    "shots",
    "damage",
    "ping"
];

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

const OCR_NOTIFICATION_TIMERS =
    new Map();

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
            "[OCR NOTIFICATIONS] Could not read OCR route.",
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
   VISIBILITY / FOCUS
   ========================================================= */

function handleVisibilityChange() {
    if (
        document.visibilityState === "visible"
    ) {
        checkActiveOcrSubmission();
    }
}

function handleWindowFocus() {
    checkActiveOcrSubmission();
}

/* =========================================================
   PENDING REVIEW STORAGE
   ========================================================= */

export function readPendingReviews() {
    try {
        const stored =
            JSON.parse(
                localStorage.getItem(
                    OCR_PENDING_REVIEW_KEY
                )
                || "[]"
            );

        return Array.isArray(
            stored
        )
            ? stored
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

        autoConfirmAt:
            Number(
                detail?.autoConfirmAt
                || (
                    Date.now()
                    + OCR_NOTIFICATION_DISPLAY_MS
                )
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
   NOTIFICATION UI
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
        timer
    ) {
        clearTimeout(
            timer
        );

        OCR_NOTIFICATION_TIMERS.delete(
            key
        );
    }
}

function createNotification(
    {
        id,
        success,
        onClick,
        onTimeout,
        remainingMs =
            OCR_NOTIFICATION_DISPLAY_MS
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
        success
            ? "ocr-notification ocr-notification-success"
            : "ocr-notification ocr-notification-failure";

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

    const title =
        document.createElement(
            "div"
        );

    title.className =
        "ocr-notification-title";

    title.textContent =
        success
            ? "Image Upload Complete"
            : "Image Upload Failed";

    const description =
        document.createElement(
            "div"
        );

    description.className =
        "ocr-notification-description";

    description.textContent =
        "Click for more details";

    content.append(
        title,
        description
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
                typeof onClick
                === "function"
            ) {
                await onClick();
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

    const timer =
        setTimeout(
            async function() {
                OCR_NOTIFICATION_TIMERS.delete(
                    normalizeId(
                        id
                    )
                );

                removeNotificationElement(
                    id
                );

                if (
                    typeof onTimeout
                    === "function"
                ) {
                    await onTimeout();
                }
            },
            timeout
        );

    OCR_NOTIFICATION_TIMERS.set(
        normalizeId(
            id
        ),
        timer
    );
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
   GET JOB
   ========================================================= */

async function getOcrJob(
    jobId
) {
    const response =
        await fetch(
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
        || data?.success !== true
        || !data?.job
    ) {
        throw new Error(
            data?.message
            || "Unable to read OCR job."
        );
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
        await fetch(
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
        || data?.success !== true
    ) {
        throw new Error(
            data?.message
            || "Unable to load OCR result."
        );
    }

    const result =
        (
            data?.result
            && typeof data.result === "object"
        )
            ? data.result
            : (
                data?.matchReport
                && typeof data.matchReport === "object"
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
   SCOREBOARD VALUES
   ========================================================= */

function getResultTeams(
    result
) {
    if (
        Array.isArray(
            result?.teams
        )
    ) {
        return result.teams;
    }

    const teams =
        [];

    if (
        Array.isArray(
            result?.team1
        )
    ) {
        teams.push({
            team:
                1,
            players:
                result.team1
        });
    }

    if (
        Array.isArray(
            result?.team2
        )
    ) {
        teams.push({
            team:
                2,
            players:
                result.team2
        });
    }

    return teams;
}

function getPlayerName(
    player
) {
    return String(
        player?.player
        || player?.matchedName
        || player?.username
        || player?.name
        || ""
    );
}

function buildConfirmationFields(
    result
) {
    const fields =
        [];

    getResultTeams(
        result
    )
        .forEach(
            function(
                team,
                teamArrayIndex
            ) {
                const teamIndex =
                    Number(
                        team?.team
                        ?? team?.teamIndex
                        ?? (
                            teamArrayIndex
                            + 1
                        )
                    );

                const players =
                    Array.isArray(
                        team?.players
                    )
                        ? team.players
                        : [];

                players.forEach(
                    function(
                        player
                    ) {
                        const playerName =
                            getPlayerName(
                                player
                            );

                        OCR_RESULT_FIELD_ORDER
                            .forEach(
                                function(
                                    field
                                ) {
                                    const value =
                                        player?.[
                                            field
                                        ];

                                    if (
                                        value === null
                                        || typeof value === "undefined"
                                    ) {
                                        return;
                                    }

                                    const numeric =
                                        Number(
                                            value
                                        );

                                    if (
                                        !Number.isInteger(
                                            numeric
                                        )
                                        || numeric < 0
                                    ) {
                                        return;
                                    }

                                    fields.push({
                                        team:
                                            teamIndex,

                                        player:
                                            playerName,

                                        field,

                                        userValue:
                                            numeric
                                    });
                                }
                            );
                    }
                );
            }
        );

    return fields;
}

/* =========================================================
   AUTO ACCEPT
   ========================================================= */

async function autoAcceptOcrResult(
    pending
) {
    const currentPending =
        getPendingReview(
            pending?.matchId
        );

    if (
        !currentPending
        || currentPending.clicked === true
    ) {
        return;
    }

    try {
        const result =
            await getOcrResult(
                currentPending.jobId
            );

        const fields =
            buildConfirmationFields(
                result
            );

        if (
            fields.length === 0
        ) {
            throw new Error(
                "No scoreboard values were available for confirmation."
            );
        }

        const response =
            await fetch(
                OCR_CONFIRM_URL,
                {
                    method:
                        "POST",

                    credentials:
                        "same-origin",

                    cache:
                        "no-store",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body:
                        JSON.stringify({
                            matchId:
                                currentPending.matchId,

                            fields
                        })
                }
            );

        if (
            !response.ok
        ) {
            throw new Error(
                "Automatic scoreboard confirmation failed."
            );
        }

        removePendingReview(
            currentPending.matchId
        );

        document.dispatchEvent(
            new CustomEvent(
                "ocr:results-confirmed",
                {
                    detail: {
                        matchId:
                            currentPending.matchId,

                        automatic:
                            true
                    }
                }
            )
        );
    }
    catch (
        error
    ) {
        console.warn(
            "[OCR NOTIFICATIONS] Automatic confirmation could not complete.",
            error
        );
    }
}

/* =========================================================
   OPEN REVIEW
   ========================================================= */

async function openPendingReview(
    pending
) {
    const updatedPending =
        markPendingReviewClicked(
            pending.matchId
        )
        || pending;

    const reviewRoute =
        String(
            updatedPending.reviewRoute
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
        || reviewRoute === currentRoute
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

    const router =
        Reflect.get(
            window,
            "BPDRouter"
        );

    if (
        router
        && typeof router.navigate === "function"
    ) {
        try {
            await router.navigate(
                reviewRoute
            );

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
        catch (
            error
        ) {
            console.error(
                "[OCR NOTIFICATIONS] OCR route navigation failed.",
                error
            );
        }
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

    if (
        reviewRoute
    ) {
        window.location.assign(
            reviewRoute
        );
    }
}

/* =========================================================
   SUCCESS NOTIFICATION
   ========================================================= */

function showSuccessNotification(
    pending
) {
    const remainingMs =
        Math.max(
            0,
            Number(
                pending.autoConfirmAt
            )
            - Date.now()
        );

    createNotification({
        id:
            pending.matchId,

        success:
            true,

        remainingMs,

        onClick:
            async function() {
                await openPendingReview(
                    pending
                );
            },

        onTimeout:
            async function() {
                const current =
                    getPendingReview(
                        pending.matchId
                    );

                if (
                    !current
                    || current.clicked === true
                ) {
                    return;
                }

                await autoAcceptOcrResult(
                    current
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
    const id =
        detail?.jobId
        || (
            "FAIL"
            + Date.now()
        );

    createNotification({
        id,

        success:
            false,

        onClick:
            async function() {
                const reviewRoute =
                    String(
                        detail?.reviewRoute
                        || ""
                    );

                const router =
                    Reflect.get(
                        window,
                        "BPDRouter"
                    );

                if (
                    reviewRoute
                    && router
                    && typeof router.navigate === "function"
                ) {
                    await router.navigate(
                        reviewRoute
                    );
                }

                document.dispatchEvent(
                    new CustomEvent(
                        "ocr:job-failed",
                        {
                            detail
                        }
                    )
                );
            }
    });
}

/* =========================================================
   POLLING
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
            Number(
                job?.progress
                || 0
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
        signature
        !== OCR_NOTIFICATION_LAST_PROGRESS_SIGNATURE
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

/* =========================================================
   ABANDON STALLED JOB
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
            && typeof job === "object"
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
            jobId,

            reason:
                abandonedJob.error.code,

            status:
                job?.status
                || null,

            stage:
                job?.stage
                || null,

            progress:
                job?.progress
                ?? null,

            queuedChecks:
                OCR_NOTIFICATION_QUEUED_CHECKS,

            staleChecks:
                OCR_NOTIFICATION_STALE_CHECKS
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
            abandonedJob.error.code
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

function scheduleActiveOcrCheck(
    jobId
) {
    if (
        !OCR_NOTIFICATION_POLLING
        || OCR_NOTIFICATION_ACTIVE_JOB_ID !== jobId
    ) {
        return;
    }

    if (
        OCR_NOTIFICATION_CHECK_INDEX
        >= OCR_NOTIFICATION_CHECK_SCHEDULE_MS.length
    ) {
        stopOcrNotificationPolling();

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

    const targetOffset =
        OCR_NOTIFICATION_CHECK_SCHEDULE_MS[
            OCR_NOTIFICATION_CHECK_INDEX
        ];

    const elapsed =
        Math.max(
            0,
            Date.now()
            - OCR_NOTIFICATION_BURST_STARTED_AT
        );

    const delay =
        Math.max(
            0,
            targetOffset
            - elapsed
        );

    OCR_NOTIFICATION_POLL_TIMER =
        setTimeout(
            function() {
                OCR_NOTIFICATION_POLL_TIMER =
                    null;

                OCR_NOTIFICATION_CHECK_INDEX +=
                    1;

                runActiveOcrCheck();
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
        && OCR_NOTIFICATION_ACTIVE_JOB_ID === jobId
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
   COMPLETED
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
        console.error(
            "[OCR NOTIFICATIONS] Completed job is missing matchId."
        );

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
        showSuccessNotification(
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
   FAILED
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
        || OCR_NOTIFICATION_ACTIVE_JOB_ID !== jobId
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

        document.dispatchEvent(
            new CustomEvent(
                "ocr:job-progress",
                {
                    detail: {
                        jobId,

                        job
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
                OCR_NOTIFICATION_QUEUED_CHECKS
                >= OCR_NOTIFICATION_MAX_QUEUED_CHECKS
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
                            "The scoreboard job did not start processing. Please try the upload again."
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
            && OCR_NOTIFICATION_STALE_CHECKS
                >= OCR_NOTIFICATION_MAX_STALE_CHECKS
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

        if (
            OCR_NOTIFICATION_CHECK_INDEX
            >= OCR_NOTIFICATION_CHECK_SCHEDULE_MS.length
        ) {
            stopOcrNotificationPolling();

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

        if (
            !navigator.onLine
        ) {
            stopOcrNotificationPolling();

            return;
        }

        if (
            OCR_NOTIFICATION_CHECK_INDEX
            >= OCR_NOTIFICATION_CHECK_SCHEDULE_MS.length
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

export function checkActiveOcrSubmission() {
    startOcrNotificationCheckBurst();
}

/* =========================================================
   RESTORE PENDING
   ========================================================= */

export function restorePendingNotifications() {
    readPendingReviews()
        .forEach(
            function(
                pending
            ) {
                if (
                    pending?.clicked === true
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
                        && currentRoute === reviewRoute
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

                if (
                    Number(
                        pending?.autoConfirmAt
                    ) <= Date.now()
                ) {
                    autoAcceptOcrResult(
                        pending
                    );

                    return;
                }

                showSuccessNotification(
                    pending
                );
            }
        );
}

/* =========================================================
   CONFIRMATION EVENT
   ========================================================= */

function handleResultsConfirmed(
    event
) {
    const matchId =
        event?.detail?.matchId;

    if (
        matchId
    ) {
        removePendingReview(
            matchId
        );
    }
}

/* =========================================================
   ONLINE
   ========================================================= */

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
        event.key === OCR_ACTIVE_JOB_KEY
    ) {
        checkActiveOcrSubmission();

        return;
    }

    if (
        event.key === OCR_PENDING_REVIEW_KEY
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

    return true;
}