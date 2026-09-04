"use strict";

import {
    OCR_JOB_SUBMIT_URL,
    OCR_JOB_RESULT_URL,
    OCR_CONFIRM_URL
} from "/scripts/apiRoutes.js";

import {
    apiFetch
} from "/scripts/apiConnection.js";

const OCR_SCRIPTS = [
    "/ocr/JS/submit_core.js",
    "/ocr/JS/ocr_review_policy.js",
    "/ocr/JS/submit_img.js",
    "/ocr/JS/submit_testing.js",
    "/ocr/JS/submit_onpage_items.js"
];

function loadScript(
    src
) {
    const absoluteSrc =
        new URL(
            src,
            window.location.origin
        ).href;

    const existing =
        Array.from(
            document.scripts
        )
            .find(
                function(
                    script
                ) {
                    return (
                        script.src ===
                        absoluteSrc
                    );
                }
            );

    if (
        existing
    ) {
        return Promise.resolve();
    }

    return new Promise(
        function(
            resolve,
            reject
        ) {
            const script =
                document.createElement(
                    "script"
                );

            script.src =
                absoluteSrc;

            script.async =
                false;

            script.onload =
                resolve;

            script.onerror =
                function() {
                    script.remove();

                    reject(
                        new Error(
                            "Failed to load OCR script: "
                            + src
                        )
                    );
                };

            document.head.appendChild(
                script
            );
        }
    );
}

async function loadOcrScripts() {
    for (
        const src
        of OCR_SCRIPTS
    ) {
        await loadScript(
            src
        );
    }
}

function initializeOcrApi() {
    if (
        window.BPDOcrApi
    ) {
        return;
    }

    window.BPDOcrApi =
        Object.freeze({
            OCR_JOB_SUBMIT_URL,
            OCR_JOB_RESULT_URL,
            OCR_CONFIRM_URL,
            apiFetch
        });
}

function runInitializer(
    name,
    initializer
) {
    if (
        typeof initializer !==
        "function"
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
        throw new Error(
            "OCR page was not found."
        );
    }

    try {
        initializeOcrApi();

        await loadOcrScripts();

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

        throw error;
    }
}