import {
    renderHeader
} from "/Framework/Shell/JS/renderHeader.js";

export function initializePage() {
    renderHeader({
        eyebrow:
            "BPD GAMING NETWORK",

        title:
            "Ark Homepage",

        tabs: [
            {
                label:
                    "Mods",

                href:
                    "/Ark/Mods"
            },
            {
                label:
                    "Announcements",

                href:
                    "/Ark/Announcements"
            }
        ]
    });

    initializeArkCommunityActions();

    return true;
}

function initializeArkCommunityActions() {
    const suggestButton =
        document.getElementById(
            "arkSuggestIdeaButton"
        );

    const joinButton =
        document.getElementById(
            "arkJoinTeamButton"
        );

    const ideaPanel =
        document.getElementById(
            "arkIdeaPanel"
        );

    const joinPanel =
        document.getElementById(
            "arkJoinTeamPanel"
        );

    function closeCommunityPanels() {
        if (
            ideaPanel
        ) {
            ideaPanel.hidden =
                true;
        }

        if (
            joinPanel
        ) {
            joinPanel.hidden =
                true;
        }

        if (
            suggestButton
        ) {
            suggestButton.setAttribute(
                "aria-expanded",
                "false"
            );
        }

        if (
            joinButton
        ) {
            joinButton.setAttribute(
                "aria-expanded",
                "false"
            );
        }
    }

    if (
        suggestButton
        && ideaPanel
    ) {
        suggestButton.addEventListener(
            "click",
            function() {
                const shouldOpen =
                    ideaPanel.hidden;

                closeCommunityPanels();

                if (
                    shouldOpen
                ) {
                    ideaPanel.hidden =
                        false;

                    suggestButton.setAttribute(
                        "aria-expanded",
                        "true"
                    );
                }
            }
        );
    }

    if (
        joinButton
        && joinPanel
    ) {
        joinButton.addEventListener(
            "click",
            function() {
                const shouldOpen =
                    joinPanel.hidden;

                closeCommunityPanels();

                if (
                    shouldOpen
                ) {
                    joinPanel.hidden =
                        false;

                    joinButton.setAttribute(
                        "aria-expanded",
                        "true"
                    );
                }
            }
        );
    }
}