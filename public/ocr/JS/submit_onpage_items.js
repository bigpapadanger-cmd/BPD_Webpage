"use strict";

/* =========================================================
   BPD GAMING NETWORK
   OCR ON-PAGE UI

   Owns:
   - example panel
   - result-modal closing
   - crop-fallback presentation

   SPA lifecycle:
   - initializeOcrOnPageItems() may be called after each
     fresh OCR page injection.
   - element listeners are bound once per injected element.
   - document-level OCR listeners are bound once globally.
   ========================================================= */


/* =========================================================
   CURRENT PAGE ELEMENTS
   ========================================================= */

let exampleToggle =
    null;

let exampleContent =
    null;

let exampleToggleIcon =
    null;

let cropFallback =
    null;

let cropHelp =
    null;

let ocrOnPageDocumentEventsBound =
    false;


/* =========================================================
   RESOLVE CURRENT DOM
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
   EXAMPLE PANEL
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
        String(
            !isOpen
        )
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
   INITIAL CROP FALLBACK STATE
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


/* =========================================================
   CROP FALLBACK SHOWN
   ========================================================= */

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


/* =========================================================
   SUCCESS
   ========================================================= */

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
   DOCUMENT EVENTS
   ========================================================= */

function bindOcrOnPageDocumentEvents() {
    if (
        ocrOnPageDocumentEventsBound
    ) {
        return;
    }

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


/* =========================================================
   INITIALIZE ON-PAGE UI

   Safe to call every time the SPA injects a fresh OCR page.
   ========================================================= */

function initializeOcrOnPageItems() {
    resolveOcrOnPageElements();

    bindExampleToggle();

    bindResultsModal();

    bindOcrOnPageDocumentEvents();

    configureCropFallbackState();

    return true;
}


/* =========================================================
   EXPOSE INITIALIZER

   Final /ocr/JS/index.js will call this after the other OCR
   systems have initialized.
   ========================================================= */

window.initializeOcrOnPageItems =
    initializeOcrOnPageItems;


/* =========================================================
   TEMPORARY LEGACY INITIALIZATION

   Keep until /ocr/JS/index.js becomes the only
   initialization owner.
   ========================================================= */

