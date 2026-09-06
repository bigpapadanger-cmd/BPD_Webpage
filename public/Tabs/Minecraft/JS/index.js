import {
    renderHeader
} from "/Framework/Shell/JS/renderHeader.js";

export function initializePage() {
    renderHeader({
        eyebrow:
            "BPD GAMING NETWORK",

        title:
            "Minecraft",

        tabs: [
            {
                label:
                    "Mods",

                href:
                    "/Minecraft/Mods"
            },
            {
                label:
                    "Announcements",

                href:
                    "/Minecraft/Announcements"
            }
        ]
    });

    initializeMinecraftCommunityActions();

    return true;
}

function initializeMinecraftCommunityActions() {
    const suggestButton =
        document.getElementById(
            "minecraftSuggestIdeaButton"
        );

    const joinButton =
        document.getElementById(
            "minecraftJoinTeamButton"
        );

    const ideaPanel =
        document.getElementById(
            "minecraftIdeaPanel"
        );

    const joinPanel =
        document.getElementById(
            "minecraftJoinTeamPanel"
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