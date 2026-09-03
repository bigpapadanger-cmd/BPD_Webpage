"use strict";

/* =========================================================
   BPD GAMING NETWORK
   OCR RESULT REVIEW / CONFIRMATION
   ========================================================= */

const OCR_CONFIRM_URL =
    "/api/ocr/confirm";

let ocrTestingPanel =
    null;

let ocrTestingAccurateBtn =
    null;

let ocrTestingIncorrectBtn =
    null;

let ocrTestingStatus =
    null;

let ocrReviewCurrentMatchId =
    "";

let ocrReviewCurrentResult =
    null;

let ocrReviewSubmitting =
    false;

let ocrTestingDocumentEventsBound =
    false;


/* =========================================================
   DOM
   ========================================================= */

function resolveOcrTestingElements() {
    ocrTestingPanel =
        document.getElementById(
            "ocrTestingPanel"
        );

    ocrTestingAccurateBtn =
        document.getElementById(
            "ocrTestingAccurateBtn"
        );

    ocrTestingIncorrectBtn =
        document.getElementById(
            "ocrTestingIncorrectBtn"
        );

    ocrTestingStatus =
        document.getElementById(
            "ocrTestingStatus"
        );
}


/* =========================================================
   EDIT POLICY
   ========================================================= */

function areOcrResultEditsLocked() {
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
   PANEL
   ========================================================= */

function configureReviewPanel() {
    if (
        !ocrTestingPanel
    ) {
        return false;
    }

    ocrTestingPanel.hidden =
        true;

    const title =
        document.getElementById(
            "ocrTestingTitle"
        );

    if (
        title
    ) {
        title.textContent =
            "Review Scoreboard";
    }

    const label =
        ocrTestingPanel.querySelector(
            ".ocr-testing-label"
        );

    if (
        label
    ) {
        label.textContent =
            "RESULT REVIEW";
    }

    const help =
        ocrTestingPanel.querySelector(
            "p"
        );

    if (
        help
    ) {
        help.textContent =
            areOcrResultEditsLocked()
                ? "Compare the returned scoreboard values with your image, then confirm."
                : "Compare the returned scoreboard values with your image. Correct any value that does not match, then confirm.";
    }

    if (
        ocrTestingAccurateBtn
    ) {
        ocrTestingAccurateBtn.textContent =
            "Confirm Results";

        ocrTestingAccurateBtn.disabled =
            false;
    }

    if (
        ocrTestingIncorrectBtn
    ) {
        ocrTestingIncorrectBtn.textContent =
            "Reset Changes";

        ocrTestingIncorrectBtn.hidden =
            areOcrResultEditsLocked();

        ocrTestingIncorrectBtn.disabled =
            areOcrResultEditsLocked();
    }

    if (
        ocrTestingStatus
    ) {
        ocrTestingStatus.textContent =
            "";
    }

    return true;
}


/* =========================================================
   REVIEW VALUES
   ========================================================= */

function getReviewInputs() {
    return Array.from(
        document.querySelectorAll(
            ".ocr-review-value-input"
        )
    );
}


function parseReviewInputValue(
    input
) {
    const field =
        String(
            input.dataset.field
            || ""
        )
            .trim();

    const raw =
        input.value
            .trim();

    if (
        raw === ""
        && field === "ping"
    ) {
        return 0;
    }

    if (
        raw === ""
    ) {
        return {
            invalid:
                true,

            raw
        };
    }

    const numeric =
        Number(
            raw
        );

    if (
        !Number.isInteger(
            numeric
        )
        || numeric < 0
    ) {
        return {
            invalid:
                true,

            raw
        };
    }

    return numeric;
}


function buildReviewSubmission() {
    const fields =
        [];

    const invalid =
        [];

    getReviewInputs()
        .forEach(
            function(
                input
            ) {
                const userValue =
                    parseReviewInputValue(
                        input
                    );

                if (
                    userValue
                    && typeof userValue
                        === "object"
                    && userValue.invalid
                ) {
                    invalid.push({
                        team:
                            Number(
                                input.dataset.team
                            ),

                        player:
                            input.dataset.player
                            || "",

                        field:
                            input.dataset.field
                            || "",

                        value:
                            userValue.raw
                    });

                    return;
                }

                fields.push({
                    team:
                        Number(
                            input.dataset.team
                        ),

                    player:
                        input.dataset.player
                        || "",

                    field:
                        input.dataset.field
                        || "",

                    userValue
                });
            }
        );

    return {
        fields,
        invalid
    };
}


/* =========================================================
   CHANGED VALUES
   ========================================================= */

function getLocalChangeSummary() {
    let changedCount =
        0;

    getReviewInputs()
        .forEach(
            function(
                input
            ) {
                const currentValue =
                    String(
                        input.value
                        ?? ""
                    )
                        .trim();

                const originalValue =
                    String(
                        input.dataset
                            .originalValue
                        ?? ""
                    )
                        .trim();

                if (
                    currentValue
                    !== originalValue
                ) {
                    changedCount +=
                        1;
                }
            }
        );

    return {
        hasChanges:
            changedCount > 0,

        changedCount
    };
}


/* =========================================================
   RESET
   ========================================================= */

function resetReviewChanges() {
    if (
        areOcrResultEditsLocked()
    ) {
        return;
    }

    getReviewInputs()
        .forEach(
            function(
                input
            ) {
                const field =
                    String(
                        input.dataset.field
                        || ""
                    )
                        .trim();

                const originalValue =
                    input.dataset
                        .originalValue
                    ?? "";

                if (
                    originalValue === ""
                    && field === "ping"
                ) {
                    input.value =
                        "0";
                }
                else {
                    input.value =
                        originalValue;
                }

                input.closest(
                    "tr"
                )
                    ?.classList
                    .remove(
                        "ocr-review-row-disputed"
                    );
            }
        );

    if (
        ocrTestingStatus
    ) {
        ocrTestingStatus.textContent =
            "Changes reset.";
    }
}


/* =========================================================
   CONFIRM
   ========================================================= */

async function confirmReviewedResults() {
    if (
        ocrReviewSubmitting
        || !ocrReviewCurrentResult
    ) {
        return;
    }

    if (
        !ocrReviewCurrentMatchId
    ) {
        if (
            ocrTestingStatus
        ) {
            ocrTestingStatus.textContent =
                "This scoreboard cannot be confirmed because its match ID is unavailable.";
        }

        return;
    }

    const reviewSubmission =
        buildReviewSubmission();

    if (
        reviewSubmission
            .invalid
            .length > 0
    ) {
        if (
            ocrTestingStatus
        ) {
            ocrTestingStatus.textContent =
                "All scoreboard values must be whole numbers greater than or equal to zero.";
        }

        return;
    }

    if (
        reviewSubmission
            .fields
            .length === 0
    ) {
        if (
            ocrTestingStatus
        ) {
            ocrTestingStatus.textContent =
                "No scoreboard values were found.";
        }

        return;
    }

    const payload = {
        matchId:
            ocrReviewCurrentMatchId,

        fields:
            reviewSubmission.fields
    };

    const changeSummary =
        getLocalChangeSummary();

    ocrReviewSubmitting =
        true;

    if (
        ocrTestingAccurateBtn
    ) {
        ocrTestingAccurateBtn.disabled =
            true;
    }

    if (
        ocrTestingIncorrectBtn
    ) {
        ocrTestingIncorrectBtn.disabled =
            true;
    }

    if (
        ocrTestingStatus
    ) {
        ocrTestingStatus.textContent =
            changeSummary.hasChanges
                ? "Saving corrected scoreboard..."
                : "Confirming scoreboard...";
    }

    try {
        const response =
            await fetch(
                OCR_CONFIRM_URL,
                {
                    method:
                        "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body:
                        JSON.stringify(
                            payload
                        ),

                    cache:
                        "no-store",

                    credentials:
                        "same-origin",

                    keepalive:
                        true
                }
            );

        if (
            !response.ok
        ) {
            let message =
                (
                    "Confirmation endpoint returned HTTP "
                    + response.status
                    + "."
                );

            try {
                const responseData =
                    await response.json();

                if (
                    responseData?.message
                ) {
                    message =
                        responseData.message;
                }
            }
            catch {
                // 204 success has no body.
            }

            throw new Error(
                message
            );
        }

        if (
            ocrTestingStatus
        ) {
            ocrTestingStatus.textContent =
                changeSummary.hasChanges
                    ? "Corrected scoreboard confirmed."
                    : "Results confirmed.";
        }

        getReviewInputs()
            .forEach(
                function(
                    input
                ) {
                    input.readOnly =
                        true;
                }
            );

        if (
            ocrTestingAccurateBtn
        ) {
            ocrTestingAccurateBtn.disabled =
                true;

            ocrTestingAccurateBtn.textContent =
                "Results Confirmed";
        }

        if (
            ocrTestingIncorrectBtn
        ) {
            ocrTestingIncorrectBtn.disabled =
                true;
        }

        document.dispatchEvent(
            new CustomEvent(
                "ocr:results-confirmed",
                {
                    detail: {
                        matchId:
                            ocrReviewCurrentMatchId,

                        automatic:
                            false
                    }
                }
            )
        );
    }
    catch (
        error
    ) {
        console.error(
            "[OCR REVIEW] CONFIRM ERROR:",
            error
        );

        if (
            ocrTestingStatus
        ) {
            ocrTestingStatus.textContent =
                "Your confirmation could not be saved. Please try again.";
        }

        if (
            ocrTestingAccurateBtn
        ) {
            ocrTestingAccurateBtn.disabled =
                false;
        }

        if (
            ocrTestingIncorrectBtn
            && !areOcrResultEditsLocked()
        ) {
            ocrTestingIncorrectBtn.disabled =
                false;
        }
    }
    finally {
        ocrReviewSubmitting =
            false;
    }
}


/* =========================================================
   SHOW REVIEW
   ========================================================= */

function showOcrReview(
    detail
) {
    resolveOcrTestingElements();

    if (
        !ocrTestingPanel
    ) {
        console.error(
            "[OCR REVIEW] Review panel was not found."
        );

        return;
    }

    ocrReviewCurrentMatchId =
        String(
            detail?.matchId
            || detail?.result
                ?.matchId
            || ""
        )
            .trim()
            .toUpperCase();

    ocrReviewCurrentResult =
        detail?.result
        || null;

    ocrReviewSubmitting =
        false;

    ocrTestingPanel.hidden =
        false;

    const editsLocked =
        areOcrResultEditsLocked();

    getReviewInputs()
        .forEach(
            function(
                input
            ) {
                input.readOnly =
                    editsLocked;
            }
        );

    if (
        ocrTestingAccurateBtn
    ) {
        ocrTestingAccurateBtn.disabled =
            false;

        ocrTestingAccurateBtn.textContent =
            "Confirm Results";
    }

    if (
        ocrTestingIncorrectBtn
    ) {
        ocrTestingIncorrectBtn.hidden =
            editsLocked;

        ocrTestingIncorrectBtn.disabled =
            editsLocked;

        ocrTestingIncorrectBtn.textContent =
            "Reset Changes";
    }

    if (
        ocrTestingStatus
    ) {
        ocrTestingStatus.textContent =
            editsLocked
                ? "Review the scoreboard values and confirm when ready."
                : "Compare the scoreboard values with your image. Correct anything that does not match.";
    }
}


function handleOcrResultRendered(
    event
) {
    showOcrReview(
        event.detail
        || {}
    );
}


/* =========================================================
   INITIALIZATION
   ========================================================= */

function initializeOcrTesting() {
    resolveOcrTestingElements();

    if (
        !ocrTestingPanel
    ) {
        console.error(
            "[OCR REVIEW] Review panel was not found."
        );

        return false;
    }

    ocrReviewCurrentMatchId =
        "";

    ocrReviewCurrentResult =
        null;

    ocrReviewSubmitting =
        false;

    configureReviewPanel();

    if (
        ocrTestingAccurateBtn
        && ocrTestingAccurateBtn
            .dataset
            .ocrTestingConfirmInitialized
        !== "true"
    ) {
        ocrTestingAccurateBtn
            .addEventListener(
                "click",
                confirmReviewedResults
            );

        ocrTestingAccurateBtn
            .dataset
            .ocrTestingConfirmInitialized =
            "true";
    }

    if (
        ocrTestingIncorrectBtn
        && ocrTestingIncorrectBtn
            .dataset
            .ocrTestingResetInitialized
        !== "true"
    ) {
        ocrTestingIncorrectBtn
            .addEventListener(
                "click",
                resetReviewChanges
            );

        ocrTestingIncorrectBtn
            .dataset
            .ocrTestingResetInitialized =
            "true";
    }

    if (
        !ocrTestingDocumentEventsBound
    ) {
        document.addEventListener(
            "ocrtesting:result-rendered",
            handleOcrResultRendered
        );

        ocrTestingDocumentEventsBound =
            true;
    }

    return true;
}


window.initializeOcrTesting =
    initializeOcrTesting;