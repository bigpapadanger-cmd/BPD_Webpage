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
import {
    OCR_SCRIPT_ID
} from "/scripts/cacheHandler.js";


function loadScript(
    src
) {
    const scriptUrl =
        new URL(
            src,
            window.location.origin
        );

    scriptUrl.searchParams.set(
        "v",
        OCR_SCRIPT_ID
    );

    const absoluteSrc =
        scriptUrl.href;

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
                function() {
                    console.log(
                        "[OCR SCRIPT] Loaded:",
                        absoluteSrc
                    );

                    resolve();
                };

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
    try {
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

        console.log(
            "[OCR PAGE] All OCR systems initialized."
        );

        return true;
    }
    catch (
        error
    ) {
        console.error(
            "[OCR PAGE] OCR system initialization failed.",
            error
        );

        const status =
            document.getElementById(
                "status"
            );

        if (
            status
        ) {
            status.textContent =
                "FAIL: "
                + (
                    error?.message
                    || "OCR initialization failed."
                );
        }

        throw error;
    }
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

        document.addEventListener(
            "pointerdown",
            function(
                event
            ) {
                console.log(
                    "[POINTER DOWN]",
                    event.target
                );
            },
            true
        );

        document.addEventListener(
            "click",
            function(
                event
            ) {
                console.log(
                    "[CLICK]",
                    event.target
                );
            },
            true
        );

        page.dataset.initialized =
            "true";

        console.log(
            "[OCR PAGE] Ready."
        );
    }
    catch (
        error
    ) {
        page.dataset.initialized =
            "false";

        console.error(
            "[OCR PAGE] Initialization failed.",
            error
        );

        throw error;
    }
}