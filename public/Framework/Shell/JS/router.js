import {
    ROUTES,
    HEADER_MAP
} from "/routes.js";

import {
    initializeOcrNotifications,
    checkActiveOcrSubmission
} from "./ocr_notifications.js";

import {
    loadSidebarHover,
    initializeSidebar
} from "./sidebar.js";

import {
    initializeRouteModule
} from "./initialization.js";

import {
    BPD_AUTH_SESSION_URL
} from "/scripts/apiRoutes.js";
import { apiFetch } from "../../../scripts/apiConnection.js";
const DEFAULT_ROUTE = "/";
const ERROR_ROUTE = "/Error";
const AUTH_FALLBACK_ROUTE = "/RocketLeague";

let navigationId = 0;

/* =========================================================
   INITIAL SIDEBAR LAYOUT STATE

   Apply the saved sidebar state immediately.

   This runs before route HTML is fetched so the content
   layout already knows whether to reserve expanded or
   collapsed sidebar space during initial page load.

   New users:
       desktop -> expanded
       mobile  -> collapsed

   Existing user preference always wins.
   ========================================================= */

function applyInitialSidebarLayoutState() {
    const savedSidebar =
        localStorage.getItem(
            "bpdSidebar"
        );

    let collapsed;

    if (
        savedSidebar ===
        "collapsed"
    ) {
        collapsed =
            true;
    }
    else if (
        savedSidebar ===
        "open"
    ) {
        collapsed =
            false;
    }
    else {
        collapsed =
            window.innerWidth <=
            700;
    }

    document.body.classList.toggle(
        "sidebar-collapsed",
        collapsed
    );

    document.body.dataset.sidebar =
        collapsed
            ? "collapsed"
            : "open";
}
applyInitialSidebarLayoutState();
/* =========================================================
   OCR GLOBAL NOTIFICATIONS
   ========================================================= */

function initializeGlobalOcrNotifications() {
    try {
        initializeOcrNotifications();
    }
    catch (
        error
    ) {
        console.error(
            "ROUTER: OCR notification initialization failed.",
            error
        );
    }
}


async function checkGlobalOcrSubmission() {
    try {
        await checkActiveOcrSubmission();
    }
    catch (
        error
    ) {
        console.error(
            "ROUTER: OCR active submission check failed.",
            error
        );
    }
}


function normalizePath(path) {
    let pathname;

    try {
        pathname =
            new URL(
                String(path || "/"),
                window.location.origin
            ).pathname;
    } catch (error) {
        pathname =
            String(path || "/");
    }

    pathname =
        pathname.trim();

    if (!pathname.startsWith("/")) {
        pathname =
            `/${pathname}`;
    }

    if (
        pathname.length > 1 &&
        pathname.endsWith("/")
    ) {
        pathname =
            pathname.slice(0, -1);
    }

    if (pathname === "/index.html") {
        return "/";
    }

    return pathname;
}


function normalizeDestination(destination) {
    const url =
        new URL(
            String(destination || "/"),
            window.location.origin
        );

    const pathname =
        normalizePath(url.pathname);

    return (
        pathname +
        url.search +
        url.hash
    );
}


function resolveRoute(path) {
    const normalizedPath =
        normalizePath(path);

    if (
        Object.prototype.hasOwnProperty.call(
            ROUTES,
            normalizedPath
        )
    ) {
        return {
            requestedPath:
                normalizedPath,

            routePath:
                normalizedPath,

            config:
                ROUTES[
                    normalizedPath
                ],

            found:
                true
        };
    }

    if (
        Object.prototype.hasOwnProperty.call(
            ROUTES,
            ERROR_ROUTE
        )
    ) {
        return {
            requestedPath:
                normalizedPath,

            routePath:
                ERROR_ROUTE,

            config:
                ROUTES[
                    ERROR_ROUTE
                ],

            found:
                false
        };
    }

    return {
        requestedPath:
            normalizedPath,

        routePath:
            DEFAULT_ROUTE,

        config:
            ROUTES[
                DEFAULT_ROUTE
            ],

        found:
            false
    };
}


function findInheritedMapValue(
    map,
    path,
    fallbackValue
) {
    const normalizedPath =
        normalizePath(path);

    if (
        Object.prototype.hasOwnProperty.call(
            map,
            normalizedPath
        )
    ) {
        return map[
            normalizedPath
        ];
    }

    const matchingRoutes =
        Object.keys(
            map
        )
            .filter(
                function(
                    route
                ) {
                    const normalizedRoute =
                        normalizePath(
                            route
                        );

                    return (
                        normalizedRoute !== "/" &&
                        normalizedPath.startsWith(
                            `${normalizedRoute}/`
                        )
                    );
                }
            )
            .sort(
                function(
                    firstRoute,
                    secondRoute
                ) {
                    return (
                        secondRoute.length -
                        firstRoute.length
                    );
                }
            );

    if (
        matchingRoutes.length > 0
    ) {
        return map[
            matchingRoutes[
                0
            ]
        ];
    }

    if (
        Object.prototype.hasOwnProperty.call(
            map,
            DEFAULT_ROUTE
        )
    ) {
        return map[
            DEFAULT_ROUTE
        ];
    }

    return fallbackValue;
}


function getRoutingControl(event) {
    if (
        !(event.target instanceof Element)
    ) {
        return null;
    }

    return event.target.closest(
        "a[data-router-link], button[data-router-link]"
    );
}


function getRoutingDestination(control) {
    if (!control) {
        return null;
    }

    const destination =
        control.dataset.route ||
        control.getAttribute(
            "href"
        );

    if (!destination) {
        return null;
    }

    const url =
        new URL(
            destination,
            window.location.origin
        );

    if (
        url.origin !==
        window.location.origin
    ) {
        return null;
    }

    return normalizeDestination(
        url.href
    );
}


async function handleRoutingButtonPressed(
    event
) {
    const control =
        getRoutingControl(
            event
        );

    if (!control) {
        return;
    }

    if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey ||
        control.hasAttribute(
            "download"
        ) ||
        control.target === "_blank" ||
        control.disabled ||
        control.classList.contains(
            "disabled"
        )
    ) {
        return;
    }

    const destination =
        getRoutingDestination(
            control
        );

    if (!destination) {
        return;
    }

    event.preventDefault();

    const routeTest =
        testRoute(
            destination
        );

    console.info(
        "ROUTER: Navigation button pressed.",
        routeTest
    );

    document.dispatchEvent(
        new CustomEvent(
            "bpd:route-button-pressed",
            {
                detail: {
                    control,

                    destination,

                    route:
                        routeTest
                }
            }
        )
    );

    await navigate(
        destination
    );
}


export function testRoute(
    path = "/"
) {
    const route =
        resolveRoute(
            path
        );

    const result = {
        requestedPath:
            route.requestedPath,

        resolvedPath:
            route.routePath,

        found:
            route.found,

        requiresAuth:
            route.config
                ?.requiresAuth === true,

        sitemap:
            route.config
                ?.sitemap !== false,

        title:
            route.config
                ?.title || null,

        body:
            route.config
                ?.body || null,

        header:
            route.config
                ?.header || null,

        sidebar:
            route.config
                ?.sidebar || null,

        footer:
            route.config
                ?.footer || null,

        module:
            route.config
                ?.module || null
    };

    console.table(
        result
    );

    return result;
}


export async function testRouteNavigation(
    path = "/"
) {
    const result =
        testRoute(
            path
        );

    await navigate(
        path
    );

    return result;
}


async function fetchHTML(
    file,
    label
) {
    if (!file) {
        return "";
    }

    const response =
        await fetch(
            file,
            {
                method:
                    "GET",

                cache:
                    "no-store",

                headers: {
                    "accept":
                        "text/html"
                }
            }
        );

    if (
        !response.ok
    ) {
        throw new Error(
            (
                `${label} failed to load: `
                + `${response.status} (${file})`
            )
        );
    }

    return response.text();
}


async function loadRouterAuthSession() {
    let result;

    if (
        window.BPDAuth &&
        typeof window.BPDAuth.getSession ===
            "function"
    ) {
        result =
            await window.BPDAuth.getSession();
    }
    else {
        const response =
            await apiFetch(
                BPD_AUTH_SESSION_URL,
                {
                    method:
                        "GET",

                    credentials:
                        "same-origin",

                    cache:
                        "no-store",

                    headers: {
                        "accept":
                            "application/json"
                    }
                }
            );

        if (
            !response.ok
        ) {
            return {
                authenticated:
                    false,

                user:
                    null
            };
        }

        result =
            await response.json()
                .catch(
                    function() {
                        return {};
                    }
                );
    }

    return {
        ...result,

        authenticated:
            result?.authenticated
            === true,

        user:
            result?.user ||
            result?.sessionData ||
            null
    };
}


async function enforceRouteAuthentication(
    route
) {
    if (
        route.config
            ?.requiresAuth !== true
    ) {
        return {
            route,

            authSession:
                null,

            redirected:
                false
        };
    }

    let authSession;

    try {
        authSession =
            await loadRouterAuthSession();
    }
    catch (
        error
    ) {
        console.warn(
            "ROUTER: Unable to verify authentication.",
            error
        );

        authSession = {
            authenticated:
                false,

            user:
                null
        };
    }

    if (
        authSession
            ?.authenticated === true
    ) {
        return {
            route,

            authSession,

            redirected:
                false
        };
    }

    const requestedPath =
        route.requestedPath;

    const fallbackUrl =
        (
            `${AUTH_FALLBACK_ROUTE}`
            + `?returnTo=${encodeURIComponent(
                requestedPath
            )}`
        );

    window.history.replaceState(
        {},
        "",
        fallbackUrl
    );

    document.dispatchEvent(
        new CustomEvent(
            "bpd:route-auth-denied",
            {
                detail: {
                    requestedPath,

                    fallbackPath:
                        AUTH_FALLBACK_ROUTE
                }
            }
        )
    );

    return {
        route:
            resolveRoute(
                AUTH_FALLBACK_ROUTE
            ),

        authSession,

        redirected:
            true
    };
}


function dispatchAuthState(
    authSession
) {
    if (!authSession) {
        return;
    }

    document.dispatchEvent(
        new CustomEvent(
            "bpd:auth-changed",
            {
                detail: {
                    authenticated:
                        authSession
                            ?.authenticated === true,

                    user:
                        authSession
                            ?.user || null
                }
            }
        )
    );
}


function setHeaderVisibility(
    showHeader
) {
    const headerElement =
        document.getElementById(
            "header"
        );

    document.body.dataset.header =
        showHeader
            ? "visible"
            : "hidden";

    document.body.classList.toggle(
        "header-hidden",
        !showHeader
    );

    if (!headerElement) {
        return;
    }

    headerElement.hidden =
        !showHeader;

    if (
        !showHeader
    ) {
        headerElement.innerHTML =
            "";
    }
}


function setPageLoading(
    loading
) {
    document.body.dataset.pageLoading =
        String(
            loading
        );

    document.body.classList.toggle(
        "page-loading",
        loading
    );
}


async function initializeLoadedSidebar(
    authSession
) {
    try {
        await loadSidebarHover();

        initializeSidebar();

        dispatchAuthState(
            authSession
        );
    }
    catch (
        error
    ) {
        console.error(
            "ROUTER: Sidebar initialization failed.",
            error
        );
    }
}


async function initializeLoadedRouteModule(
    moduleFile
) {
    if (!moduleFile) {
        return;
    }

    try {
        const moduleUrl =
            new URL(
                moduleFile,
                window.location.origin
            );

        moduleUrl.searchParams.set(
            "routeLoad",
            String(
                navigationId
            )
        );

        await initializeRouteModule(
            moduleUrl.href
        );
    }
    catch (
        error
    ) {
        console.error(
            "ROUTER: Route module initialization failed.",
            error
        );

        document.dispatchEvent(
            new CustomEvent(
                "bpd:route-module-error",
                {
                    detail: {
                        module:
                            moduleFile,

                        error
                    }
                }
            )
        );
    }
}


async function loadShell() {
    const currentNavigationId =
        ++navigationId;

    setPageLoading(
        true
    );

    let route =
        resolveRoute(
            window.location.pathname
        );

    const authCheck =
        await enforceRouteAuthentication(
            route
        );

    if (
        currentNavigationId !==
        navigationId
    ) {
        return;
    }

    route =
        authCheck.route;

    const routeConfig =
        route.config;

    if (
        !routeConfig
    ) {
        console.error(
            "ROUTER: Route configuration was not found."
        );

        setPageLoading(
            false
        );

        return;
    }

    const showHeader =
        findInheritedMapValue(
            HEADER_MAP,
            route.routePath,
            true
        ) !== false;

    const headerElement =
        document.getElementById(
            "header"
        );

    const sidebarElement =
        document.getElementById(
            "sidebar"
        );

    const contentElement =
        document.getElementById(
            "siteContent"
        );

    const footerElement =
        document.getElementById(
            "footer"
        );

    if (
        !sidebarElement ||
        !contentElement
    ) {
        console.error(
            "ROUTER: Required shell elements were not found."
        );

        setPageLoading(
            false
        );

        return;
    }

    setHeaderVisibility(
        showHeader
    );

    document.title =
        routeConfig.title ||
        "BPD Gaming Network";

    try {
        const [
            headerHTML,
            sidebarHTML,
            pageHTML,
            footerHTML
        ] =
            await Promise.all([
                showHeader
                    ? fetchHTML(
                        routeConfig.header,
                        "Header"
                    )
                    : Promise.resolve(
                        ""
                    ),

                fetchHTML(
                    routeConfig.sidebar,
                    "Sidebar"
                ),

                fetchHTML(
                    routeConfig.body,
                    "Page"
                ),

                fetchHTML(
                    routeConfig.footer,
                    "Footer"
                )
            ]);

        if (
            currentNavigationId !==
            navigationId
        ) {
            return;
        }

        if (
            headerElement &&
            showHeader
        ) {
            headerElement.innerHTML =
                headerHTML;
        }

        sidebarElement.innerHTML =
            sidebarHTML;

        contentElement.innerHTML =
            pageHTML;

        if (
            footerElement
        ) {
            footerElement.innerHTML =
                footerHTML;
        }

        document.body.dataset.currentRoute =
            route.routePath;

        document.body.dataset.routeFound =
            String(
                route.found
            );

        await initializeLoadedSidebar(
            authCheck.authSession
        );

        await initializeLoadedRouteModule(
            routeConfig.module
        );

        contentElement.focus({
            preventScroll:
                true
        });

        window.scrollTo({
            top:
                0,

            left:
                0,

            behavior:
                "auto"
        });

        document.dispatchEvent(
            new CustomEvent(
                "bpd:page-loaded",
                {
                    detail: {
                        requestedPath:
                            route.requestedPath,

                        routePath:
                            route.routePath,

                        found:
                            route.found,

                        redirected:
                            authCheck.redirected
                    }
                }
            )
        );
        
        /* =================================================
           OCR ACTIVE SUBMISSION CHECK

           This does not start permanent polling for users
           without an OCR job.

           If an active OCR job exists in localStorage,
           ocr_notifications.js resumes/checks that job.

           If no active job exists, this is effectively a
           no-op.
           ================================================= */

        await checkGlobalOcrSubmission();
    }
    catch (
        error
    ) {
        console.error(
            "ROUTER: Shell loading failed.",
            error
        );

        contentElement.innerHTML = `
            <section class="route-load-error">
                <h1>Unable to load this page</h1>
                <p>
                    Please refresh the page or return
                    to the main menu.
                </p>
                <a href="/" data-router-link>
                    Main Menu
                </a>
            </section>
        `;
    }
    finally {
        if (
            currentNavigationId ===
            navigationId
        ) {
            setPageLoading(
                false
            );
        }
    }
}


async function navigate(
    destination,
    options = {}
) {
    const normalizedDestination =
        normalizeDestination(
            destination
        );

    const destinationUrl =
        new URL(
            normalizedDestination,
            window.location.origin
        );

    const currentUrl =
        (
            window.location.pathname +
            window.location.search +
            window.location.hash
        );

    if (
        normalizedDestination !==
        currentUrl
    ) {
        if (
            options.replace === true
        ) {
            window.history.replaceState(
                {},
                "",
                destinationUrl.href
            );
        }
        else {
            window.history.pushState(
                {},
                "",
                destinationUrl.href
            );
        }
    }

    await loadShell();
}


/* =========================================================
   ROUTER EVENTS
   ========================================================= */

document.addEventListener(
    "click",
    handleRoutingButtonPressed
);


window.addEventListener(
    "popstate",
    function() {
        loadShell();
    }
);


/* =========================================================
   PUBLIC ROUTER
   ========================================================= */

window.BPDRouter = {
    testRoute,

    testRouteNavigation,

    navigate,

    reload:
        loadShell
};


/* =========================================================
   GLOBAL OCR NOTIFICATION INITIALIZATION

   Runs once when the router module itself loads.

   ocr_notifications.js owns its own timer and should only
   poll while an active OCR job exists.
   ========================================================= */

initializeGlobalOcrNotifications();


/* =========================================================
   INITIAL PAGE LOAD
   ========================================================= */

if (
    !window.location.pathname.startsWith(
        "/api/"
    )
) {
    loadShell();
}