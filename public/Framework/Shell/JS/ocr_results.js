"use strict";

/* =========================================================
   BPD GAMING NETWORK
   GLOBAL OCR RESULTS / REVIEW / ADJUSTMENT
   ========================================================= */

import {
    OCR_JOB_RESULT_URL,
    OCR_CONFIRM_URL
} from "/scripts/apiRoutes.js";

import {
    apiFetch
} from "/scripts/apiConnection.js";

const OCR_RESULTS_VERSION =
    "ocr-results-2.1";

const OCR_RESULT_DIALOG_ID =
    "ocrGlobalResultDialog";

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

let OCR_RESULTS_READY =
    false;

let OCR_RESULTS_CURRENT_JOB_ID =
    "";

let OCR_RESULTS_CURRENT_MATCH_ID =
    "";

let OCR_RESULTS_CURRENT_MODE =
    "";

let OCR_RESULTS_CURRENT_RESULT =
    null;

let OCR_RESULTS_CURRENT_RESPONSE =
    null;

let OCR_RESULTS_CURRENT_EDIT_DEADLINE_AT =
    null;

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

function normalizeInteger(
    value
) {
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
        return null;
    }

    return numeric;
}

/* =========================================================
   REVIEW POLICY
   ========================================================= */

function getOcrReviewPolicy() {
    const policy =
        window.OCRReviewPolicy;

    if (
        !policy
        || typeof policy.getState !==
            "function"
    ) {
        return null;
    }

    return policy;
}

function getCurrentEditDeadlineAt() {
    const responseDeadline =
        String(
            OCR_RESULTS_CURRENT_RESPONSE
                ?.editDeadlineAt
            || ""
        )
            .trim();

    if (
        responseDeadline
    ) {
        return responseDeadline;
    }

    const resultDeadline =
        String(
            OCR_RESULTS_CURRENT_RESULT
                ?.editDeadlineAt
            || ""
        )
            .trim();

    if (
        resultDeadline
    ) {
        return resultDeadline;
    }

    return (
        OCR_RESULTS_CURRENT_EDIT_DEADLINE_AT
        || null
    );
}

function getCurrentReviewPolicyState() {
    const editDeadlineAt =
        getCurrentEditDeadlineAt();

    const policy =
        getOcrReviewPolicy();

    if (
        !policy
    ) {
        return {
            locked:
                true,

            canModify:
                false,

            globallyLocked:
                false,

            deadlineExpired:
                true,

            editDeadlineAt,

            editDeadlineDisplay:
                ""
        };
    }

    return policy.getState(
        editDeadlineAt
    );
}

function getDeadlineMessage(
    {
        lockedPrefix =
            "Scoreboard editing is closed.",
        openPrefix =
            "Editable until"
    } = {}
) {
    const state =
        getCurrentReviewPolicyState();

    if (
        state.locked
    ) {
        if (
            state.editDeadlineDisplay
        ) {
            return (
                lockedPrefix
                + " The modification deadline was "
                + state.editDeadlineDisplay
                + "."
            );
        }

        return lockedPrefix;
    }

    if (
        state.editDeadlineDisplay
    ) {
        return (
            openPrefix
            + " "
            + state.editDeadlineDisplay
            + "."
        );
    }

    return "";
}

function assertOcrResultEditable() {
    const state =
        getCurrentReviewPolicyState();

    if (
        !state.locked
    ) {
        return true;
    }

    const error =
        new Error(
            "The deadline to review or modify this scoreboard has passed."
        );

    error.code =
        "EDIT_WINDOW_CLOSED";

    throw error;
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
   RESULT UNWRAP
   ========================================================= */

function isObject(
    value
) {
    return (
        value
        && typeof value ===
            "object"
        && !Array.isArray(
            value
        )
    );
}

function containsScoreboardTeams(
    value
) {
    if (
        !isObject(
            value
        )
    ) {
        return false;
    }

    return (
        Array.isArray(
            value.teams
        )
        || Array.isArray(
            value.team1
        )
        || Array.isArray(
            value.team2
        )
    );
}

function unwrapOcrResult(
    data
) {
    const candidates = [
        data?.matchReport,
        data?.result,
        data?.result?.matchReport,
        data?.result?.result,
        data?.result?.providerData,
        data?.result?.providerData?.matchReport,
        data?.result?.providerData?.result,
        data?.matchReport?.providerData,
        data?.matchReport?.providerData?.matchReport,
        data?.matchReport?.providerData?.result,
        data?.providerData,
        data?.providerData?.matchReport,
        data?.providerData?.result
    ];

    for (
        const candidate
        of candidates
    ) {
        if (
            containsScoreboardTeams(
                candidate
            )
        ) {
            return candidate;
        }
    }

    for (
        const candidate
        of candidates
    ) {
        if (
            isObject(
                candidate
            )
        ) {
            return candidate;
        }
    }

    return null;
}

/* =========================================================
   RESULT API
   ========================================================= */

async function getOcrResult(
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
        throw new Error(
            "A valid OCR job ID is required."
        );
    }

    const response =
        await apiFetch(
            (
                OCR_JOB_RESULT_URL
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
        throw new Error(
            data?.message
            || "Unable to load OCR result."
        );
    }

    const result =
        unwrapOcrResult(
            data
        );

    if (
        !result
    ) {
        throw new Error(
            "OCR result was not returned."
        );
    }

    return {
        result,
        responseData:
            data
    };
}

/* =========================================================
   RESULT HELPERS
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
        || ""
    )
        .trim();
}

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

/* =========================================================
   REVIEW FIELD LIST
   ========================================================= */

function getReviewRequiredFields(
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
                return Object.prototype
                    .hasOwnProperty
                    .call(
                        reviewFields,
                        fieldName
                    );
            }
        );
}

function getResultDisplayFields(
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
                    Object.prototype
                        .hasOwnProperty
                        .call(
                            player,
                            fieldName
                        )
                    || Object.prototype
                        .hasOwnProperty
                        .call(
                            reviewFields,
                            fieldName
                        )
                );
            }
        );
}

/* =========================================================
   FIELD STATE
   ========================================================= */

function getOcrFieldReviewState(
    player,
    fieldName,
    {
        useEffectiveValue = false
    } = {}
) {
    const reviewFields =
        getOcrReviewFields(
            player
        );

    const reviewField = (
        reviewFields?.[
            fieldName
        ]
        && typeof reviewFields[
            fieldName
        ] ===
            "object"
    )
        ? reviewFields[
            fieldName
        ]
        : {};

    const ocrValue =
        reviewField.value
        ?? player?.[
            fieldName
        ]
        ?? null;

    const effectiveValue =
        player?.[
            fieldName
        ]
        ?? ocrValue;

    return {
        value:
            useEffectiveValue
                ? effectiveValue
                : ocrValue,

        ocrValue,

        effectiveValue,

        requiresVerification:
            reviewField
                .requiresVerification ===
                true,

        confidence:
            reviewField
                .confidence
            ?? null,

        template:
            reviewField
                .template
            ?? null,

        tesseract:
            reviewField
                .tesseract
            ?? null,

        paddle:
            reviewField
                .paddle
            ?? null
    };
}

/* =========================================================
   DISPLAY FORMAT
   ========================================================= */

function formatEngineValue(
    value
) {
    if (
        value === null
        || typeof value ===
            "undefined"
        || value === ""
    ) {
        return "—";
    }

    if (
        typeof value ===
            "object"
    ) {
        const candidate =
            value?.value
            ?? value?.text
            ?? value?.selectedValue
            ?? null;

        if (
            candidate !== null
            && typeof candidate !==
                "undefined"
        ) {
            return String(
                candidate
            );
        }

        return "—";
    }

    return String(
        value
    );
}

function formatConfidence(
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
        return "—";
    }

    const percentage =
        numeric <= 1
            ? numeric * 100
            : numeric;

    return (
        Math.round(
            percentage
        )
        + "%"
    );
}

/* =========================================================
   ELEMENT HELPERS
   ========================================================= */

function createTextElement(
    tag,
    className,
    text
) {
    const element =
        document.createElement(
            tag
        );

    if (
        className
    ) {
        element.className =
            className;
    }

    element.textContent =
        String(
            text
            ?? ""
        );

    return element;
}

function createTextCell(
    value
) {
    const cell =
        document.createElement(
            "td"
        );

    cell.textContent =
        String(
            value
            ?? "—"
        );

    return cell;
}

/* =========================================================
   GLOBAL DIALOG
   ========================================================= */

function ensureOcrResultDialog() {
    let dialog =
        document.getElementById(
            OCR_RESULT_DIALOG_ID
        );

    if (
        dialog
    ) {
        return dialog;
    }

    dialog =
        document.createElement(
            "dialog"
        );

    dialog.id =
        OCR_RESULT_DIALOG_ID;

    dialog.className =
        "ocr-result-dialog";

    const shell =
        document.createElement(
            "div"
        );

    shell.className =
        "ocr-result-dialog-shell";

    const header =
        document.createElement(
            "div"
        );

    header.className =
        "ocr-result-dialog-header";

    const headingWrap =
        document.createElement(
            "div"
        );

    headingWrap.className =
        "ocr-result-dialog-heading";

    const title =
        createTextElement(
            "h2",
            "ocr-result-dialog-title",
            ""
        );

    title.id =
        "ocrGlobalResultTitle";

    const subtitle =
        createTextElement(
            "div",
            "ocr-result-dialog-subtitle",
            ""
        );

    subtitle.id =
        "ocrGlobalResultSubtitle";

    headingWrap.append(
        title,
        subtitle
    );

    const closeButton =
        document.createElement(
            "button"
        );

    closeButton.type =
        "button";

    closeButton.className =
        "ocr-result-dialog-close";

    closeButton.setAttribute(
        "aria-label",
        "Close OCR results"
    );

    closeButton.textContent =
        "×";

    header.append(
        headingWrap,
        closeButton
    );

    const message =
        createTextElement(
            "div",
            "ocr-result-dialog-message",
            ""
        );

    message.id =
        "ocrGlobalResultMessage";

    const content =
        document.createElement(
            "div"
        );

    content.id =
        "ocrGlobalResultContent";

    content.className =
        "ocr-result-dialog-content";

    const error =
        createTextElement(
            "div",
            "ocr-result-dialog-error",
            ""
        );

    error.id =
        "ocrGlobalResultError";

    error.hidden =
        true;

    const footer =
        document.createElement(
            "div"
        );

    footer.className =
        "ocr-result-dialog-footer";

    const secondaryButton =
        document.createElement(
            "button"
        );

    secondaryButton.type =
        "button";

    secondaryButton.id =
        "ocrGlobalResultSecondary";

    secondaryButton.className =
        "ocr-result-secondary";

    secondaryButton.textContent =
        "Close";

    const primaryButton =
        document.createElement(
            "button"
        );

    primaryButton.type =
        "button";

    primaryButton.id =
        "ocrGlobalResultPrimary";

    primaryButton.className =
        "ocr-result-primary";

    primaryButton.hidden =
        true;

    footer.append(
        secondaryButton,
        primaryButton
    );

    shell.append(
        header,
        message,
        content,
        error,
        footer
    );

    dialog.appendChild(
        shell
    );

    document.body.appendChild(
        dialog
    );

    function closeResultDialog() {
        if (
            typeof dialog.close ===
                "function"
            && dialog.open
        ) {
            dialog.close();

            return;
        }

        dialog.removeAttribute(
            "open"
        );
    }

    closeButton.addEventListener(
        "click",
        closeResultDialog
    );

    secondaryButton.addEventListener(
        "click",
        closeResultDialog
    );

    dialog.addEventListener(
        "click",
        function(
            event
        ) {
            if (
                event.target ===
                    dialog
                && OCR_RESULTS_CURRENT_MODE !==
                    "failure"
            ) {
                closeResultDialog();
            }
        }
    );

    return dialog;
}

/* =========================================================
   DIALOG STATE
   ========================================================= */

function setDialogText(
    {
        title = "",
        subtitle = "",
        message = ""
    }
) {
    const dialog =
        ensureOcrResultDialog();

    dialog.querySelector(
        "#ocrGlobalResultTitle"
    ).textContent =
        title;

    dialog.querySelector(
        "#ocrGlobalResultSubtitle"
    ).textContent =
        subtitle;

    dialog.querySelector(
        "#ocrGlobalResultMessage"
    ).textContent =
        message;
}

function setDialogError(
    message = ""
) {
    const dialog =
        ensureOcrResultDialog();

    const errorElement =
        dialog.querySelector(
            "#ocrGlobalResultError"
        );

    const normalized =
        String(
            message
            || ""
        )
            .trim();

    errorElement.textContent =
        normalized;

    errorElement.hidden =
        !normalized;
}

function setDialogBusy(
    busy
) {
    const dialog =
        ensureOcrResultDialog();

    dialog.querySelectorAll(
        "button, input"
    )
        .forEach(
            function(
                element
            ) {
                element.disabled =
                    busy;
            }
        );
}

function openDialog() {
    const dialog =
        ensureOcrResultDialog();

    if (
        typeof dialog.showModal ===
            "function"
    ) {
        if (
            dialog.open
        ) {
            dialog.close();
        }

        dialog.showModal();

        return;
    }

    dialog.setAttribute(
        "open",
        ""
    );
}

function closeDialog() {
    const dialog =
        ensureOcrResultDialog();

    if (
        typeof dialog.close ===
            "function"
        && dialog.open
    ) {
        dialog.close();

        return;
    }

    dialog.removeAttribute(
        "open"
    );
}

/* =========================================================
   REVIEW ROW
   ========================================================= */

function createReviewRow(
    teamIndex,
    player,
    fieldName,
    {
        editable = false,
        useEffectiveValue = false
    } = {}
) {
    const state =
        getOcrFieldReviewState(
            player,
            fieldName,
            {
                useEffectiveValue
            }
        );

    const playerName =
        getOcrPlayerName(
            player
        );

    const row =
        document.createElement(
            "tr"
        );

    row.className =
        state.requiresVerification
            ? (
                "ocr-review-row "
                + "ocr-review-row-needs-review"
            )
            : (
                "ocr-review-row "
                + "ocr-review-row-high-confidence"
            );

    row.dataset.team =
        String(
            teamIndex
        );

    row.dataset.player =
        playerName;

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
            playerName
        )
    );

    row.appendChild(
        createTextCell(
            fieldName
        )
    );

    row.appendChild(
        createTextCell(
            state.ocrValue
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

    if (
        editable
    ) {
        const input =
            document.createElement(
                "input"
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
            state.value
            ?? "";

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
                state.value
                ?? ""
            );

        input.dataset.requiresVerification =
            String(
                state.requiresVerification
            );

        input.addEventListener(
            "input",
            function() {
                const originalValue =
                    String(
                        input.dataset
                            .originalValue
                        ?? ""
                    );

                row.classList.toggle(
                    "ocr-review-row-disputed",
                    input.value.trim() !==
                        originalValue
                );
            }
        );

        inputCell.appendChild(
            input
        );
    }
    else {
        inputCell.textContent =
            String(
                state.value
                ?? "—"
            );
    }

    row.appendChild(
        inputCell
    );

    return row;
}

/* =========================================================
   RESULT TABLE
   ========================================================= */

function renderOcrResultTable(
    result,
    {
        editable = false,
        mode = "result"
    } = {}
) {
    const dialog =
        ensureOcrResultDialog();

    const content =
        dialog.querySelector(
            "#ocrGlobalResultContent"
        );

    content.replaceChildren();

    const teams =
        getOcrTeams(
            result
        );

    if (
        teams.length === 0
    ) {
        content.appendChild(
            createTextElement(
                "div",
                "ocr-result-empty",
                "No scoreboard teams were returned."
            )
        );

        return;
    }

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
        editable
            ? (
                mode ===
                    "adjustment"
                    ? "New Value"
                    : "User Value"
            )
            : "Final Value"
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
                    const fields = (
                        mode ===
                            "review"
                            ? getReviewRequiredFields(
                                player
                            )
                            : getResultDisplayFields(
                                player
                            )
                    );

                    fields.forEach(
                        function(
                            fieldName
                        ) {
                            body.appendChild(
                                createReviewRow(
                                    teamIndex,
                                    player,
                                    fieldName,
                                    {
                                        editable,

                                        useEffectiveValue:
                                            mode !==
                                            "review"
                                    }
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

    const policyState =
        getCurrentReviewPolicyState();

    if (
        mode ===
            "review"
    ) {
        help.textContent =
            policyState.locked
                ? (
                    "This scoreboard required review, but the review window is now closed. "
                    + "The displayed OCR evidence is read-only."
                )
                : (
                    "Highlighted values require review. "
                    + "Verify every displayed value before submitting. "
                    + "Changed OCR values will be recorded as disputes."
                );
    }
    else if (
        mode ===
            "adjustment"
    ) {
        help.textContent =
            (
                "Edit only values that need correction. "
                + "Your changes will be stored as an adjustment "
                + "without replacing the original OCR evidence."
            );
    }
    else {
        help.textContent =
            policyState.locked
                ? (
                    "This scoreboard is read-only because the modification window has closed."
                )
                : (
                    "This scoreboard has already been accepted. "
                    + "You can edit it if a value needs correction."
                );
    }

    content.append(
        help,
        wrapper
    );

    document.dispatchEvent(
        new CustomEvent(
            "ocr:review-table-rendered",
            {
                detail: {
                    result,
                    editable,
                    mode,

                    jobId:
                        OCR_RESULTS_CURRENT_JOB_ID,

                    matchId:
                        OCR_RESULTS_CURRENT_MATCH_ID,

                    editDeadlineAt:
                        getCurrentEditDeadlineAt(),

                    editWindowOpen:
                        !policyState.locked
                }
            }
        )
    );
}

/* =========================================================
   BUILD REVIEW FIELDS
   ========================================================= */

function buildReviewFields() {
    assertOcrResultEditable();

    const dialog =
        ensureOcrResultDialog();

    const inputs =
        Array.from(
            dialog.querySelectorAll(
                ".ocr-review-value-input"
            )
        );

    const fields =
        [];

    for (
        const input
        of inputs
    ) {
        const team =
            normalizeInteger(
                input.dataset.team
            );

        const player =
            String(
                input.dataset.player
                || ""
            )
                .trim();

        const field =
            String(
                input.dataset.field
                || ""
            )
                .trim();

        const value =
            normalizeInteger(
                input.value
            );

        if (
            (
                team !== 1
                && team !== 2
            )
            || !player
            || !OCR_RESULT_FIELD_ORDER.includes(
                field
            )
            || value === null
        ) {
            throw new Error(
                "Every scoreboard field must contain a valid non-negative whole number."
            );
        }

        fields.push({
            team,
            player,
            field,

            userValue:
                value
        });
    }

    if (
        fields.length === 0
    ) {
        throw new Error(
            "No review fields were available."
        );
    }

    return fields;
}

/* =========================================================
   BUILD ADJUSTMENT FIELDS
   ========================================================= */

function buildAdjustmentFields() {
    assertOcrResultEditable();

    const dialog =
        ensureOcrResultDialog();

    const inputs =
        Array.from(
            dialog.querySelectorAll(
                ".ocr-review-value-input"
            )
        );

    const fields =
        [];

    for (
        const input
        of inputs
    ) {
        const team =
            normalizeInteger(
                input.dataset.team
            );

        const player =
            String(
                input.dataset.player
                || ""
            )
                .trim();

        const field =
            String(
                input.dataset.field
                || ""
            )
                .trim();

        const value =
            normalizeInteger(
                input.value
            );

        const originalValue =
            normalizeInteger(
                input.dataset
                    .originalValue
            );

        if (
            (
                team !== 1
                && team !== 2
            )
            || !player
            || !OCR_RESULT_FIELD_ORDER.includes(
                field
            )
            || value === null
            || originalValue === null
        ) {
            throw new Error(
                "Every scoreboard field must contain a valid non-negative whole number."
            );
        }

        if (
            value ===
                originalValue
        ) {
            continue;
        }

        fields.push({
            team,
            player,
            field,

            userValue:
                value
        });
    }

    if (
        fields.length === 0
    ) {
        throw new Error(
            "No scoreboard values were changed."
        );
    }

    return fields;
}

/* =========================================================
   CONFIRM API
   ========================================================= */

async function submitOcrFields(
    mode,
    fields
) {
    assertOcrResultEditable();

    const matchId =
        OCR_RESULTS_CURRENT_MATCH_ID;

    if (
        !validMatchId(
            matchId
        )
    ) {
        throw new Error(
            "A valid match ID is required."
        );
    }

    const response =
        await apiFetch(
            OCR_CONFIRM_URL,
            {
                method:
                    "POST",

                credentials:
                    "same-origin",

                cache:
                    "no-store",

                headers: {
                    "Accept":
                        "application/json",

                    "Content-Type":
                        "application/json"
                },

                body:
                    JSON.stringify({
                        mode,
                        matchId,
                        fields
                    })
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
                || (
                    mode ===
                        "adjustment"
                        ? "Unable to save scoreboard adjustment."
                        : "Unable to submit OCR review."
                )
            );

        error.code =
            data?.code
            || null;

        throw error;
    }

    return data;
}

/* =========================================================
   SUBMIT REVIEW
   ========================================================= */

async function submitReview() {
    const fields =
        buildReviewFields();

    const data =
        await submitOcrFields(
            "review",
            fields
        );

    document.dispatchEvent(
        new CustomEvent(
            "ocr:results-confirmed",
            {
                detail: {
                    jobId:
                        OCR_RESULTS_CURRENT_JOB_ID,

                    matchId:
                        OCR_RESULTS_CURRENT_MATCH_ID,

                    automatic:
                        false,

                    confirmationStatus:
                        normalizeConfirmationStatus(
                            data
                                ?.confirmationStatus
                        )
                        || "confirmed",

                    hasDisputes:
                        data?.hasDisputes ===
                            true,

                    disputeCount:
                        Number(
                            data?.disputeCount
                            || 0
                        ),

                    confirmedAt:
                        data?.confirmedAt
                        || null,

                    editDeadlineAt:
                        data?.editDeadlineAt
                        || getCurrentEditDeadlineAt()
                }
            }
        )
    );

    closeDialog();
}

/* =========================================================
   SAVE ADJUSTMENT
   ========================================================= */

async function saveAdjustment() {
    const fields =
        buildAdjustmentFields();

    const data =
        await submitOcrFields(
            "adjustment",
            fields
        );

    document.dispatchEvent(
        new CustomEvent(
            "ocr:result-adjusted",
            {
                detail: {
                    jobId:
                        OCR_RESULTS_CURRENT_JOB_ID,

                    matchId:
                        OCR_RESULTS_CURRENT_MATCH_ID,

                    adjustmentId:
                        data?.adjustmentId
                        || null,

                    adjustmentCount:
                        Number(
                            data
                                ?.adjustmentCount
                            || 0
                        ),

                    changedFieldCount:
                        Number(
                            data
                                ?.changedFieldCount
                            || fields.length
                        ),

                    adjustedAt:
                        data?.adjustedAt
                        || null,

                    editDeadlineAt:
                        data?.editDeadlineAt
                        || getCurrentEditDeadlineAt()
                }
            }
        )
    );

    await reloadCurrentResult();

    OCR_RESULTS_CURRENT_MODE =
        "result";

    const policyState =
        getCurrentReviewPolicyState();

    setDialogText({
        title:
            "Scoreboard Result",

        subtitle:
            OCR_RESULTS_CURRENT_MATCH_ID,

        message:
            (
                "Scoreboard correction saved. "
                + (
                    policyState.locked
                        ? getDeadlineMessage({
                            lockedPrefix:
                                "Scoreboard editing is now closed."
                        })
                        : getDeadlineMessage({
                            openPrefix:
                                "Additional corrections may be submitted until"
                        })
                )
            )
    });

    renderOcrResultTable(
        OCR_RESULTS_CURRENT_RESULT,
        {
            editable:
                false,

            mode:
                "result"
        }
    );

    configureResultActions();
}

/* =========================================================
   RELOAD CURRENT RESULT
   ========================================================= */

async function reloadCurrentResult() {
    if (
        !validJobId(
            OCR_RESULTS_CURRENT_JOB_ID
        )
    ) {
        throw new Error(
            "A valid OCR job ID is required."
        );
    }

    const {
        result,
        responseData
    } =
        await getOcrResult(
            OCR_RESULTS_CURRENT_JOB_ID
        );

    OCR_RESULTS_CURRENT_RESULT =
        result;

    OCR_RESULTS_CURRENT_RESPONSE =
        responseData;

    const resolvedMatchId =
        normalizeId(
            responseData?.matchId
            || result?.matchId
            || OCR_RESULTS_CURRENT_MATCH_ID
        );

    if (
        validMatchId(
            resolvedMatchId
        )
    ) {
        OCR_RESULTS_CURRENT_MATCH_ID =
            resolvedMatchId;
    }

    const resolvedEditDeadlineAt =
        String(
            responseData?.editDeadlineAt
            || result?.editDeadlineAt
            || ""
        )
            .trim();

    OCR_RESULTS_CURRENT_EDIT_DEADLINE_AT =
        resolvedEditDeadlineAt
        || null;

    return {
        result,
        responseData
    };
}

/* =========================================================
   RESULT ACTIONS
   ========================================================= */

function configureResultActions() {
    const dialog =
        ensureOcrResultDialog();

    const primaryButton =
        dialog.querySelector(
            "#ocrGlobalResultPrimary"
        );

    const secondaryButton =
        dialog.querySelector(
            "#ocrGlobalResultSecondary"
        );

    const policyState =
        getCurrentReviewPolicyState();

    secondaryButton.hidden =
        false;

    secondaryButton.disabled =
        false;

    secondaryButton.textContent =
        "Close";

    primaryButton.onclick =
        null;

    primaryButton.disabled =
        false;

    if (
        policyState.locked
    ) {
        primaryButton.hidden =
            true;

        return;
    }

    primaryButton.hidden =
        false;

    primaryButton.textContent =
        "Edit Result";

    primaryButton.onclick =
        function() {
            try {
                assertOcrResultEditable();
            }
            catch (
                error
            ) {
                setDialogError(
                    error?.message
                    || "Scoreboard editing is closed."
                );

                configureResultActions();

                return;
            }

            OCR_RESULTS_CURRENT_MODE =
                "adjustment";

            setDialogError();

            setDialogText({
                title:
                    "Edit Scoreboard",

                subtitle:
                    OCR_RESULTS_CURRENT_MATCH_ID,

                message:
                    (
                        "Correct any accepted scoreboard value that does not match the image. "
                        + getDeadlineMessage({
                            openPrefix:
                                "Changes may be submitted until"
                        })
                    )
            });

            renderOcrResultTable(
                OCR_RESULTS_CURRENT_RESULT,
                {
                    editable:
                        true,

                    mode:
                        "adjustment"
                }
            );

            primaryButton.textContent =
                "Save Changes";

            primaryButton.onclick =
                async function() {
                    setDialogError();

                    setDialogBusy(
                        true
                    );

                    try {
                        assertOcrResultEditable();

                        await saveAdjustment();
                    }
                    catch (
                        error
                    ) {
                        setDialogError(
                            error?.message
                            || "Unable to save scoreboard adjustment."
                        );

                        if (
                            error?.code ===
                                "EDIT_WINDOW_CLOSED"
                        ) {
                            await reloadCurrentResult();

                            renderOcrResultTable(
                                OCR_RESULTS_CURRENT_RESULT,
                                {
                                    editable:
                                        false,

                                    mode:
                                        "result"
                                }
                            );

                            configureResultActions();
                        }
                    }
                    finally {
                        setDialogBusy(
                            false
                        );
                    }
                };
        };
}

/* =========================================================
   REVIEW ACTIONS
   ========================================================= */

function configureReviewActions() {
    const dialog =
        ensureOcrResultDialog();

    const primaryButton =
        dialog.querySelector(
            "#ocrGlobalResultPrimary"
        );

    const secondaryButton =
        dialog.querySelector(
            "#ocrGlobalResultSecondary"
        );

    const policyState =
        getCurrentReviewPolicyState();

    secondaryButton.hidden =
        false;

    secondaryButton.disabled =
        false;

    secondaryButton.textContent =
        "Close";

    primaryButton.onclick =
        null;

    primaryButton.disabled =
        false;

    if (
        policyState.locked
    ) {
        primaryButton.hidden =
            true;

        return;
    }

    primaryButton.hidden =
        false;

    primaryButton.textContent =
        "Submit Review";

    primaryButton.onclick =
        async function() {
            setDialogError();

            setDialogBusy(
                true
            );

            try {
                assertOcrResultEditable();

                await submitReview();
            }
            catch (
                error
            ) {
                setDialogError(
                    error?.message
                    || "Unable to submit OCR review."
                );

                if (
                    error?.code ===
                        "EDIT_WINDOW_CLOSED"
                ) {
                    await reloadCurrentResult();

                    renderOcrResultTable(
                        OCR_RESULTS_CURRENT_RESULT,
                        {
                            editable:
                                false,

                            mode:
                                "review"
                        }
                    );

                    configureReviewActions();
                }
            }
            finally {
                setDialogBusy(
                    false
                );
            }
        };
}

/* =========================================================
   RESULT MODAL
   ========================================================= */

async function openResultModal(
    detail,
    {
        review = false
    } = {}
) {
    const jobId =
        normalizeId(
            detail?.jobId
        );

    const requestedMatchId =
        normalizeId(
            detail?.matchId
        );

    if (
        !validJobId(
            jobId
        )
    ) {
        throw new Error(
            "OCR result is missing a valid job ID."
        );
    }

    OCR_RESULTS_CURRENT_JOB_ID =
        jobId;

    OCR_RESULTS_CURRENT_MATCH_ID =
        validMatchId(
            requestedMatchId
        )
            ? requestedMatchId
            : "";

    OCR_RESULTS_CURRENT_MODE =
        review
            ? "review"
            : "result";

    OCR_RESULTS_CURRENT_RESULT =
        null;

    OCR_RESULTS_CURRENT_RESPONSE =
        null;

    OCR_RESULTS_CURRENT_EDIT_DEADLINE_AT =
        null;

    const dialog =
        ensureOcrResultDialog();

    const content =
        dialog.querySelector(
            "#ocrGlobalResultContent"
        );

    const primaryButton =
        dialog.querySelector(
            "#ocrGlobalResultPrimary"
        );

    const secondaryButton =
        dialog.querySelector(
            "#ocrGlobalResultSecondary"
        );

    secondaryButton.hidden =
        false;

    secondaryButton.disabled =
        false;

    secondaryButton.textContent =
        "Close";

    primaryButton.hidden =
        true;

    primaryButton.disabled =
        false;

    primaryButton.onclick =
        null;

    content.replaceChildren(
        createTextElement(
            "div",
            "ocr-result-loading",
            "Loading scoreboard..."
        )
    );

    setDialogError();

    setDialogText({
        title:
            review
                ? "Review Scoreboard"
                : "Scoreboard Result",

        subtitle:
            OCR_RESULTS_CURRENT_MATCH_ID,

        message:
            review
                ? "Loading scoreboard review..."
                : "Loading OCR result..."
    });

    openDialog();

    try {
        const {
            result,
            responseData
        } =
            await reloadCurrentResult();

        const responseStatus =
            normalizeConfirmationStatus(
                responseData
                    ?.confirmationStatus
                || result
                    ?.confirmationStatus
            );

        const shouldReview = (
            responseStatus ===
                "pending_review"
            || responseData
                ?.requiresPlayerReview ===
                true
            || responseData
                ?.reviewRequired ===
                true
        );

        const policyState =
            getCurrentReviewPolicyState();

        if (
            shouldReview
        ) {
            OCR_RESULTS_CURRENT_MODE =
                "review";

            setDialogText({
                title:
                    "Review Scoreboard",

                subtitle:
                    OCR_RESULTS_CURRENT_MATCH_ID,

                message:
                    policyState.locked
                        ? (
                            "This scoreboard required review, but the modification deadline has passed. "
                            + getDeadlineMessage({
                                lockedPrefix:
                                    "Review is now closed."
                            })
                        )
                        : (
                            "Verify each scoreboard value. "
                            + "Highlighted values require special attention. "
                            + getDeadlineMessage({
                                openPrefix:
                                    "Submit your review by"
                            })
                        )
            });

            renderOcrResultTable(
                result,
                {
                    editable:
                        !policyState.locked,

                    mode:
                        "review"
                }
            );

            configureReviewActions();

            return;
        }

        OCR_RESULTS_CURRENT_MODE =
            "result";

        const acceptedMessage =
            responseStatus ===
                "confirmed_with_disputes"
                ? "This scoreboard was reviewed and accepted with corrections."
                : responseStatus ===
                    "confirmed"
                    ? "This scoreboard was reviewed and confirmed."
                    : "This scoreboard was accepted automatically.";

        setDialogText({
            title:
                "Scoreboard Result",

            subtitle:
                OCR_RESULTS_CURRENT_MATCH_ID,

            message:
                (
                    acceptedMessage
                    + " "
                    + (
                        policyState.locked
                            ? getDeadlineMessage({
                                lockedPrefix:
                                    "Scoreboard editing is now closed."
                            })
                            : getDeadlineMessage({
                                openPrefix:
                                    "You may make corrections until"
                            })
                    )
                )
        });

        renderOcrResultTable(
            result,
            {
                editable:
                    false,

                mode:
                    "result"
            }
        );

        configureResultActions();
    }
    catch (
        error
    ) {
        content.replaceChildren();

        setDialogError(
            error?.message
            || "Unable to load OCR result."
        );

        primaryButton.hidden =
            true;
    }
}

/* =========================================================
   FAILURE MODAL
   ========================================================= */

function openFailureModal(
    detail
) {
    OCR_RESULTS_CURRENT_MODE =
        "failure";

    OCR_RESULTS_CURRENT_JOB_ID =
        normalizeId(
            detail?.jobId
        );

    OCR_RESULTS_CURRENT_MATCH_ID =
        "";

    OCR_RESULTS_CURRENT_RESULT =
        null;

    OCR_RESULTS_CURRENT_RESPONSE =
        null;

    OCR_RESULTS_CURRENT_EDIT_DEADLINE_AT =
        null;

    const dialog =
        ensureOcrResultDialog();

    const content =
        dialog.querySelector(
            "#ocrGlobalResultContent"
        );

    const primaryButton =
        dialog.querySelector(
            "#ocrGlobalResultPrimary"
        );

    const secondaryButton =
        dialog.querySelector(
            "#ocrGlobalResultSecondary"
        );

    const message =
        String(
            detail?.message
            || "The scoreboard could not be processed."
        )
            .trim();

    const errorCode =
        String(
            detail?.errorCode
            || "OCR_FAILED"
        )
            .trim();

    setDialogText({
        title:
            "Scoreboard Processing Failed",

        subtitle:
            errorCode,

        message
    });

    setDialogError();

    content.replaceChildren();

    primaryButton.hidden =
        false;

    primaryButton.disabled =
        false;

    primaryButton.textContent =
        "Acknowledge";

    secondaryButton.hidden =
        true;

    primaryButton.onclick =
        function() {
            document.dispatchEvent(
                new CustomEvent(
                    "ocr:failure-acknowledged",
                    {
                        detail: {
                            jobId:
                                OCR_RESULTS_CURRENT_JOB_ID
                        }
                    }
                )
            );

            secondaryButton.hidden =
                false;

            closeDialog();
        };

    openDialog();
}

/* =========================================================
   EVENT HANDLERS
   ========================================================= */

function handleResultOpen(
    event
) {
    void openResultModal(
        event?.detail
        || {},
        {
            review:
                false
        }
    )
        .catch(
            function(
                error
            ) {
                console.error(
                    "[OCR RESULTS] Could not open result.",
                    error
                );
            }
        );
}

function handlePendingReviewOpen(
    event
) {
    void openResultModal(
        event?.detail
        || {},
        {
            review:
                true
        }
    )
        .catch(
            function(
                error
            ) {
                console.error(
                    "[OCR RESULTS] Could not open review.",
                    error
                );
            }
        );
}

function handleFailureOpen(
    event
) {
    openFailureModal(
        event?.detail
        || {}
    );
}

/* =========================================================
   PUBLIC OPEN
   ========================================================= */

export function openOcrResult(
    detail
) {
    return openResultModal(
        detail,
        {
            review:
                false
        }
    );
}

export function openOcrReview(
    detail
) {
    return openResultModal(
        detail,
        {
            review:
                true
        }
    );
}

export function openOcrFailure(
    detail
) {
    openFailureModal(
        detail
    );
}

/* =========================================================
   INITIALIZE
   ========================================================= */

export function initializeOcrResults() {
    if (
        OCR_RESULTS_READY
    ) {
        ensureOcrResultDialog();

        return true;
    }

    ensureOcrResultDialog();

    document.addEventListener(
        "ocr:result-open",
        handleResultOpen
    );

    document.addEventListener(
        "ocr:pending-review-open",
        handlePendingReviewOpen
    );

    document.addEventListener(
        "ocr:failure-open",
        handleFailureOpen
    );

    OCR_RESULTS_READY =
        true;

    console.log(
        `[OCR RESULTS] ${OCR_RESULTS_VERSION} ready.`
    );

    return true;
}