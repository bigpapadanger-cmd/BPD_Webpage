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
    - Load the centralized BPD client authorization state.
    - Require current Discord-backed Admin authorization.
    - Reveal Admin content only after authorization succeeds.
    - Fail closed when Admin authorization is denied or
      unavailable.
    - Export initializePage() for the BPD router.

Security:
    - This module is NOT a security boundary.
    - Discord/Admin authorization is verified server-side by:
          GET /api/auth/admin/access
    - The centralized client auth service performs that
      server authorization check and exposes the result.
    - Client-side state controls page presentation only.
    - Admin API endpoints independently enforce permissions.
    - Client-side account IDs, Discord IDs, permissions, and
      responsibility roles are never trusted by protected
      server APIs.

Important:
    - Sidebar HTML and sidebar behavior are handled by the
      global router/shell.
    - This module must not load or initialize the sidebar.
    - This module must not call /api/auth/admin/access
      directly.
    - Admin authorization is obtained through the centralized
      /Framework/Auth/auth.js service.
========================================================= */

/* =========================================================
IMPORTS
========================================================= */

import {
    getAuthState,
    hasAdminAccess
} from "/Framework/Auth/auth.js";

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

function showLoading() {
    const {
        adminContent,
        adminLoading,
        adminDenied
    } =
        getAdminElements();

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
            true;
    }

    if (
        adminLoading
    ) {
        adminLoading.hidden =
            false;
    }
}

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
ADMIN ACCESS

The centralized auth service performs:

    GET /api/auth/session
        ↓
    authenticated active account
        ↓
    GET /api/auth/admin/access
        ↓
    live Discord authorization
        ↓
    responsibility-role synchronization
        ↓
    state.admin

This page consumes that established state rather than
performing a second Admin authorization request.
========================================================= */

async function loadAdminAuthorization() {
    /*
     * force:true is intentional for an Admin page entry.
     *
     * Normal site/profile loading may have populated the
     * centralized state already, but entering a protected
     * Admin page should perform a fresh server authorization
     * check rather than relying on the normal short-lived
     * client cache.
     */
    const state =
        await getAuthState({
            force:
                true
        });

    return {
        state,

        authorized:
            hasAdminAccess(
                state
            )
    };
}

/* =========================================================
ROUTER ENTRY POINT
========================================================= */

export async function initializePage() {
    showLoading();

    try {
        const {
            state,
            authorized
        } =
            await loadAdminAuthorization();

        if (
            !authorized
        ) {
            if (
                state?.admin?.available ===
                false
            ) {
                console.warn(
                    "ADMIN MANAGEMENT: Admin authorization is unavailable.",
                    {
                        code:
                            state?.admin?.error?.code
                            || null,

                        status:
                            state?.admin?.error?.status
                            || null
                    }
                );
            }

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