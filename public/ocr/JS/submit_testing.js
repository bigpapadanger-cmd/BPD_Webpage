"use strict";

/* =========================================================
   BPD GAMING NETWORK
   OCR RESULT REVIEW / CONFIRMATION
   ========================================================= */


/* =========================================================
   CONFIGURATION
   ========================================================= */

const OCR_CONFIRM_URL =
    "/api/ocr/confirm";


/* =========================================================
   ELEMENTS
   ========================================================= */

const ocrTestingPanel =
    document.getElementById(
        "ocrTestingPanel"
    );

const ocrTestingAccurateBtn =
    document.getElementById(
        "ocrTestingAccurateBtn"
    );

const ocrTestingIncorrectBtn =
    document.getElementById(
        "ocrTestingIncorrectBtn"
    );

const ocrTestingStatus =
    document.getElementById(
        "ocrTestingStatus"
    );


/* =========================================================
   STATE
   ========================================================= */

let ocrReviewCurrentMatchId = "";

let ocrReviewCurrentResult = null;

let ocrReviewSubmitting = false;


/* =========================================================
   CONFIGURE PANEL
   ========================================================= */

function configureReviewPanel() {

    if (
        !ocrTestingPanel
    ) {
        return;
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
            "Review & Confirm Results";
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
            (
                "Review the values above. "
                + "Gray values are high confidence. "
                + "Highlighted values need review. "
                + "Any changed value will be recorded "
                + "as disputed while preserving the "
                + "original OCR evidence."
            );
    }


    if (
        ocrTestingAccurateBtn
    ) {
        ocrTestingAccurateBtn.textContent =
            "Confirm Results";
    }


    if (
        ocrTestingIncorrectBtn
    ) {
        ocrTestingIncorrectBtn.textContent =
            "Reset Changes";
    }
}


/* =========================================================
   REVIEW INPUTS
   ========================================================= */

function getReviewInputs() {

    return Array.from(
        document.querySelectorAll(
            ".ocr-review-value-input"
        )
    );
}


/* =========================================================
   VALUE PARSING
   ========================================================= */

function parseReviewInputValue(
    input
) {

    const field =
        String(
            input.dataset.field
            || ""
        ).trim();

    const raw =
        input.value.trim();


    /*
        Ping may default to zero if blank.
    */

    if (
        raw === ""
        && field === "ping"
    ) {
        return 0;
    }


    /*
        Other numeric fields may not be blank.
    */

    if (
        raw === ""
    ) {
        return {
            invalid:
                true,

            raw:
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

            raw:
                raw
        };
    }


    return numeric;
}


/* =========================================================
   BUILD SUBMISSION
   ========================================================= */

function buildReviewSubmission() {

    const fields = [];

    const invalid = [];


    getReviewInputs().forEach(
        function(
            input
        ) {

            const userValue =
                parseReviewInputValue(
                    input
                );


            if (
                userValue
                && typeof userValue === "object"
                && userValue.invalid
            ) {
                invalid.push(
                    {
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
                    }
                );

                return;
            }


            fields.push(
                {
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

                    userValue:
                        userValue
                }
            );
        }
    );


    return {
        fields:
            fields,

        invalid:
            invalid
    };
}


/* =========================================================
   LOCAL DISPLAY HELPERS
   ========================================================= */

function getLocalDisputeSummary() {

    let disputeCount = 0;


    getReviewInputs().forEach(
        function(
            input
        ) {

            const field =
                String(
                    input.dataset.field
                    || ""
                ).trim();

            const originalRaw =
                String(
                    input.dataset.originalValue
                    ?? ""
                ).trim();

            let originalValue = null;


            if (
                originalRaw === ""
                && field === "ping"
            ) {
                originalValue = 0;

            } else if (
                originalRaw !== ""
            ) {
                const numeric =
                    Number(
                        originalRaw
                    );

                originalValue =
                    Number.isInteger(
                        numeric
                    )
                        ? numeric
                        : null;
            }


            const userValue =
                parseReviewInputValue(
                    input
                );


            if (
                userValue
                && typeof userValue === "object"
                && userValue.invalid
            ) {
                return;
            }


            if (
                userValue
                !== originalValue
            ) {
                disputeCount += 1;
            }
        }
    );


    return {
        hasDisputes:
            disputeCount > 0,

        disputeCount:
            disputeCount
    };
}


/* =========================================================
   RESET CHANGES
   ========================================================= */

function resetReviewChanges() {

    getReviewInputs().forEach(
        function(
            input
        ) {

            const field =
                String(
                    input.dataset.field
                    || ""
                ).trim();

            const originalValue =
                input.dataset.originalValue
                ?? "";


            if (
                originalValue === ""
                && field === "ping"
            ) {
                input.value = "0";

            } else {
                input.value =
                    originalValue;
            }


            input
                .closest(
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
            "Changes reset to the OCR values.";
    }
}


/* =========================================================
   CONFIRM RESULTS
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
                "Match ID is unavailable. Results cannot be confirmed.";
        }

        return;
    }


    const reviewSubmission =
        buildReviewSubmission();


    if (
        reviewSubmission.invalid.length > 0
    ) {
        if (
            ocrTestingStatus
        ) {
            ocrTestingStatus.textContent =
                (
                    "One or more edited values are invalid. "
                    + "Use whole numbers greater than or equal to zero."
                );
        }

        return;
    }


    if (
        reviewSubmission.fields.length === 0
    ) {
        if (
            ocrTestingStatus
        ) {
            ocrTestingStatus.textContent =
                "No reviewable scoreboard values were found.";
        }

        return;
    }


    /*
        Only send the values the browser is authoritative for.

        Cloudflare derives:
        - OCR value
        - original engine evidence
        - disputed state
        - confirmation status
        - dispute count
    */

    const payload = {
        matchId:
            ocrReviewCurrentMatchId,

        fields:
            reviewSubmission.fields
    };


    const localSummary =
        getLocalDisputeSummary();


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
            localSummary.hasDisputes
                ? "Saving reviewed results..."
                : "Confirming results...";
    }


    try {

        const response =
            await fetch(
                OCR_CONFIRM_URL,
                {
                    method:
                        "POST",

                    headers:
                        {
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


        const rawText =
            await response.text();


        let responseData = null;


        try {
            responseData =
                JSON.parse(
                    rawText
                );

        } catch {
            responseData =
                null;
        }


        if (
            !response.ok
            || responseData?.success !== true
        ) {
            throw new Error(
                responseData?.message
                || (
                    "Confirmation endpoint returned HTTP "
                    + response.status
                    + "."
                )
            );
        }


        /*
            Use the server response for the authoritative
            dispute result rather than the local estimate.
        */

        const disputeCount =
            Number(
                responseData.disputeCount
                || 0
            );


        if (
            ocrTestingStatus
        ) {
            if (
                responseData.hasDisputes === true
            ) {
                ocrTestingStatus.textContent =
                    (
                        "Results confirmed. "
                        + disputeCount
                        + " disputed value"
                        + (
                            disputeCount === 1
                                ? ""
                                : "s"
                        )
                        + " recorded."
                    );

            } else {
                ocrTestingStatus.textContent =
                    "Results confirmed.";
            }
        }


        document.dispatchEvent(
            new CustomEvent(
                "ocr:results-confirmed",
                {
                    detail:
                        {
                            payload:
                                payload,

                            response:
                                responseData
                        }
                }
            )
        );


    } catch (
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
                (
                    "The OCR result is already preserved, "
                    + "but your confirmation could not be saved. "
                    + "Please try Confirm Results again."
                );
        }


        if (
            ocrTestingAccurateBtn
        ) {
            ocrTestingAccurateBtn.disabled =
                false;
        }


        if (
            ocrTestingIncorrectBtn
        ) {
            ocrTestingIncorrectBtn.disabled =
                false;
        }


        return;

    } finally {

        ocrReviewSubmitting =
            false;
    }


    /*
        Successful confirmation stays locked.
        This prevents an accidental second submission.
    */

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
}


/* =========================================================
   SHOW REVIEW
   ========================================================= */

function showOcrReview(
    detail
) {

    if (
        !ocrTestingPanel
    ) {
        return;
    }


    ocrReviewCurrentMatchId =
        String(
            detail?.matchId
            || detail?.result?.matchId
            || detail?.responseData?.matchId
            || ""
        ).trim();


    ocrReviewCurrentResult =
        detail?.result
        || null;


    ocrReviewSubmitting =
        false;


    ocrTestingPanel.hidden =
        false;


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
        ocrTestingIncorrectBtn.disabled =
            false;
    }


    if (
        ocrTestingStatus
    ) {

        const needsReviewCount =
            getReviewInputs().filter(
                function(
                    input
                ) {
                    return (
                        input.dataset.requiresVerification
                        === "true"
                    );
                }
            ).length;


        if (
            needsReviewCount > 0
        ) {
            ocrTestingStatus.textContent =
                (
                    needsReviewCount
                    + " value"
                    + (
                        needsReviewCount === 1
                            ? ""
                            : "s"
                    )
                    + " need review before confirmation."
                );

        } else {
            ocrTestingStatus.textContent =
                (
                    "All returned values are high confidence. "
                    + "Review them and confirm when ready."
                );
        }
    }
}


/* =========================================================
   FORCE-THROUGH BEHAVIOR
   ========================================================= */

/*
    There is intentionally no browser auto-confirm timer.

    A successful OCR result is already stored by the backend
    before this review UI is displayed.

    If the user closes the page without confirming, the
    stored auto_accepted OCR result remains the fallback.
*/


/* =========================================================
   INITIALIZATION
   ========================================================= */

configureReviewPanel();


document.addEventListener(
    "ocrtesting:result-rendered",
    function(
        event
    ) {
        showOcrReview(
            event.detail
            || {}
        );
    }
);


ocrTestingAccurateBtn
    ?.addEventListener(
        "click",
        confirmReviewedResults
    );


ocrTestingIncorrectBtn
    ?.addEventListener(
        "click",
        resetReviewChanges
    );