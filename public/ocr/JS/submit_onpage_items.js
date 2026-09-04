"use strict";

/* =========================================================
   BPD GAMING NETWORK
   OCR ON-PAGE UI
   ========================================================= */
(function() {
    let exampleToggle = null;
    let exampleContent = null;
    let exampleToggleIcon = null;
    let cropFallback = null;
    let cropHelp = null;

    let ocrOnPageDocumentEventsBound =
        false;


    /* =========================================================
    DOM
    ========================================================= */

    function resolveOcrOnPageElements() {
        exampleToggle =
            document.getElementById(
                "exampleToggle"
            );

        exampleContent =
            document.getElementById(
                "exampleContent"
            );

        exampleToggleIcon =
            document.getElementById(
                "exampleToggleIcon"
            );

        cropFallback =
            document.getElementById(
                "cropFallback"
            );

        cropHelp =
            document.querySelector(
                ".crop-help"
            );
    }


    /* =========================================================
    EXAMPLE
    ========================================================= */

    function handleExampleToggle() {
        if (
            !exampleToggle ||
            !exampleContent ||
            !exampleToggleIcon
        ) {
            return;
        }

        const isOpen =
            !exampleContent.hidden;

        exampleContent.hidden =
            isOpen;

        exampleToggle.setAttribute(
            "aria-expanded",
            String(!isOpen)
        );

        exampleToggleIcon.textContent =
            isOpen
                ? "▼"
                : "▲";
    }

    function bindExampleToggle() {
        if (
            !exampleToggle ||
            !exampleContent ||
            !exampleToggleIcon
        ) {
            return;
        }

        if (
            exampleToggle.dataset
                .ocrExampleInitialized ===
            "true"
        ) {
            return;
        }

        exampleToggle.addEventListener(
            "click",
            handleExampleToggle
        );

        exampleToggle.dataset
            .ocrExampleInitialized =
            "true";
    }


    /* =========================================================
    RESULTS MODAL
    ========================================================= */

    function closeResultsModal() {
        if (!results) {
            return;
        }

        if (
            typeof results.close ===
            "function"
        ) {
            if (results.open) {
                results.close();
            }

            return;
        }

        results.removeAttribute(
            "open"
        );
    }

    function handleResultsBackdropClick(
        event
    ) {
        if (
            results &&
            event.target === results
        ) {
            closeResultsModal();
        }
    }

    function bindResultsModal() {
        if (
            resultsCloseBtn &&
            resultsCloseBtn.dataset
                .ocrResultsCloseInitialized !==
                "true"
        ) {
            resultsCloseBtn.addEventListener(
                "click",
                closeResultsModal
            );

            resultsCloseBtn.dataset
                .ocrResultsCloseInitialized =
                "true";
        }

        if (
            results &&
            results.dataset
                .ocrResultsBackdropInitialized !==
                "true"
        ) {
            results.addEventListener(
                "click",
                handleResultsBackdropClick
            );

            results.dataset
                .ocrResultsBackdropInitialized =
                "true";
        }
    }


    /* =========================================================
    CROP UI
    ========================================================= */

    function configureCropFallbackState() {
        if (cropFallback) {
            cropFallback.hidden =
                !cropFallbackVisible;
        }

        if (cropHelp) {
            cropHelp.textContent =
                (
                    "The full-image attempt could not reliably locate "
                    + "the scoreboard. Move and resize the green box "
                    + "around the scoreboard, then retry."
                );
        }

        if (resetCropBtn) {
            resetCropBtn.hidden =
                !cropFallbackVisible;

            resetCropBtn.disabled =
                (
                    ocrControlsLocked ||
                    !sourceImage ||
                    !cropFallbackVisible
                );
        }

        if (submitBtn) {
            submitBtn.textContent =
                cropFallbackVisible
                    ? "Retry Cropped Scoreboard"
                    : "Read Scoreboard";
        }
    }

    function handleCropFallbackShown() {
        resolveOcrOnPageElements();

        if (cropFallback) {
            cropFallback.hidden =
                false;
        }

        if (resetCropBtn) {
            resetCropBtn.hidden =
                false;

            resetCropBtn.disabled =
                ocrControlsLocked;
        }

        if (submitBtn) {
            submitBtn.textContent =
                "Retry Cropped Scoreboard";
        }
    }

    function handleOcrSuccessfulResult() {
        resolveOcrOnPageElements();

        if (cropFallback) {
            cropFallback.hidden =
                true;
        }

        if (resetCropBtn) {
            resetCropBtn.hidden =
                true;
        }

        if (submitBtn) {
            submitBtn.textContent =
                "Read Scoreboard";
        }
    }


    /* =========================================================
    INITIALIZATION
    ========================================================= */

    function initializeOcrOnPageItems() {
        resolveOcrOnPageElements();

        bindExampleToggle();
        bindResultsModal();
        configureCropFallbackState();

        if (
            !ocrOnPageDocumentEventsBound
        ) {
            document.addEventListener(
                "ocr:crop-fallback-shown",
                handleCropFallbackShown
            );

            document.addEventListener(
                "ocr:successful-result",
                handleOcrSuccessfulResult
            );

            ocrOnPageDocumentEventsBound =
                true;
        }

        return true;
    }

    window.initializeOcrOnPageItems =
        initializeOcrOnPageItems;

})();