"use strict";

/* =========================================================
   BPD GAMING NETWORK
   OCR IMAGE SUBMISSION
   ========================================================= */

const OCR_JOB_SUBMIT_URL =
    "/api/ocr/jobs/submit_job";

const OCR_JOB_STATUS_URL =
    "/api/ocr/jobs/get_job";

const OCR_JOB_RESULT_URL =
    "/api/ocr/jobs/get_result";

const OCR_ACTIVE_JOB_KEY =
    "rocketLeagueOcrActiveJobV1";

const OCR_JOB_POLL_INTERVAL_MS =
    2000;

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

let OCR_JOB_POLL_TIMER =
    null;

let OCR_JOB_POLLING =
    false;

let OCR_LOADING_PROGRESS =
    0;

/* =========================================================
   LOADING UI
   ========================================================= */

function updateOcrLoading(
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
        Math.min(
            100,
            Math.max(
                0,
                Number(
                    progress
                ) || 0
            )
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
        loadingText.textContent =
            text;
    }
}

function showOcrLoading(
    text =
        "Submitting scoreboard..."
) {
    OCR_LOADING_PROGRESS =
        0;

    updateOcrLoading(
        0,
        text
    );
}

function finishOcrLoading(
    success,
    text = null
) {
    const loadingWrap =
        document.getElementById(
            "loadingWrap"
        );

    if (
        success
    ) {
        updateOcrLoading(
            100,
            text
            || "Scoreboard scan completed."
        );
    }
    else {
        updateOcrLoading(
            OCR_LOADING_PROGRESS,
            text
            || "OCR processing stopped."
        );
    }

    if (
        loadingWrap
    ) {
        setTimeout(
            function() {
                if (
                    loadingWrap.isConnected
                ) {
                    loadingWrap.hidden =
                        true;
                }
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
        case "preparing_image":
            return "Preparing scoreboard image...";

        case "ocr":
            return "Reading scoreboard...";

        case "headers":
            return "Reading scoreboard headers...";

        case "anchors":
            return "Locating scoreboard anchors...";

        case "rows":
            return "Locating player rows...";

        case "numeric_matcher":
            return "Reading scoreboard statistics...";

        case "numeric_tesseract":
            return "Verifying scoreboard statistics...";

        case "numeric_paddle":
            return "Resolving uncertain values...";

        case "validation":
            return "Validating scoreboard results...";

        case "saving":
            return "Saving scoreboard results...";

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

function getJobProgress(
    job
) {
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
   ACTIVE JOB PERSISTENCE
   ========================================================= */

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

    try {
        localStorage.setItem(
            OCR_ACTIVE_JOB_KEY,
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

function clearActiveOcrJob() {
    OCR_ACTIVE_JOB_ID =
        "";

    try {
        localStorage.removeItem(
            OCR_ACTIVE_JOB_KEY
        );
    }
    catch (
        error
    ) {
        console.error(
            "[OCR] Could not clear active job.",
            error
        );
    }
}

/* =========================================================
   POLLING
   ========================================================= */

function stopOcrJobPolling() {
    OCR_JOB_POLLING =
        false;

    if (
        OCR_JOB_POLL_TIMER
    ) {
        clearTimeout(
            OCR_JOB_POLL_TIMER
        );

        OCR_JOB_POLL_TIMER =
            null;
    }
}

function scheduleOcrJobPoll(
    jobId
) {
    if (
        !OCR_JOB_POLLING
    ) {
        return;
    }

    if (
        OCR_JOB_POLL_TIMER
    ) {
        clearTimeout(
            OCR_JOB_POLL_TIMER
        );
    }

    OCR_JOB_POLL_TIMER =
        setTimeout(
            function() {
                pollOcrJob(
                    jobId
                );
            },
            OCR_JOB_POLL_INTERVAL_MS
        );
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
    ) {
        throw new Error(
            data?.message
            || (
                "Unable to read OCR job. HTTP "
                + response.status
            )
        );
    }

    const job =
        data?.job;

    if (
        !job
        || typeof job
            !== "object"
    ) {
        throw new Error(
            "OCR job response did not contain job data."
        );
    }

    return job;
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
   OCR PAYLOAD
   ========================================================= */

function getOcrPayload(
    responseData
) {
    if (
        responseData?.matchReport
        && typeof responseData
            .matchReport === "object"
    ) {
        return responseData
            .matchReport;
    }

    if (
        responseData?.result
        && typeof responseData
            .result === "object"
    ) {
        return responseData.result;
    }

    return responseData;
}

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

    const teams = [];

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

function getOcrReviewFields(
    player
) {
    const reviewFields =
        player?.reviewFields;

    if (
        reviewFields
        && typeof reviewFields
            === "object"
        && !Array.isArray(
            reviewFields
        )
    ) {
        return reviewFields;
    }

    return {};
}

function getOcrReviewField(
    player,
    fieldName
) {
    const field =
        getOcrReviewFields(
            player
        )[
            fieldName
        ];

    if (
        field
        && typeof field
            === "object"
        && !Array.isArray(
            field
        )
    ) {
        return field;
    }

    return null;
}

function getOcrFieldReviewState(
    player,
    fieldName
) {
    const field =
        getOcrReviewField(
            player,
            fieldName
        );

    if (
        !field
    ) {
        return {
            value:
                player?.[
                    fieldName
                ]
                ?? null,

            confidence:
                null,

            engine:
                null,

            requiresVerification:
                true,

            template:
                null,

            tesseract:
                null,

            paddle:
                null
        };
    }

    const confidence =
        Number(
            field.confidence
        );

    return {
        value:
            field.value
            ?? player?.[
                fieldName
            ]
            ?? null,

        confidence:
            Number.isFinite(
                confidence
            )
                ? confidence
                : null,

        engine:
            field.engine
            || null,

        requiresVerification:
            field.requiresVerification
            === true,

        template:
            field.template
            || null,

        tesseract:
            field.tesseract
            || null,

        paddle:
            field.paddle
            || null
    };
}

function formatEngineValue(
    engineResult
) {
    if (
        !engineResult
        || engineResult.value
            === null
        || typeof engineResult.value
            === "undefined"
    ) {
        return "—";
    }

    return String(
        engineResult.value
    );
}

function formatConfidence(
    confidence
) {
    if (
        confidence === null
        || typeof confidence
            === "undefined"
        || !Number.isFinite(
            Number(
                confidence
            )
        )
    ) {
        return "—";
    }

    const numeric =
        Number(
            confidence
        );

    const percentage =
        numeric <= 1
            ? numeric * 100
            : numeric;

    return (
        percentage.toFixed(
            1
        )
        + "%"
    );
}

function createTextCell(
    value,
    className = ""
) {
    const cell =
        document.createElement(
            "td"
        );

    if (
        className
    ) {
        cell.className =
            className;
    }

    cell.textContent =
        String(
            value
            ?? "—"
        );

    return cell;
}

function getActiveReviewFields(
    player
) {
    const reviewFields =
        getOcrReviewFields(
            player
        );

    return OCR_RESULT_FIELD_ORDER
        .filter(
            function(
                fieldName
            ) {
                return (
                    fieldName
                        in reviewFields
                    || (
                        player?.[
                            fieldName
                        ] !== null
                        && typeof player?.[
                            fieldName
                        ] !== "undefined"
                    )
                );
            }
        );
}

/* =========================================================
   REVIEW TABLE
   ========================================================= */

function createReviewRow(
    teamIndex,
    player,
    fieldName
) {
    const state =
        getOcrFieldReviewState(
            player,
            fieldName
        );

    const row =
        document.createElement(
            "tr"
        );

    row.className =
        state.requiresVerification
            ? "ocr-review-row ocr-review-row-needs-review"
            : "ocr-review-row ocr-review-row-high-confidence";

    row.dataset.team =
        String(
            teamIndex
        );

    row.dataset.player =
        getOcrPlayerName(
            player
        );

    row.dataset.field =
        fieldName;

    row.dataset.originalValue =
        String(
            state.value
            ?? ""
        );

    row.appendChild(
        createTextCell(
            `Team ${teamIndex}`
        )
    );

    row.appendChild(
        createTextCell(
            getOcrPlayerName(
                player
            )
        )
    );

    row.appendChild(
        createTextCell(
            fieldName
        )
    );

    row.appendChild(
        createTextCell(
            state.value
        )
    );

    row.appendChild(
        createTextCell(
            formatEngineValue(
                state.template
            )
        )
    );

    row.appendChild(
        createTextCell(
            formatEngineValue(
                state.tesseract
            )
        )
    );

    row.appendChild(
        createTextCell(
            formatEngineValue(
                state.paddle
            )
        )
    );

    row.appendChild(
        createTextCell(
            formatConfidence(
                state.confidence
            )
        )
    );

    const inputCell =
        document.createElement(
            "td"
        );

    const input =
        document.createElement(
            "input"
        );

    input.type =
        "number";

    input.step =
        "1";

    input.inputMode =
        "numeric";

    input.className =
        "ocr-review-value-input";

    input.value =
        state.value
        ?? "";

    input.dataset.team =
        String(
            teamIndex
        );

    input.dataset.player =
        getOcrPlayerName(
            player
        );

    input.dataset.field =
        fieldName;

    input.dataset.originalValue =
        String(
            state.value
            ?? ""
        );

    input.dataset.requiresVerification =
        String(
            state.requiresVerification
        );

    input.title =
        state.requiresVerification
            ? "This OCR value needs review. Correct it if necessary."
            : "High-confidence OCR value. Change only if you can verify it is incorrect.";

    input.addEventListener(
        "input",
        function() {
            const originalValue =
                String(
                    input.dataset
                        .originalValue
                    ?? ""
                );

            const currentValue =
                input.value.trim();

            row.classList.toggle(
                "ocr-review-row-disputed",
                currentValue
                    !== originalValue
            );

            document.dispatchEvent(
                new CustomEvent(
                    "ocr:review-value-changed"
                )
            );
        }
    );

    inputCell.appendChild(
        input
    );

    row.appendChild(
        inputCell
    );

    return row;
}

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
        "ocr-review-table";

    const head =
        document.createElement(
            "thead"
        );

    const headRow =
        document.createElement(
            "tr"
        );

    [
        "Team",
        "Player",
        "Stat",
        "OCR Final",
        "Template",
        "Tesseract",
        "Paddle",
        "Confidence",
        "User Value"
    ]
        .forEach(
            function(
                label
            ) {
                const th =
                    document.createElement(
                        "th"
                    );

                th.textContent =
                    label;

                headRow.appendChild(
                    th
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

    teams.forEach(
        function(
            team,
            teamArrayIndex
        ) {
            const teamIndex =
                Number(
                    team?.team
                    || team?.teamIndex
                    || teamArrayIndex
                        + 1
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
                    getActiveReviewFields(
                        player
                    )
                        .forEach(
                            function(
                                fieldName
                            ) {
                                body.appendChild(
                                    createReviewRow(
                                        teamIndex,
                                        player,
                                        fieldName
                                    )
                                );
                            }
                        );
                }
            );
        }
    );

    table.appendChild(
        body
    );

    wrapper.appendChild(
        table
    );

    const help =
        document.createElement(
            "div"
        );

    help.className =
        "ocr-review-help";

    help.textContent =
        "Gray rows are high-confidence values and should normally be left unchanged. Highlighted rows need review. Any edited value is recorded as disputed.";

    resultsSummary.append(
        help,
        wrapper
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

function renderOcrResult(
    result,
    responseData
) {
    if (
        !results
        || !resultsOutput
    ) {
        console.error(
            "[OCR] Results UI was not found."
        );

        return;
    }

    renderOcrResultTable(
        result
    );

    resultsOutput.textContent =
        JSON.stringify(
            responseData,
            null,
            4
        );

    document.dispatchEvent(
        new CustomEvent(
            "ocrtesting:result-rendered",
            {
                detail: {
                    jobId:
                        String(
                            responseData?.jobId
                            || result?.jobId
                            || OCR_ACTIVE_JOB_ID
                            || ""
                        ),

                    matchId:
                        String(
                            responseData?.matchId
                            || result?.matchId
                            || ""
                        ),

                    result,

                    responseData
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
   COMPLETED JOB
   ========================================================= */

async function handleCompletedOcrJob(
    job
) {
    stopOcrJobPolling();

    const jobId =
        String(
            job?.jobId
            || OCR_ACTIVE_JOB_ID
            || ""
        )
            .trim()
            .toUpperCase();

    if (
        !jobId
    ) {
        throw new Error(
            "Completed OCR job has no jobId."
        );
    }

    updateOcrLoading(
        99,
        "Loading completed scoreboard..."
    );

    const completed =
        await getOcrJobResult(
            jobId
        );

    const result =
        completed.result;

    const responseData = {
        ...completed.data,

        jobId,

        providerJobId:
            job?.providerJobId
            || completed.data
                ?.providerJobId
            || null,

        matchId:
            result?.matchId
            || job?.matchId
            || completed.data
                ?.matchId
            || null,

        status:
            "completed",

        resultKey:
            job?.resultKey
            || completed.data
                ?.resultKey
            || null,

        benchmarkKey:
            job?.benchmarkKey
            || completed.data
                ?.benchmarkKey
            || null,

        matchReport:
            result
    };

    clearActiveOcrJob();

    finishOcrLoading(
        true,
        "Scoreboard scan completed."
    );

    setStatus(
        "SUCCESS: Scoreboard read successfully. Review the returned values before confirming."
    );

    renderOcrResult(
        result,
        responseData
    );

    document.dispatchEvent(
        new CustomEvent(
            "ocr:successful-result",
            {
                detail: {
                    result,

                    responseData,

                    usedCrop:
                        Boolean(
                            cropFallbackVisible
                        )
                }
            }
        )
    );

    setOcrControlsLocked(
        false
    );

    savePageState();
}

/* =========================================================
   FAILED JOB
   ========================================================= */

function handleFailedOcrJob(
    job
) {
    stopOcrJobPolling();

    clearActiveOcrJob();

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
   POLL JOB
   ========================================================= */

async function pollOcrJob(
    jobId
) {
    if (
        !OCR_JOB_POLLING
    ) {
        return;
    }

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

        updateOcrLoading(
            getJobProgress(
                job
            ),
            getJobStageMessage(
                job
            )
        );

        if (
            status === "completed"
        ) {
            await handleCompletedOcrJob(
                job
            );

            return;
        }

        if (
            status === "failed"
        ) {
            handleFailedOcrJob(
                job
            );

            return;
        }

        scheduleOcrJobPoll(
            jobId
        );
    }
    catch (
        error
    ) {
        console.error(
            "[OCR] Job polling failed:",
            error
        );

        setStatus(
            "OCR is still processing, but its status could not be refreshed. Retrying..."
        );

        scheduleOcrJobPoll(
            jobId
        );
    }
}

function startOcrJobPolling(
    jobId
) {
    stopOcrJobPolling();

    saveActiveOcrJob(
        jobId
    );

    OCR_JOB_POLLING =
        true;

    pollOcrJob(
        jobId
    );
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

    stopOcrJobPolling();

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

        startOcrJobPolling(
            jobId
        );
    }
    catch (
        error
    ) {
        console.error(
            "[OCR SUBMIT] ERROR:",
            error
        );

        stopOcrJobPolling();

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
    ) {
        return;
    }

    if (
        !/^[A-Z0-9]{16}$/.test(
            jobId
        )
    ) {
        clearActiveOcrJob();

        return;
    }

    setOcrControlsLocked(
        true
    );

    showOcrLoading(
        "Restoring OCR job..."
    );

    setStatus(
        "Restoring active scoreboard scan..."
    );

    startOcrJobPolling(
        jobId
    );
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

    stopOcrJobPolling();

    OCR_LOADING_PROGRESS =
        0;

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

    return true;
}

window.initializeOcrSubmission =
    initializeOcrSubmission;