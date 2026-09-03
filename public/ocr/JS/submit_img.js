"use strict";

/* =========================================================
   BPD GAMING NETWORK
   OCR IMAGE SUBMISSION
   ========================================================= */

const OCR_JOB_SUBMIT_URL =
    "/api/ocr/jobs/submit_job";

const OCR_JOB_RESULT_URL =
    "/api/ocr/jobs/get_result";

const OCR_REVIEW_OPEN_REQUEST_KEY =
    "rocketLeagueOcrReviewOpenRequestV1";

const OCR_ACTIVE_JOB_KEY =
    "rocketLeagueOcrActiveJobV1";

const OCR_ACTIVE_JOB_ROUTE_KEY =
    "rocketLeagueOcrActiveJobRouteV1";

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

let OCR_ACTIVE_JOB_ID =
    "";

let OCR_LOADING_PROGRESS =
    0;

let OCR_LOADING_CONFIRMED_PROGRESS =
    0;

let OCR_LOADING_NEXT_GATE =
    0;

let OCR_LOADING_VELOCITY =
    0;

let OCR_LOADING_ANIMATION_TIMER =
    null;

let OCR_LOADING_FINISH_TIMER =
    null;

let OCR_LOADING_LAST_MESSAGE =
    "";

let OCR_SUBMISSION_EVENTS_BOUND =
    false;

const OCR_PROGRESS_CHECKPOINTS = [
    0,
    2,
    4,
    6,
    8,
    10,
    12,
    18,
    25,
    34,
    45,
    56,
    68,
    76,
    82,
    89,
    94,
    96,
    100
];

const OCR_PROGRESS_FAST_RATIO =
    0.70;

const OCR_PROGRESS_TICK_MS =
    60;

const OCR_PROGRESS_INITIAL_VELOCITY =
    0.025;

const OCR_PROGRESS_ACCELERATION =
    0.014;

const OCR_PROGRESS_MAX_FAST_VELOCITY =
    0.18;

const OCR_PROGRESS_MIN_CREEP_VELOCITY =
    0.006;

const OCR_PROGRESS_DECELERATION =
    0.90;

const OCR_PROGRESS_GATE_PADDING =
    0.08;

/* =========================================================
   LOADING UI
   ========================================================= */

function normalizeOcrProgress(
    progress
) {
    const numeric =
        Number(
            progress
        );

    if (
        !Number.isFinite(
            numeric
        )
    ) {
        return 0;
    }

    return Math.min(
        100,
        Math.max(
            0,
            numeric
        )
    );
}

function renderOcrLoading(
    progress,
    text = null
) {
    const loadingWrap =
        document.getElementById(
            "loadingWrap"
        );

    const loadingFill =
        document.getElementById(
            "loadingFill"
        );

    const loadingPercent =
        document.getElementById(
            "loadingPercent"
        );

    const loadingText =
        document.getElementById(
            "loadingText"
        );

    if (
        !loadingWrap
        || !loadingFill
        || !loadingPercent
        || !loadingText
    ) {
        return;
    }

    const normalizedProgress =
        normalizeOcrProgress(
            progress
        );

    OCR_LOADING_PROGRESS =
        normalizedProgress;

    loadingWrap.hidden =
        false;

    loadingFill.style.width =
        `${normalizedProgress}%`;

    loadingPercent.textContent =
        `${Math.round(
            normalizedProgress
        )}%`;

    if (
        text
    ) {
        OCR_LOADING_LAST_MESSAGE =
            String(
                text
            );

        loadingText.textContent =
            OCR_LOADING_LAST_MESSAGE;
    }
}

function getNextOcrProgressGate(
    confirmedProgress
) {
    const confirmed =
        normalizeOcrProgress(
            confirmedProgress
        );

    for (
        const checkpoint
        of OCR_PROGRESS_CHECKPOINTS
    ) {
        if (
            checkpoint > confirmed
        ) {
            return checkpoint;
        }
    }

    return 100;
}

function stopOcrLoadingAnimation() {
    if (
        OCR_LOADING_ANIMATION_TIMER
    ) {
        clearInterval(
            OCR_LOADING_ANIMATION_TIMER
        );

        OCR_LOADING_ANIMATION_TIMER =
            null;
    }
}

function clearOcrLoadingFinishTimer() {
    if (
        OCR_LOADING_FINISH_TIMER
    ) {
        clearTimeout(
            OCR_LOADING_FINISH_TIMER
        );

        OCR_LOADING_FINISH_TIMER =
            null;
    }
}

function calculateOcrProgressStep() {
    if (
        OCR_LOADING_PROGRESS >= 100
    ) {
        return 0;
    }

    const confirmed =
        OCR_LOADING_CONFIRMED_PROGRESS;

    const nextGate =
        OCR_LOADING_NEXT_GATE;

    if (
        nextGate <= 0
        || nextGate <= confirmed
    ) {
        return 0;
    }

    const checkpointDistance =
        nextGate
        - confirmed;

    const fastEnd =
        confirmed
        + (
            checkpointDistance
            * OCR_PROGRESS_FAST_RATIO
        );

    const visualCeiling =
        nextGate >= 100
            ? 99.92
            : nextGate
                - OCR_PROGRESS_GATE_PADDING;

    if (
        OCR_LOADING_PROGRESS >=
        visualCeiling
    ) {
        return 0;
    }

    if (
        OCR_LOADING_PROGRESS <
        confirmed
    ) {
        OCR_LOADING_VELOCITY =
            Math.min(
                OCR_PROGRESS_MAX_FAST_VELOCITY,
                Math.max(
                    OCR_LOADING_VELOCITY,
                    OCR_PROGRESS_INITIAL_VELOCITY
                )
                + OCR_PROGRESS_ACCELERATION
            );

        return Math.min(
            OCR_LOADING_VELOCITY,
            confirmed
            - OCR_LOADING_PROGRESS
        );
    }

    if (
        OCR_LOADING_PROGRESS <
        fastEnd
    ) {
        OCR_LOADING_VELOCITY =
            Math.min(
                OCR_PROGRESS_MAX_FAST_VELOCITY,
                Math.max(
                    OCR_LOADING_VELOCITY,
                    OCR_PROGRESS_INITIAL_VELOCITY
                )
                + OCR_PROGRESS_ACCELERATION
            );

        return Math.min(
            OCR_LOADING_VELOCITY,
            visualCeiling
            - OCR_LOADING_PROGRESS
        );
    }

    const remaining =
        visualCeiling
        - OCR_LOADING_PROGRESS;

    if (
        remaining <= 0
    ) {
        return 0;
    }

    OCR_LOADING_VELOCITY =
        Math.max(
            OCR_PROGRESS_MIN_CREEP_VELOCITY,
            OCR_LOADING_VELOCITY
            * OCR_PROGRESS_DECELERATION
        );

    const distanceLimitedStep =
        remaining
        * 0.075;

    return Math.min(
        remaining,
        OCR_LOADING_VELOCITY,
        Math.max(
            OCR_PROGRESS_MIN_CREEP_VELOCITY,
            distanceLimitedStep
        )
    );
}

function animateOcrLoadingStep() {
    const step =
        calculateOcrProgressStep();

    if (
        step <= 0
    ) {
        return;
    }

    renderOcrLoading(
        OCR_LOADING_PROGRESS
        + step
    );
}

function ensureOcrLoadingAnimation() {
    if (
        OCR_LOADING_ANIMATION_TIMER
    ) {
        return;
    }

    OCR_LOADING_ANIMATION_TIMER =
        setInterval(
            animateOcrLoadingStep,
            OCR_PROGRESS_TICK_MS
        );
}

function updateOcrLoading(
    progress,
    text = null
) {
    const normalizedProgress =
        normalizeOcrProgress(
            progress
        );

    if (
        normalizedProgress >
        OCR_LOADING_CONFIRMED_PROGRESS
    ) {
        OCR_LOADING_CONFIRMED_PROGRESS =
            normalizedProgress;

        OCR_LOADING_NEXT_GATE =
            getNextOcrProgressGate(
                OCR_LOADING_CONFIRMED_PROGRESS
            );

        OCR_LOADING_VELOCITY =
            Math.max(
                OCR_LOADING_VELOCITY,
                OCR_PROGRESS_INITIAL_VELOCITY
            );
    }

    if (
        text
    ) {
        renderOcrLoading(
            OCR_LOADING_PROGRESS,
            text
        );
    }

    if (
        normalizedProgress >= 100
    ) {
        return;
    }

    ensureOcrLoadingAnimation();
}

function showOcrLoading(
    text =
        "Submitting scoreboard..."
) {
    stopOcrLoadingAnimation();
    clearOcrLoadingFinishTimer();

    OCR_LOADING_PROGRESS =
        0;

    OCR_LOADING_CONFIRMED_PROGRESS =
        0;

    OCR_LOADING_NEXT_GATE =
        getNextOcrProgressGate(
            0
        );

    OCR_LOADING_VELOCITY =
        OCR_PROGRESS_INITIAL_VELOCITY;

    OCR_LOADING_LAST_MESSAGE =
        "";

    renderOcrLoading(
        0,
        text
    );

    ensureOcrLoadingAnimation();
}

function finishOcrLoading(
    success,
    text = null
) {
    const loadingWrap =
        document.getElementById(
            "loadingWrap"
        );

    clearOcrLoadingFinishTimer();

    if (
        success
    ) {
        stopOcrLoadingAnimation();

        OCR_LOADING_CONFIRMED_PROGRESS =
            100;

        OCR_LOADING_NEXT_GATE =
            100;

        OCR_LOADING_VELOCITY =
            0;

        renderOcrLoading(
            100,
            text
            || "Scoreboard scan completed."
        );
    }
    else {
        stopOcrLoadingAnimation();

        renderOcrLoading(
            OCR_LOADING_PROGRESS,
            text
            || "OCR processing stopped."
        );
    }

    if (
        loadingWrap
    ) {
        OCR_LOADING_FINISH_TIMER =
            setTimeout(
                function() {
                    if (
                        loadingWrap.isConnected
                    ) {
                        loadingWrap.hidden =
                            true;
                    }

                    OCR_LOADING_FINISH_TIMER =
                        null;
                },
                900
            );
    }
}

/* =========================================================
   JOB STAGE DISPLAY
   ========================================================= */

function getJobStageMessage(
    job
) {
    const status =
        String(
            job?.status
            || ""
        )
            .trim()
            .toLowerCase();

    const stage =
        String(
            job?.stage
            || ""
        )
            .trim()
            .toLowerCase();

    const providerMessage =
        String(
            job?.message
            || ""
        )
            .trim();

    if (
        providerMessage
    ) {
        return providerMessage;
    }

    if (
        status === "queued"
    ) {
        return "Scoreboard queued for processing...";
    }

    if (
        status === "completed"
    ) {
        return "Scoreboard scan completed.";
    }

    if (
        status === "failed"
    ) {
        return "Scoreboard processing failed.";
    }

    switch (
        stage
    ) {
        case "starting":
            return "Starting scoreboard reader...";

        case "loading_job":
            return "Loading your scoreboard...";

        case "preparing_image":
            return "Getting the pixels lined up...";

        case "building_request":
            return "Building the OCR request...";

        case "contacting_ocr":
            return "Waking up the scoreboard reader...";

        case "ocr":
            return "Crunching scoreboard pixels...";

        case "preflight":
            return "Checking for a Rocket League scoreboard...";

        case "normalization":
        case "normalized":
            return "Getting the scoreboard into formation...";

        case "headers":
            return "Reading scoreboard headers...";

        case "anchors":
            return "Finding the important bits...";

        case "rows":
            return "Lining up the players...";

        case "cells":
            return "Mapping the scoreboard values...";

        case "names":
            return "Reading who's on the pitch...";

        case "stats":
        case "numeric_matcher":
            return "Counting up the scoreboard...";

        case "numeric_tesseract":
            return "Double-checking scoreboard numbers...";

        case "numeric_paddle":
            return "Resolving the tricky values...";

        case "validation":
            return "Double-checking the numbers...";

        case "training_capture":
            return "Preparing the match for saving...";

        case "reconciliation":
            return "Sorting out the tricky bits...";

        case "saving":
            return "Saving the match...";

        case "finalizing":
            return "Putting the finishing touches on your scoreboard...";

        case "retry_pending":
            return "OCR processing will retry...";

        default:
            return (
                status === "processing"
                    ? "Reading scoreboard..."
                    : "Preparing OCR job..."
            );
    }
}

/* =========================================================
   JOB PROGRESS
   ========================================================= */

function getJobProgress(
    job
) {
    const totalImages =
        Number(
            job?.totalImages
        );

    const completedImages =
        Number(
            job?.completedImages
        );

    const currentImageProgress =
        Number(
            job?.currentImageProgress
        );

    if (
        Number.isFinite(
            totalImages
        )
        && totalImages > 0
        && Number.isFinite(
            completedImages
        )
        && Number.isFinite(
            currentImageProgress
        )
    ) {
        return Math.min(
            100,
            Math.max(
                0,
                (
                    (
                        completedImages
                        + (
                            currentImageProgress
                            / 100
                        )
                    )
                    / totalImages
                )
                * 100
            )
        );
    }

    const progress =
        Number(
            job?.progress
        );

    if (
        Number.isFinite(
            progress
        )
    ) {
        return Math.min(
            100,
            Math.max(
                0,
                progress
            )
        );
    }

    const status =
        String(
            job?.status
            || ""
        )
            .trim()
            .toLowerCase();

    if (
        status === "queued"
    ) {
        return 5;
    }

    if (
        status === "processing"
    ) {
        return 10;
    }

    if (
        status === "completed"
    ) {
        return 100;
    }

    return OCR_LOADING_PROGRESS;
}

/* =========================================================
   GLOBAL JOB PROGRESS EVENT
   ========================================================= */

function handleGlobalOcrJobProgress(
    event
) {
    const jobId =
        String(
            event?.detail?.jobId
            || ""
        )
            .trim()
            .toUpperCase();

    const job =
        event?.detail?.job
        || {};

    if (
        !/^[A-Z0-9]{16}$/.test(
            jobId
        )
    ) {
        return;
    }

    if (
        OCR_ACTIVE_JOB_ID
        && OCR_ACTIVE_JOB_ID !== jobId
    ) {
        return;
    }

    const progress =
        getJobProgress(
            job
        );

    const message =
        getJobStageMessage(
            job
        );

    updateOcrLoading(
        progress,
        message
    );
}

/* =========================================================
   ACTIVE JOB STORAGE
   ========================================================= */

function notifyGlobalJobWatcher(
    oldValue,
    newValue
) {
    try {
        window.dispatchEvent(
            new StorageEvent(
                "storage",
                {
                    key:
                        OCR_ACTIVE_JOB_KEY,
                    oldValue,
                    newValue,
                    storageArea:
                        localStorage,
                    url:
                        window.location.href
                }
            )
        );
    }
    catch (
        error
    ) {
        console.warn(
            "[OCR] Could not notify global OCR watcher.",
            error
        );
    }
}

function saveActiveOcrJob(
    jobId
) {
    OCR_ACTIVE_JOB_ID =
        String(
            jobId
            || ""
        )
            .trim()
            .toUpperCase();

    if (
        !OCR_ACTIVE_JOB_ID
    ) {
        return;
    }

    const reviewRoute =
        String(
            document.body
                ?.dataset
                ?.currentRoute
            || window.location.pathname
            || ""
        )
            .trim();

    try {
        const oldValue =
            localStorage.getItem(
                OCR_ACTIVE_JOB_KEY
            );

        localStorage.setItem(
            OCR_ACTIVE_JOB_KEY,
            OCR_ACTIVE_JOB_ID
        );

        if (
            reviewRoute
        ) {
            localStorage.setItem(
                OCR_ACTIVE_JOB_ROUTE_KEY,
                reviewRoute
            );
        }

        notifyGlobalJobWatcher(
            oldValue,
            OCR_ACTIVE_JOB_ID
        );
    }
    catch (
        error
    ) {
        console.error(
            "[OCR] Could not persist active job.",
            error
        );
    }
}

function getSavedActiveOcrJob() {
    try {
        return String(
            localStorage.getItem(
                OCR_ACTIVE_JOB_KEY
            )
            || ""
        )
            .trim()
            .toUpperCase();
    }
    catch (
        error
    ) {
        console.error(
            "[OCR] Could not restore active job.",
            error
        );

        return "";
    }
}

/* =========================================================
   JSON RESPONSE
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
   GET COMPLETED RESULT
   ========================================================= */

async function getOcrJobResult(
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
            || (
                "Unable to load completed OCR result. HTTP "
                + response.status
            )
        );
    }

    const result =
        (
            data?.matchReport
            && typeof data.matchReport
                === "object"
        )
            ? data.matchReport
            : (
                data?.result
                && typeof data.result
                    === "object"
                    ? data.result
                    : null
            );

    if (
        !result
    ) {
        throw new Error(
            "Completed OCR result was not returned."
        );
    }

    return {
        data,
        result
    };
}

/* =========================================================
   SCOREBOARD HELPERS
   ========================================================= */

function getOcrTeams(
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

function getOcrPlayerName(
    player
) {
    return String(
        player?.player
        || player?.matchedName
        || player?.username
        || player?.name
        || "Unknown Player"
    );
}

function getVisibleScoreboardFields(
    teams
) {
    const visibleFields =
        new Set();

    teams.forEach(
        function(
            team
        ) {
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
                    OCR_RESULT_FIELD_ORDER
                        .forEach(
                            function(
                                fieldName
                            ) {
                                if (
                                    player?.[
                                        fieldName
                                    ] !== null
                                    && typeof player?.[
                                        fieldName
                                    ] !== "undefined"
                                ) {
                                    visibleFields.add(
                                        fieldName
                                    );
                                }
                            }
                        );
                }
            );
        }
    );

    return OCR_RESULT_FIELD_ORDER
        .filter(
            function(
                fieldName
            ) {
                return visibleFields.has(
                    fieldName
                );
            }
        );
}

function getOcrEditLockState() {
    const policy =
        Reflect.get(
            window,
            "OCRReviewPolicy"
        );

    if (
        !policy
        || typeof policy.areEditsLocked
            !== "function"
    ) {
        return false;
    }

    return (
        policy.areEditsLocked()
        === true
    );
}

/* =========================================================
   SCOREBOARD RESULT TABLE
   ========================================================= */

function renderOcrResultTable(
    result
) {
    if (
        !resultsSummary
    ) {
        return;
    }

    resultsSummary
        .replaceChildren();

    const teams =
        getOcrTeams(
            result
        );

    const fields =
        getVisibleScoreboardFields(
            teams
        );

    const editsLocked =
        getOcrEditLockState();

    teams.forEach(
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

            const section =
                document.createElement(
                    "section"
                );

            section.className =
                "ocr-scoreboard-team";

            const title =
                document.createElement(
                    "h3"
                );

            title.className =
                "ocr-scoreboard-team-title";

            title.textContent =
                `TEAM ${teamIndex}`;

            const wrapper =
                document.createElement(
                    "div"
                );

            wrapper.className =
                "ocr-review-table-wrap";

            const table =
                document.createElement(
                    "table"
                );

            table.className =
                "ocr-review-table ocr-scoreboard-table";

            const head =
                document.createElement(
                    "thead"
                );

            const headRow =
                document.createElement(
                    "tr"
                );

            const playerHeader =
                document.createElement(
                    "th"
                );

            playerHeader.textContent =
                "Player";

            headRow.appendChild(
                playerHeader
            );

            fields.forEach(
                function(
                    fieldName
                ) {
                    const header =
                        document.createElement(
                            "th"
                        );

                    header.textContent =
                        (
                            fieldName
                                .charAt(
                                    0
                                )
                                .toUpperCase()
                            + fieldName.slice(
                                1
                            )
                        );

                    headRow.appendChild(
                        header
                    );
                }
            );

            head.appendChild(
                headRow
            );

            table.appendChild(
                head
            );

            const body =
                document.createElement(
                    "tbody"
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
                    const row =
                        document.createElement(
                            "tr"
                        );

                    row.className =
                        "ocr-review-row";

                    const playerName =
                        getOcrPlayerName(
                            player
                        );

                    const playerCell =
                        document.createElement(
                            "td"
                        );

                    playerCell.textContent =
                        playerName;

                    row.appendChild(
                        playerCell
                    );

                    fields.forEach(
                        function(
                            fieldName
                        ) {
                            const cell =
                                document.createElement(
                                    "td"
                                );

                            const input =
                                document.createElement(
                                    "input"
                                );

                            const value =
                                (
                                    player?.[
                                        fieldName
                                    ]
                                    ?? (
                                        fieldName
                                        === "ping"
                                            ? 0
                                            : ""
                                    )
                                );

                            input.type =
                                "number";

                            input.step =
                                "1";

                            input.min =
                                "0";

                            input.inputMode =
                                "numeric";

                            input.className =
                                "ocr-review-value-input";

                            input.value =
                                String(
                                    value
                                );

                            input.dataset.team =
                                String(
                                    teamIndex
                                );

                            input.dataset.player =
                                playerName;

                            input.dataset.field =
                                fieldName;

                            input.dataset.originalValue =
                                String(
                                    value
                                );

                            input.readOnly =
                                editsLocked;

                            input.addEventListener(
                                "input",
                                function() {
                                    const changed =
                                        (
                                            input.value
                                                .trim()
                                            !== String(
                                                input.dataset
                                                    .originalValue
                                                ?? ""
                                            )
                                        );

                                    row.classList.toggle(
                                        "ocr-review-row-disputed",
                                        changed
                                    );

                                    document.dispatchEvent(
                                        new CustomEvent(
                                            "ocr:review-value-changed"
                                        )
                                    );
                                }
                            );

                            cell.appendChild(
                                input
                            );

                            row.appendChild(
                                cell
                            );
                        }
                    );

                    body.appendChild(
                        row
                    );
                }
            );

            table.appendChild(
                body
            );

            wrapper.appendChild(
                table
            );

            section.append(
                title,
                wrapper
            );

            resultsSummary.appendChild(
                section
            );
        }
    );

    document.dispatchEvent(
        new CustomEvent(
            "ocr:review-table-rendered",
            {
                detail: {
                    result
                }
            }
        )
    );
}

/* =========================================================
   RESULT MODAL
   ========================================================= */

function renderOcrResult(
    result,
    jobId,
    matchId
) {
    if (
        !results
        || !resultsSummary
    ) {
        console.error(
            "[OCR] Results UI was not found."
        );

        return;
    }

    renderOcrResultTable(
        result
    );

    if (
        resultsOutput
    ) {
        resultsOutput.textContent =
            "";

        resultsOutput.hidden =
            true;
    }

    document.dispatchEvent(
        new CustomEvent(
            "ocrtesting:result-rendered",
            {
                detail: {
                    jobId:
                        String(
                            jobId
                            || ""
                        )
                            .trim()
                            .toUpperCase(),
                    matchId:
                        String(
                            matchId
                            || result?.matchId
                            || ""
                        )
                            .trim()
                            .toUpperCase(),
                    result
                }
            }
        )
    );

    if (
        typeof results.showModal
            === "function"
    ) {
        if (
            !results.open
        ) {
            results.showModal();
        }

        return;
    }

    results.setAttribute(
        "open",
        ""
    );
}

/* =========================================================
   CROP RETRY
   ========================================================= */

function shouldOfferCropRetry(
    data
) {
    const failureStage =
        String(
            data?.failureStage
            || data?.stage
            || data?.error?.stage
            || ""
        )
            .trim()
            .toLowerCase();

    if (
        [
            "normalization",
            "headers",
            "anchors",
            "rows",
            "cells",
            "preflight",
            "alignment",
            "localization"
        ].includes(
            failureStage
        )
    ) {
        return true;
    }

    const message =
        String(
            data?.message
            || data?.error?.message
            || ""
        )
            .toLowerCase();

    return (
        message.includes(
            "scoreboard"
        )
        && (
            message.includes(
                "locat"
            )
            || message.includes(
                "align"
            )
            || message.includes(
                "geometry"
            )
            || message.includes(
                "row"
            )
            || message.includes(
                "header"
            )
        )
    );
}

/* =========================================================
   GLOBAL COMPLETED EVENT
   ========================================================= */

function handleGlobalOcrJobCompleted(
    event
) {
    const jobId =
        String(
            event?.detail?.jobId
            || ""
        )
            .trim()
            .toUpperCase();

    const job =
        event?.detail?.job
        || {};

    if (
        !/^[A-Z0-9]{16}$/.test(
            jobId
        )
    ) {
        return;
    }

    if (
        OCR_ACTIVE_JOB_ID
        && OCR_ACTIVE_JOB_ID !== jobId
    ) {
        return;
    }

    OCR_ACTIVE_JOB_ID =
        "";

    finishOcrLoading(
        true,
        "Scoreboard scan completed."
    );

    setStatus(
        "Image upload complete. Click the completion notification to review the scoreboard."
    );

    setOcrControlsLocked(
        false
    );

    savePageState();

    const matchId =
        String(
            event?.detail?.matchId
            || job?.matchId
            || ""
        )
            .trim()
            .toUpperCase();

    document.dispatchEvent(
        new CustomEvent(
            "ocr:successful-result",
            {
                detail: {
                    jobId,
                    matchId,
                    usedCrop:
                        Boolean(
                            cropFallbackVisible
                        )
                }
            }
        )
    );
}

/* =========================================================
   GLOBAL FAILED EVENT
   ========================================================= */

function handleGlobalOcrJobFailed(
    event
) {
    const job =
        event?.detail?.job
        || {};

    OCR_ACTIVE_JOB_ID =
        "";

    const message =
        String(
            job?.error?.message
            || job?.message
            || "OCR processing failed."
        );

    finishOcrLoading(
        false,
        "OCR processing failed."
    );

    if (
        !cropFallbackVisible
        && shouldOfferCropRetry(
            job
        )
    ) {
        showCropFallback(
            "The full-image scan could not reliably locate the scoreboard. Adjust the green crop box around the scoreboard, then press Read Scoreboard again."
        );

        setOcrControlsLocked(
            false
        );

        return;
    }

    setStatus(
        `FAIL: ${message}`
    );

    setOcrControlsLocked(
        false
    );
}

/* =========================================================
   OPEN PENDING REVIEW
   ========================================================= */

async function handlePendingReviewOpen(
    event
) {
    const jobId =
        String(
            event?.detail?.jobId
            || ""
        )
            .trim()
            .toUpperCase();

    if (
        !/^[A-Z0-9]{16}$/.test(
            jobId
        )
    ) {
        return;
    }

    try {
        const completed =
            await getOcrJobResult(
                jobId
            );

        const result =
            completed.result;

        const matchId =
            String(
                event?.detail?.matchId
                || result?.matchId
                || ""
            )
                .trim()
                .toUpperCase();

        renderOcrResult(
            result,
            jobId,
            matchId
        );
    }
    catch (
        error
    ) {
        console.error(
            "[OCR] Pending scoreboard could not be restored.",
            error
        );

        setStatus(
            "The completed scoreboard could not be loaded. Please try again."
        );
    }
}

/* =========================================================
   SUBMIT
   ========================================================= */

async function submitScoreboard(
    event
) {
    event?.preventDefault();

    if (
        !sourceImage
    ) {
        setStatus(
            "FAIL: No image loaded."
        );

        return;
    }

    if (
        ocrControlsLocked
    ) {
        return;
    }

    const playerNameValidation =
        validateExpectedPlayerNames();

    if (
        !playerNameValidation.valid
    ) {
        setStatus(
            (
                "FAIL: "
                + playerNameValidation
                    .message
            )
        );

        return;
    }

    if (
        !matchSize
    ) {
        setStatus(
            "FAIL: Match size is unavailable."
        );

        return;
    }

    const playersPerTeam =
        Number(
            matchSize.value
        );

    const expectedPlayerNames =
        playerNameValidation.names;

    const usingCrop =
        cropFallbackVisible;

    setOcrControlsLocked(
        true
    );

    showOcrLoading(
        usingCrop
            ? "Uploading selected scoreboard crop..."
            : "Uploading scoreboard..."
    );

    setStatus(
        usingCrop
            ? "Submitting selected scoreboard crop..."
            : "Submitting full uploaded image..."
    );

    try {
        const blob =
            usingCrop
                ? await createScoreboardCropBlob()
                : await getOriginalImageBlob();

        if (
            !(blob instanceof Blob)
        ) {
            throw new Error(
                "Prepared scoreboard image is not a valid Blob."
            );
        }

        if (
            blob.size <= 0
        ) {
            throw new Error(
                "Prepared scoreboard image is empty."
            );
        }

        const uploadFileName =
            usingCrop
                ? (
                    sourceFileName
                        .replace(
                            /\.[^.]+$/,
                            ""
                        )
                    + "_crop.png"
                )
                : sourceFileName;

        const uploadFile =
            blob instanceof File
                ? blob
                : new File(
                    [
                        blob
                    ],
                    uploadFileName,
                    {
                        type:
                            blob.type
                            || "image/png"
                    }
                );

        const formData =
            new FormData();

        formData.set(
            "image",
            uploadFile
        );

        formData.set(
            "playersPerTeam",
            String(
                playersPerTeam
            )
        );

        formData.set(
            "expectedPlayerNames",
            JSON.stringify(
                expectedPlayerNames
            )
        );

        formData.set(
            "matchType",
            `${playersPerTeam}v${playersPerTeam}`
        );

        formData.set(
            "submissionMode",
            usingCrop
                ? "manual_crop_retry"
                : "original_image"
        );

        const response =
            await fetch(
                OCR_JOB_SUBMIT_URL,
                {
                    method:
                        "POST",
                    body:
                        formData,
                    credentials:
                        "same-origin",
                    cache:
                        "no-store"
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
                || (
                    "OCR job submission failed. HTTP "
                    + response.status
                )
            );
        }

        const jobId =
            String(
                data?.jobId
                || ""
            )
                .trim()
                .toUpperCase();

        if (
            !/^[A-Z0-9]{16}$/.test(
                jobId
            )
        ) {
            throw new Error(
                "OCR server did not return a valid jobId."
            );
        }

        OCR_ACTIVE_JOB_ID =
            jobId;

        saveActiveOcrJob(
            jobId
        );

        updateOcrLoading(
            Math.max(
                5,
                Number(
                    data?.progress
                ) || 0
            ),
            "Scoreboard queued for processing..."
        );

        setStatus(
            "Scoreboard uploaded. OCR is processing in the background."
        );

        savePageState();
    }
    catch (
        error
    ) {
        console.error(
            "[OCR SUBMIT] ERROR:",
            error
        );

        finishOcrLoading(
            false,
            "OCR submission failed."
        );

        setStatus(
            (
                "FAIL: "
                + (
                    error?.message
                    || "OCR submission failed."
                )
            )
        );

        setOcrControlsLocked(
            false
        );
    }
}

/* =========================================================
   RESTORE ACTIVE JOB UI
   ========================================================= */

function restoreActiveOcrJob() {
    const jobId =
        getSavedActiveOcrJob();

    if (
        !jobId
    ) {
        return;
    }

    if (
        !/^[A-Z0-9]{16}$/.test(
            jobId
        )
    ) {
        return;
    }

    OCR_ACTIVE_JOB_ID =
        jobId;

    setOcrControlsLocked(
        true
    );

    showOcrLoading(
        "Restoring OCR job..."
    );

    setStatus(
        "Restoring active scoreboard scan..."
    );

    notifyGlobalJobWatcher(
        jobId,
        jobId
    );
}

/* =========================================================
   EVENTS
   ========================================================= */

function bindOcrSubmissionEvents() {
    if (
        OCR_SUBMISSION_EVENTS_BOUND
    ) {
        return;
    }

    document.addEventListener(
        "ocr:job-progress",
        handleGlobalOcrJobProgress
    );

    document.addEventListener(
        "ocr:job-completed",
        handleGlobalOcrJobCompleted
    );

    document.addEventListener(
        "ocr:job-failed",
        handleGlobalOcrJobFailed
    );

    document.addEventListener(
        "ocr:pending-review-open",
        handlePendingReviewOpen
    );

    OCR_SUBMISSION_EVENTS_BOUND =
        true;
}

/* =========================================================
   INITIALIZATION
   ========================================================= */

function initializeOcrSubmission() {
    if (
        OCR_CORE_READY !== true
    ) {
        console.error(
            "[OCR] Core is not initialized. Submission cannot start."
        );

        return false;
    }

    if (
        !submitBtn
    ) {
        console.error(
            "[OCR] Submit button was not found."
        );

        return false;
    }

    stopOcrLoadingAnimation();
    clearOcrLoadingFinishTimer();

    OCR_LOADING_PROGRESS =
        0;

    OCR_LOADING_CONFIRMED_PROGRESS =
        0;

    OCR_LOADING_NEXT_GATE =
        0;

    OCR_LOADING_VELOCITY =
        0;

    OCR_LOADING_LAST_MESSAGE =
        "";

    OCR_ACTIVE_JOB_ID =
        "";

    bindOcrSubmissionEvents();

    if (
        submitBtn.dataset
            .ocrSubmissionInitialized
        !== "true"
    ) {
        submitBtn.addEventListener(
            "click",
            submitScoreboard
        );

        submitBtn.dataset
            .ocrSubmissionInitialized =
            "true";
    }

    restoreActiveOcrJob();
    restoreRequestedOcrReview();

    return true;
}

window.initializeOcrSubmission =
    initializeOcrSubmission;