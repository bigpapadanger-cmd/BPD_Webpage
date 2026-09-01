"use strict";

const OCR_SCRIPT_PATHS = [
    "/ocr/JS/submit_core.js",
    "/ocr/JS/submit_img.js",
    "/ocr/JS/submit_testing.js",
    "/ocr/JS/submit_onpage_items.js"
];

function createOcrScript(src) {
    return new Promise(function(resolve, reject) {
        const script = document.createElement("script");

        script.src = src;
        script.async = false;
        script.dataset.ocrScript = src;

        script.addEventListener(
            "load",
            function() {
                script.dataset.loaded = "true";
                resolve();
            },
            { once: true }
        );

        script.addEventListener(
            "error",
            function() {
                script.dataset.failed = "true";

                reject(
                    new Error(
                        `Failed to load OCR script: ${src}`
                    )
                );
            },
            { once: true }
        );

        document.head.appendChild(script);
    });
}

function loadScript(src) {
    const existing = document.querySelector(
        `script[data-ocr-script="${src}"]`
    );

    if (existing?.dataset.loaded === "true") {
        return Promise.resolve();
    }

    if (existing) {
        existing.remove();
    }

    return createOcrScript(src);
}

async function loadOcrScripts() {
    for (const src of OCR_SCRIPT_PATHS) {
        await loadScript(src);
    }
}

function runInitializer(name, initializer) {
    if (typeof initializer !== "function") {
        throw new Error(
            `${name} initializer was not found.`
        );
    }

    const result = initializer();

    if (result === false) {
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
    const page = document.querySelector(
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
        await loadOcrScripts();

        initializeOcrSystems();

        page.dataset.initialized =
            "true";
    } catch (error) {
        page.dataset.initialized =
            "false";

        console.error(
            "OCR PAGE: Initialization failed.",
            error
        );
    }
}