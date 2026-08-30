import {
    renderHeader
} from "/Framework/Shell/JS/renderHeader.js";


const announcements = [
    {
        id:
            "example-mod-update",

        type:
            "Mod Update",

        title:
            "Example Mod Update",

        date:
            "2026-08-28",

        description:
            "Updates and improvements have been released for one of our ARK Ascended projects."
    },

    {
        id:
            "example-development",

        type:
            "Development",

        title:
            "New ARK Project in Development",

        date:
            "2026-08-14",

        description:
            "Development has started on another project for the ARK Ascended community."
    },

    {
        id:
            "ark-section-launch",

        type:
            "General",

        title:
            "BPD Gaming Network ARK Section",

        date:
            "2026-07-30",

        description:
            "The ARK section of BPD Gaming Network is now available for project information, mods, announcements, and community updates."
    }
];


renderHeader({
    eyebrow:
        "BPD GAMING NETWORK",

    title:
        "ARK Announcements",

    tabs: [
        {
            label:
                "Home",

            href:
                "/Ark"
        },
        {
            label:
                "Mods",

            href:
                "/Ark/Mods"
        }
    ]
});


renderAnnouncements();


function renderAnnouncements() {

    const announcementList =
        document.getElementById(
            "arkAnnouncementList"
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
            <div class="ark-announcement-empty">

                <span class="ark-content-eyebrow">
                    NO ANNOUNCEMENTS
                </span>

                <p>
                    There are currently no ARK announcements.
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


    return `
        <article
            class="ark-announcement-item"
            id="${escapeAttribute(
                announcement?.id ||
                ""
            )}"
        >

            <div class="ark-announcement-marker">

                <span
                    class="ark-announcement-dot"
                    aria-hidden="true"
                ></span>

                <span
                    class="ark-announcement-line"
                    aria-hidden="true"
                ></span>

            </div>


            <div class="ark-announcement-content">

                <div class="ark-announcement-meta">

                    <time
                        datetime="${isoDate}"
                    >
                        ${date}
                    </time>

                    <span class="ark-announcement-type">
                        ${type}
                    </span>

                </div>


                <h3 class="ark-announcement-title">
                    ${title}
                </h3>


                <p class="ark-announcement-description">
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