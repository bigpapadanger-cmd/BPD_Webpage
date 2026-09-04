"use strict";

/* =========================================================
   BPD GAMING NETWORK
   ROUTE MODULE INITIALIZATION
   ========================================================= */

export async function initializeRouteModule(
    moduleFile
) {
    if (
        !moduleFile
    ) {
        return;
    }

    const moduleUrl =
        new URL(
            moduleFile,
            window.location.origin
        );

    const pageModule =
        await import(
            moduleUrl.href
        );

    if (
        typeof pageModule.initializePage !==
        "function"
    ) {
        throw new Error(
            "Route module does not export initializePage(): "
            + moduleUrl.pathname
        );
    }

    await pageModule.initializePage();
}