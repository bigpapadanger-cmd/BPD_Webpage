"use strict";

/* =========================================================
BPD GAMING NETWORK
ADMIN MANAGEMENT CLIENT

File:
    public/Admin/admin.js

Purpose:
    Initializes the Admin Management area.

Responsibilities:
    - Verify server-side Admin authorization.
    - Load Admin-specific sidebar content.
    - Load shared sidebar hover content.
    - Initialize Admin sidebar behavior.
    - Reveal Admin content only after authorization succeeds.

Security:
    - Discord authorization is performed server-side.
    - Client-side role claims are never trusted.
    - Admin API endpoints independently enforce permissions.
========================================================= */

import {
    initializeAdminSidebar,
    loadAdminSidebarHover
} from "/Framework/Shell/JS/Admin/sidebar.js";

/* =========================================================
CONSTANTS
========================================================= */

const ADMIN_ACCESS_URL =
    "/api/auth/admin/access";

const ADMIN_SIDEBAR_URL =
    "/Framework/Shell/HTML/Admin/sidebar.html";

/* =========================================================
ELEMENTS
========================================================= */

const adminContent =
    document.getElementById(
        "adminContent"
    );

const adminLoading =
    document.getElementById(
        "adminLoading"
    );

const adminDenied =
    document.getElementById(
        "adminDenied"
    );

const sidebar =
    document.getElementById(
        "sidebar"
    );

/* =========================================================
PAGE STATE
========================================================= */

function showAuthorized() {
    adminLoading.hidden =
        true;

    adminDenied.hidden =
        true;

    adminContent.hidden =
        false;
}

function showDenied() {
    adminLoading.hidden =
        true;

    adminContent.hidden =
        true;

    adminDenied.hidden =
        false;
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
        && result?.authorized === true
    );
}

/* =========================================================
LOAD ADMIN SIDEBAR
========================================================= */

async function loadAdminSidebar() {
    if (
        !sidebar
    ) {
        throw new Error(
            "Admin sidebar container was not found."
        );
    }

    const response =
        await fetch(
            ADMIN_SIDEBAR_URL,
            {
                cache:
                    "no-store"
            }
        );

    if (
        !response.ok
    ) {
        throw new Error(
            `Admin sidebar failed: ${response.status}`
        );
    }

    sidebar.innerHTML =
        await response.text();
}

/* =========================================================
INITIALIZE ADMIN SHELL
========================================================= */

async function initializeAdminShell() {
    await loadAdminSidebar();
    await loadAdminSidebarHover();

    initializeAdminSidebar();
}

/* =========================================================
INITIALIZE ADMIN PAGE
========================================================= */

async function initializeAdminPage() {
    try {
        const authorized =
            await verifyAdminAccess();

        if (
            !authorized
        ) {
            showDenied();
            return;
        }

        await initializeAdminShell();

        showAuthorized();
    }
    catch (
        error
    ) {
        console.error(
            "[ADMIN INITIALIZATION FAILED]",
            error
        );

        showDenied();
    }
}

/* =========================================================
START
========================================================= */

initializeAdminPage();