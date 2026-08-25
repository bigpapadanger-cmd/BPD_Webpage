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
        "/Framework/Shell/HTML/Sidebar/mainmenu.html",
    footer:
        "/Framework/Shell/HTML/Footer/footer.html",
    module: 
        "/Global/Index/JS/Index.js",
        sitemap: true
    },
    
    "/About": {
    title: "Dashboard | BPD Gaming Network",
    body:
        "/Global/Index/HTML/home.html",
    header:
        "/Framework/Shell/HTML/Header/header.html",
    sidebar:
        "/Framework/Shell/HTML/Sidebar/mainmenu.html",
    footer:
        "/Framework/Shell/HTML/Footer/footer.html",
        sitemap: true
    }

};
export const HEADER_MAP = {
    "/": false,
    "/RocketLeague": false,
    "/Settings": true,
    "/About": true,
    "/Privacy": true,
    // pages that should NOT show header
    "/Error": false,
    "/RocketLeague/WeeklyMatches": false,
    "/RocketLeague/PrivateMatches": false,
    "/Dashboard": true
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
    "/Terms": 0.3
};
