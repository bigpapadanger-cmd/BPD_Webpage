/* =========================================================
BPD GAMING NETWORK
ROUTE CONFIGURATION
=========================================================

When adding a new page:

1. Add the route to ROUTES.
2. Give it a unique title.
3. Set its body HTML path.
4. Set its page module.
5. Set the appropriate header, sidebar, and footer.
6. Add it to HEADER_MAP if its header behavior differs.
7. The Pages catch-all routes only registered human paths;
   API and asset paths retain their exact matching behavior.

CSS POLICY

The shell uses one master CSS caller at a time.

Default:
    /Framework/Shell/CSS/Callers/master.css

Rocket League:
    /Framework/Shell/CSS/Callers/master_rl.css

Minecraft:
    /Framework/Shell/CSS/Callers/master_mc.css

ARK:
    /Framework/Shell/CSS/Callers/master_ark.css

Admin:
    /Framework/Shell/CSS/Callers/master_admin.css

The route root determines which master CSS caller is loaded.

Unknown, global, required, dashboard, and error routes
fall back to master.css.
*/

/* =========================================================
MASTER CSS CALLERS
========================================================= */

export const MASTER_CSS_PATH =
    "/Framework/Shell/CSS/Callers/master.css";

export function getRouteStyles(pathname) {
    const path = normalizeRoutePath(pathname);
    const styles = {
        "/": ["/Global/Index/CSS/index.css", "/Tabs/RocketLeague/Features/CSS/index.css"],
        "/Dashboard": ["/Global/Index/CSS/dashboard.css"],
        "/Account": ["/Global/Account/CSS/index.css"], "/Login": ["/Global/Login/CSS/index.css"],
        "/Settings": ["/Global/Settings/CSS/settings-page.css"], "/Suggestions": ["/Global/Suggestions/CSS/index.css"],
        "/About": ["/Required/About/CSS/index.css"], "/FAQ": ["/Required/FAQ/CSS/index.css"],
        "/Privacy": ["/Required/PrivacyPolicy/CSS/index.css"], "/TOS": ["/Required/TOS/CSS/index.css"], "/Error": ["/Global/404/CSS/404.css"],
        "/RocketLeague/Profile": ["/Tabs/RocketLeague/Registration/CSS/index.css"],
        "/RocketLeague/MyProfile": ["/Tabs/RocketLeague/Registration/CSS/index.css", "/Tabs/RocketLeague/MyProfile/CSS/index.css"],
        "/RocketLeague/FindPlayers": ["/Tabs/RocketLeague/FindPlayers/CSS/index.css"],
        "/RocketLeague/Player": ["/Tabs/RocketLeague/FindPlayers/CSS/index.css", "/Tabs/RocketLeague/PublicProfile/CSS/index.css"],
        "/RocketLeague/FindCustomMatches": ["/Tabs/RocketLeague/CustomMatches/CSS/index.css"]
    };
    const result = styles[path] ?? [];
    if (path.startsWith("/RocketLeague") && !["/RocketLeague", "/RocketLeague/Profile", "/RocketLeague/MyProfile", "/RocketLeague/FindPlayers", "/RocketLeague/Player", "/RocketLeague/FindCustomMatches"].includes(path)) {
        return [...result, "/Tabs/RocketLeague/Features/CSS/index.css", ...( /SubmitMatchResults|ImageScanning|MatchResults|PrivateMatches|WeeklyMatches/.test(path) ? ["/ocr/CSS/disputes.css", "/ocr/CSS/submitimg.css"] : [])];
    }
    return result;
}

export function getPageMetadata(pathname, search = "") {
    const path = normalizeRoutePath(pathname);
    const config = ROUTES[path] ?? {};
    const privatePage = Boolean(config.auth?.required || config.requiresAuth || /^\/(Admin|Account|Settings|Login|Error)(\/|$)/i.test(path)
        || path === "/RocketLeague/Player" || (path === "/RocketLeague/FindCustomMatches" && new URLSearchParams(search).has("match")));
    const title = path === "/Account" ? "Account | BPD Gaming Network" : config.title || "BPD Gaming Network";
    const description = privatePage ? "Manage your BPD Gaming Network account and authorized features."
        : path === "/RocketLeague/FindPlayers" ? "Find Rocket League players who have opted into public profile discovery."
        : path === "/FAQ" ? "Answers to common questions about BPD Gaming Network."
        : path === "/RocketLeague/UE6" ? "Personal BPD opinions and comments about Rocket League's Unreal Engine 6 update."
        : path.startsWith("/RocketLeague") ? `${title.split(" | ")[0]}: Rocket League player tools and community features on BPD Gaming Network.`
        : `${title.split(" | ")[0]}: explore BPD Gaming Network game hubs, community resources and player tools.`;
    return { title, description, canonical: new URL(path, "https://bpd-gaming-network.com").href,
        robots: privatePage ? "noindex, nofollow" : "index, follow" };
}

export const MASTER_CSS_MAP =
    Object.freeze({
        RocketLeague:
            "/Framework/Shell/CSS/Callers/master_rl.css",

        Minecraft:
            "/Framework/Shell/CSS/Callers/master_mc.css",

        Ark:
            "/Framework/Shell/CSS/Callers/master_ark.css",

        Admin:
            "/Framework/Shell/CSS/Callers/master_admin.css"
    });

/* =========================================================
ROUTES
========================================================= */

export const ROUTES = {

    // =====================================================
    // MAIN
    // =====================================================

    "/": {
        title:
            "BPD Gaming Network",

        body:
            "/Framework/Shell/HTML/Body/body.html",

        header:
            "/Framework/Shell/HTML/Header/header.html",

        sidebar:
            "/Framework/Shell/HTML/Sidebar/mainmenu.html",

        footer:
            "/Framework/Shell/HTML/Footer/footer.html",

        module:
            "/Tabs/RocketLeague/Features/JS/shop.js",

        sitemap:
            true
    },

    "/Dashboard": {
        title:
            "Dashboard | BPD Gaming Network",

        body:
            "/Global/Index/HTML/home.html",

        header:
            "/Framework/Shell/HTML/Header/header.html",

        sidebar:
            "/Framework/Shell/HTML/Sidebar/dashboard.html",

        footer:
            "/Framework/Shell/HTML/Footer/footer.html",

        module:
            "/Global/Index/JS/index.js",

        sitemap:
            true
    },

    "/Account": {
        auth: { required: true, recovery: true },
        title:
            "Dashboard | BPD Gaming Network",

        body:
            "/Global/Account/HTML/index.html",

        header:
            "/Framework/Shell/HTML/Header/header.html",

        sidebar:
            "/Framework/Shell/HTML/Sidebar/dashboard.html",

        footer:
            "/Framework/Shell/HTML/Footer/footer.html",

        module:
            "/Global/Account/JS/index.js",

        sitemap:
            false,

        requiresAuth:
            true
    },

    "/Login": {
        title:
            "Sign In | BPD Gaming Network",

        body:
            "/Global/Login/HTML/index.html",

        header:
            "/Framework/Shell/HTML/Header/header.html",

        sidebar:
            null,

        footer:
            "/Framework/Shell/HTML/Footer/footer.html",

        module:
            "/Global/Login/JS/index.js",

        sitemap:
            false,

        requiresAuth:
            false
    },

    // =====================================================
    // ROCKET LEAGUE
    // =====================================================

    "/RocketLeague": {
        title:
            "Rocket League | BPD Gaming Network",

        body:
            "/Tabs/RocketLeague/Index/HTML/index.html",

        header:
            "/Framework/Shell/HTML/Header/header.html",

        sidebar:
            "/Framework/Shell/HTML/Sidebar/rl_menu.html",

        footer:
            "/Framework/Shell/HTML/Footer/footer.html",

        module:
            "/Tabs/RocketLeague/Index/JS/index.js",

        sitemap:
            true
    },

    "/RocketLeague/Profile": {
        auth: { required: true, provider: "epic" },
        title:
            "Rocket League Profile | BPD Gaming Network",

        body:
            "/Tabs/RocketLeague/Registration/HTML/index.html",

        header:
            "/Framework/Shell/HTML/Header/header.html",

        sidebar:
            null,

        footer:
            "/Framework/Shell/HTML/Footer/footer.html",

        module:
            "/Tabs/RocketLeague/Registration/JS/index.js",

        sitemap:
            false,

        requiresAuth:
            true
    },

    "/RocketLeague/MyProfile": {
        auth: { required: true, provider: "epic", rocketLeague: true },
        title:
            "My Rocket League Profile | BPD Gaming Network",

        body:
            "/Tabs/RocketLeague/MyProfile/HTML/index.html",

        header:
            "/Framework/Shell/HTML/Header/header.html",

        sidebar:
            "/Framework/Shell/HTML/Sidebar/rl_menu.html",

        footer:
            "/Framework/Shell/HTML/Footer/footer.html",

        module:
            "/Tabs/RocketLeague/MyProfile/JS/index.js",

        sitemap:
            false,

        requiresAuth:
            true
    },

    "/RocketLeague/MatchHistory": {
        auth: { required: true, provider: "epic", rocketLeague: true },
        title:
            "Rocket League Match History | BPD Gaming Network",

        body:
            "/Tabs/RocketLeague/Features/HTML/match-history.html",

        header:
            "/Framework/Shell/HTML/Header/header.html",

        sidebar:
            "/Framework/Shell/HTML/Sidebar/rl_menu.html",

        footer:
            "/Framework/Shell/HTML/Footer/footer.html",

        module:
            null,

        requiresAuth:
            true,

        sitemap:
            false
    },

    "/RocketLeague/Shop": {
        title:
            "Rocket League Shop | BPD Gaming Network",

        body:
            "/Tabs/RocketLeague/Features/HTML/shop.html",

        header:
            "/Framework/Shell/HTML/Header/header.html",

        sidebar:
            "/Framework/Shell/HTML/Sidebar/rl_menu.html",

        footer:
            "/Framework/Shell/HTML/Footer/footer.html",

        module:
            "/Tabs/RocketLeague/Features/JS/shop.js",

        sitemap:
            true
    },

    "/RocketLeague/UE6": {
        title: "Rocket League on Unreal Engine 6 | BPD Gaming Network",
        body: "/Tabs/RocketLeague/Features/HTML/ue6.html",
        header: "/Framework/Shell/HTML/Header/header.html",
        sidebar: "/Framework/Shell/HTML/Sidebar/rl_menu.html",
        footer: "/Framework/Shell/HTML/Footer/footer.html",
        module: null,
        sitemap: true
    },

    "/RocketLeague/FindPlayers": {
        title:
            "Find Rocket League Players | BPD Gaming Network",

        body:
            "/Tabs/RocketLeague/FindPlayers/HTML/index.html",

        header:
            "/Framework/Shell/HTML/Header/header.html",

        sidebar:
            "/Framework/Shell/HTML/Sidebar/rl_menu.html",

        footer:
            "/Framework/Shell/HTML/Footer/footer.html",

        module:
            "/Tabs/RocketLeague/FindPlayers/JS/index.js",

        sitemap:
            true
    },

    "/RocketLeague/Player": {
        title:
            "Rocket League Player Profile | BPD Gaming Network",

        body:
            "/Tabs/RocketLeague/PublicProfile/HTML/index.html",

        header:
            "/Framework/Shell/HTML/Header/header.html",

        sidebar:
            "/Framework/Shell/HTML/Sidebar/rl_menu.html",

        footer:
            "/Framework/Shell/HTML/Footer/footer.html",

        module:
            "/Tabs/RocketLeague/PublicProfile/JS/index.js",

        sitemap:
            false
    },

    "/RocketLeague/SubmitMatchResults": {
        auth: { required: true, provider: "epic", rocketLeague: true },
        title:
            "Submit Match Results | BPD Gaming Network",

        body:
            "/ocr/HTML/submitimg.html",

        header:
            "/Framework/Shell/HTML/Header/header.html",

        sidebar:
            "/Framework/Shell/HTML/Sidebar/rl_menu.html",

        footer:
            "/Framework/Shell/HTML/Footer/footer.html",

        module:
            "/ocr/JS/index.js",

        requiresAuth:
            true,

        sitemap:
            false
    },

    "/RocketLeague/ImageScanning": {
        redirectTo: "/RocketLeague/SubmitMatchResults",
        auth: { required: true, provider: "epic", rocketLeague: true },
        title:
            "Rocket League Image Scanning | BPD Gaming Network",

        body:
            "/Tabs/RocketLeague/Index/HTML/index.html",

        header:
            "/Framework/Shell/HTML/Header/header.html",

        sidebar:
            "/Framework/Shell/HTML/Sidebar/rl_menu.html",

        footer:
            "/Framework/Shell/HTML/Footer/footer.html",

        module:
            "/Tabs/RocketLeague/Index/JS/index.js",

        sitemap:
            false,

        requiresAuth:
            true
    },

    "/RocketLeague/Leaderboards": {
        title:
            "Rocket League Leaderboards | BPD Gaming Network",

        body:
            "/Tabs/RocketLeague/Features/HTML/leaderboards.html",

        header:
            "/Framework/Shell/HTML/Header/header.html",

        sidebar:
            "/Framework/Shell/HTML/Sidebar/rl_menu.html",

        footer:
            "/Framework/Shell/HTML/Footer/footer.html",

        module:
            "/Tabs/RocketLeague/Features/JS/leaderboards.js",

        sitemap:
            false
    },

    "/RocketLeague/MatchResults": {
        title:
            "Match Results | BPD Gaming Network",

        body:
            "/Tabs/RocketLeague/Features/HTML/match-results.html",

        header:
            "/Framework/Shell/HTML/Header/header.html",

        sidebar:
            "/Framework/Shell/HTML/Sidebar/rl_menu.html",

        footer:
            "/Framework/Shell/HTML/Footer/footer.html",

        module:
            null,

        sitemap:
            false
    },

    "/RocketLeague/FindCustomMatches": {
        title: "Find Custom Matches | BPD Gaming Network",
        body: "/Tabs/RocketLeague/Features/HTML/find-custom-matches.html",
        header: "/Framework/Shell/HTML/Header/header.html",
        sidebar: "/Framework/Shell/HTML/Sidebar/rl_menu.html",
        footer: "/Framework/Shell/HTML/Footer/footer.html",
        module: "/Tabs/RocketLeague/CustomMatches/JS/index.js",
        sitemap: false
    },

    "/RocketLeague/WeeklyMatches": {
        auth: { required: true, provider: "epic", rocketLeague: true },
        title:
            "Rocket League Weekly Matches | BPD Gaming Network",

        body:
            "/Tabs/RocketLeague/Features/HTML/weekly-matches.html",

        header:
            "/Framework/Shell/HTML/Header/header.html",

        sidebar:
            "/Framework/Shell/HTML/Sidebar/rl_menu.html",

        footer:
            "/Framework/Shell/HTML/Footer/footer.html",

        module:
            null,

        requiresAuth:
            true,

        sitemap:
            false
    },

    "/RocketLeague/MyMatches": {
        auth: { required: true, provider: "epic", rocketLeague: true },
        title:
            "My Rocket League Matches | BPD Gaming Network",

        body:
            "/Tabs/RocketLeague/Features/HTML/my-matches.html",

        header:
            "/Framework/Shell/HTML/Header/header.html",

        sidebar:
            "/Framework/Shell/HTML/Sidebar/rl_menu.html",

        footer:
            "/Framework/Shell/HTML/Footer/footer.html",

        module:
            null,

        requiresAuth:
            true,

        sitemap:
            false
    },

    "/RocketLeague/PrivateMatches": {
        auth: { required: true, provider: "epic", rocketLeague: true },
        title:
            "Rocket League Private Matches | BPD Gaming Network",

        body:
            "/Tabs/RocketLeague/Features/HTML/private-matches.html",

        header:
            "/Framework/Shell/HTML/Header/header.html",

        sidebar:
            "/Framework/Shell/HTML/Sidebar/rl_menu.html",

        footer:
            "/Framework/Shell/HTML/Footer/footer.html",

        module:
            null,

        requiresAuth:
            true,

        sitemap:
            false
    },

    // =====================================================
    // REQUIRED / INFORMATION
    // =====================================================

    "/About": {
        title:
            "About Us | BPD Gaming Network",

        body:
            "/Required/About/HTML/index.html",

        header:
            "/Framework/Shell/HTML/Header/header.html",

        sidebar:
            "/Framework/Shell/HTML/Sidebar/mainmenu.html",

        footer:
            "/Framework/Shell/HTML/Footer/footer.html",

        module:
            "/Required/About/JS/index.js",

        sitemap:
            true
    },

    "/FAQ": {
        title:
            "Frequently Asked Questions | BPD Gaming Network",

        body:
            "/Required/FAQ/HTML/index.html",

        header:
            "/Framework/Shell/HTML/Header/header.html",

        sidebar:
            "/Framework/Shell/HTML/Sidebar/mainmenu.html",

        footer:
            "/Framework/Shell/HTML/Footer/footer.html",

        module:
            "/Required/FAQ/JS/index.js",

        sitemap:
            true
    },

    "/Privacy": {
        title:
            "Privacy Policy | BPD Gaming Network",

        body:
            "/Required/PrivacyPolicy/HTML/index.html",

        header:
            "/Framework/Shell/HTML/Header/header.html",

        sidebar:
            "/Framework/Shell/HTML/Sidebar/mainmenu.html",

        footer:
            "/Framework/Shell/HTML/Footer/footer.html",

        module:
            "/Required/PrivacyPolicy/JS/index.js",

        sitemap:
            true
    },

    "/TOS": {
        title:
            "Terms of Service | BPD Gaming Network",

        body:
            "/Required/TOS/HTML/index.html",

        header:
            "/Framework/Shell/HTML/Header/header.html",

        sidebar:
            "/Framework/Shell/HTML/Sidebar/mainmenu.html",

        footer:
            "/Framework/Shell/HTML/Footer/footer.html",

        module:
            "/Required/TOS/JS/index.js",

        sitemap:
            true
    },

    // =====================================================
    // MINECRAFT
    // =====================================================

    "/Minecraft": {
        title:
            "Minecraft | BPD Gaming Network",

        body:
            "/Tabs/Minecraft/HTML/index.html",

        header:
            "/Framework/Shell/HTML/Header/header.html",

        sidebar:
            "/Framework/Shell/HTML/Sidebar/mainmenu.html",

        footer:
            "/Framework/Shell/HTML/Footer/footer.html",

        module:
            "/Tabs/Minecraft/JS/index.js",

        sitemap:
            true
    },

    "/Minecraft/Mods": {
        title:
            "Minecraft Mods | BPD Gaming Network",

        body:
            "/Tabs/Minecraft/HTML/mods.html",

        header:
            "/Framework/Shell/HTML/Header/header.html",

        sidebar:
            "/Framework/Shell/HTML/Sidebar/mainmenu.html",

        footer:
            "/Framework/Shell/HTML/Footer/footer.html",

        module:
            "/Tabs/Minecraft/JS/mods.js",

        sitemap:
            true
    },

    "/Minecraft/Announcements": {
        title:
            "Minecraft Announcements | BPD Gaming Network",

        body:
            "/Tabs/Minecraft/HTML/announcements.html",

        header:
            "/Framework/Shell/HTML/Header/header.html",

        sidebar:
            "/Framework/Shell/HTML/Sidebar/mainmenu.html",

        footer:
            "/Framework/Shell/HTML/Footer/footer.html",

        module:
            "/Tabs/Minecraft/JS/announcements.js",

        sitemap:
            true
    },

    // =====================================================
    // ARK
    // =====================================================

    "/Ark": {
        title:
            "ARK: Survival Ascended | BPD Gaming Network",

        body:
            "/Tabs/Ark/HTML/index.html",

        header:
            "/Framework/Shell/HTML/Header/header.html",

        sidebar:
            "/Framework/Shell/HTML/Sidebar/mainmenu.html",

        footer:
            "/Framework/Shell/HTML/Footer/footer.html",

        module:
            "/Tabs/Ark/JS/index.js",

        sitemap:
            true
    },

    "/Ark/Mods": {
        title:
            "ARK: Survival Ascended Mods | BPD Gaming Network",

        body:
            "/Tabs/Ark/HTML/mods.html",

        header:
            "/Framework/Shell/HTML/Header/header.html",

        sidebar:
            "/Framework/Shell/HTML/Sidebar/mainmenu.html",

        footer:
            "/Framework/Shell/HTML/Footer/footer.html",

        module:
            "/Tabs/Ark/JS/mods.js",

        sitemap:
            true
    },

    "/Ark/Announcements": {
        title:
            "ARK: Survival Ascended Announcements | BPD Gaming Network",

        body:
            "/Tabs/Ark/HTML/announcements.html",

        header:
            "/Framework/Shell/HTML/Header/header.html",

        sidebar:
            "/Framework/Shell/HTML/Sidebar/mainmenu.html",

        footer:
            "/Framework/Shell/HTML/Footer/footer.html",

        module:
            "/Tabs/Ark/JS/announcements.js",

        sitemap:
            true
    },

    // =====================================================
    // ERROR
    // =====================================================

    "/Error": {
        title:
            "Page Not Found | BPD Gaming Network",

        body:
            "/Global/404/HTML/404.html",

        header:
            "/Framework/Shell/HTML/Header/header.html",

        sidebar:
            "/Framework/Shell/HTML/Sidebar/mainmenu.html",

        footer:
            "/Framework/Shell/HTML/Footer/footer.html",

        module:
            null,

        requiresAuth:
            false,

        sitemap:
            false
    },

    "/Settings": {
        title:
            "Settings | BPD Gaming Network",

        body:
            "/Global/Settings/HTML/settings.html",

        header:
            "/Framework/Shell/HTML/Header/header.html",

        sidebar:
            "/Framework/Shell/HTML/Sidebar/mainmenu.html",

        footer:
            "/Framework/Shell/HTML/Footer/footer.html",

        module:
            "/Global/Settings/JS/settings.js",

        requiresAuth:
            false,

        sitemap:
            true
    },

    "/Suggestions": {
        title:
            "Community Suggestions | BPD Gaming Network",

        body:
            "/Global/Suggestions/HTML/index.html",

        header:
            "/Framework/Shell/HTML/Header/header.html",

        sidebar:
            "/Framework/Shell/HTML/Sidebar/mainmenu.html",

        footer:
            "/Framework/Shell/HTML/Footer/footer.html",

        module:
            "/Global/Suggestions/JS/index.js",

        requiresAuth:
            false,

        sitemap:
            true
    },

    // =====================================================
    // ADMIN PAGES
    // =====================================================

    "/Admin": {
        title:
            "Admin Management Page | BPD Gaming Network",

        body:
            "/Global/Admin/Home/HTML/index.html",

        header:
            "/Framework/Shell/HTML/Header/header.html",

        sidebar:
            "/Framework/Shell/HTML/Sidebar/admin.html",

        footer:
            "/Framework/Shell/HTML/Footer/footer.html",

        module:
            "/Global/Admin/Home/JS/index.js",

        requiresAuth:
            true,

        sitemap:
            false
    },

    "/Admin/Taskboard": {
        title:
            "Taskboard | BPD Gaming Network",

        body:
            "/Global/Admin/TaskBoard/HTML/index.html",

        header:
            "/Framework/Shell/HTML/Header/header.html",

        sidebar:
            "/Framework/Shell/HTML/Sidebar/admin.html",

        footer:
            "/Framework/Shell/HTML/Footer/footer.html",

        module:
            "/Global/Admin/TaskBoard/JS/index.js",

        requiresAuth:
            true,

        sitemap:
            false
    },

    "/Admin/FAQReview": {
        title: "FAQ Review | BPD Gaming Network",
        body: "/Global/Admin/FAQ/HTML/index.html",
        header: "/Framework/Shell/HTML/Header/header.html",
        sidebar: "/Framework/Shell/HTML/Sidebar/admin.html",
        footer: "/Framework/Shell/HTML/Footer/footer.html",
        module: "/Global/Admin/FAQ/JS/index.js",
        requiresAuth: true,
        sitemap: false
    },
    "/Admin/UserManagement": {
        title: "User Management | BPD Gaming Network",
        body: "/Global/Admin/UserManagement/HTML/index.html",
        header: "/Framework/Shell/HTML/Header/header.html",
        sidebar: "/Framework/Shell/HTML/Sidebar/admin.html",
        footer: "/Framework/Shell/HTML/Footer/footer.html",
        module: "/Global/Admin/UserManagement/JS/index.js",
        requiresAuth: true,
        sitemap: false
    },

    "/Admin/PageSettings": {
        title:
            "System Status | BPD Gaming Network",

        body:
            "/Global/Admin/WorkerStatus/HTML/index.html",

        header:
            "/Framework/Shell/HTML/Header/header.html",

        sidebar:
            "/Framework/Shell/HTML/Sidebar/admin.html",

        footer:
            "/Framework/Shell/HTML/Footer/footer.html",

        module:
            "/Global/Admin/WorkerStatus/JS/index.js",

        requiresAuth:
            true,

        sitemap:
            false
    },

    "/Admin/WorkerStatus": {
        title: "System Status | BPD Gaming Network",
        body: "/Global/Admin/WorkerStatus/HTML/index.html",
        header: "/Framework/Shell/HTML/Header/header.html",
        sidebar: "/Framework/Shell/HTML/Sidebar/admin.html",
        footer: "/Framework/Shell/HTML/Footer/footer.html",
        module: "/Global/Admin/WorkerStatus/JS/index.js",
        requiresAuth: true,
        sitemap: false
    },

    "/Admin/SuggestionReview": {
        title:
            "Suggestion Review | BPD Gaming Network",

        body:
            "/Global/Admin/Suggestions/HTML/index.html",

        header:
            "/Framework/Shell/HTML/Header/header.html",

        sidebar:
            "/Framework/Shell/HTML/Sidebar/admin.html",

        footer:
            "/Framework/Shell/HTML/Footer/footer.html",

        module:
            "/Global/Admin/Suggestions/JS/index.js",

        requiresAuth:
            true,

        sitemap:
            false
    }
};

/* =========================================================
HUMAN PAGE ROUTE INDEX

The configured route path remains the preferred public form.
The lower-case key is only for case-insensitive page lookup;
it must never be applied to APIs, assets, callbacks, or URLs
outside this page registry.
========================================================= */

export function buildHumanPageRouteIndex(
    routeRegistry = ROUTES
) {
    const routeIndex = new Map();

    for (const [routePath, config] of Object.entries(routeRegistry)) {
        const canonicalPath = normalizeRoutePath(routePath);
        const lookupKey = canonicalPath.toLowerCase();
        const previous = routeIndex.get(lookupKey);

        if (previous && previous.canonicalPath !== canonicalPath) {
            throw new Error(
                `Human page route collision: ${previous.canonicalPath} and ${canonicalPath}`
            );
        }

        routeIndex.set(lookupKey, {
            canonicalPath,
            config
        });
    }

    return routeIndex;
}

const HUMAN_PAGE_ROUTE_INDEX =
    buildHumanPageRouteIndex();

export function resolveHumanPageRoute(
    routePath
) {
    const normalizedPath =
        normalizeRoutePath(routePath);

    const route =
        HUMAN_PAGE_ROUTE_INDEX.get(
            normalizedPath.toLowerCase()
        );

    if (!route) {
        return null;
    }

    return {
        requestedPath: normalizedPath,
        canonicalPath: route.canonicalPath,
        config: route.config
    };
}

/* =========================================================
ROUTE NORMALIZATION
========================================================= */

export function getRocketLeagueSettingsContext(search = "") {
    const params = new URLSearchParams(search);
    if (params.get("context") !== "rocketleague") return null;
    const requested = params.get("returnTo") || "/RocketLeague";
    const route = requested.startsWith("/RocketLeague") && !requested.includes("?") && !requested.includes("#")
        ? resolveHumanPageRoute(requested) : null;
    return {
        sidebar: "/Framework/Shell/HTML/Sidebar/rl_menu.html",
        returnPath: route?.config.sidebar === "/Framework/Shell/HTML/Sidebar/rl_menu.html"
            ? route.canonicalPath : "/RocketLeague"
    };
}

export function normalizeRoutePath(
    value
) {
    let path =
        String(
            value
            || "/"
        )
            .trim();

    if (
        !path
    ) {
        return "/";
    }

    if (
        !path.startsWith(
            "/"
        )
    ) {
        path =
            `/${path}`;
    }

    if (
        path.length > 1
    ) {
        path =
            path.replace(
                /\/+$/,
                ""
            );
    }

    return (
        path
        || "/"
    );
}

/* =========================================================
ROUTE ROOT
========================================================= */

export function getRouteRoot(
    routePath
) {
    const path =
        normalizeRoutePath(
            routePath
        );

    if (
        path ===
            "/"
    ) {
        return "";
    }

    const segments =
        path
            .split(
                "/"
            )
            .filter(
                Boolean
            );

    return (
        segments[
            0
        ]
        || ""
    );
}

/* =========================================================
MASTER CSS RESOLUTION
========================================================= */

export function getMasterCssForRoute(
    routePath
) {
    const normalizedPath =
        normalizeRoutePath(
            routePath
        );

    if (
        resolveHumanPageRoute(normalizedPath)?.canonicalPath ===
            "/Error"
    ) {
        return MASTER_CSS_PATH;
    }

    const canonicalPath =
        resolveHumanPageRoute(normalizedPath)?.canonicalPath;

    if (
        !canonicalPath
    ) {
        return MASTER_CSS_PATH;
    }

    const root =
        getRouteRoot(
            canonicalPath
        );

    if (
        !root
    ) {
        return MASTER_CSS_PATH;
    }

    return (
        MASTER_CSS_MAP[
            root
        ]
        || MASTER_CSS_PATH
    );
}

/* =========================================================
ROUTE RESOLUTION
========================================================= */

export function getRouteConfig(
    routePath
) {
    return resolveHumanPageRoute(routePath)?.config
        || ROUTES["/Error"];
}

/* =========================================================
ROUTE EXISTS
========================================================= */

export function routeExists(
    routePath
) {
    return Boolean(resolveHumanPageRoute(routePath));
}

/* =========================================================
HEADER VISIBILITY
========================================================= */

export const HEADER_MAP = {
    "/":
        false,

    "/Dashboard":
        true,

    "/RocketLeague":
        false,

    "/RocketLeague/Profile":
        false,

    "/RocketLeague/MyProfile":
        false,

    "/RocketLeague/SubmitMatchResults":
        false,

    "/RocketLeague/ImageScanning":
        false,

    "/RocketLeague/Leaderboards":
        false,

    "/RocketLeague/MatchResults":
        false,

    "/RocketLeague/MatchHistory":
        false,

    "/RocketLeague/Shop":
        false,

    "/RocketLeague/WeeklyMatches":
        false,

    "/RocketLeague/MyMatches":
        false,

    "/RocketLeague/PrivateMatches":
        false,

    "/About":
        true,

    "/FAQ":
        false,

    "/Privacy":
        true,

    "/TOS":
        true,

    "/Minecraft":
        true,

    "/Minecraft/Mods":
        true,

    "/Minecraft/Announcements":
        true,

    "/Ark":
        true,

    "/Ark/Mods":
        true,

    "/Ark/Announcements":
        true,

    "/Error":
        false,

    "/Account":
        false
};

