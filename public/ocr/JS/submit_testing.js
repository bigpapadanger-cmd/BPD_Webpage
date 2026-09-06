"use strict";

/* =========================================================
   BPD GAMING NETWORK
   OCR RESULT REVIEW COMPATIBILITY
   ========================================================= */

(function() {
    const OCR_TESTING_VERSION =
        "ocr-testing-2.0";

    let OCR_TESTING_READY =
        false;

    /* =========================================================
       LEGACY PANEL
       ========================================================= */

    function getLegacyReviewPanel() {
        return document.getElementById(
            "ocrTestingPanel"
        );
    }

    function hideLegacyReviewPanel() {
        const panel =
            getLegacyReviewPanel();

        if (
            !panel
        ) {
            return;
        }

        panel.hidden =
            true;

        panel.setAttribute(
            "aria-hidden",
            "true"
        );
    }

    /* =========================================================
       LEGACY CONTROLS
       ========================================================= */

    function disableLegacyReviewControls() {
        const confirmButton =
            document.getElementById(
                "ocrTestingAccurateBtn"
            );

        const resetButton =
            document.getElementById(
                "ocrTestingIncorrectBtn"
            );

        if (
            confirmButton
        ) {
            confirmButton.disabled =
                true;

            confirmButton.removeAttribute(
                "data-ocr-testing-confirm-initialized"
            );
        }

        if (
            resetButton
        ) {
            resetButton.disabled =
                true;

            resetButton.removeAttribute(
                "data-ocr-testing-reset-initialized"
            );
        }
    }

    /* =========================================================
       LEGACY RESULT INPUTS
       ========================================================= */

    function disableLegacyReviewInputs() {
        document.querySelectorAll(
            "#ocrTestingPanel .ocr-review-value-input"
        )
            .forEach(
                function(
                    input
                ) {
                    input.disabled =
                        true;
                }
            );
    }

    /* =========================================================
       CLEANUP
       ========================================================= */

    function cleanupLegacyReviewInterface() {
        hideLegacyReviewPanel();
        disableLegacyReviewControls();
        disableLegacyReviewInputs();
    }

    /* =========================================================
       INITIALIZATION
       ========================================================= */

    function initializeOcrTesting() {
        cleanupLegacyReviewInterface();

        if (
            OCR_TESTING_READY
        ) {
            return true;
        }

        OCR_TESTING_READY =
            true;

        console.log(
            `[OCR TESTING] ${OCR_TESTING_VERSION} ready. Global OCR result review is active.`
        );

        return true;
    }

    /* =========================================================
       PUBLIC
       ========================================================= */

    window.initializeOcrTesting =
        initializeOcrTesting;
})();