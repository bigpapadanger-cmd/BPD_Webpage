export function renderHeader({
    eyebrow = "BPD GAMING NETWORK",
    title,
    tabs = []
}) {

    const header =
        document.getElementById(
            "header"
        );


    if (!header) {
        return;
    }


    const currentPath =
        window.location.pathname;


    const navigation =
        tabs.length > 0
            ? `
                <nav
                    class="header-navigation"
                    aria-label="${title} navigation"
                >
                    ${tabs.map(
                        tab => {

                            const isActive =
                                currentPath ===
                                tab.href;

                            return `
                                <a
                                    href="${tab.href}"
                                    class="header-tab${isActive ? " active" : ""}"
                                    ${isActive ? 'aria-current="page"' : ""}
                                    data-router-link
                                >
                                    ${tab.label}
                                </a>
                            `;

                        }
                    ).join("")}
                </nav>
            `
            : "";


    header.innerHTML = `
        <div class="header-content">
            <div class="header-box">
                <div class="header-title-row">
                    <div class="header-title-content">

                        <span class="header-eyebrow">
                            ${eyebrow}
                        </span>

                        <h1 class="header-title">
                            ${title}
                        </h1>

                    </div>
                </div>

                ${navigation}

            </div>
        </div>
    `;

}