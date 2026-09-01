/*
=========================================================
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
7. Add it to PRIORITY_MAP if sitemap: true.
8. Add the clean URL to _redirects when required.

Page-specific CSS is loaded separately by the shell/page system.
*/

export const ROUTES = {

    // =====================================================
    // MAIN
    // =====================================================

    "/": {
        title: "BPD Gaming Network",
        body: "/Framework/Shell/HTML/Body/body.html",
        header: "/Framework/Shell/HTML/Header/header.html",
        sidebar: "/Framework/Shell/HTML/Sidebar/mainmenu.html",
        footer: "/Framework/Shell/HTML/Footer/footer.html",
        module: "/Framework/Shell/JS/initialization.js",
        sitemap: true
    },

    "/Dashboard": {
        title: "Dashboard | BPD Gaming Network",
        body: "/Global/Index/HTML/home.html",
        header: "/Framework/Shell/HTML/Header/header.html",
        sidebar: "/Framework/Shell/HTML/Sidebar/dashboard.html",
        footer: "/Framework/Shell/HTML/Footer/footer.html",
        module: "/Global/Index/JS/index.js",
        sitemap: true
    },


    // =====================================================
    // ROCKET LEAGUE
    // =====================================================

    "/RocketLeague": {
        title: "Rocket League | BPD Gaming Network",
        body: "/Tabs/RocketLeague/Index/HTML/index.html",
        header: "/Framework/Shell/HTML/Header/header.html",
        sidebar: "/Framework/Shell/HTML/Sidebar/rl_AuthSidebar.html",
        footer: "/Framework/Shell/HTML/Footer/footer.html",
        module: "/Tabs/RocketLeague/Index/JS/index.js",
        sitemap: true
    },

    "/RocketLeague/Profile": {
        title: "Rocket League Profile | BPD Gaming Network",
        body: "/Tabs/RocketLeague/Registration/HTML/index.html",
        header: "/Framework/Shell/HTML/Header/header.html",
        sidebar: "/Framework/Shell/HTML/Sidebar/mainmenu.html",
        footer: "/Framework/Shell/HTML/Footer/footer.html",
        module: "/Tabs/RocketLeague/Registration/JS/index.js",
        sitemap: true
    },

    "/RocketLeague/SubmitMatchResults": {
        title: "Submit Match Results | BPD Gaming Network",
        body: "/ocr/HTML/submitimg.html",
        header: "/Framework/Shell/HTML/Header/header.html",
        sidebar: "/Framework/Shell/HTML/Sidebar/rl_AuthSidebar.html",
        footer: "/Framework/Shell/HTML/Footer/footer.html",
        module: "/ocr/JS/index.js",
        requiresAuth: true,
        sitemap: false
    },

    "/RocketLeague/ImageScanning": {
        title: "Rocket League Image Scanning | BPD Gaming Network",
        body: "/Tabs/RocketLeague/Index/HTML/index.html",
        header: "/Framework/Shell/HTML/Header/header.html",
        sidebar: "/Framework/Shell/HTML/Sidebar/rl_AuthSidebar.html",
        footer: "/Framework/Shell/HTML/Footer/footer.html",
        module: "/Tabs/RocketLeague/Index/JS/index.js",
        sitemap: true
    },

    "/RocketLeague/Leaderboards": {
        title: "Rocket League Leaderboards | BPD Gaming Network",
        body: "/Tabs/RocketLeague/Index/HTML/index.html",
        header: "/Framework/Shell/HTML/Header/header.html",
        sidebar: "/Tabs/RocketLeague/Sidebars/HTML/rl_AuthSidebar.html",
        footer: "/Framework/Shell/HTML/Footer/footer.html",
        module: "/Tabs/RocketLeague/Index/JS/index.js",
        sitemap: true
    },

    "/RocketLeague/MatchResults": {
        title: "Match Results | BPD Gaming Network",
        body: "/Tabs/RocketLeague/MatchResults/HTML/index.html",
        header: "/Framework/Shell/HTML/Header/header.html",
        sidebar: "/Framework/Shell/HTML/Sidebar/rocketleague.html",
        footer: "/Framework/Shell/HTML/Footer/footer.html",
        module: "/Tabs/RocketLeague/MatchResults/JS/index.js",
        requiresAuth: true,
        sitemap: false
    },


    // =====================================================
    // REQUIRED / INFORMATION
    // =====================================================

    "/About": {
        title: "About Us | BPD Gaming Network",
        body: "/Required/About/HTML/index.html",
        header: "/Framework/Shell/HTML/Header/header.html",
        sidebar: "/Framework/Shell/HTML/Sidebar/mainmenu.html",
        footer: "/Framework/Shell/HTML/Footer/footer.html",
        module: "/Required/About/JS/loadPage.js",
        sitemap: true
    },

    "/FAQ": {
        title: "Frequently Asked Questions | BPD Gaming Network",
        body: "/Required/FAQ/HTML/index.html",
        header: "/Framework/Shell/HTML/Header/header.html",
        sidebar: "/Framework/Shell/HTML/Sidebar/mainmenu.html",
        footer: "/Framework/Shell/HTML/Footer/footer.html",
        module: "/Required/FAQ/JS/index.js",
        sitemap: true
    },

    "/Privacy": {
        title: "Privacy Policy | BPD Gaming Network",
        body: "/Required/PrivacyPolicy/HTML/index.html",
        header: "/Framework/Shell/HTML/Header/header.html",
        sidebar: "/Framework/Shell/HTML/Sidebar/mainmenu.html",
        footer: "/Framework/Shell/HTML/Footer/footer.html",
        module: "/Required/PrivacyPolicy/JS/loadPage.js",
        sitemap: true
    },

    "/TOS": {
        title: "Terms of Service | BPD Gaming Network",
        body: "/Required/TOS/HTML/index.html",
        header: "/Framework/Shell/HTML/Header/header.html",
        sidebar: "/Framework/Shell/HTML/Sidebar/mainmenu.html",
        footer: "/Framework/Shell/HTML/Footer/footer.html",
        module: "/Required/TOS/JS/loadPage.js",
        sitemap: true
    },


    // =====================================================
    // MINECRAFT
    // =====================================================

    "/Minecraft": {
        title: "Minecraft | BPD Gaming Network",
        body: "/Tabs/Minecraft/HTML/index.html",
        header: "/Framework/Shell/HTML/Header/header.html",
        sidebar: "/Framework/Shell/HTML/Sidebar/mainmenu.html",
        footer: "/Framework/Shell/HTML/Footer/footer.html",
        module: "/Tabs/Minecraft/JS/index.js",
        sitemap: true
    },

    "/Minecraft/Mods": {
        title: "Minecraft Mods | BPD Gaming Network",
        body: "/Tabs/Minecraft/HTML/mods.html",
        header: "/Framework/Shell/HTML/Header/header.html",
        sidebar: "/Framework/Shell/HTML/Sidebar/mainmenu.html",
        footer: "/Framework/Shell/HTML/Footer/footer.html",
        module: "/Tabs/Minecraft/JS/mods.js",
        sitemap: true
    },

    "/Minecraft/Announcements": {
        title: "Minecraft Announcements | BPD Gaming Network",
        body: "/Tabs/Minecraft/HTML/announcements.html",
        header: "/Framework/Shell/HTML/Header/header.html",
        sidebar: "/Framework/Shell/HTML/Sidebar/mainmenu.html",
        footer: "/Framework/Shell/HTML/Footer/footer.html",
        module: "/Tabs/Minecraft/JS/announcements.js",
        sitemap: true
    },


    // =====================================================
    // ARK
    // =====================================================

    "/Ark": {
        title: "ARK: Survival Ascended | BPD Gaming Network",
        body: "/Tabs/Ark/HTML/index.html",
        header: "/Framework/Shell/HTML/Header/header.html",
        sidebar: "/Framework/Shell/HTML/Sidebar/mainmenu.html",
        footer: "/Framework/Shell/HTML/Footer/footer.html",
        module: "/Tabs/Ark/JS/index.js",
        sitemap: true
    },

    "/Ark/Mods": {
        title: "ARK: Survival Ascended Mods | BPD Gaming Network",
        body: "/Tabs/Ark/HTML/mods.html",
        header: "/Framework/Shell/HTML/Header/header.html",
        sidebar: "/Framework/Shell/HTML/Sidebar/mainmenu.html",
        footer: "/Framework/Shell/HTML/Footer/footer.html",
        module: "/Tabs/Ark/JS/mods.js",
        sitemap: true
    },

    "/Ark/Announcements": {
        title: "ARK: Survival Ascended Announcements | BPD Gaming Network",
        body: "/Tabs/Ark/HTML/announcements.html",
        header: "/Framework/Shell/HTML/Header/header.html",
        sidebar: "/Framework/Shell/HTML/Sidebar/mainmenu.html",
        footer: "/Framework/Shell/HTML/Footer/footer.html",
        module: "/Tabs/Ark/JS/announcements.js",
        sitemap: true
    },


    // =====================================================
    // ERROR
    // =====================================================

    "/Error": {
        title: "Page Not Found | BPD Gaming Network",
        body: "/Global/404/HTML/404.html",
        header: "/Framework/Shell/HTML/Header/header.html",
        sidebar: "/Framework/Shell/HTML/Sidebar/mainmenu.html",
        footer: "/Framework/Shell/HTML/Footer/footer.html",
        module: "/Framework/Shell/JS/initialization.js",
        requiresAuth: false,
        sitemap: false
    }
};


// =========================================================
// HEADER VISIBILITY
// =========================================================

export const HEADER_MAP = {
    "/": false,

    "/Dashboard": true,

    "/RocketLeague": false,
    "/RocketLeague/Profile": false,
    "/RocketLeague/SubmitMatchResults": false,
    "/RocketLeague/ImageScanning": false,
    "/RocketLeague/Leaderboards": false,
    "/RocketLeague/MatchResults": false,

    "/About": true,
    "/FAQ": false,
    "/Privacy": true,
    "/TOS": true,

    "/Minecraft": true,
    "/Minecraft/Mods": true,
    "/Minecraft/Announcements": true,

    "/Ark": true,
    "/Ark/Mods": true,
    "/Ark/Announcements": true,

    "/Error": false
};


// =========================================================
// SITEMAP PRIORITIES
// Only routes with sitemap: true belong here.
// =========================================================

export const PRIORITY_MAP = {
    "/": 1.0,

    "/Dashboard": 0.9,

    "/RocketLeague": 0.9,
    "/RocketLeague/Leaderboards": 0.8,


    "/Minecraft": 0.7,
    "/Minecraft/Mods": 0.7,
    "/Minecraft/Announcements": 0.5,

    "/Ark": 0.7,
    "/Ark/Mods": 0.7,
    "/Ark/Announcements": 0.5,

    "/FAQ": 0.5,
    "/About": 0.4,

    "/Privacy": 0.3,
    "/TOS": 0.3
};