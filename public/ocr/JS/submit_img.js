"use strict";

/* =========================================================
   BPD GAMING NETWORK
   OCR IMAGE SUBMISSION
   ========================================================= */

(function() {
    if (
        !window.BPDOcrApi
    ) {
        throw new Error(
            "OCR API dependencies were not initialized."
        );
    }

    const {
        OCR_JOB_SUBMIT_URL,
        OCR_JOB_RESULT_URL,
        apiFetch
    } = window.BPDOcrApi;

    const OCR_SUBMISSION_VERSION =
        "ocr-submission-1.6";

    const OCR_REVIEW_OPEN_REQUEST_KEY =
        "rocketLeagueOcrReviewOpenRequestV1";

    const OCR_FAILURE_OPEN_REQUEST_KEY =
        "rocketLeagueOcrFailureOpenRequestV1";

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

    /* =========================================================
       PROGRESS CONFIGURATION
       ========================================================= */

    const OCR_PROGRESS_TICK_MS =
        60;

    const OCR_PROGRESS_INITIAL_VELOCITY =
        0.035;

    const OCR_PROGRESS_ACCELERATION =
        0.012;

    const OCR_PROGRESS_MAX_VELOCITY =
        0.38;

    const OCR_PROGRESS_MIN_VELOCITY =
        0.015;

    const OCR_PROGRESS_DISTANCE_RATIO =
        0.08;

    const OCR_PROGRESS_PROCESSING_MAX =
        95;

    const OCR_PROGRESS_COMPLETE =
        100;

    let OCR_ACTIVE_JOB_ID =
        "";

    let OCR_LOADING_PROGRESS =
        0;

    let OCR_LOADING_TARGET_PROGRESS =
        0;

    let OCR_LOADING_CONFIRMED_PROGRESS =
        0;

    let OCR_LOADING_SIMULATED_PROGRESS =
        0;

    let OCR_LOADING_VELOCITY =
        0;

    let OCR_LOADING_ANIMATION_TIMER =
        null;

    let OCR_LOADING_FINISH_TIMER =
        null;

    let OCR_LOADING_LAST_MESSAGE =
        "";

    let OCR_LOADING_STAGE =
        "";

    let OCR_LOADING_SOURCE =
        "stored";

    let OCR_SUBMISSION_EVENTS_BOUND =
        false;

    /* =========================================================
       PROGRESS NORMALIZATION
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
            OCR_PROGRESS_COMPLETE,
            Math.max(
                0,
                numeric
            )
        );
    }

    function getSafeProcessingProgress(
        progress
    ) {
        return Math.min(
            OCR_PROGRESS_PROCESSING_MAX,
            normalizeOcrProgress(
                progress
            )
        );
    }

    function getHighestProgressValue(
        values
    ) {
        let highest =
            0;

        values.forEach(
            function(
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
                    return;
                }

                highest =
                    Math.max(
                        highest,
                        normalizeOcrProgress(
                            numeric
                        )
                    );
            }
        );

        return highest;
    }

    /* =========================================================
       PROGRESS MESSAGE
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
                return "Connecting to Image Scanner...";

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
            case "numeric_prepare":
            case "numeric_matcher":
                return "Counting up the scoreboard...";

            case "numeric_tesseract":
                return "Double-checking scoreboard numbers...";

            case "numeric_resolution":
                return "Resolving scoreboard values...";

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

    function getProgressMessage(
        detail,
        job
    ) {
        const eventMessage =
            String(
                detail?.message
                || ""
            )
                .trim();

        const eventStage =
            String(
                detail?.stage
                || job?.stage
                || ""
            )
                .trim()
                .toLowerCase();

        const source =
            String(
                detail?.progressSource
                || detail?.source
                || ""
            )
                .trim()
                .toLowerCase();

        if (
            source === "simulated"
            && eventStage
        ) {
            return getJobStageMessage({
                ...job,
                stage:
                    eventStage
            });
        }

        if (
            eventMessage
        ) {
            return eventMessage;
        }

        return getJobStageMessage({
            ...job,
            stage:
                eventStage
                || job?.stage
        });
    }

    /* =========================================================
       LOADING UI
       ========================================================= */

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
            text !== null
            && typeof text !==
                "undefined"
        ) {
            const normalizedText =
                String(
                    text
                    || ""
                )
                    .trim();

            if (
                normalizedText
            ) {
                OCR_LOADING_LAST_MESSAGE =
                    normalizedText;

                loadingText.textContent =
                    normalizedText;
            }
        }
    }

    function stopOcrLoadingAnimation() {
        if (
            !OCR_LOADING_ANIMATION_TIMER
        ) {
            return;
        }

        clearInterval(
            OCR_LOADING_ANIMATION_TIMER
        );

        OCR_LOADING_ANIMATION_TIMER =
            null;
    }

    function clearOcrLoadingFinishTimer() {
        if (
            !OCR_LOADING_FINISH_TIMER
        ) {
            return;
        }

        clearTimeout(
            OCR_LOADING_FINISH_TIMER
        );

        OCR_LOADING_FINISH_TIMER =
            null;
    }

    /* =========================================================
       DYNAMIC PROGRESS TARGET
       ========================================================= */

    function setOcrProgressTarget(
        progress
    ) {
        const normalizedProgress =
            getSafeProcessingProgress(
                progress
            );

        if (
            normalizedProgress <=
            OCR_LOADING_TARGET_PROGRESS
        ) {
            return false;
        }

        OCR_LOADING_TARGET_PROGRESS =
            normalizedProgress;

        OCR_LOADING_VELOCITY =
            Math.max(
                OCR_LOADING_VELOCITY,
                OCR_PROGRESS_INITIAL_VELOCITY
            );

        return true;
    }

    function calculateOcrProgressStep() {
        const remaining =
            OCR_LOADING_TARGET_PROGRESS
            - OCR_LOADING_PROGRESS;

        if (
            remaining <= 0
        ) {
            OCR_LOADING_VELOCITY =
                OCR_PROGRESS_INITIAL_VELOCITY;

            return 0;
        }

        OCR_LOADING_VELOCITY =
            Math.min(
                OCR_PROGRESS_MAX_VELOCITY,
                Math.max(
                    OCR_PROGRESS_MIN_VELOCITY,
                    OCR_LOADING_VELOCITY
                    + OCR_PROGRESS_ACCELERATION
                )
            );

        const distanceStep =
            Math.max(
                OCR_PROGRESS_MIN_VELOCITY,
                remaining
                * OCR_PROGRESS_DISTANCE_RATIO
            );

        return Math.min(
            remaining,
            OCR_LOADING_VELOCITY,
            distanceStep
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
            Math.min(
                OCR_LOADING_TARGET_PROGRESS,
                OCR_LOADING_PROGRESS
                + step
            )
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

    /* =========================================================
       HYBRID PROGRESS INPUT
       ========================================================= */

    function updateOcrLoadingFromProgress(
        {
            progress,
            confirmedProgress,
            simulatedProgress,
            progressSource,
            stage,
            message
        }
    ) {
        const normalizedProgress =
            getSafeProcessingProgress(
                progress
            );

        const normalizedConfirmed =
            getSafeProcessingProgress(
                confirmedProgress
            );

        const normalizedSimulated =
            getSafeProcessingProgress(
                simulatedProgress
            );

        OCR_LOADING_CONFIRMED_PROGRESS =
            Math.max(
                OCR_LOADING_CONFIRMED_PROGRESS,
                normalizedConfirmed
            );

        OCR_LOADING_SIMULATED_PROGRESS =
            Math.max(
                OCR_LOADING_SIMULATED_PROGRESS,
                normalizedSimulated
            );

        OCR_LOADING_SOURCE =
            String(
                progressSource
                || OCR_LOADING_SOURCE
                || "stored"
            )
                .trim()
                .toLowerCase();

        OCR_LOADING_STAGE =
            String(
                stage
                || OCR_LOADING_STAGE
                || ""
            )
                .trim()
                .toLowerCase();

        const target =
            getHighestProgressValue([
                normalizedProgress,
                OCR_LOADING_CONFIRMED_PROGRESS,
                OCR_LOADING_SIMULATED_PROGRESS
            ]);

        setOcrProgressTarget(
            target
        );

        if (
            message
        ) {
            renderOcrLoading(
                OCR_LOADING_PROGRESS,
                message
            );
        }

        ensureOcrLoadingAnimation();
    }

    function updateOcrLoading(
        progress,
        text = null
    ) {
        updateOcrLoadingFromProgress({
            progress,
            confirmedProgress:
                progress,
            simulatedProgress:
                0,
            progressSource:
                "stored",
            stage:
                OCR_LOADING_STAGE,
            message:
                text
        });
    }

    function showOcrLoading(
        text =
            "Submitting scoreboard..."
    ) {
        stopOcrLoadingAnimation();
        clearOcrLoadingFinishTimer();

        OCR_LOADING_PROGRESS =
            0;

        OCR_LOADING_TARGET_PROGRESS =
            0;

        OCR_LOADING_CONFIRMED_PROGRESS =
            0;

        OCR_LOADING_SIMULATED_PROGRESS =
            0;

        OCR_LOADING_VELOCITY =
            OCR_PROGRESS_INITIAL_VELOCITY;

        OCR_LOADING_LAST_MESSAGE =
            "";

        OCR_LOADING_STAGE =
            "";

        OCR_LOADING_SOURCE =
            "stored";

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
        stopOcrLoadingAnimation();

        if (
            success
        ) {
            OCR_LOADING_TARGET_PROGRESS =
                OCR_PROGRESS_COMPLETE;

            OCR_LOADING_CONFIRMED_PROGRESS =
                OCR_PROGRESS_COMPLETE;

            OCR_LOADING_SIMULATED_PROGRESS =
                OCR_PROGRESS_COMPLETE;

            OCR_LOADING_PROGRESS =
                OCR_PROGRESS_COMPLETE;

            OCR_LOADING_VELOCITY =
                0;

            renderOcrLoading(
                OCR_PROGRESS_COMPLETE,
                text
                || "Scoreboard scan completed."
            );
        }
        else {
            OCR_LOADING_VELOCITY =
                0;

            renderOcrLoading(
                OCR_LOADING_PROGRESS,
                text
                || "OCR processing stopped."
            );
        }

        if (
            !loadingWrap
        ) {
            return;
        }

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

    /* =========================================================
       RESTORE REQUESTS
       ========================================================= */

    function restoreRequestedOcrReview() {
        let pending =
            null;

        try {
            pending =
                JSON.parse(
                    sessionStorage.getItem(
                        OCR_REVIEW_OPEN_REQUEST_KEY
                    )
                    || "null"
                );

            sessionStorage.removeItem(
                OCR_REVIEW_OPEN_REQUEST_KEY
            );
        }
        catch (
            error
        ) {
            console.error(
                "[OCR] Could not restore requested OCR review.",
                error
            );

            return;
        }

        if (
            !pending
            || typeof pending !==
                "object"
            || Array.isArray(
                pending
            )
        ) {
            return;
        }

        const jobId =
            String(
                pending?.jobId
                || ""
            )
                .trim()
                .toUpperCase();

        if (
            !/^[A-Z0-9]{16}$/.test(
                jobId
            )
        ) {
            console.warn(
                "[OCR] Ignoring invalid restored OCR review request."
            );

            return;
        }

        void handlePendingReviewOpen({
            detail: {
                ...pending,
                jobId
            }
        });
    }

    function restoreRequestedOcrFailure() {
        let detail =
            null;

        try {
            detail =
                JSON.parse(
                    sessionStorage.getItem(
                        OCR_FAILURE_OPEN_REQUEST_KEY
                    )
                    || "null"
                );

            sessionStorage.removeItem(
                OCR_FAILURE_OPEN_REQUEST_KEY
            );
        }
        catch (
            error
        ) {
            console.error(
                "[OCR] Could not restore requested OCR failure.",
                error
            );

            return;
        }

        if (
            !detail
            || typeof detail !==
                "object"
            || Array.isArray(
                detail
            )
        ) {
            return;
        }

        handleOcrFailureOpen({
            detail
        });
    }

    /* =========================================================
       FAILURE DETAIL
       ========================================================= */

    function handleOcrFailureOpen(
        event
    ) {
        const message =
            String(
                event?.detail?.message
                || event?.detail?.job
                    ?.error
                    ?.message
                || event?.detail?.job
                    ?.message
                || "The scoreboard could not be processed."
            )
                .trim();

        setOcrControlsLocked(
            false
        );

        setStatus(
            "FAIL: "
            + message
        );
    }

    /* =========================================================
       JOB PROGRESS FALLBACK
       ========================================================= */

    function getJobProgress(
        job
    ) {
        const progress =
            Number(
                job?.progress
            );

        const confirmedProgress =
            Number(
                job?.confirmedProgress
            );

        const simulatedProgress =
            Number(
                job?.simulatedProgress
            );

        const highest =
            getHighestProgressValue([
                progress,
                confirmedProgress,
                simulatedProgress
            ]);

        if (
            highest > 0
        ) {
            return highest;
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
            return OCR_PROGRESS_COMPLETE;
        }

        return OCR_LOADING_TARGET_PROGRESS;
    }

    /* =========================================================
       GLOBAL JOB PROGRESS
       ========================================================= */

    function handleGlobalOcrJobProgress(
        event
    ) {
        const detail =
            event?.detail
            || {};

        const jobId =
            String(
                detail?.jobId
                || ""
            )
                .trim()
                .toUpperCase();

        const job =
            detail?.job
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
            && OCR_ACTIVE_JOB_ID !==
                jobId
        ) {
            return;
        }

        const progress =
            Number.isFinite(
                Number(
                    detail?.progress
                )
            )
                ? Number(
                    detail.progress
                )
                : getJobProgress(
                    job
                );

        const confirmedProgress =
            Number.isFinite(
                Number(
                    detail?.confirmedProgress
                )
            )
                ? Number(
                    detail.confirmedProgress
                )
                : Number(
                    job?.confirmedProgress
                );

        const simulatedProgress =
            Number.isFinite(
                Number(
                    detail?.simulatedProgress
                )
            )
                ? Number(
                    detail.simulatedProgress
                )
                : Number(
                    job?.simulatedProgress
                );

        const stage =
            String(
                detail?.stage
                || job?.stage
                || ""
            )
                .trim()
                .toLowerCase();

        const progressSource =
            String(
                detail?.progressSource
                || job?.progressSource
                || ""
            )
                .trim()
                .toLowerCase();

        const message =
            getProgressMessage(
                {
                    ...detail,
                    stage,
                    progressSource
                },
                job
            );

        updateOcrLoadingFromProgress({
            progress,
            confirmedProgress,
            simulatedProgress,
            progressSource,
            stage,
            message
        });
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
       REVIEW FIELD STATE
       ========================================================= */

    function getOcrReviewFields(
        player
    ) {
        if (
            player?.reviewFields
            && typeof player.reviewFields ===
                "object"
            && !Array.isArray(
                player.reviewFields
            )
        ) {
            return player.reviewFields;
        }

        return {};
    }

    function getOcrFieldReviewState(
        player,
        fieldName
    ) {
        const reviewFields =
            getOcrReviewFields(
                player
            );

        const reviewField =
            reviewFields[
                fieldName
            ];

        if (
            reviewField
            && typeof reviewField ===
                "object"
        ) {
            return {
                value:
                    reviewField.value
                    ?? player?.[
                        fieldName
                    ]
                    ?? "",

                confidence:
                    Number(
                        reviewField.confidence
                    )
                    || 0,

                requiresVerification:
                    reviewField
                        .requiresVerification ===
                    true,

                warning:
                    reviewField.warning
                    || null,

                reason:
                    reviewField.reason
                    || null
            };
        }

        return {
            value:
                player?.[
                    fieldName
                ]
                ?? "",

            confidence:
                1,

            requiresVerification:
                false,

            warning:
                null,

            reason:
                null
        };
    }

    /* =========================================================
       GET COMPLETED RESULT
       ========================================================= */

    async function getOcrJobResult(
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
                && typeof data.matchReport ===
                    "object"
            )
                ? data.matchReport
                : (
                    data?.result
                    && typeof data.result ===
                        "object"
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
                        const reviewFields =
                            getOcrReviewFields(
                                player
                            );

                        OCR_RESULT_FIELD_ORDER
                            .forEach(
                                function(
                                    fieldName
                                ) {
                                    const directValue =
                                        player?.[
                                            fieldName
                                        ];

                                    const reviewValue =
                                        reviewFields?.[
                                            fieldName
                                        ]?.value;

                                    if (
                                        (
                                            directValue !==
                                                null
                                            && typeof directValue !==
                                                "undefined"
                                        )
                                        || (
                                            reviewValue !==
                                                null
                                            && typeof reviewValue !==
                                                "undefined"
                                        )
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
            || typeof policy.areEditsLocked !==
                "function"
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

                                const fieldState =
                                    getOcrFieldReviewState(
                                        player,
                                        fieldName
                                    );

                                const value =
                                    (
                                        fieldState.value
                                        ?? (
                                            fieldName ===
                                                "ping"
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

                                input.dataset.requiresVerification =
                                    String(
                                        fieldState
                                            .requiresVerification
                                    );

                                input.readOnly =
                                    editsLocked;

                                if (
                                    fieldState
                                        .requiresVerification
                                ) {
                                    cell.classList.add(
                                        "ocr-review-cell-needs-review"
                                    );

                                    row.classList.add(
                                        "ocr-review-row-needs-review"
                                    );

                                    input.title =
                                        String(
                                            fieldState.reason
                                            || fieldState.warning
                                            || "This OCR value needs review."
                                        );
                                }
                                else {
                                    cell.classList.add(
                                        "ocr-review-cell-high-confidence"
                                    );
                                }

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
                JSON.stringify(
                    result,
                    null,
                    2
                );

            resultsOutput.hidden =
                false;
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
            typeof results.showModal ===
                "function"
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

    function closeOcrResultsDialog() {
        if (
            !results
        ) {
            return;
        }

        if (
            typeof results.close ===
                "function"
            && results.open
        ) {
            results.close();

            return;
        }

        results.removeAttribute(
            "open"
        );
    }

    function handleOcrResultsConfirmed(
        event
    ) {
        closeOcrResultsDialog();

        if (
            event?.detail?.automatic !==
            true
        ) {
            setStatus(
                "Scoreboard confirmed."
            );
        }

        setOcrControlsLocked(
            false
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
       COMPLETED
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
            && OCR_ACTIVE_JOB_ID !==
                jobId
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
            "Scoreboard processing complete. Review the returned values before confirming."
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
       FAILED
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
                || event?.detail?.message
                || "OCR processing failed."
            )
                .trim();

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
       OPEN REVIEW
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
            setStatus(
                "Loading scoreboard review..."
            );

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

            setStatus(
                "Scoreboard loaded for review."
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
                "FAIL: "
                + (
                    error?.message
                    || "The completed scoreboard could not be loaded."
                )
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

        console.log(
            "[OCR SUBMIT] Read Scoreboard pressed."
        );

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

        setStatus(
            "Reviewing image..."
        );

        const playerNameValidation =
            validateExpectedPlayerNames();

        if (
            !playerNameValidation.valid
        ) {
            setStatus(
                "FAIL: "
                + playerNameValidation
                    .message
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
                await apiFetch(
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
                || data?.success !==
                    true
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

            const submittedProgress =
                normalizeOcrProgress(
                    Number(
                        data?.progress
                    )
                    || 0
                );

            updateOcrLoadingFromProgress({
                progress:
                    submittedProgress,
                confirmedProgress:
                    submittedProgress,
                simulatedProgress:
                    0,
                progressSource:
                    "real",
                stage:
                    String(
                        data?.stage
                        || "queued"
                    ),
                message:
                    String(
                        data?.message
                        || "Scoreboard queued for processing..."
                    )
            });

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
                "FAIL: "
                + (
                    error?.message
                    || "OCR submission failed."
                )
            );

            setOcrControlsLocked(
                false
            );
        }
    }

    /* =========================================================
       RESTORE ACTIVE JOB
       ========================================================= */

    function restoreActiveOcrJob() {
        const jobId =
            getSavedActiveOcrJob();

        if (
            !jobId
            || !/^[A-Z0-9]{16}$/.test(
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

        document.addEventListener(
            "ocr:failure-open",
            handleOcrFailureOpen
        );

        document.addEventListener(
            "ocr:results-confirmed",
            handleOcrResultsConfirmed
        );

        OCR_SUBMISSION_EVENTS_BOUND =
            true;
    }

    /* =========================================================
       INITIALIZATION
       ========================================================= */

    function initializeOcrSubmission() {
        if (
            OCR_CORE_READY !==
            true
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

        OCR_LOADING_TARGET_PROGRESS =
            0;

        OCR_LOADING_CONFIRMED_PROGRESS =
            0;

        OCR_LOADING_SIMULATED_PROGRESS =
            0;

        OCR_LOADING_VELOCITY =
            0;

        OCR_LOADING_LAST_MESSAGE =
            "";

        OCR_LOADING_STAGE =
            "";

        OCR_LOADING_SOURCE =
            "stored";

        OCR_ACTIVE_JOB_ID =
            "";

        bindOcrSubmissionEvents();

        if (
            submitBtn.dataset
                .ocrSubmissionInitialized !==
            "true"
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
        restoreRequestedOcrFailure();

        console.log(
            `[OCR SUBMISSION] ${OCR_SUBMISSION_VERSION} ready.`
        );

        return true;
    }

    window.initializeOcrSubmission =
        initializeOcrSubmission;
})();