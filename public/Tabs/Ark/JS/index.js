import {
    renderHeader
} from "/Framework/Shell/JS/renderHeader.js";

const arkPanels =
    document.querySelectorAll(
        "[data-ark-panel]"
    );

renderHeader({
    eyebrow: "BPD GAMING NETWORK",

    title: "ARK",

    tabs: [
        {
            label: "Mods"
        },
        {
            label: "Announcements"
        }
    ]
});


function renderArkPanel() {

    const params =
        new URLSearchParams(
            window.location.search
        );

    const tab =
        params.get("tab") ||
        "mods";


    arkPanels.forEach(
        panel => {

            panel.hidden =
                panel.dataset.arkPanel !== tab;

        }
    );

}


renderArkPanel();

window.addEventListener(
    "popstate",
    renderArkPanel
);