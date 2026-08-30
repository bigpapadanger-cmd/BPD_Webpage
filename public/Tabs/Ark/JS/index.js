import {
    renderHeader
} from "/Framework/Shell/JS/renderHeader.js";


const arkPanels =
    document.querySelectorAll(
        "[data-ark-panel]"
    );

const gameCategory = "ark";
renderHeader({
    eyebrow:
        "BPD GAMING NETWORK",

    title:
        "ARK",

    tabs: [
        {
            label:
                "Mods",

            href:
                "/Ark?tab=mods"
        },
        {
            label:
                "Announcements",

            href:
                "/Ark?tab=announcements"
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
                panel.dataset.arkPanel !==
                tab;

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


async function loadModsForGame(
    game
) {

    const modList =
        document.getElementById(
            "arkModList"
        );


    if (!modList) {
        return;
    }


    try {

        const response =
            await fetch(
                `/api/curseforge/mods?game=${encodeURIComponent(
                    game
                )}`,
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
                "Unable to load mods."
            );

        }


        const mods =
            Array.isArray(
                data.mods
            )
                ? data.mods
                : [];


        modList.innerHTML =
            "";


        if (
            mods.length === 0
        ) {

            modList.innerHTML = `
                <p class="ark-mod-empty">
                    No active mods are currently listed.
                </p>
            `;

            return;

        }


        mods.forEach(
            mod => {

                modList.insertAdjacentHTML(
                    "beforeend",
                    createModCard(
                        mod
                    )
                );

            }
        );

    }
    catch (
        error
    ) {

        console.error(
            "ARK: Unable to load CurseForge mods.",
            error
        );


        modList.innerHTML = `
            <p class="ark-mod-empty">
                Mod information is currently unavailable.
            </p>
        `;

    }

}

async function loadCurseForgeMod(
    modId
) {

    const response =
        await fetch(
            `/api/curseforge/mod?game=${encodeURIComponent(
                gameCategory
            )}&id=${encodeURIComponent(
                modId
            )}`,
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
            `CurseForge mod ${modId} returned ${response.status}`
        );

    }


    const data =
        await response.json();


    if (
        data?.success !== true
    ) {

        throw new Error(
            data?.message ||
            `Unable to load mod ${modId}.`
        );

    }


    return data;

}


function createModCard(
    mod
) {

    const name =
        escapeHTML(
            mod.name ||
            "Unnamed Mod"
        );

    const summary =
        escapeHTML(
            mod.summary ||
            "No description available."
        );

    const website =
        escapeAttribute(
            mod.links?.websiteUrl ||
            "#"
        );

    const image =
        escapeAttribute(
            mod.logo?.thumbnailUrl ||
            ""
        );

    const version =
        escapeHTML(
            mod.version ||
            "—"
        );

    const updated =
        formatModDate(
            mod.lastUpdated
        );

    const downloads =
        formatModDownloads(
            mod.downloads
        );


    return `
        <a
            class="ark-mod-card"
            href="${website}"
            target="_blank"
            rel="noopener noreferrer"
        >

            <div class="ark-mod-media">

                ${
                    image
                        ? `
                            <img
                                class="ark-mod-image"
                                src="${image}"
                                alt="${name}"
                                loading="lazy"
                            >
                        `
                        : ""
                }

                <div class="ark-mod-overlay">

                    <div class="ark-mod-overlay-content">

                        <span class="ark-mod-status">
                            Active
                        </span>

                        <h4 class="ark-mod-title">
                            ${name}
                        </h4>

                    </div>


                    <span
                        class="ark-mod-external"
                        aria-hidden="true"
                    >
                        ↗
                    </span>

                </div>

            </div>


            <div class="ark-mod-content">

                <p class="ark-mod-description">
                    ${summary}
                </p>


                <div class="ark-mod-meta">

                    <span>
                        Version: ${version}
                    </span>

                    <span>
                        Updated: ${updated}
                    </span>

                    <span>
                        Downloads: ${downloads}
                    </span>

                </div>

            </div>

        </a>
    `;

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


function escapeHTML(
    value
) {

    return String(
        value ?? ""
    )
        .replaceAll(
            "&",
            "&amp;"
        )
        .replaceAll(
            "<",
            "&lt;"
        )
        .replaceAll(
            ">",
            "&gt;"
        )
        .replaceAll(
            '"',
            "&quot;"
        )
        .replaceAll(
            "'",
            "&#039;"
        );

}


function escapeAttribute(
    value
) {

    return escapeHTML(
        value
    );

}


initializeArkTabs();

renderArkPanel();

loadModsForGame(
    "ark"
);


window.addEventListener(
    "popstate",
    renderArkPanel
);