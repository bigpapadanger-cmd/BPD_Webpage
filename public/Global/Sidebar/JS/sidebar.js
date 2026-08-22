/* 
========================================================= 
BPD GAMING NETWORK 
GLOBAL SIDEBAR 
========================================================= 
 
The sidebar is shared across the website, but each major 
section has its own sidebar HTML file. 
 
Sidebar files: 
 
../HTML/mainmenu.html 
../HTML/rocketleague.html 
../HTML/settings.html 
../HTML/hover.html 
 
Examples: 
 
/                           -> mainmenu.html 
/RocketLeague               -> rocketleague.html 
/RocketLeague/WeeklyMatches -> rocketleague.html 
/RocketLeague/FindPlayers   -> rocketleague.html 
/RocketLeague/PrivateMatches -> rocketleague.html 
/Settings                   -> settings.html 
 
The sidebar HTML paths are resolved relative to this 
JavaScript file. 
 
========================================================= 
*/ 
const BPD_AUTH_SESSION_URL="/api/auth/session";
const BPD_AUTH_LOGOUT_URL="/api/auth/logout";
let BPD_AUTH_SESSION_PROMISE=null;
function normalizeBpdAuthSession(data){
    const authenticated=(
        data?.authenticated===true
        &&data?.user
        &&typeof data.user==="object"
    );
    return{
        authenticated:authenticated,
        user:authenticated
            ?{
                epicAccountId:String(
                    data.user.epicAccountId||""
                ),
                displayName:String(
                    data.user.displayName||"Epic Player"
                )
            }
            :null
    };
}
async function requestBpdAuthSession(){
    try{
        const response=await fetch(
            BPD_AUTH_SESSION_URL,
            {
                method:"GET",
                credentials:"include",
                cache:"no-store",
                headers:{
                    "accept":"application/json"
                }
            }
        );
        if(!response.ok){
            return normalizeBpdAuthSession(null);
        }
        const data=await response.json();
        return normalizeBpdAuthSession(data);
    }catch(error){
        console.warn(
            "BPD AUTH: Session check failed. Treating visitor as logged out.",
            error
        );
        return normalizeBpdAuthSession(null);
    }
}
function getBpdAuthSession(forceRefresh=false){
    if(forceRefresh||!BPD_AUTH_SESSION_PROMISE){
        BPD_AUTH_SESSION_PROMISE=requestBpdAuthSession();
    }
    return BPD_AUTH_SESSION_PROMISE;
}
window.BPDAuth={
    getSession:getBpdAuthSession
};
 
 
/* 
========================================================= 
LOAD GLOBAL SIDEBAR 
========================================================= 
*/ 
 
async function loadGlobalSidebar() { 
    const sidebarContainer = document.getElementById("global-sidebar"); 
 
    if (!sidebarContainer) { 
        console.warn("GLOBAL SIDEBAR: #global-sidebar was not found."); 
        return; 
    } 
 
    const sidebarFile = getSidebarFile(); 
 
    try { 
        console.log("GLOBAL SIDEBAR: Loading:", sidebarFile); 
 
        const response = await fetch(sidebarFile); 
 
        if (!response.ok) { 
            throw new Error( 
                `Sidebar failed to load: ${response.status} ${response.statusText}` 
            ); 
        } 
 
        const sidebarHTML = await response.text(); 
 
        sidebarContainer.innerHTML = sidebarHTML; 
 
        await loadSidebarHover();
        const authSession=await getBpdAuthSession();
        initializeGlobalSidebar(authSession);
    } catch (error) { 
        console.error("GLOBAL SIDEBAR:", error); 
    } 
} 
 
 
/* 
========================================================= 
GET SIDEBAR BASE URL 
========================================================= 
*/ 
 
function getSidebarBaseUrl() { 
    const sidebarScript = document.querySelector( 
        'script[src*="/Sidebar/JS/sidebar.js"]' 
    ); 
 
    if (!sidebarScript) { 
        throw new Error( 
            "GLOBAL SIDEBAR: sidebar.js script element was not found." 
        ); 
    } 
 
    return new URL("../HTML/", sidebarScript.src); 
} 
 
 
/* 
========================================================= 
DETERMINE SIDEBAR FILE 
========================================================= 
*/ 
 
function getSidebarFile() { 
    const path = normalizePath(window.location.pathname); 
    const sidebarBaseUrl = getSidebarBaseUrl(); 
 
    /* 
    ===================================================== 
    MAIN MENU 
    ===================================================== 
    */ 
 
    if ( 
        path === "/" || 
        path === "/index.html" || 
        path === "/Global/Index/HTML/homepage.html" 
    ) { 
        return new URL("mainmenu.html", sidebarBaseUrl).href; 
    } 
 
    /* 
    ===================================================== 
    ROCKET LEAGUE 
    ===================================================== 
    */ 
 
    if (
        
        path.includes("/Categories/RocketLeague/")
    ) {
        return new URL("rocketleague.html", sidebarBaseUrl).href;
    }
 
    /* 
    ===================================================== 
    SETTINGS 
    ===================================================== 
    */ 
 
    if ( 
        path === "/Settings" || 
        path.startsWith("/Settings/") 
    ) { 
        return new URL("settings.html", sidebarBaseUrl).href; 
    } 
 
    /* 
    ===================================================== 
    DEFAULT 
    ===================================================== 
    */ 
 
    return new URL("mainmenu.html", sidebarBaseUrl).href; 
} 
 
 
/* 
========================================================= 
LOAD SIDEBAR HOVER HTML 
========================================================= 
 
Loads: 
 
../HTML/hover.html 
 
and places the physical tooltip element directly 
inside the document body. 
 
This allows the tooltip to exist outside the sidebar's 
layout and appear freely on the screen. 
========================================================= 
*/ 
 
async function loadSidebarHover() { 
    const sidebarBaseUrl = getSidebarBaseUrl(); 
    const hoverFile = new URL("hover.html", sidebarBaseUrl).href; 
 
    try { 
        console.log("GLOBAL SIDEBAR: Loading hover:", hoverFile); 
 
        const response = await fetch(hoverFile); 
 
        if (!response.ok) { 
            throw new Error( 
                `Sidebar hover failed to load: ${response.status} ${response.statusText}` 
            ); 
        } 
 
        const hoverHTML = await response.text(); 
 
        /* 
        ================================================= 
        REMOVE EXISTING HOVER 
        ================================================= 
        */ 
 
        const existingHover = 
            document.getElementById("sidebarHover"); 
 
        if (existingHover) { 
            existingHover.remove(); 
        } 
 
        /* 
        ================================================= 
        CREATE TEMPORARY CONTAINER 
        ================================================= 
        */ 
 
        const hoverContainer = 
            document.createElement("div"); 
 
        hoverContainer.innerHTML = hoverHTML; 
 
        /* 
        ================================================= 
        MOVE HOVER HTML INTO BODY 
        ================================================= 
        */ 
 
        while (hoverContainer.firstElementChild) { 
            document.body.appendChild( 
                hoverContainer.firstElementChild 
            ); 
        } 
 
        console.log( 
            "GLOBAL SIDEBAR: Hover HTML loaded successfully." 
        ); 
    } catch (error) { 
        console.error( 
            "GLOBAL SIDEBAR: Failed to load hover.html:", 
            error 
        ); 
    } 
} 
 
 
/* 
========================================================= 
INITIALIZE SIDEBAR 
========================================================= 
 
Runs after the selected sidebar HTML and hover HTML 
have been loaded. 
========================================================= 
*/ 
 
function initializeGlobalSidebar(authSession) { 
    const sidebar = 
        document.getElementById("sidebar"); 
 
    const sidebarToggle = 
        document.getElementById("sidebarToggle"); 
 
    if (!sidebar) { 
        console.error( 
            "GLOBAL SIDEBAR: Sidebar element was not found." 
        ); 
        return; 
    } 
 
    applyGlobalSettings( 
        sidebar, 
        sidebarToggle 
    ); 
 
    setupSidebarToggle( 
        sidebar, 
        sidebarToggle 
    ); 
 
    setupActiveNavigation(); 
 
    setupDisabledNavigation(); 
 
    applySidebarAuthState(
        authSession
    );

    setupSidebarTooltips(); 
} 
function applySidebarAuthState(authSession){
    const authenticated=authSession?.authenticated===true;
    const authenticatedItems=document.querySelectorAll(
        '#sidebar [data-auth="authenticated"]'
    );
    authenticatedItems.forEach(function(item){
        item.hidden=!authenticated;
    });
    const authButton=document.getElementById(
        "sidebarAuthButton"
    );
    const authLabel=document.getElementById(
        "sidebarAuthLabel"
    );
    const authIcon=document.getElementById(
        "sidebarAuthIcon"
    );
    if(authButton&&authLabel&&authIcon){
        if(authenticated){
            authButton.href=BPD_AUTH_LOGOUT_URL;
            authButton.dataset.navRoute=BPD_AUTH_LOGOUT_URL;
            authButton.dataset.tooltip="Logout";
            authLabel.textContent="Logout";
            authIcon.textContent="⇤";
            authButton.addEventListener(
                "click",
                handleBpdLogout
            );
        }else{
            authButton.href="/auth/epic/login";
            authButton.dataset.navRoute="/auth/epic/login";
            authButton.dataset.tooltip="Login or Register";
            authLabel.textContent="Login / Register";
            authIcon.textContent="⇥";
        }
    }
    document.body.dataset.authenticated=String(
        authenticated
    );
    document.dispatchEvent(
        new CustomEvent(
            "bpd:auth-ready",
            {
                detail:authSession
            }
        )
    );
}
async function handleBpdLogout(event){
    event.preventDefault();
    const authButton=event.currentTarget;
    authButton.setAttribute(
        "aria-disabled",
        "true"
    );
    try{
        await fetch(
            BPD_AUTH_LOGOUT_URL,
            {
                method:"POST",
                credentials:"include",
                cache:"no-store",
                headers:{
                    "accept":"application/json"
                }
            }
        );
    }catch(error){
        console.warn(
            "BPD AUTH: Logout request failed.",
            error
        );
    }finally{
        BPD_AUTH_SESSION_PROMISE=null;
        window.location.assign(
            "/Categories/RocketLeague/Index/HTML/index.html"
        );
    }
}
 
 
/* 
========================================================= 
APPLY GLOBAL SETTINGS 
========================================================= 
*/ 
 
function applyGlobalSettings(sidebar, sidebarToggle) {
    const savedSidebar =
        localStorage.getItem("bpdSidebar") || "open";

    const savedTheme =
        localStorage.getItem("bpdTheme") || "blue";

    const savedAnimations =
        localStorage.getItem("bpdAnimations") || "on";

    if (savedSidebar === "collapsed") {
        sidebar.classList.add("collapsed");
        document.body.classList.add("sidebar-collapsed");
    } else {
        sidebar.classList.remove("collapsed");
        document.body.classList.remove("sidebar-collapsed");
    }

    if (sidebarToggle) {
        sidebarToggle.setAttribute(
            "aria-expanded",
            savedSidebar !== "collapsed"
        );
    }

    document.body.dataset.theme = savedTheme;
    document.body.dataset.animations = savedAnimations;

    if (savedAnimations === "off") {
        document.body.classList.add("animations-off");
    } else {
        document.body.classList.remove("animations-off");
    }
} 
 
 
/* 
========================================================= 
SIDEBAR TOGGLE 
========================================================= 
*/ 
 
function setupSidebarToggle( 
    sidebar, 
    sidebarToggle 
) { 
    if (!sidebarToggle) { 
        return; 
    } 
 
    sidebarToggle.addEventListener( 
        "click", 
        () => { 
            const isCollapsed = 
                sidebar.classList.contains( 
                    "collapsed" 
                ); 
 
            /* 
            ============================================= 
            OPEN SIDEBAR 
            ============================================= 
            */ 
 
            if (isCollapsed) { 
                sidebar.classList.remove( 
                    "collapsed" 
                ); 
 
                document.body.classList.remove( 
                    "sidebar-collapsed" 
                ); 
 
                localStorage.setItem( 
                    "bpdSidebar", 
                    "open" 
                ); 
 
                sidebarToggle.setAttribute( 
                    "aria-expanded", 
                    "true" 
                ); 
 
                hideSidebarTooltip(); 
            } 
 
            /* 
            ============================================= 
            COLLAPSE SIDEBAR 
            ============================================= 
            */ 
 
            else { 
                sidebar.classList.add( 
                    "collapsed" 
                ); 
 
                document.body.classList.add( 
                    "sidebar-collapsed" 
                ); 
 
                localStorage.setItem( 
                    "bpdSidebar", 
                    "collapsed" 
                ); 
 
                sidebarToggle.setAttribute( 
                    "aria-expanded", 
                    "false" 
                ); 
            } 
        } 
    ); 
} 
 
 
/* 
========================================================= 
SIDEBAR TOOLTIP 
========================================================= 
 
Uses the physical HTML element loaded from: 
 
../HTML/hover.html 
 
Expected elements: 
 
#sidebarHover 
#sidebarHoverText 
 
The tooltip follows the mouse cursor while hovering 
collapsed sidebar navigation items. 
========================================================= 
*/ 
 
function setupSidebarTooltips() { 
    const sidebar = 
        document.getElementById("sidebar"); 
 
    const tooltip = 
        document.getElementById("sidebarHover"); 
 
    const tooltipText = 
        document.getElementById("sidebarHoverText"); 
 
    if (!sidebar) { 
        console.warn( 
            "GLOBAL SIDEBAR: Sidebar was not found for tooltips." 
        ); 
        return; 
    } 
 
    if (!tooltip || !tooltipText) { 
        console.warn( 
            "GLOBAL SIDEBAR: hover.html elements were not found." 
        ); 
        return; 
    } 
 
    /* 
    ===================================================== 
    FIND TOOLTIP ITEMS 
    ===================================================== 
    */ 
 
    const tooltipItems = 
        sidebar.querySelectorAll( 
            ".nav-item[data-tooltip]" 
        ); 
 
    tooltipItems.forEach((item) => { 
        /* 
        ================================================ 
        MOUSE ENTER 
        ================================================ 
        */ 
 
        item.addEventListener(
            "mouseenter",
            (event) => {
       

                if (
                    !sidebar.classList.contains(
                        "collapsed"
                    )
                ) {
                    hideSidebarTooltip();
                    return;
                }

                const text =
                    item.dataset.tooltip;

                if (!text) {
                    hideSidebarTooltip();
                    return;
                }

                showSidebarTooltip(
                    tooltip,
                    tooltipText,
                    event,
                    text
                );
            }
        );
 
        /* 
        ================================================ 
        MOUSE MOVE 
        ================================================ 
        */ 
 
        item.addEventListener(
            "mousemove",
            (event) => {
                if (
                    !sidebar.classList.contains(
                        "collapsed"
                    )
                ) {
                    return;
                }

                const text =
                    item.dataset.tooltip;

                if (!text) {
                    return;
                }

                showSidebarTooltip(
                    tooltip,
                    tooltipText,
                    event,
                    text
                );
            }
        ); 
 
        /* 
        ================================================ 
        MOUSE LEAVE 
        ================================================ 
        */ 
 
        item.addEventListener( 
            "mouseleave", 
            (event) => { 
                hideSidebarTooltip(); 
            } 
        ); 
    }); 
 
    /* 
    ===================================================== 
    HIDE WHEN LEAVING SIDEBAR 
    ===================================================== 
    */ 
 
    sidebar.addEventListener( 
        "mouseleave", 
        () => { 
            hideSidebarTooltip(); 
        } 
    ); 
 
    /* 
    ===================================================== 
    HIDE WHEN SCROLLING 
    ===================================================== 
    */ 
 
    sidebar.addEventListener( 
        "scroll", 
        () => { 
            hideSidebarTooltip(); 
        } 
    ); 
} 
 
 
/* 
========================================================= 
SHOW SIDEBAR TOOLTIP 
========================================================= 
*/ 
 
function showSidebarTooltip(
    tooltip,
    tooltipText,
    event,
    text
    ) {


    /*
    =====================================================
    SET TEXT
    =====================================================
    */

    tooltipText.textContent =
        text;


    /*
    =====================================================
    POSITION NEAR CURSOR
    =====================================================
    */

    tooltip.style.left =
        `${event.clientX + 25}px`;

    tooltip.style.top =
        `${event.clientY + 10}px`;



    /*
    =====================================================
    SHOW TOOLTIP
    =====================================================
    */

    tooltip.classList.add(
        "visible"
    );



    tooltip.setAttribute(
        "aria-hidden",
        "false"
    );



}
 
 
/* 
========================================================= 
HIDE SIDEBAR TOOLTIP 
========================================================= 
*/ 
 
function hideSidebarTooltip() { 
    const tooltip = 
        document.getElementById( 
            "sidebarHover" 
        ); 
 
    if (!tooltip) { 
        return; 
    } 
 
    tooltip.classList.remove( 
        "visible" 
    ); 
 
    tooltip.setAttribute( 
        "aria-hidden", 
        "true" 
    ); 
} 
 
 
/* 
========================================================= 
ACTIVE NAVIGATION 
========================================================= 
*/ 
 
function setupActiveNavigation() { 
    const currentPath = 
        normalizePath( 
            window.location.pathname 
        ); 
 
    const navItems = 
        document.querySelectorAll( 
            ".nav-item[data-nav-route]" 
        ); 
 
    navItems.forEach((item) => { 
        const route = 
            normalizePath( 
                item.dataset.navRoute 
            ); 
 
        /* 
        ================================================= 
        EXACT MATCH 
        ================================================= 
        */ 
 
        if (currentPath === route) { 
            item.classList.add( 
                "active" 
            ); 
 
            return; 
        } 
 
        /* 
        ================================================= 
        SECTION MATCH 
        ================================================= 
        */ 
 
        if ( 
            route !== "/" && 
            route !== "" && 
            currentPath.startsWith( 
                route + "/" 
            ) 
        ) { 
            item.classList.add( 
                "active" 
            ); 
        } 
    }); 
} 
 
 
/* 
========================================================= 
NORMALIZE PATH 
========================================================= 
*/ 
 
function normalizePath(path) { 
    if (!path) { 
        return "/"; 
    } 
 
    /* 
    ===================================================== 
    REMOVE TRAILING SLASH 
    ===================================================== 
    */ 
 
    if ( 
        path.length > 1 && 
        path.endsWith("/") 
    ) { 
        path = 
            path.slice( 
                0, 
                -1 
            ); 
    } 
 
    /* 
    ===================================================== 
    NORMALIZE INDEX.HTML 
    ===================================================== 
    */ 
 
    if ( 
        path === "/index.html" 
    ) { 
        return "/"; 
    } 
 
    return path; 
} 
 
 
/* 
========================================================= 
DISABLED NAVIGATION 
========================================================= 
*/ 
 
function setupDisabledNavigation() { 
    document 
        .querySelectorAll( 
            ".nav-item.disabled" 
        ) 
        .forEach((item) => { 
            item.addEventListener( 
                "click", 
                (event) => { 
                    event.preventDefault(); 
                } 
            ); 
        }); 
} 
 
 
/* 
========================================================= 
START SIDEBAR 
========================================================= 
*/ 
 
loadGlobalSidebar(); 
