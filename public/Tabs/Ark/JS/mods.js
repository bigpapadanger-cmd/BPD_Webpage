import {
    renderHeader
} from "/Framework/Shell/JS/renderHeader.js";
import { CF_MOD_LIST_API } from "../../../scripts/apiRoutes.js";
import { apiFetch } from "../../../scripts/apiConnection.js";

const gameCategory =
    "ark";


const MOD_GLOWS = [
    "139, 92, 246",
    "59, 130, 246",
    "34, 211, 238",
    "245, 158, 11",
    "236, 72, 153",
    "16, 185, 129"
];


renderHeader({
    eyebrow:
        "BPD GAMING NETWORK",

    title:
        "Ark Ascended Mods List",

    tabs: [
        {
            label:
                "Home",

            href:
                "/Ark"
        },
        {
            label:
                "Announcements",

            href:
                "/Ark/Announcements"
        }
    ]
});


initializeModsPage();


function initializeModsPage() {

    const retryButton =
        document.getElementById(
            "arkModRetry"
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
            "arkModList"
        );

    const errorSection =
        document.getElementById(
            "arkModError"
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
                <p class="ark-mod-empty">
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
            "ARK: Unable to load CurseForge mods.",
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
            class="ark-mod-loading"
            id="arkModLoading"
        >

            <span
                class="ark-mod-loading-spinner"
                aria-hidden="true"
            ></span>

            <span>
                Loading ARK mods...
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


    const ue5Version =
        escapeHtml(
            mod?.ue5Version ||
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
                    class="ark-mod-image"
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
                    class="ark-mod-image ark-mod-image-placeholder"
                    aria-hidden="true"
                >
                    ARK
                </div>
            `;


    const linkHtml =
        websiteUrl
            ? `
                <a
                    class="ark-mod-link"
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
            class="ark-mod-card"
            style="--mod-glow: ${glow};"
        >

            <div class="ark-mod-banner">

                <div class="ark-mod-image-wrap">

                    ${imageHtml}

                </div>


                <div class="ark-mod-main">

                    <div class="ark-mod-heading">

                        <div class="ark-mod-title-group">

                            <span class="ark-mod-label">
                                ARK ASCENDED MOD
                            </span>

                            <h3 class="ark-mod-name">
                                ${name}
                            </h3>

                        </div>


                        ${linkHtml}

                    </div>


                    <p class="ark-mod-description">
                        ${description}
                    </p>

                </div>

            </div>


            <div class="ark-mod-meta">

                    <div class="ark-mod-meta-item">

                        <span class="ark-mod-meta-label">
                            UE5 Version
                        </span>

                        <strong class="ark-mod-meta-value">
                            ${ue5Version}
                        </strong>

                    </div>


                <div class="ark-mod-meta-item">

                    <span class="ark-mod-meta-label">
                        Downloads
                    </span>

                    <strong class="ark-mod-meta-value">
                        ${downloads}
                    </strong>

                </div>


                <div class="ark-mod-meta-item">

                    <span class="ark-mod-meta-label">
                        Updated
                    </span>

                    <strong class="ark-mod-meta-value">
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