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

        submenu.style.top = "";
        submenu.style.left = "";
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

function positionCollapsedSubmenu(
    button,
    submenu
) {
    const sidebar =
        document.getElementById(
            "sidebar"
        );

    if (!sidebar) {
        return;
    }

    const collapsed =
        document.body.classList.contains(
            "sidebar-collapsed"
        );

    if (!collapsed) {
        submenu.style.top = "";
        submenu.style.left = "";

        return;
    }

    const buttonRect =
        button.getBoundingClientRect();

    const sidebarRect =
        sidebar.getBoundingClientRect();

    const viewportPadding = 10;

    let top =
        buttonRect.top;

    const left =
        sidebarRect.right + 8;

    submenu.style.left =
        `${left}px`;

    submenu.style.top =
        `${top}px`;

    const submenuRect =
        submenu.getBoundingClientRect();

    const maxBottom =
        window.innerHeight -
        viewportPadding;

    if (
        submenuRect.bottom >
        maxBottom
    ) {
        top -=
            submenuRect.bottom -
            maxBottom;
    }

    if (top < viewportPadding) {
        top =
            viewportPadding;
    }

    submenu.style.top =
        `${top}px`;
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
        console.error(
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

    if (opening) {
        positionCollapsedSubmenu(
            button,
            submenu
        );
    }
}

function closeAllSubmenus() {
    document
        .querySelectorAll(
            "#sidebar .sidebar-menu-toggle"
        )
        .forEach(function(button) {
            closeSubmenu(button);
        });
}

function handleOutsideClick(event) {
    const sidebar =
        document.getElementById(
            "sidebar"
        );

    if (!sidebar) {
        return;
    }

    if (
        event.target.closest(
            "#sidebar .sidebar-menu"
        )
    ) {
        return;
    }

    closeAllSubmenus();
}

function handleViewportChange() {
    document
        .querySelectorAll(
            "#sidebar .sidebar-menu-toggle" +
            '[aria-expanded="true"]'
        )
        .forEach(function(button) {
            const submenuId =
                button.getAttribute(
                    "aria-controls"
                );

            const submenu =
                document.getElementById(
                    submenuId
                );

            if (!submenu) {
                return;
            }

            positionCollapsedSubmenu(
                button,
                submenu
            );
        });
}

let globalListenersInitialized =
    false;

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
                function(event) {
                    event.stopPropagation();

                    toggleSubmenu(
                        button
                    );
                }
            );

            button.dataset.initialized =
                "true";
        });

    if (!globalListenersInitialized) {
        document.addEventListener(
            "click",
            handleOutsideClick
        );

        window.addEventListener(
            "resize",
            handleViewportChange
        );

        window.addEventListener(
            "scroll",
            handleViewportChange,
            true
        );

        globalListenersInitialized =
            true;
    }
}