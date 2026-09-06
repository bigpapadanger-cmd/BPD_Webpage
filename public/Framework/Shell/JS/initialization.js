"use strict";

/* =========================================================
   BPD GAMING NETWORK
   ROUTE MODULE INITIALIZATION
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

    const moduleUrl =
        new URL(
            normalizedModuleFile,
            window.location.origin
        );

    if (
        moduleUrl.pathname ===
        "/Framework/Shell/JS/initialization.js"
    ) {
        throw new Error(
            "initialization.js cannot initialize itself as a route module."
        );
    }

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

    if (
        typeof pageModule?.initializePage !==
        "function"
    ) {
        throw new Error(
            "Route module does not export initializePage(): "
            + moduleUrl.pathname
        );
    }

    await pageModule.initializePage();

    return true;
}