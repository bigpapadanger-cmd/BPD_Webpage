"use strict";

/* =========================================================
BPD GAMING NETWORK
ADMIN MANAGEMENT CLIENT

File:
    public/Global/Admin/Home/JS/index.js

Purpose:
    Initializes the Admin Management page when loaded by the
    BPD client-side router.

Responsibilities:
    - Verify server-side Admin authorization.
    - Reveal Admin content only after authorization succeeds.
    - Export initializePage() for the BPD router.

Security:
    - Discord authorization is performed server-side.
    - Client-side role claims are never trusted.
    - Admin API endpoints independently enforce permissions.

Important:
    - Sidebar HTML and sidebar behavior are handled by the
      global router/shell.
    - This module must not load or initialize the sidebar.
========================================================= */

/* =========================================================
CONSTANTS
========================================================= */

const ADMIN_ACCESS_URL =
    "/api/auth/admin/access";

/* =========================================================
ELEMENT LOOKUP
========================================================= */

function getAdminElements() {
    return {
        adminContent:
            document.getElementById(
                "adminContent"
            ),

        adminLoading:
            document.getElementById(
                "adminLoading"
            ),

        adminDenied:
            document.getElementById(
                "adminDenied"
            )
    };
}

/* =========================================================
PAGE STATE
========================================================= */

function showAuthorized() {
    const {
        adminContent,
        adminLoading,
        adminDenied
    } =
        getAdminElements();

    if (
        adminLoading
    ) {
        adminLoading.hidden =
            true;
    }

    if (
        adminDenied
    ) {
        adminDenied.hidden =
            true;
    }

    if (
        adminContent
    ) {
        adminContent.hidden =
            false;
    }
}

function showDenied() {
    const {
        adminContent,
        adminLoading,
        adminDenied
    } =
        getAdminElements();

    if (
        adminLoading
    ) {
        adminLoading.hidden =
            true;
    }

    if (
        adminContent
    ) {
        adminContent.hidden =
            true;
    }

    if (
        adminDenied
    ) {
        adminDenied.hidden =
            false;
    }
}

/* =========================================================
VERIFY ADMIN ACCESS
========================================================= */

async function verifyAdminAccess() {
    const response =
        await fetch(
            ADMIN_ACCESS_URL,
            {
                method:
                    "GET",

                credentials:
                    "same-origin",

                headers: {
                    "Accept":
                        "application/json"
                },

                cache:
                    "no-store"
            }
        );

    let result =
        null;

    try {
        result =
            await response.json();
    }
    catch {
        return false;
    }

    return (
        response.ok
        && result?.authorized ===
            true
    );
}

/* =========================================================
ROUTER ENTRY POINT
========================================================= */

export async function initializePage() {
    try {
        const authorized =
            await verifyAdminAccess();

        if (
            !authorized
        ) {
            showDenied();

            return;
        }

        showAuthorized();
    }
    catch (
        error
    ) {
        console.error(
            "ADMIN MANAGEMENT: Initialization failed.",
            {
                name:
                    error?.name
                    || "Error",

                message:
                    error?.message
                    || "Unknown error"
            }
        );

        showDenied();
    }
}