/*
=========================================================
BPD GAMING NETWORK
ADMIN SIDEBAR NAVIGATION

File:
    Framework/Shell/JS/Sidebar/admin_navigation.js

Purpose:
    Shows the Admin navigation item only when the current
    authenticated account has authorized Admin/staff access.
=========================================================
*/

export async function setupAdminNavigation() {
    const adminNavItem =
        document.getElementById(
            "adminNavItem"
        );

    if (
        !adminNavItem
    ) {
        return;
    }

    adminNavItem.hidden =
        true;

    try {
        const response =
            await fetch(
                "/api/auth/admin/access",
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

        if (
            !response.ok
        ) {
            return;
        }

        const result =
            await response.json();

        if (
            result?.success === true
            && result?.authorized === true
        ) {
            adminNavItem.hidden =
                false;
        }
    }
    catch (
        error
    ) {
        console.error(
            "ADMIN NAVIGATION ACCESS CHECK FAILED:",
            error
        );
    }
}