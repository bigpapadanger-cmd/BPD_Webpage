/*
NEW LINKS REQUIRE Being Added in their own Folder, they need a unique title, and module, 
these handle loading unique data on each injected page. The css goes in index.html.
The header and sidebar can stay default but add to const HEADER_MAP, and PRIORITY_MAP
LASTLY ADD IN _redirects
*/

export const ROUTES = {

    "/": {
        title: "BPD Gaming Network",
        body:
            "/Framework/Shell/HTML/Body/body.html",
        header:
            "/Framework/Shell/HTML/Header/header.html",
        sidebar:
            "/Framework/Shell/HTML/Sidebar/mainmenu.html",
        footer:
            "/Framework/Shell/HTML/Footer/footer.html",
        module: 
            "/Framework/Shell/JS/initialization.js",
        sitemap: true
    },

    "/RocketLeague": {
        title: "Rocket League | BPD Gaming Network",
        body:
            "/Tabs/RocketLeague/Index/HTML/index.html",
        header:
            "/Framework/Shell/HTML/Header/header.html",
        sidebar:
            "/Framework/Shell/HTML/Sidebar/rl_AuthSidebar.html",
        footer:
            "/Framework/Shell/HTML/Footer/footer.html",
        module: 
            "/Tabs/RocketLeague/Index/JS/index.js",
        sitemap: true

        
    },

    "/RocketLeague/Profile": {
        title: "Rocket League Profile Creation| BPD Gaming Network",
        body:
            "/Tabs/RocketLeague/Registration/HTML/index.html",
        header:
            "/Framework/Shell/HTML/Header/header.html",
        sidebar:
            "/Framework/Shell/HTML/Sidebar/mainmenu.html",
        footer:
            "/Framework/Shell/HTML/Footer/footer.html",
        module: 
            "/Tabs/RocketLeague/Index/JS/index.js",
        sitemap: true

        
    },
    "/RocketLeague/ImageScanning": {
        title: "Rocket League | BPD Gaming Network",
        body:
            "/Tabs/RocketLeague/Index/HTML/index.html",
        header:
            "/Framework/Shell/HTML/Header/header.html",
        sidebar:
            "/Framework/Shell/HTML/Sidebar/rl_AuthSidebar.html",
        footer:
            "/Framework/Shell/HTML/Footer/footer.html",
        module: 
            "/Tabs/RocketLeague/Index/JS/index.js",
        sitemap: true

        
    },
    "/RocketLeague/Leaderboards": {
        title: "Rocket League | BPD Gaming Network",
        body:
            "/Tabs/RocketLeague/Index/HTML/index.html",
        header:
            "/Framework/Shell/HTML/Header/header.html",
        sidebar:
            "/Tabs/RocketLeague/Sidebars/HTML/rl_AuthSidebar.html",
        footer:
            "/Framework/Shell/HTML/Footer/footer.html",
        module: 
            "/Tabs/RocketLeague/Index/JS/index.js",
        sitemap: true

        
    },
    "/RocketLeague/MatchResults": {
        title: "Match Results | BPD Gaming Network",
        body:
            "/Tabs/RocketLeague/MatchResults/HTML/index.html",
        header:
            "/Framework/Shell/HTML/Header/header.html",
        sidebar:
            "/Framework/Shell/HTML/Sidebar/rocketleague.html",
        footer:
            "/Framework/Shell/HTML/Footer/footer.html",
        module:
            "/Tabs/RocketLeague/MatchResults/JS/index.js",
        requiresAuth: true,
        sitemap: false
    },
    
    "/Error": {
    title: "Page Not Found | BPD Gaming Network",
    body:
        "/Global/404/HTML/404.html",
    header:
        "/Framework/Shell/HTML/Header/header.html",
    sidebar:
        "/Framework/Shell/HTML/Sidebar/mainmenu.html",
    footer:
        "/Framework/Shell/HTML/Footer/footer.html",
    module: 
        "/Framework/Shell/JS/initialization.js",
        requiresAuth: false,
        sitemap: false
    },
    
    "/Dashboard": {
    title: "Dashboard | BPD Gaming Network",
    body:
        "/Global/Index/HTML/home.html",
    header:
        "/Framework/Shell/HTML/Header/header.html",
    sidebar:
        "/Framework/Shell/HTML/Sidebar/dashboard.html",
    footer:
        "/Framework/Shell/HTML/Footer/footer.html",
    module: 
        "/Global/Index/JS/Index.js",
        sitemap: true
    },
    
    "/Privacy": {
    title: "Privacy | BPD Gaming Network",
    body:
        "/Required/PrivacyPolicy/HTML/index.html",
    header:
        "/Framework/Shell/HTML/Header/header.html",
    sidebar:
        "/Framework/Shell/HTML/Sidebar/mainmenu.html",
    footer:
        "/Framework/Shell/HTML/Footer/footer.html",
    module: 
        "/Global/Index/JS/Index.js",
        sitemap: true
    },

    "/About": {
    title: "About Us | BPD Gaming Network",
    body:
        "/Required/About/HTML/index.html",
    header:
        "/Framework/Shell/HTML/Header/header.html",
    sidebar:
        "/Framework/Shell/HTML/Sidebar/mainmenu.html",
    footer:
        "/Framework/Shell/HTML/Footer/footer.html",
    module: 
        "/Required/About/JS/loadPage.js",
        sitemap: true
    },

    "/FAQ": {
    title: "Frequently Asked Questions | BPD Gaming Network",
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
        sitemap: true
    },
    "/TOS": {
    title: "Terms Of Service | BPD Gaming Network",
    body:
        "/Required/TOS/HTML/index.html",
    header:
        "/Framework/Shell/HTML/Header/header.html",
    sidebar:
        "/Framework/Shell/HTML/Sidebar/mainmenu.html",
    footer:
        "/Framework/Shell/HTML/Footer/footer.html",
    module: 
        "/Required/TOS/JS/loadPage.js",
        sitemap: true
    },

    //NEED TO BUILD THESE PAGES
    "/Minecraft": {
    title: "Minecraft | BPD Gaming Network",
    body:
        "/Required/TOS/HTML/index.html",
    header:
        "/Framework/Shell/HTML/Header/header.html",
    sidebar:
        "/Framework/Shell/HTML/Sidebar/mainmenu.html",
    footer:
        "/Framework/Shell/HTML/Footer/footer.html",
    module: 
        "/Required/TOS/JS/loadPage.js",
        sitemap: true
    },
    "/Ark": {
    title: "Ark Survival Ascended | BPD Gaming Network",
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
        sitemap: true
    }

};
export const HEADER_MAP = {
    "/": false,
    "/RocketLeague": false,
    "/Settings": true,
    "/About": true,
    "/TOS": true,
    "/Privacy": true,
    // pages that should NOT show header
    "/Error": false,
    "/RocketLeague/WeeklyMatches": false,
    "/RocketLeague/PrivateMatches": false,
    "/Dashboard": true,
    "/FAQ": false,
    "/Minecraft":false,
    "/Ark":true
};

export const PRIORITY_MAP = {
    "/": 1.0,
    "/Dashboard": 0.9,

    "/RocketLeague": 0.9,
    "/RocketLeague/WeeklyMatches": 0.8,
    "/RocketLeague/FindPlayers": 0.8,
    "/RocketLeague/PrivateMatches": 0.7,
    "/RocketLeague/MatchResults": 0.7,

    "/Settings": 0.6,
    "/About": 0.4,
    "/Privacy": 0.3,
    "/TOS": 0.3
};
