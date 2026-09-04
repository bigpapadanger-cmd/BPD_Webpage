import {
    renderHeader
} from "/Framework/Shell/JS/renderHeader.js";
import { CF_MOD_LIST_API } from "../../../scripts/apiRoutes.js";
import { apiFetch } from "../../../scripts/apiConnection.js";

const gameCategory =
    "minecraft";


const MOD_GLOWS = [
    "34, 197, 94",
    "22, 163, 74",
    "132, 204, 22",
    "16, 185, 129",
    "14, 165, 233",
    "234, 179, 8"
];


renderHeader({
    eyebrow:
        "BPD GAMING NETWORK",

    title:
        "Minecraft Mods",

    tabs: [
        {
            label:
                "Home",

            href:
                "/Minecraft"
        },
        {
            label:
                "Announcements",

            href:
                "/Minecraft/Announcements"
        }
    ]
});


initializeModsPage();


function initializeModsPage() {

    const retryButton =
        document.getElementById(
            "minecraftModRetry"
        );


    if (retryButton) {

        retryButton.addEventListener(
            "click",
            () => {

                loadModsForGame(
                    gameCategory
                );

            }
        );

    }


    loadModsForGame(
        gameCategory
    );

}


async function loadModsForGame(
    game
) {

    const modList =
        document.getElementById(
            "minecraftModList"
        );

    const errorSection =
        document.getElementById(
            "minecraftModError"
        );


    if (!modList) {
        return;
    }


    if (errorSection) {

        errorSection.hidden =
            true;

    }


    renderLoadingState(
        modList
    );

    try {

        const response =
            await apiFetch(
                `${CF_MOD_LIST_API}?game=${encodeURIComponent(
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
            data?.success !==
            true
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
            mods.length ===
            0
        ) {

            modList.innerHTML = `
                <p class="minecraft-mod-empty">
                    No active mods are currently listed.
                </p>
            `;

            return;

        }


        mods.forEach(
            (
                mod,
                index
            ) => {

                modList.insertAdjacentHTML(
                    "beforeend",
                    createModCard(
                        mod,
                        index
                    )
                );

            }
        );

    }
    catch (
        error
    ) {

        console.error(
            "Minecraft: Unable to load CurseForge mods.",
            error
        );


        modList.innerHTML =
            "";


        if (errorSection) {

            errorSection.hidden =
                false;

        }

    }

}


function renderLoadingState(
    modList
) {

    modList.innerHTML = `
        <div
            class="minecraft-mod-loading"
            id="minecraftModLoading"
        >

            <span
                class="minecraft-mod-loading-spinner"
                aria-hidden="true"
            ></span>

            <span>
                Loading Minecraft mods...
            </span>

        </div>
    `;

}


function createModCard(
    mod,
    index
) {

    const glow =
        MOD_GLOWS[
            index %
            MOD_GLOWS.length
        ];


    const name =
        escapeHtml(
            mod?.name ||
            "Unnamed Mod"
        );


    const description =
        escapeHtml(
            mod?.summary ||
            "No description is currently available."
        );


    const version =
        escapeHtml(
            mod?.modVersion ||
            "Unknown"
        );


    const downloads =
        formatNumber(
            mod?.downloads
        );


    const updated =
        formatDate(
            mod?.lastUpdated
        );


    const websiteUrl =
        safeUrl(
            mod?.links?.websiteUrl
        );


    const logoUrl =
        safeUrl(
            mod?.logo?.thumbnailUrl
        );


    const imageHtml =
        logoUrl
            ? `
                <img
                    class="minecraft-mod-image"
                    src="${escapeAttribute(
                        logoUrl
                    )}"
                    alt="${escapeAttribute(
                        name
                    )}"
                    loading="lazy"
                >
            `
            : `
                <div
                    class="minecraft-mod-image minecraft-mod-image-placeholder"
                    aria-hidden="true"
                >
                    MC
                </div>
            `;


    const linkHtml =
        websiteUrl
            ? `
                <a
                    class="minecraft-mod-link"
                    href="${escapeAttribute(
                        websiteUrl
                    )}"
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    View on CurseForge

                    <span
                        aria-hidden="true"
                    >
                        →
                    </span>
                </a>
            `
            : "";


    return `
        <article
            class="minecraft-mod-card"
            style="--mod-glow: ${glow};"
        >

            <div class="minecraft-mod-banner">

                <div class="minecraft-mod-image-wrap">

                    ${imageHtml}

                </div>


                <div class="minecraft-mod-main">

                    <div class="minecraft-mod-heading">

                        <div class="minecraft-mod-title-group">

                            <span class="minecraft-mod-label">
                                MINECRAFT MOD
                            </span>

                            <h3 class="minecraft-mod-name">
                                ${name}
                            </h3>

                        </div>


                        ${linkHtml}

                    </div>


                    <p class="minecraft-mod-description">
                        ${description}
                    </p>

                </div>

            </div>


            <div class="minecraft-mod-meta">

                <div class="minecraft-mod-meta-item">

                    <span class="minecraft-mod-meta-label">
                        Mod Version
                    </span>

                    <strong class="minecraft-mod-meta-value">
                        ${version}
                    </strong>

                </div>


                <div class="minecraft-mod-meta-item">

                    <span class="minecraft-mod-meta-label">
                        Downloads
                    </span>

                    <strong class="minecraft-mod-meta-value">
                        ${downloads}
                    </strong>

                </div>


                <div class="minecraft-mod-meta-item">

                    <span class="minecraft-mod-meta-label">
                        Updated
                    </span>

                    <strong class="minecraft-mod-meta-value">
                        ${updated}
                    </strong>

                </div>

            </div>

        </article>
    `;

}


function formatNumber(
    value
) {

    const number =
        Number(
            value
        );


    if (
        !Number.isFinite(
            number
        )
    ) {

        return "—";

    }


    return new Intl.NumberFormat(
        "en-US"
    ).format(
        number
    );

}


function formatDate(
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


    return new Intl.DateTimeFormat(
        "en-US",
        {
            month:
                "short",

            day:
                "numeric",

            year:
                "numeric"
        }
    ).format(
        date
    );

}


function safeUrl(
    value
) {

    if (!value) {

        return "";

    }


    try {

        const url =
            new URL(
                value,
                window.location.origin
            );


        if (
            url.protocol !==
                "https:" &&
            url.protocol !==
                "http:"
        ) {

            return "";

        }


        return url.href;

    }
    catch {

        return "";

    }

}


function escapeHtml(
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

    return escapeHtml(
        value
    );

}