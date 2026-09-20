"use strict";

/* =========================================================
BPD GAMING NETWORK
OCR PAGE INITIALIZER

File:
    /ocr/JS/index.js

Purpose:
    Initializes the protected Rocket League OCR page.

Responsibilities:
    - Verifies Epic-backed route authorization.
    - Refreshes Rocket League auth/profile UI state.
    - Exposes the OCR API bridge.
    - Loads OCR page scripts in order.
    - Initializes OCR subsystems once.
    - Preserves SPA-safe reinitialization behavior.

Security:
    - authorizeRoute() remains the route-access gate.
    - Rocket League auth-view initialization is UI/state
      synchronization and is not a replacement for route
      authorization.
========================================================= */

import {
    OCR_JOB_SUBMIT_URL,
    OCR_JOB_RESULT_URL,
    OCR_CONFIRM_URL
} from "/scripts/apiRoutes.js";

import {
    apiFetch
} from "/scripts/apiConnection.js";

import {
    OCR_SCRIPT_ID
} from "/scripts/cacheHandler.js";

import {
    authorizeRoute
} from "/Framework/Auth/auth.js";

import {
    initializeRocketLeagueAuthView
} from "../../Tabs/RocketLeague/Index/JS/auth.js";

/* =========================================================
OCR SCRIPT REGISTRY
========================================================= */

const OCR_SCRIPTS = [
    "/ocr/JS/submit_core.js",
    "/ocr/JS/submit_img.js",
    "/ocr/JS/submit_testing.js",
    "/ocr/JS/submit_onpage_items.js"
];

/* =========================================================
SCRIPT LOADING
========================================================= */

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

/* =========================================================
OCR API BRIDGE
========================================================= */

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

/* =========================================================
INITIALIZER SAFETY
========================================================= */

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
        result ===
        false
    ) {
        throw new Error(
            `${name} initialization failed.`
        );
    }
}

/* =========================================================
OCR SYSTEM INITIALIZATION
========================================================= */

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

/* =========================================================
ROCKET LEAGUE AUTH STATE

Route authorization and Rocket League UI-state
initialization are intentionally separate.

authorizeRoute():
    Determines whether the user may access OCR.

initializeRocketLeagueAuthView():
    Refreshes normalized Rocket League account/profile state
    used by Rocket League UI such as the sidebar.
========================================================= */

async function initializeRocketLeagueState() {
    if (
        typeof initializeRocketLeagueAuthView !==
        "function"
    ) {
        throw new Error(
            "Rocket League auth view initializer was not found."
        );
    }

    await initializeRocketLeagueAuthView();

    console.log(
        "[OCR PAGE] Rocket League auth state initialized."
    );
}

/* =========================================================
ROUTE AUTHORIZATION
========================================================= */

async function authorizeOcrRoute() {
    const {
        evaluation
    } =
        await authorizeRoute({
            required:
                true,

            provider:
                "epic"
        });

    if (
        evaluation?.allowed !==
        true
    ) {
        console.warn(
            "[OCR PAGE] Route authorization denied."
        );

        return false;
    }

    return true;
}

/* =========================================================
ROUTE INITIALIZATION
========================================================= */

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

    /*
     * Always re-evaluate protected route access.
     *
     * This runs before the page's initialization guard so
     * an SPA revisit cannot rely on stale authorization.
     */
    const authorized =
        await authorizeOcrRoute();

    if (
        !authorized
    ) {
        return false;
    }

    /*
     * Refresh Rocket League auth/profile state even if OCR
     * itself was already initialized.
     *
     * This allows the Rocket League sidebar to receive the
     * current profileComplete / rocketLeagueAccess state.
     */
    await initializeRocketLeagueState();

    /*
     * OCR subsystems themselves only need to initialize once.
     */
    if (
        page.dataset.initialized ===
        "true"
    ) {
        console.log(
            "[OCR PAGE] OCR systems already initialized."
        );

        return true;
    }

    try {
        initializeOcrApi();

        await loadOcrScripts();

        initializeOcrSystems();

        page.dataset.initialized =
            "true";

        console.log(
            "[OCR PAGE] Ready."
        );

        return true;
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