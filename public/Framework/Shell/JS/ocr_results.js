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
    "ocr-results-3.2";

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

const OCR_CONFIRMATION_STATUSES =
    new Set([
        "pending_review",
        "auto_accepted",
        "confirmed",
        "confirmed_with_disputes"
    ]);

const OCR_STRUCTURAL_REVIEW_FAILURE_CODES =
    new Set([
        "MATCH_ID_INVALID",
        "MATCH_REPORT_NOT_FOUND",
        "MATCH_REPORT_INVALID",
        "MATCH_ID_MISMATCH",
        "MATCH_OWNER_MISSING",
        "EDIT_DEADLINE_MISSING",
        "SCOREBOARD_EMPTY",
        "OCR_RESULT_MISSING"
    ]);

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

    return OCR_CONFIRMATION_STATUSES.has(
        status
    )
        ? status
        : "";
}

function normalizeErrorCode(
    value
) {
    return String(
        value
        || ""
    )
        .trim()
        .toUpperCase();
}

function normalizeInteger(
    value
) {
    if (
        value === null
        || value === undefined
        || String(
            value
        )
            .trim() ===
            ""
    ) {
        return null;
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
        return null;
    }

    return numeric;
}

function isObject(
    value
) {
    return Boolean(
        value
        && typeof value ===
            "object"
        && !Array.isArray(
            value
        )
    );
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
    const candidates = [
        OCR_RESULTS_CURRENT_RESPONSE
            ?.editDeadlineAt,
        OCR_RESULTS_CURRENT_RESULT
            ?.editDeadlineAt,
        OCR_RESULTS_CURRENT_EDIT_DEADLINE_AT
    ];

    for (
        const candidate
        of candidates
    ) {
        const value =
            String(
                candidate
                || ""
            )
                .trim();

        if (
            value
        ) {
            return value;
        }
    }

    return null;
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

    try {
        return policy.getState(
            editDeadlineAt
        );
    }
    catch (
        error
    ) {
        console.error(
            "[OCR RESULTS] Review policy failed.",
            error
        );

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
        return state.editDeadlineDisplay
            ? (
                lockedPrefix
                + " The modification deadline was "
                + state.editDeadlineDisplay
                + "."
            )
            : lockedPrefix;
    }

    return state.editDeadlineDisplay
        ? (
            openPrefix
            + " "
            + state.editDeadlineDisplay
            + "."
        )
        : "";
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
   RESPONSE HELPERS
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
        const error =
            new Error(
                "Server returned an invalid response."
            );

        error.code =
            "INVALID_SERVER_RESPONSE";

        error.status =
            response.status;

        throw error;
    }
}

function createResponseError(
    response,
    data,
    fallbackMessage
) {
    const error =
        new Error(
            data?.message
            || fallbackMessage
        );

    error.status =
        response?.status
        || 0;

    error.code =
        normalizeErrorCode(
            data?.code
        )
        || null;

    return error;
}

/* =========================================================
   RESULT EXTRACTION
   ========================================================= */

function containsScoreboardTeams(
    value
) {
    return Boolean(
        isObject(
            value
        )
        && (
            Array.isArray(
                value.teams
            )
            || Array.isArray(
                value.team1
            )
            || Array.isArray(
                value.team2
            )
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
    matchId
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
        const error =
            new Error(
                "A valid match ID is required."
            );

        error.code =
            "MATCH_ID_INVALID";

        error.status =
            400;

        throw error;
    }

    const response =
        await apiFetch(
            (
                OCR_JOB_RESULT_URL
                + "?matchId="
                + encodeURIComponent(
                    normalizedMatchId
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
        throw createResponseError(
            response,
            data,
            "Unable to load this scoreboard."
        );
    }

    const result =
        unwrapOcrResult(
            data
        );

    if (
        !result
    ) {
        const error =
            new Error(
                "Stored OCR result is missing."
            );

        error.code =
            "OCR_RESULT_MISSING";

        error.status =
            409;

        throw error;
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
    return isObject(
        player?.reviewFields
    )
        ? player.reviewFields
        : {};
}

function getResultDisplayFields(
    player
) {
    const reviewFields =
        getOcrReviewFields(
            player
        );

    return OCR_RESULT_FIELD_ORDER.filter(
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

    const reviewField =
        isObject(
            reviewFields?.[
                fieldName
            ]
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
                ?.requiresVerification ===
                true,
        confidence:
            reviewField?.confidence
            ?? null,
        template:
            reviewField?.template
            ?? null,
        tesseract:
            reviewField?.tesseract
            ?? null,
        paddle:
            reviewField?.paddle
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
        isObject(
            value
        )
    ) {
        const candidate =
            value?.value
            ?? value?.text
            ?? value?.selectedValue
            ?? null;

        return candidate === null
            ? "—"
            : String(
                candidate
            );
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
   DIALOG
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

    const close =
        function() {
            if (
                OCR_RESULTS_CURRENT_MODE ===
                "failure"
            ) {
                return;
            }

            closeDialog();
        };

    closeButton.addEventListener(
        "click",
        close
    );

    secondaryButton.addEventListener(
        "click",
        close
    );

    dialog.addEventListener(
        "click",
        function(
            event
        ) {
            if (
                event.target ===
                dialog
            ) {
                close();
            }
        }
    );

    return dialog;
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

function getDialogElements() {
    const dialog =
        ensureOcrResultDialog();

    return {
        dialog,
        title:
            dialog.querySelector(
                "#ocrGlobalResultTitle"
            ),
        subtitle:
            dialog.querySelector(
                "#ocrGlobalResultSubtitle"
            ),
        message:
            dialog.querySelector(
                "#ocrGlobalResultMessage"
            ),
        content:
            dialog.querySelector(
                "#ocrGlobalResultContent"
            ),
        error:
            dialog.querySelector(
                "#ocrGlobalResultError"
            ),
        primary:
            dialog.querySelector(
                "#ocrGlobalResultPrimary"
            ),
        secondary:
            dialog.querySelector(
                "#ocrGlobalResultSecondary"
            )
    };
}

function setDialogText(
    {
        title = "",
        subtitle = "",
        message = ""
    } = {}
) {
    const elements =
        getDialogElements();

    elements.title.textContent =
        title;

    elements.subtitle.textContent =
        subtitle;

    elements.message.textContent =
        message;
}

function setDialogError(
    message = ""
) {
    const element =
        getDialogElements()
            .error;

    const normalized =
        String(
            message
            || ""
        )
            .trim();

    element.textContent =
        normalized;

    element.hidden =
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

function resetDialogActions() {
    const {
        primary,
        secondary
    } =
        getDialogElements();

    primary.hidden =
        true;

    primary.disabled =
        false;

    primary.onclick =
        null;

    secondary.hidden =
        false;

    secondary.disabled =
        false;

    secondary.textContent =
        "Close";
}

/* =========================================================
   SCOREBOARD IMAGE
   ========================================================= */

function createOcrResultImage() {
    const imageUrl =
        String(
            OCR_RESULTS_CURRENT_RESPONSE
                ?.imageUrl
            || ""
        )
            .trim();

    if (
        !imageUrl
    ) {
        return null;
    }

    const wrapper =
        document.createElement(
            "div"
        );

    wrapper.className =
        "ocr-result-image-wrap";

    const image =
        document.createElement(
            "img"
        );

    image.className =
        "ocr-result-image";

    image.alt =
        "Submitted Rocket League scoreboard";

    image.loading =
        "eager";

    image.decoding =
        "async";

    image.src =
        imageUrl;

    image.addEventListener(
        "error",
        function() {
            console.warn(
                "[OCR RESULTS] Scoreboard image unavailable.",
                {
                    jobId:
                        OCR_RESULTS_CURRENT_JOB_ID
                        || null,
                    matchId:
                        OCR_RESULTS_CURRENT_MATCH_ID
                        || null
                }
            );

            wrapper.remove();
        },
        {
            once:
                true
        }
    );

    wrapper.appendChild(
        image
    );

    return wrapper;
}



/* =========================================================
   SCOREBOARD FIELDS V1
   ========================================================= */

function getScoreboardFields(
    result
) {
    const matchType =
        String(
            result?.matchType
            || OCR_RESULTS_CURRENT_RESPONSE?.matchType
            || ""
        )
            .trim()
            .toLowerCase();

    let middleStat =
        String(
            result?.middleStat
            || OCR_RESULTS_CURRENT_RESPONSE?.middleStat
            || ""
        )
            .trim()
            .toLowerCase();

    if (
        ![
            "assists",
            "demos",
            "damage"
        ].includes(
            middleStat
        )
    ) {
        middleStat =
            matchType ===
                "1v1"
                ? "demos"
                : "assists";
    }

    return [
        "score",
        "goals",
        middleStat,
        "saves",
        "shots",
        "ping"
    ];
}

function formatScoreboardHeader(
    fieldName
) {
    const labels = {
        score:
            "Score",
        goals:
            "Goals",
        assists:
            "Assists",
        demos:
            "Demos",
        saves:
            "Saves",
        shots:
            "Shots",
        damage:
            "Damage",
        ping:
            "Ping"
    };

    return (
        labels[
            fieldName
        ]
        || fieldName
    );
}

/* =========================================================
   SCOREBOARD VALUE CELL
   ========================================================= */

function createScoreboardValueCell(
    teamIndex,
    player,
    fieldName,
    {
        editable = false,
        useEffectiveValue = true
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
        )
        || "Unknown Player";

    const cell =
        document.createElement(
            "td"
        );

    cell.className =
        "ocr-scoreboard-value";

    const valueMissing = (
        state.value === null
        || state.value === undefined
        || String(
            state.value
        )
            .trim() ===
            ""
    );

    if (
        state.requiresVerification
        || (
            editable
            && valueMissing
        )
    ) {
        cell.classList.add(
            "ocr-scoreboard-value-review"
        );
    }

    if (
        !editable
    ) {
        cell.textContent =
            String(
                state.value
                ?? "—"
            );

        return cell;
    }

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
    input.required =
        true;
    input.inputMode =
        "numeric";

    /*
     * Keep this class because collectEditableFields()
     * already uses it.
     */
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
            const changed =
                input.value.trim() !==
                String(
                    input.dataset
                        .originalValue
                    ?? ""
                );

            cell.classList.toggle(
                "ocr-scoreboard-value-disputed",
                changed
            );
        }
    );

    cell.appendChild(
        input
    );

    return cell;
}

/* =========================================================
   SCOREBOARD PLAYER ROW
   ========================================================= */

function createScoreboardPlayerRow(
    teamIndex,
    player,
    fields,
    {
        editable = false,
        useEffectiveValue = true
    } = {}
) {
    const playerName =
        getOcrPlayerName(
            player
        )
        || "Unknown Player";

    const row =
        document.createElement(
            "tr"
        );

    row.className =
        "ocr-scoreboard-player-row";

    row.dataset.team =
        String(
            teamIndex
        );

    row.dataset.player =
        playerName;

    const playerCell =
        document.createElement(
            "td"
        );

    playerCell.className =
        "ocr-scoreboard-player-name";

    playerCell.textContent =
        playerName;

    row.appendChild(
        playerCell
    );

    fields.forEach(
        function(
            fieldName
        ) {
            row.appendChild(
                createScoreboardValueCell(
                    teamIndex,
                    player,
                    fieldName,
                    {
                        editable,
                        useEffectiveValue
                    }
                )
            );
        }
    );

    return row;
}

/* =========================================================
   SCOREBOARD TEAM
   ========================================================= */

function createScoreboardTeamTable(
    result,
    team,
    teamArrayIndex,
    {
        editable = false,
        mode = "result"
    } = {}
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

    const section =
        document.createElement(
            "section"
        );

    section.className =
        (
            "ocr-scoreboard-team "
            + `ocr-scoreboard-team-${teamIndex}`
        );

    const teamHeader =
        document.createElement(
            "div"
        );

    teamHeader.className =
        "ocr-scoreboard-team-header";

    teamHeader.textContent =
        `Team ${teamIndex}`;

    section.appendChild(
        teamHeader
    );

    if (
        players.length === 0
    ) {
        section.appendChild(
            createTextElement(
                "div",
                "ocr-result-empty",
                "No players were returned for this team."
            )
        );

        return section;
    }

    const fields =
        getScoreboardFields(
            result
        );

    const wrapper =
        document.createElement(
            "div"
        );

    /*
     * Keep existing wrapper/table classes so your
     * current CSS remains useful.
     */
    wrapper.className =
        (
            "ocr-review-table-wrap "
            + "ocr-scoreboard-table-wrap"
        );

    const table =
        document.createElement(
            "table"
        );

    table.className =
        (
            "ocr-review-table "
            + "ocr-scoreboard-table"
        );

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
                formatScoreboardHeader(
                    fieldName
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

    players.forEach(
        function(
            player
        ) {
            body.appendChild(
                createScoreboardPlayerRow(
                    teamIndex,
                    player,
                    fields,
                    {
                        editable,
                        /*
                         * Review mode shows the OCR value
                         * being reviewed.
                         *
                         * Result/adjustment modes use the
                         * finalized/effective stored value.
                         */
                        useEffectiveValue:
                            mode !==
                            "review"
                    }
                )
            );
        }
    );

    table.appendChild(
        body
    );

    wrapper.appendChild(
        table
    );

    section.appendChild(
        wrapper
    );

    return section;
}

/* =========================================================
   RESULT SCOREBOARD
   ========================================================= */

function renderOcrResultTable(
    result,
    {
        editable = false,
        mode = "result"
    } = {}
) {
    const {
        content
    } =
        getDialogElements();

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
                "No scoreboard values are available."
            )
        );

        return false;
    }

    const image =
        createOcrResultImage();

    if (
        image
    ) {
        content.appendChild(
            image
        );
    }

    const policyState =
        getCurrentReviewPolicyState();

    const help =
        createTextElement(
            "div",
            "ocr-review-help",
            ""
        );

    if (
        mode ===
        "review"
    ) {
        help.textContent =
            policyState.locked
                ? (
                    "This review window has closed. "
                    + "The scoreboard is read-only."
                )
                : (
                    "Verify the scoreboard below. "
                    + "Highlighted values require special attention."
                );
    }
    else if (
        mode ===
        "adjustment"
    ) {
        help.textContent =
            (
                "Correct only values that do not match "
                + "the submitted scoreboard."
            );
    }
    else {
        help.textContent =
            policyState.locked
                ? (
                    "This scoreboard is read-only because "
                    + "its modification window has closed."
                )
                : (
                    "This scoreboard has been accepted. "
                    + "You may correct a value before "
                    + "the modification deadline."
                );
    }

    content.appendChild(
        help
    );

    const scoreboard =
        document.createElement(
            "div"
        );

    scoreboard.className =
        "ocr-scoreboard";

    let playerCount =
        0;

    teams.forEach(
        function(
            team,
            teamArrayIndex
        ) {
            const players =
                Array.isArray(
                    team?.players
                )
                    ? team.players
                    : [];

            playerCount +=
                players.length;

            scoreboard.appendChild(
                createScoreboardTeamTable(
                    result,
                    team,
                    teamArrayIndex,
                    {
                        editable,
                        mode
                    }
                )
            );
        }
    );

    if (
        playerCount === 0
    ) {
        content.appendChild(
            createTextElement(
                "div",
                "ocr-result-empty",
                "No scoreboard players are available."
            )
        );

        return false;
    }

    content.appendChild(
        scoreboard
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
                        OCR_RESULTS_CURRENT_JOB_ID
                        || null,
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

    return true;
}
/* =========================================================
   FIELD COLLECTION
   ========================================================= */

function collectEditableFields(
    {
        changedOnly = false
    } = {}
) {
    assertOcrResultEditable();

    const dialog =
        ensureOcrResultDialog();

    const inputs =
        Array.from(
            dialog.querySelectorAll(
                ".ocr-review-value-input"
            )
        );

    if (
        inputs.length === 0
    ) {
        throw new Error(
            "No scoreboard fields are available."
        );
    }

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
        ) {
            throw new Error(
                "Every scoreboard value must be a non-negative whole number."
            );
        }

        if (
            changedOnly
        ) {
            if (
                originalValue === null
            ) {
                throw new Error(
                    "An original scoreboard value is missing."
                );
            }

            if (
                value ===
                originalValue
            ) {
                continue;
            }
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
            changedOnly
                ? "No scoreboard values were changed."
                : "No review fields are available."
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

    if (
        mode !== "review"
        && mode !== "adjustment"
    ) {
        throw new Error(
            "Invalid scoreboard update mode."
        );
    }

    const matchId =
        OCR_RESULTS_CURRENT_MATCH_ID;

    if (
        !validMatchId(
            matchId
        )
    ) {
        const error =
            new Error(
                "A valid match ID is required."
            );

        error.code =
            "MATCH_ID_INVALID";

        throw error;
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
        throw createResponseError(
            response,
            data,
            mode === "adjustment"
                ? "Unable to save scoreboard corrections."
                : "Unable to submit scoreboard review."
        );
    }

    return data;
}

/* =========================================================
   RELOAD
   ========================================================= */

async function reloadCurrentResult() {
    if (
        !validMatchId(
            OCR_RESULTS_CURRENT_MATCH_ID
        )
    ) {
        const error =
            new Error(
                "A valid match ID is required."
            );

        error.code =
            "MATCH_ID_INVALID";

        error.status =
            400;

        throw error;
    }

    const {
        result,
        responseData
    } =
        await getOcrResult(
            OCR_RESULTS_CURRENT_MATCH_ID
        );

    OCR_RESULTS_CURRENT_RESULT =
        result;

    OCR_RESULTS_CURRENT_RESPONSE =
        responseData;

    const matchId =
        normalizeId(
            responseData?.matchId
            || result?.matchId
            || OCR_RESULTS_CURRENT_MATCH_ID
        );

    if (
        validMatchId(
            matchId
        )
    ) {
        OCR_RESULTS_CURRENT_MATCH_ID =
            matchId;
    }

    const jobId =
        normalizeId(
            responseData?.jobId
            || OCR_RESULTS_CURRENT_JOB_ID
        );

    OCR_RESULTS_CURRENT_JOB_ID =
        validJobId(
            jobId
        )
            ? jobId
            : "";

    const editDeadlineAt =
        String(
            responseData?.editDeadlineAt
            || result?.editDeadlineAt
            || ""
        )
            .trim();

    OCR_RESULTS_CURRENT_EDIT_DEADLINE_AT =
        editDeadlineAt
        || null;

    return {
        result,
        responseData
    };
}

/* =========================================================
   REVIEW / ADJUSTMENT SUBMISSION
   ========================================================= */

async function submitReview() {
    const fields =
        collectEditableFields({
            changedOnly:
                false
        });

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
                        OCR_RESULTS_CURRENT_JOB_ID
                        || null,
                    matchId:
                        OCR_RESULTS_CURRENT_MATCH_ID,
                    automatic:
                        false,
                    confirmationStatus:
                        normalizeConfirmationStatus(
                            data?.confirmationStatus
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

async function saveAdjustment() {
    const fields =
        collectEditableFields({
            changedOnly:
                true
        });

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
                        OCR_RESULTS_CURRENT_JOB_ID
                        || null,
                    matchId:
                        OCR_RESULTS_CURRENT_MATCH_ID,
                    adjustmentId:
                        data?.adjustmentId
                        || null,
                    adjustmentCount:
                        Number(
                            data?.adjustmentCount
                            || 0
                        ),
                    changedFieldCount:
                        Number(
                            data?.changedFieldCount
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
   ACTION ERROR RECOVERY
   ========================================================= */

async function recoverFromClosedEditWindow(
    mode
) {
    try {
        await reloadCurrentResult();

        renderOcrResultTable(
            OCR_RESULTS_CURRENT_RESULT,
            {
                editable:
                    false,
                mode
            }
        );

        if (
            mode === "review"
        ) {
            configureReviewActions();
        }
        else {
            configureResultActions();
        }
    }
    catch (
        error
    ) {
        console.error(
            "[OCR RESULTS] Could not refresh closed edit window.",
            error
        );
    }
}

/* =========================================================
   RESULT ACTIONS
   ========================================================= */

function configureResultActions() {
    const {
        primary,
        secondary
    } =
        getDialogElements();

    const policyState =
        getCurrentReviewPolicyState();

    secondary.hidden =
        false;

    secondary.disabled =
        false;

    secondary.textContent =
        "Close";

    primary.onclick =
        null;

    primary.disabled =
        false;

    if (
        policyState.locked
    ) {
        primary.hidden =
            true;

        return;
    }

    primary.hidden =
        false;

    primary.textContent =
        "Edit Result";

    primary.onclick =
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
                        "Correct only values that do not match the scoreboard image. "
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

            primary.textContent =
                "Save Changes";

            primary.onclick =
                async function() {
                    setDialogError();
                    setDialogBusy(
                        true
                    );

                    try {
                        await saveAdjustment();
                    }
                    catch (
                        error
                    ) {
                        setDialogError(
                            error?.message
                            || "Unable to save scoreboard corrections."
                        );

                        if (
                            error?.code ===
                            "EDIT_WINDOW_CLOSED"
                        ) {
                            await recoverFromClosedEditWindow(
                                "result"
                            );
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
    const {
        primary,
        secondary
    } =
        getDialogElements();

    const policyState =
        getCurrentReviewPolicyState();

    secondary.hidden =
        false;

    secondary.disabled =
        false;

    secondary.textContent =
        "Close";

    primary.onclick =
        null;

    primary.disabled =
        false;

    if (
        policyState.locked
    ) {
        primary.hidden =
            true;

        return;
    }

    primary.hidden =
        false;

    primary.textContent =
        "Submit Review";

    primary.onclick =
        async function() {
            setDialogError();
            setDialogBusy(
                true
            );

            try {
                await submitReview();
            }
            catch (
                error
            ) {
                setDialogError(
                    error?.message
                    || "Unable to submit scoreboard review."
                );

                if (
                    error?.code ===
                    "EDIT_WINDOW_CLOSED"
                ) {
                    await recoverFromClosedEditWindow(
                        "review"
                    );
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
   STRUCTURAL REVIEW FAILURES
   ========================================================= */

function isStructuralReviewFailure(
    error
) {
    const code =
        normalizeErrorCode(
            error?.code
        );

    return Boolean(
        code
        && OCR_STRUCTURAL_REVIEW_FAILURE_CODES
            .has(
                code
            )
    );
}

function getStructuralReviewFailureMessage(
    error
) {
    const code =
        normalizeErrorCode(
            error?.code
        );

    const messages = {
        MATCH_ID_INVALID:
            "This scoreboard cannot be reviewed because its match ID is invalid.",
        MATCH_REPORT_NOT_FOUND:
            "This scoreboard cannot be reviewed because its stored match report is missing.",
        MATCH_REPORT_INVALID:
            "This scoreboard cannot be reviewed because its stored match report is invalid.",
        MATCH_ID_MISMATCH:
            "This scoreboard cannot be reviewed because its stored match report does not match this match.",
        MATCH_OWNER_MISSING:
            "This scoreboard cannot be reviewed because required ownership information is missing.",
        EDIT_DEADLINE_MISSING:
            "This scoreboard cannot be reviewed because its review deadline is missing or invalid.",
        SCOREBOARD_EMPTY:
            "This scoreboard cannot be reviewed because the stored report contains no scoreboard values.",
        OCR_RESULT_MISSING:
            "This scoreboard cannot be reviewed because its stored OCR result is missing."
    };

    return messages[
        code
    ]
    || String(
        error?.message
        || "This scoreboard cannot be reviewed because required stored data is missing or invalid."
    )
        .trim();
}

function dispatchInvalidReview(
    error
) {
    const jobId =
        validJobId(
            OCR_RESULTS_CURRENT_JOB_ID
        )
            ? OCR_RESULTS_CURRENT_JOB_ID
            : null;

    const matchId =
        validMatchId(
            OCR_RESULTS_CURRENT_MATCH_ID
        )
            ? OCR_RESULTS_CURRENT_MATCH_ID
            : null;

    const errorCode =
        normalizeErrorCode(
            error?.code
        )
        || "OCR_REVIEW_INVALID";

    const message =
        getStructuralReviewFailureMessage(
            error
        );

    console.error(
        "[OCR RESULTS] Review is structurally invalid.",
        {
            jobId,
            matchId,
            errorCode,
            message
        }
    );

    document.dispatchEvent(
        new CustomEvent(
            "ocr:review-invalid",
            {
                detail: {
                    jobId,
                    matchId,
                    errorCode,
                    message
                }
            }
        )
    );

    return {
        jobId,
        matchId,
        errorCode,
        message
    };
}

/* =========================================================
   UNAVAILABLE RESULT
   ========================================================= */

function showUnavailableResult(
    {
        review = false,
        message = ""
    } = {}
) {
    const {
        content,
        primary,
        secondary
    } =
        getDialogElements();

    content.replaceChildren();

    setDialogText({
        title:
            review
                ? "Review Unavailable"
                : "Scoreboard Unavailable",
        subtitle:
            OCR_RESULTS_CURRENT_MATCH_ID
            || OCR_RESULTS_CURRENT_JOB_ID,
        message:
            ""
    });

    setDialogError(
        message
        || "This scoreboard is no longer available."
    );

    primary.hidden =
        true;

    primary.onclick =
        null;

    secondary.hidden =
        false;

    secondary.disabled =
        false;

    secondary.textContent =
        "Close";
}

/* =========================================================
   FAILURE MODAL
   ========================================================= */

function openFailureModal(
    detail
) {
    const requestedJobId =
        normalizeId(
            detail?.jobId
        );

    OCR_RESULTS_CURRENT_MODE =
        "failure";

    OCR_RESULTS_CURRENT_JOB_ID =
        validJobId(
            requestedJobId
        )
            ? requestedJobId
            : "";

    OCR_RESULTS_CURRENT_MATCH_ID =
        "";

    OCR_RESULTS_CURRENT_RESULT =
        null;

    OCR_RESULTS_CURRENT_RESPONSE =
        null;

    OCR_RESULTS_CURRENT_EDIT_DEADLINE_AT =
        null;

    const {
        content,
        primary,
        secondary
    } =
        getDialogElements();

    const errorCode =
        normalizeErrorCode(
            detail?.errorCode
        )
        || "OCR_FAILED";

    const message =
        String(
            detail?.message
            || "The scoreboard could not be processed."
        )
            .trim();

    content.replaceChildren();

    setDialogError();

    setDialogText({
        title:
            "Scoreboard Processing Failed",
        subtitle:
            errorCode,
        message
    });

    secondary.hidden =
        true;

    primary.hidden =
        false;

    primary.disabled =
        false;

    primary.textContent =
        "Acknowledge";

    primary.onclick =
        function() {
            if (
                validJobId(
                    OCR_RESULTS_CURRENT_JOB_ID
                )
            ) {
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
            }

            closeDialog();
        };

    openDialog();
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
    const requestedJobId =
        normalizeId(
            detail?.jobId
        );

    const requestedMatchId =
        normalizeId(
            detail?.matchId
        );

    OCR_RESULTS_CURRENT_JOB_ID =
        validJobId(
            requestedJobId
        )
            ? requestedJobId
            : "";

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

    resetDialogActions();

    if (
        !OCR_RESULTS_CURRENT_MATCH_ID
    ) {
        if (
            review
        ) {
            const error =
                new Error(
                    "This scoreboard does not contain a valid match ID."
                );

            error.code =
                "MATCH_ID_INVALID";

            const failure =
                dispatchInvalidReview(
                    error
                );

            openFailureModal(
                failure
            );

            return;
        }

        openDialog();

        showUnavailableResult({
            review:
                false,
            message:
                "This scoreboard does not contain a valid match ID."
        });

        return;
    }

    const {
        content
    } =
        getDialogElements();

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
                : "Loading scoreboard result..."
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
                            "This scoreboard required review, but its review window has closed. "
                            + getDeadlineMessage({
                                lockedPrefix:
                                    "Review is now read-only."
                            })
                        )
                        : (
                            "Verify each scoreboard value before submitting. "
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
                                    "Corrections may be submitted until"
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
        console.error(
            "[OCR RESULTS] Result load failed.",
            {
                jobId:
                    OCR_RESULTS_CURRENT_JOB_ID
                    || null,
                matchId:
                    OCR_RESULTS_CURRENT_MATCH_ID
                    || null,
                status:
                    error?.status
                    || null,
                code:
                    error?.code
                    || null,
                message:
                    error?.message
                    || null
            }
        );

        if (
            review
            && isStructuralReviewFailure(
                error
            )
        ) {
            const failure =
                dispatchInvalidReview(
                    error
                );

            openFailureModal(
                failure
            );

            return;
        }

        const unavailable = (
            error?.code ===
                "MATCH_ID_INVALID"
            || error?.code ===
                "MATCH_REPORT_NOT_FOUND"
            || error?.status ===
                404
        );

        showUnavailableResult({
            review,
            message:
                unavailable
                    ? "This scoreboard is no longer available."
                    : (
                        error?.message
                        || "Unable to load this scoreboard."
                    )
        });
    }
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
   PUBLIC API
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