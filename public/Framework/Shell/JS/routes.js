export const ROUTES = {
    //Global
    "/": "/index.html",
    "/Error": "/Global/404/HTML/404.html",
    "/Dashboard": "/Global/Index/HTML/dashboard.html",

    //Categories
    "/RocketLeague": "/Tabs/RocketLeague/Index/HTML/index.html",
    "/RocketLeague/WeeklyMatches": "/Tabs/RocketLeague/WeeklyMatches/HTML/index.html",
    "/RocketLeague/FindPlayers": "/Tabs/RocketLeague/FindPlayers/HTML/index.html",
    "/RocketLeague/PrivateMatches": "/Tabs/RocketLeague/PrivateMatches/HTML/index.html",
    "/RocketLeague/MatchResults": "/Tabs/RocketLeague/MatchResults/HTML/index.html",

    //Required
    "/Settings": "/Global/Settings/HTML/settings.html",
    "/About": "/Global/Required/About/HTML/index.html",
    "/Privacy": "/Global/Required/PrivacyPolicy/HTML/index.html",
    "/Terms": "/Global/Required/TOS/HTML/index.html"
    //ocr

};
export const HEADER_MAP = {
    "/": false,
    "/RocketLeague": false,
    "/Settings": true,

    // pages that should NOT show header
    "/RocketLeague/WeeklyMatches": false,
    "/RocketLeague/PrivateMatches": false,
    "/Dashboard": true
};

    //ALL SIDEBAR MAPPING 
export const SIDEBAR_MAP = {
    "/": "/Framework/Shell/HTML/Sidebar/mainmenu.html",
    "/RocketLeague": "/Framework/Shell/HTML/Sidebar/rocketleague.html",
    "/Settings": "/Framework/Shell/HTML/Sidebar/settings.html"
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
