"use strict";

const OCR_SCRIPT_PATHS = [
    "/Tabs/RocketLeague/SubmitImage/JS/submit_core.js",
    "/Tabs/RocketLeague/SubmitImage/JS/submit_img.js",
    "/Tabs/RocketLeague/SubmitImage/JS/submit_testing.js",
    "/Tabs/RocketLeague/SubmitImage/JS/submit_onpage_items.js"
];

function loadScript(
    src
) {
    return new Promise(
        (
            resolve,
            reject
        ) => {
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
                        once:
                            true
                    }
                );

                existing.addEventListener(
                    "error",
                    reject,
                    {
                        once:
                            true
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
                () => {
                    script.dataset.loaded =
                        "true";

                    resolve();
                },
                {
                    once:
                        true
                }
            );

            script.addEventListener(
                "error",
                () => {
                    reject(
                        new Error(
                            `Failed to load OCR script: ${src}`
                        )
                    );
                },
                {
                    once:
                        true
                }
            );

            document.head.appendChild(
                script
            );
        }
    );
}

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
        await loadOcrScripts();

        page.dataset.initialized =
            "true";

    } catch (
        error
    ) {
        console.error(
            "OCR PAGE: Initialization failed.",
            {
                name:
                    error?.name ||
                    "Error",

                message:
                    error?.message ||
                    "Unknown error"
            }
        );
    }
}