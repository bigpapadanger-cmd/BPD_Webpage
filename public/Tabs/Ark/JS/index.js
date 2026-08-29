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
            label: "Mods",
            href: "/ARK?tab=mods"
        },
        {
            label: "Announcements",
            href: "/ARK?tab=announcements"
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


function navigateArkTab(
    tab
) {

    const url =
        new URL(
            window.location.href
        );

    url.searchParams.set(
        "tab",
        tab
    );

    window.history.pushState(
        {},
        "",
        url
    );

    renderArkPanel();
}


function initializeArkTabs() {

    document
        .querySelectorAll(
            "[data-header-tab]"
        )
        .forEach(
            tab => {

                tab.addEventListener(
                    "click",
                    () => {

                        navigateArkTab(
                            tab.dataset.headerTab
                        );

                    }
                );

            }
        );

}


async function loadPapaDangerAdminMod() {

    const card =
        document.getElementById(
            "papaDangerAdminCard"
        );

    if (!card) {
        return;
    }


    try {

        const response =
            await fetch(
                "/api/cursforge/mod",
                {
                    method:
                        "GET",

                    cache:
                        "no-store",

                    headers: {
                        "accept":
                            "application/json"
                    }
                }
            );


        if (!response.ok) {

            throw new Error(
                `Mod API returned ${response.status}`
            );

        }


        const data =
            await response.json();


        if (
            data?.success !== true
        ) {

            throw new Error(
                data?.message ||
                "Unable to load mod."
            );

        }


        const title =
            document.getElementById(
                "papaDangerAdminTitle"
            );

        const description =
            document.getElementById(
                "papaDangerAdminDescription"
            );

        const version =
            document.getElementById(
                "papaDangerAdminVersion"
            );

        const updated =
            document.getElementById(
                "papaDangerAdminUpdated"
            );

        const downloads =
            document.getElementById(
                "papaDangerAdminDownloads"
            );

        const image =
            document.getElementById(
                "papaDangerAdminImage"
            );


        if (title) {

            title.textContent =
                data.name ||
                "Papa Danger's Admin Advancements";

        }


        if (description) {

            description.textContent =
                data.summary ||
                "No description available.";

        }


        if (version) {

            version.textContent =
                `Version: ${
                    data.version ||
                    "—"
                }`;

        }


        if (updated) {

            updated.textContent =
                `Updated: ${
                    formatModDate(
                        data.lastUpdated
                    )
                }`;

        }


        if (downloads) {

            downloads.textContent =
                `Downloads: ${
                    formatModDownloads(
                        data.downloads
                    )
                }`;

        }


        if (
            image &&
            data.logo?.thumbnailUrl
        ) {

            image.src =
                data.logo.thumbnailUrl;

        }


        if (
            data.links?.websiteUrl
        ) {

            card.href =
                data.links.websiteUrl;

        }

    }
    catch (
        error
    ) {

        console.error(
            "ARK: Unable to load CurseForge mod.",
            error
        );


        const description =
            document.getElementById(
                "papaDangerAdminDescription"
            );


        if (description) {

            description.textContent =
                "Mod information is currently unavailable.";

        }

    }

}


function formatModDate(
    value
) {

    if (!value) {
        return "—";
    }


    const date =
        new Date(
            value
        );


    if (
        Number.isNaN(
            date.getTime()
        )
    ) {
        return "—";
    }


    return date.toLocaleDateString(
        undefined,
        {
            year:
                "numeric",

            month:
                "short",

            day:
                "numeric"
        }
    );

}


function formatModDownloads(
    value
) {

    const downloads =
        Number(
            value
        );


    if (
        !Number.isFinite(
            downloads
        )
    ) {
        return "—";
    }


    return downloads.toLocaleString();

}


initializeArkTabs();

renderArkPanel();

loadPapaDangerAdminMod();


window.addEventListener(
    "popstate",
    renderArkPanel
);