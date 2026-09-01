"use strict";

/* =========================================================
   BPD GAMING NETWORK
   OCR IMAGE SUBMISSION
   ========================================================= */

const OCR_API_URL =
    "/api/ocr";

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

const OCR_LOADING_TICK_MS =
    100;

const OCR_LOADING_EXPECTED_SECONDS =
    24;

let OCR_LOADING_TIMER = null;
let OCR_LOADING_PROGRESS = 0;


/* =========================================================
   LOADING
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
        !loadingWrap ||
        !loadingFill ||
        !loadingPercent ||
        !loadingText
    ) {
        return;
    }

    OCR_LOADING_PROGRESS =
        Math.max(
            OCR_LOADING_PROGRESS,
            Math.min(
                99,
                Math.max(
                    0,
                    Number(progress) || 0
                )
            )
        );

    loadingWrap.hidden =
        false;

    loadingFill.style.width =
        OCR_LOADING_PROGRESS +
        "%";

    loadingPercent.textContent =
        Math.round(
            OCR_LOADING_PROGRESS
        ) + "%";

    if (text) {
        loadingText.textContent =
            text;
    }
}

function startOcrLoading(
    text =
        "Reading scoreboard..."
) {
    if (OCR_LOADING_TIMER) {
        clearInterval(
            OCR_LOADING_TIMER
        );
    }

    OCR_LOADING_PROGRESS = 1;

    const startedAt =
        Date.now();

    updateOcrLoading(
        1,
        text
    );

    OCR_LOADING_TIMER =
        setInterval(
            function() {
                const elapsedSeconds =
                    (
                        Date.now() -
                        startedAt
                    ) / 1000;

                const ratio =
                    Math.min(
                        1,
                        elapsedSeconds /
                        OCR_LOADING_EXPECTED_SECONDS
                    );

                const eased =
                    1 -
                    Math.pow(
                        1 - ratio,
                        2
                    );

                updateOcrLoading(
                    1 +
                    94 *
                    eased,
                    text
                );
            },
            OCR_LOADING_TICK_MS
        );
}

function finishOcrLoading(
    success
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

    if (OCR_LOADING_TIMER) {
        clearInterval(
            OCR_LOADING_TIMER
        );

        OCR_LOADING_TIMER = null;
    }

    if (
        !loadingWrap ||
        !loadingFill ||
        !loadingPercent ||
        !loadingText
    ) {
        return;
    }

    if (success) {
        OCR_LOADING_PROGRESS = 100;

        loadingFill.style.width =
            "100%";

        loadingPercent.textContent =
            "100%";

        loadingText.textContent =
            "Scoreboard scan completed.";
    } else {
        loadingText.textContent =
            "OCR attempt finished.";
    }

    setTimeout(
        function() {
            if (
                loadingWrap.isConnected
            ) {
                loadingWrap.hidden =
                    true;
            }
        },
        700
    );
}


/* =========================================================
   HELPERS
   ========================================================= */

function createJobId() {
    if (
        globalThis.crypto &&
        typeof globalThis.crypto
            .randomUUID ===
            "function"
    ) {
        return globalThis.crypto
            .randomUUID()
            .replace(/-/g, "")
            .slice(0, 16)
            .toUpperCase();
    }

    return Date.now()
        .toString(36)
        .toUpperCase()
        .padEnd(
            16,
            "X"
        )
        .slice(0, 16);
}

function getOcrPayload(
    responseData
) {
    if (
        responseData?.matchReport &&
        typeof responseData
            .matchReport ===
            "object"
    ) {
        return responseData
            .matchReport;
    }

    if (
        responseData?.result &&
        typeof responseData.result ===
            "object"
    ) {
        return responseData.result;
    }

    return responseData;
}

function getOcrTeams(result) {
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
            team: 1,
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
            team: 2,
            players:
                result.team2
        });
    }

    return teams;
}

function getOcrPlayerName(player) {
    return String(
        player?.player ||
        player?.matchedName ||
        player?.username ||
        player?.name ||
        "Unknown Player"
    );
}

function getOcrReviewFields(player) {
    const reviewFields =
        player?.reviewFields;

    if (
        reviewFields &&
        typeof reviewFields ===
            "object" &&
        !Array.isArray(
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
        )[fieldName];

    if (
        field &&
        typeof field ===
            "object" &&
        !Array.isArray(field)
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

    if (!field) {
        return {
            value:
                player?.[
                    fieldName
                ] ?? null,
            confidence: null,
            engine: null,
            requiresVerification:
                true,
            template: null,
            tesseract: null,
            paddle: null
        };
    }

    const confidence =
        Number(
            field.confidence
        );

    return {
        value:
            field.value ??
            player?.[
                fieldName
            ] ??
            null,

        confidence:
            Number.isFinite(
                confidence
            )
                ? confidence
                : null,

        engine:
            field.engine ||
            null,

        requiresVerification:
            field.requiresVerification ===
            true,

        template:
            field.template ||
            null,

        tesseract:
            field.tesseract ||
            null,

        paddle:
            field.paddle ||
            null
    };
}

function formatEngineValue(
    engineResult
) {
    if (
        !engineResult ||
        engineResult.value ===
            null ||
        typeof engineResult.value ===
            "undefined"
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
        confidence === null ||
        typeof confidence ===
            "undefined" ||
        !Number.isFinite(
            Number(confidence)
        )
    ) {
        return "—";
    }

    const numeric =
        Number(confidence);

    const percentage =
        numeric <= 1
            ? numeric * 100
            : numeric;

    return (
        percentage.toFixed(1) +
        "%"
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

    if (className) {
        cell.className =
            className;
    }

    cell.textContent =
        String(
            value ?? "—"
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
            function(fieldName) {
                return (
                    fieldName in
                        reviewFields ||
                    (
                        player?.[
                            fieldName
                        ] !== null &&
                        typeof player?.[
                            fieldName
                        ] !==
                            "undefined"
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
        String(teamIndex);

    row.dataset.player =
        getOcrPlayerName(player);

    row.dataset.field =
        fieldName;

    row.dataset.originalValue =
        String(
            state.value ?? ""
        );

    row.appendChild(
        createTextCell(
            `Team ${teamIndex}`
        )
    );

    row.appendChild(
        createTextCell(
            getOcrPlayerName(player)
        )
    );

    row.appendChild(
        createTextCell(fieldName)
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

    input.type = "number";
    input.step = "1";
    input.inputMode = "numeric";

    input.className =
        "ocr-review-value-input";

    input.value =
        state.value ?? "";

    input.dataset.team =
        String(teamIndex);

    input.dataset.player =
        getOcrPlayerName(player);

    input.dataset.field =
        fieldName;

    input.dataset.originalValue =
        String(
            state.value ?? ""
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
                        .originalValue ??
                    ""
                );

            const currentValue =
                input.value.trim();

            row.classList.toggle(
                "ocr-review-row-disputed",
                currentValue !==
                    originalValue
            );

            document.dispatchEvent(
                new CustomEvent(
                    "ocr:review-value-changed"
                )
            );
        }
    );

    inputCell.appendChild(input);
    row.appendChild(inputCell);

    return row;
}

function renderOcrResultTable(
    result
) {
    if (!resultsSummary) {
        return;
    }

    resultsSummary
        .replaceChildren();

    const teams =
        getOcrTeams(result);

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
    ].forEach(
        function(label) {
            const th =
                document.createElement(
                    "th"
                );

            th.textContent =
                label;

            headRow.appendChild(th);
        }
    );

    head.appendChild(headRow);
    table.appendChild(head);

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
                    team?.team ||
                    team?.teamIndex ||
                    teamArrayIndex + 1
                );

            const players =
                Array.isArray(
                    team?.players
                )
                    ? team.players
                    : [];

            players.forEach(
                function(player) {
                    getActiveReviewFields(
                        player
                    ).forEach(
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

    table.appendChild(body);
    wrapper.appendChild(table);

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
        !results ||
        !resultsOutput
    ) {
        console.error(
            "[OCR] Results UI was not found."
        );

        return;
    }

    renderOcrResultTable(result);

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
                            responseData
                                ?.jobId ||
                            result?.jobId ||
                            ""
                        ),

                    matchId:
                        String(
                            responseData
                                ?.matchId ||
                            result?.matchId ||
                            ""
                        ),

                    result,
                    responseData
                }
            }
        )
    );

    if (
        typeof results.showModal ===
        "function"
    ) {
        if (!results.open) {
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
   RETRY
   ========================================================= */

function shouldOfferCropRetry(
    response,
    data
) {
    if (
        response?.status === 422
    ) {
        const stage =
            String(
                data?.failureStage ||
                data?.ocr
                    ?.failureStage ||
                ""
            ).toLowerCase();

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
            ].includes(stage)
        ) {
            return true;
        }
    }

    const message =
        String(
            data?.message ||
            data?.ocr?.message ||
            ""
        ).toLowerCase();

    return (
        message.includes(
            "scoreboard"
        ) &&
        (
            message.includes(
                "locat"
            ) ||
            message.includes(
                "align"
            ) ||
            message.includes(
                "geometry"
            ) ||
            message.includes(
                "row"
            ) ||
            message.includes(
                "header"
            )
        )
    );
}


/* =========================================================
   AUTH
   ========================================================= */

async function getAuthenticatedSubmitter() {
    try {
        let session = null;

        if (
            window.BPDAuth &&
            typeof window.BPDAuth
                .getSession ===
                "function"
        ) {
            session =
                await window.BPDAuth
                    .getSession();
        } else {
            const response =
                await fetch(
                    "/api/auth/rocketleague/session",
                    {
                        credentials:
                            "same-origin",

                        cache:
                            "no-store",

                        headers: {
                            "accept":
                                "application/json"
                        }
                    }
                );

            if (!response.ok) {
                return "";
            }

            session =
                await response.json();
        }

        if (
            session?.authenticated !==
            true
        ) {
            return "";
        }

        return String(
            session?.user
                ?.EpicUniqueId ||
            session?.sessionData
                ?.EpicUniqueId ||
            session?.EpicUniqueId ||
            ""
        ).trim();
    } catch (error) {
        console.error(
            "[OCR] Could not resolve authenticated Epic user.",
            error
        );

        return "";
    }
}


/* =========================================================
   SUBMIT
   ========================================================= */

async function submitScoreboard(
    event
) {
    event?.preventDefault();

    if (!sourceImage) {
        setStatus(
            "FAIL: No image loaded."
        );

        return;
    }

    if (ocrControlsLocked) {
        return;
    }

    const playerNameValidation =
        validateExpectedPlayerNames();

    if (
        !playerNameValidation.valid
    ) {
        setStatus(
            "FAIL: " +
            playerNameValidation
                .message
        );

        return;
    }

    if (!matchSize) {
        setStatus(
            "FAIL: Match size is unavailable."
        );

        return;
    }

    const playersPerTeam =
        Number(matchSize.value);

    const expectedPlayerNames =
        playerNameValidation.names;

    const usingCrop =
        cropFallbackVisible;

    setOcrControlsLocked(true);

    startOcrLoading(
        usingCrop
            ? "Retrying with selected scoreboard crop..."
            : "Reading full uploaded image..."
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

        const uploadFileName =
            usingCrop
                ? sourceFileName
                    .replace(
                        /\.[^.]+$/,
                        ""
                    ) +
                    "_crop.png"
                : sourceFileName;

        const submittedBy =
            await getAuthenticatedSubmitter();

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
                            blob.type ||
                            "image/png"
                    }
                );

        const formData =
            new FormData();

        formData.set(
            "image",
            uploadFile
        );

        console.log(
            "[OCR CLIENT] IMAGE BEFORE FETCH:",
            {
                originalConstructor:
                    blob.constructor
                        ?.name ||
                    null,

                originalSize:
                    blob.size,

                originalType:
                    blob.type,

                uploadConstructor:
                    uploadFile.constructor
                        ?.name ||
                    null,

                uploadName:
                    uploadFile.name,

                uploadSize:
                    uploadFile.size,

                uploadType:
                    uploadFile.type,

                formConstructor:
                    formData
                        .get("image")
                        ?.constructor
                        ?.name ||
                    null,

                formSize:
                    formData
                        .get("image")
                        ?.size ??
                    null
            }
        );

        formData.append(
            "playersPerTeam",
            String(playersPerTeam)
        );

        formData.append(
            "expectedPlayerNames",
            JSON.stringify(
                expectedPlayerNames
            )
        );

        formData.append(
            "jobId",
            createJobId()
        );

        formData.append(
            "matchType",
            `${playersPerTeam}v${playersPerTeam}`
        );

        formData.append(
            "submissionMode",
            usingCrop
                ? "manual_crop_retry"
                : "original_image"
        );

        if (submittedBy) {
            formData.append(
                "submittedBy",
                submittedBy
            );
        }

        const response =
            await fetch(
                OCR_API_URL,
                {
                    method: "POST",
                    body: formData,
                    credentials:
                        "same-origin",
                    cache:
                        "no-store"
                }
            );

        const rawText =
            await response.text();

        let data = null;

        try {
            data =
                JSON.parse(rawText);
        } catch {
            throw new Error(
                "OCR server returned invalid JSON."
            );
        }

        if (
            !response.ok ||
            data?.success !== true
        ) {
            finishOcrLoading(false);

            if (
                !usingCrop &&
                shouldOfferCropRetry(
                    response,
                    data
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
                "FAIL: " +
                (
                    data?.message ||
                    `HTTP ${response.status}`
                )
            );

            setOcrControlsLocked(
                false
            );

            return;
        }

        finishOcrLoading(true);

        const result =
            getOcrPayload(data);

        setStatus(
            "SUCCESS: Scoreboard read successfully. Review the returned values before confirming."
        );

        renderOcrResult(
            result,
            data
        );

        document.dispatchEvent(
            new CustomEvent(
                "ocr:successful-result",
                {
                    detail: {
                        result,
                        responseData:
                            data,
                        usedCrop:
                            usingCrop
                    }
                }
            )
        );

        setOcrControlsLocked(false);
        savePageState();
    } catch (error) {
        console.error(
            "[OCR SUBMIT] ERROR:",
            error
        );

        finishOcrLoading(false);

        setStatus(
            "FAIL: " +
            (
                error?.message ||
                "OCR submission failed."
            )
        );

        setOcrControlsLocked(false);
    }
}


/* =========================================================
   INITIALIZATION
   ========================================================= */

function initializeOcrSubmission() {
    if (OCR_CORE_READY !== true) {
        console.error(
            "[OCR] Core is not initialized. Submission cannot start."
        );

        return false;
    }

    if (!submitBtn) {
        console.error(
            "[OCR] Submit button was not found."
        );

        return false;
    }

    if (OCR_LOADING_TIMER) {
        clearInterval(
            OCR_LOADING_TIMER
        );

        OCR_LOADING_TIMER = null;
    }

    OCR_LOADING_PROGRESS = 0;

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

    return true;
}

window.initializeOcrSubmission =
    initializeOcrSubmission;