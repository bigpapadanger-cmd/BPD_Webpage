"use strict";





function runInitializer(
    name,
    initializer
) {
    if (
        typeof initializer
        !== "function"
    ) {
        throw new Error(
            `${name} initializer was not found.`
        );
    }

    const result =
        initializer();

    if (
        result === false
    ) {
        throw new Error(
            `${name} initialization failed.`
        );
    }
}

function initializeOcrSystems() {
    runInitializer(
        "OCR Core",
        window.initializeOcrCore
    );

    runInitializer(
        "OCR Review Policy",
        window.initializeOcrReviewPolicy
    );

    runInitializer(
        "OCR Submission",
        window.initializeOcrSubmission
    );

    runInitializer(
        "OCR Testing",
        window.initializeOcrTesting
    );

    runInitializer(
        "OCR On-Page UI",
        window.initializeOcrOnPageItems
    );
}

export async function initializePage() {
    const page =
        document.querySelector(
            ".page"
        );

    if (
        !page
    ) {
        console.error(
            "OCR PAGE: Page root was not found."
        );

        return;
    }

    if (
        page.dataset.initialized
        === "true"
    ) {
        return;
    }

    try {

        initializeOcrSystems();

        page.dataset.initialized =
            "true";
    }
    catch (
        error
    ) {
        page.dataset.initialized =
            "false";

        console.error(
            "OCR PAGE: Initialization failed.",
            error
        );
    }
}