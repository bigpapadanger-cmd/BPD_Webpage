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
        apiFetch
    } = window.BPDOcrApi;

    const OCR_SUBMISSION_VERSION =
        "ocr-submission-1.7";

    const OCR_ACTIVE_JOB_KEY =
        "rocketLeagueOcrActiveJobV1";

    const OCR_ACTIVE_JOB_ROUTE_KEY =
        "rocketLeagueOcrActiveJobRouteV1";

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
        97;

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

            case "cloud_handoff":
                return "Sending data to cloud...";

            case "acceptance_checks":
                return "Verifying image...";

            case "preparing_image":
                return "Getting the pixels lined up...";

            case "building_request":
                return "Building the OCR request...";

            case "contacting_ocr":
            case "ocr_provider":
                return "Connecting to Image Scanner...";

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
       JOB PROGRESS FALLBACK
       ========================================================= */

    function getJobProgress(
        job
    ) {
        const highest =
            getHighestProgressValue([
                job?.progress,
                job?.confirmedProgress,
                job?.simulatedProgress
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

        OCR_ACTIVE_JOB_ID =
            jobId;

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
                || "stored"
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
            !/^[A-Z0-9]{16}$/.test(
                OCR_ACTIVE_JOB_ID
            )
        ) {
            return;
        }

        const sourceRoute =
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
                sourceRoute
            ) {
                localStorage.setItem(
                    OCR_ACTIVE_JOB_ROUTE_KEY,
                    sourceRoute
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

        const confirmationStatus =
            String(
                event?.detail
                    ?.confirmationStatus
                || event?.detail
                    ?.job
                    ?.confirmationStatus
                || ""
            )
                .trim()
                .toLowerCase();

        if (
            confirmationStatus ===
                "pending_review"
        ) {
            setStatus(
                "Scoreboard processing complete. Review is required."
            );
        }
        else {
            setStatus(
                "Scoreboard processing complete."
            );
        }

        setOcrControlsLocked(
            false
        );

        savePageState();
    }

    /* =========================================================
       FAILED
       ========================================================= */

    function handleGlobalOcrJobFailed(
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
            OCR_ACTIVE_JOB_ID
            && jobId
            && OCR_ACTIVE_JOB_ID !==
                jobId
        ) {
            return;
        }

        const job =
            event?.detail?.job
            || {};

        OCR_ACTIVE_JOB_ID =
            "";

        const message =
            String(
                job?.error?.userMessage
                || job?.message
                || job?.error?.message
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

            setStatus(
                "Scoreboard could not be located reliably. Adjust the crop and try again."
            );

            setOcrControlsLocked(
                false
            );

            return;
        }

        setStatus(
            "FAIL: "
            + message
        );

        setOcrControlsLocked(
            false
        );
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

        if (
            !Number.isInteger(
                playersPerTeam
            )
            || playersPerTeam < 1
            || playersPerTeam > 3
        ) {
            setStatus(
                "FAIL: Match size is invalid."
            );

            return;
        }

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
                    String(
                        data?.progressSource
                        || "stored"
                    ),

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

        console.log(
            `[OCR SUBMISSION] ${OCR_SUBMISSION_VERSION} ready.`
        );

        return true;
    }

    window.initializeOcrSubmission =
        initializeOcrSubmission;
})();