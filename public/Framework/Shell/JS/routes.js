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
        stylesheets: ["/Framework/Shell/CSS/shell.css"]
    },

    "/RocketLeague": {
        title: "Rocket League | BPD Gaming Network",
        body:
            "/Tabs/RocketLeague/Index/HTML/index.html",
        header:
            "/Framework/Shell/HTML/Header/header.html",
        sidebar:
            "/Framework/Shell/HTML/Sidebar/rocketleague.html",
        footer:
            "/Framework/Shell/HTML/Footer/footer.html"
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
            "/Tabs/RocketLeague/MatchResults/JS/index.js"
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
    stylesheets: ["/Global/404/CSS/404.css"]
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
    stylesheets: ["/Global/Index/CSS/index.css"]
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
        "/Framework/Shell/HTML/Footer/footer.html"
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
