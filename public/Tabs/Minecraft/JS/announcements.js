import {
    renderHeader
} from "/Framework/Shell/JS/renderHeader.js";


const announcements = [
    {
        id:
            "minecraft-example-update",

        type:
            "Mod Update",

        title:
            "Example Minecraft Mod Update",

        date:
            "2026-08-28",

        description:
            "Updates and improvements have been released for one of our Minecraft projects."
    },

    {
        id:
            "minecraft-development",

        type:
            "Development",

        title:
            "New Minecraft Project in Development",

        date:
            "2026-08-14",

        description:
            "Development has started on another project for the Minecraft community."
    },

    {
        id:
            "minecraft-section-launch",

        type:
            "General",

        title:
            "BPD Gaming Network Minecraft Section",

        date:
            "2026-07-30",

        description:
            "The Minecraft section of BPD Gaming Network is available for project information, mods, announcements, and community updates."
    }
];


renderHeader({
    eyebrow:
        "BPD GAMING NETWORK",

    title:
        "Minecraft Announcements",

    tabs: [
        {
            label:
                "Home",

            href:
                "/Minecraft"
        },
        {
            label:
                "Mods",

            href:
                "/Minecraft/Mods"
        }
    ]
});


renderAnnouncements();


function renderAnnouncements() {

    const announcementList =
        document.getElementById(
            "minecraftAnnouncementList"
        );


    if (!announcementList) {

        return;

    }


    const sortedAnnouncements =
        [...announcements]
            .sort(
                (
                    first,
                    second
                ) => {

                    return new Date(
                        second.date
                    ).getTime() -
                    new Date(
                        first.date
                    ).getTime();

                }
            );


    announcementList.innerHTML =
        "";


    if (
        sortedAnnouncements.length ===
        0
    ) {

        announcementList.innerHTML = `
            <div class="minecraft-announcement-empty">

                <span class="minecraft-content-eyebrow">
                    NO ANNOUNCEMENTS
                </span>

                <p>
                    There are currently no Minecraft announcements.
                </p>

            </div>
        `;

        return;

    }


    sortedAnnouncements.forEach(
        announcement => {

            announcementList.insertAdjacentHTML(
                "beforeend",
                createAnnouncement(
                    announcement
                )
            );

        }
    );

}


function createAnnouncement(
    announcement
) {

    const title =
        escapeHtml(
            announcement?.title ||
            "Announcement"
        );


    const type =
        escapeHtml(
            announcement?.type ||
            "General"
        );


    const description =
        escapeHtml(
            announcement?.description ||
            ""
        );


    const date =
        formatAnnouncementDate(
            announcement?.date
        );


    const isoDate =
        escapeAttribute(
            announcement?.date ||
            ""
        );


    const id =
        escapeAttribute(
            announcement?.id ||
            ""
        );


    return `
        <article
            class="minecraft-announcement-item"
            id="${id}"
        >

            <div class="minecraft-announcement-marker">

                <span
                    class="minecraft-announcement-dot"
                    aria-hidden="true"
                ></span>

                <span
                    class="minecraft-announcement-line"
                    aria-hidden="true"
                ></span>

            </div>


            <div class="minecraft-announcement-content">

                <div class="minecraft-announcement-meta">

                    <time
                        datetime="${isoDate}"
                    >
                        ${date}
                    </time>

                    <span class="minecraft-announcement-type">
                        ${type}
                    </span>

                </div>


                <h3 class="minecraft-announcement-title">
                    ${title}
                </h3>


                <p class="minecraft-announcement-description">
                    ${description}
                </p>

            </div>

        </article>
    `;

}


function formatAnnouncementDate(
    value
) {

    if (!value) {

        return "Unknown Date";

    }


    const date =
        new Date(
            `${value}T12:00:00`
        );


    if (
        Number.isNaN(
            date.getTime()
        )
    ) {

        return "Unknown Date";

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
    )
        .format(
            date
        )
        .toUpperCase();

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