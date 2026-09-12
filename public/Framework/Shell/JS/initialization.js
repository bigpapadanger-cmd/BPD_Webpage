"use strict";

/* =========================================================
BPD GAMING NETWORK
ROUTE MODULE INITIALIZATION

File:
    Framework/Shell/JS/initialization.js

Purpose:
    Loads and initializes route-specific JavaScript modules.

Description:
    - Accepts a route module path or URL.
    - Restricts route modules to the current site origin.
    - Prevents initialization.js from loading itself.
    - Dynamically imports the requested ES module.
    - Requires the module to export initializePage().
    - Propagates route initialization failures to the router.
========================================================= */

/* =========================================================
INITIALIZE ROUTE MODULE
========================================================= */

export async function initializeRouteModule(
    moduleFile
) {
    const normalizedModuleFile =
        String(
            moduleFile
            || ""
        )
            .trim();

    if (
        !normalizedModuleFile
    ) {
        return false;
    }

    /* =====================================================
    NORMALIZE MODULE URL
    ===================================================== */

    let moduleUrl;

    try {
        moduleUrl =
            new URL(
                normalizedModuleFile,
                window.location.origin
            );
    }
    catch (
        error
    ) {
        throw new Error(
            "Invalid route module URL."
            + (
                error?.message
                    ? " — " + error.message
                    : ""
            )
        );
    }

    /* =====================================================
    SAME-ORIGIN REQUIREMENT
    ===================================================== */

    if (
        moduleUrl.origin !==
        window.location.origin
    ) {
        throw new Error(
            "Route modules must use the current site origin: "
            + moduleUrl.href
        );
    }

    /* =====================================================
    SELF-IMPORT PROTECTION
    ===================================================== */

    if (
        moduleUrl.pathname ===
        "/Framework/Shell/JS/initialization.js"
    ) {
        throw new Error(
            "initialization.js cannot initialize itself as a route module."
        );
    }

    /* =====================================================
    IMPORT MODULE
    ===================================================== */

    let pageModule;

    try {
        pageModule =
            await import(
                moduleUrl.href
            );
    }
    catch (
        error
    ) {
        throw new Error(
            "Failed to load route module: "
            + moduleUrl.pathname
            + (
                error?.message
                    ? " — " + error.message
                    : ""
            )
        );
    }

    /* =====================================================
    INITIALIZER CONTRACT
    ===================================================== */

    if (
        typeof pageModule
            ?.initializePage !==
        "function"
    ) {
        throw new Error(
            "Route module does not export initializePage(): "
            + moduleUrl.pathname
        );
    }

    /* =====================================================
    INITIALIZE PAGE
    ===================================================== */

    try {
        await pageModule.initializePage();
    }
    catch (
        error
    ) {
        throw new Error(
            "Route module initializePage() failed: "
            + moduleUrl.pathname
            + (
                error?.message
                    ? " — " + error.message
                    : ""
            )
        );
    }

    return true;
}