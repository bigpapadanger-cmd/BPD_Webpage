"use strict";

function closeSubmenu(button) {
    const submenuId =
        button.getAttribute(
            "aria-controls"
        );

    const submenu =
        document.getElementById(
            submenuId
        );

    button.setAttribute(
        "aria-expanded",
        "false"
    );

    if (submenu) {
        submenu.hidden = true;
    }
}

function closeOtherSubmenus(
    currentButton
) {
    document
        .querySelectorAll(
            "#sidebar .sidebar-menu-toggle"
        )
        .forEach(function(button) {
            if (button !== currentButton) {
                closeSubmenu(button);
            }
        });
}

function toggleSubmenu(button) {
    const submenuId =
        button.getAttribute(
            "aria-controls"
        );

    const submenu =
        document.getElementById(
            submenuId
        );

    if (!submenu) {
        console.warn(
            "SIDEBAR SUBMENU: Submenu not found.",
            submenuId
        );

        return;
    }

    const opening =
        button.getAttribute(
            "aria-expanded"
        ) !== "true";

    closeOtherSubmenus(button);

    button.setAttribute(
        "aria-expanded",
        String(opening)
    );

    submenu.hidden =
        !opening;
}

export function initializeSidebarSubmenus() {
    const sidebar =
        document.getElementById(
            "sidebar"
        );

    if (!sidebar) {
        return;
    }

    sidebar
        .querySelectorAll(
            ".sidebar-menu-toggle"
        )
        .forEach(function(button) {
            if (
                button.dataset.initialized ===
                "true"
            ) {
                return;
            }

            button.addEventListener(
                "click",
                function() {
                    toggleSubmenu(button);
                }
            );

            button.dataset.initialized =
                "true";
        });
}