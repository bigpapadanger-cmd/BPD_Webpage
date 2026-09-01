"use strict";

const OCR_SCRIPT_PATHS = [
    "/ocr/JS/submit_core.js",
    "/ocr/JS/submit_img.js",
    "/ocr/JS/submit_testing.js",
    "/ocr/JS/submit_onpage_items.js"
];


/* =========================================================
   SCRIPT LOADER
   ========================================================= */

function loadScript(src) {
    return new Promise(
        function(resolve, reject) {
            const existing =
                document.querySelector(
                    `script[data-ocr-script="${src}"]`
                );

            if (existing) {
                if (
                    existing.dataset.loaded ===
                    "true"
                ) {
                    resolve();
                    return;
                }

                existing.addEventListener(
                    "load",
                    resolve,
                    {
                        once: true
                    }
                );

                existing.addEventListener(
                    "error",
                    function() {
                        reject(
                            new Error(
                                `Failed to load OCR script: ${src}`
                            )
                        );
                    },
                    {
                        once: true
                    }
                );

                return;
            }

            const script =
                document.createElement(
                    "script"
                );

            script.src =
                src;

            script.async =
                false;

            script.dataset.ocrScript =
                src;

            script.addEventListener(
                "load",
                function() {
                    script.dataset.loaded =
                        "true";

                    resolve();
                },
                {
                    once: true
                }
            );

            script.addEventListener(
                "error",
                function() {
                    reject(
                        new Error(
                            `Failed to load OCR script: ${src}`
                        )
                    );
                },
                {
                    once: true
                }
            );

            document.head.appendChild(
                script
            );
        }
    );
}


/* =========================================================
   LOAD OCR FILES
   ========================================================= */

async function loadOcrScripts() {
    for (
        const src
        of OCR_SCRIPT_PATHS
    ) {
        await loadScript(
            src
        );
    }
}


/* =========================================================
   RUN OCR INITIALIZERS
   ========================================================= */

function initializeOcrSystems() {
    const initializers = [
        {
            name:
                "OCR Core",

            fn:
                window.initializeOcrCore
        },
        {
            name:
                "OCR Submission",

            fn:
                window.initializeOcrSubmission
        },
        {
            name:
                "OCR Testing",

            fn:
                window.initializeOcrTesting
        },
        {
            name:
                "OCR On-Page UI",

            fn:
                window.initializeOcrOnPageItems
        }
    ];


    for (
        const initializer
        of initializers
    ) {
        if (
            typeof initializer.fn !==
            "function"
        ) {
            throw new Error(
                `${initializer.name} initializer was not found.`
            );
        }

        const result =
            initializer.fn();

        if (
            result ===
            false
        ) {
            throw new Error(
                `${initializer.name} initialization failed.`
            );
        }
    }
}


/* =========================================================
   PAGE INITIALIZATION
   Called by SPA router.
   ========================================================= */

export async function initializePage() {
    const page =
        document.querySelector(
            ".page"
        );

    if (!page) {
        console.error(
            "OCR PAGE: Page root was not found."
        );

        return;
    }


    if (
        page.dataset.initialized ===
        "true"
    ) {
        return;
    }


    try {
        /*
        -----------------------------------------------------
        Load the legacy OCR files once.

        On later SPA visits these scripts remain loaded,
        but their explicit initializer functions are called
        again against the newly injected DOM.
        -----------------------------------------------------
        */

        await loadOcrScripts();


        /*
        -----------------------------------------------------
        Initialize in dependency order.
        -----------------------------------------------------
        */

        initializeOcrSystems();


        page.dataset.initialized =
            "true";

    } catch (error) {
        console.error(
            "OCR PAGE: Initialization failed.",
            error
        );
    }
}