import {
    ROUTES,
    HEADER_MAP,
    getMasterCssForRoute
} from "/routes.js";

import {
    initializeOcrNotifications,
    checkActiveOcrSubmission
} from "./ocr_notifications.js";

import {
    initializeOcrResults
} from "./ocr_results.js";

import {
    loadSidebarHover,
    initializeSidebar
} from "./sidebar.js";

import {
    initializeRouteModule
} from "./initialization.js";

import {
    BPD_AUTH_SESSION_URL
} from "../../../scripts/apiRoutes.js";

import {
    apiFetch
} from "../../../scripts/apiConnection.js";

import {
    APP_ASSET_ID
} from "/scripts/cacheHandler.js";

/* =========================================================
   BPD GAMING NETWORK
   SPA ROUTER
   ========================================================= */

const DEFAULT_ROUTE =
    "/";

const ERROR_ROUTE =
    "/Error";

const AUTH_FALLBACK_ROUTE =
    "/RocketLeague";

const MASTER_CSS_LINK_ID =
    "bpdMasterCss";

let navigationId =
    0;

let globalOcrInitialized =
    false;

/* =========================================================
   INITIAL SHELL STATE
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

/* =========================================================
   GLOBAL OCR
   ========================================================= */

function initializeGlobalOcr() {
    if (
        globalOcrInitialized
    ) {
        return;
    }

    try {
        initializeOcrResults();
    }
    catch (
        error
    ) {
        console.error(
            "ROUTER: OCR result initialization failed.",
            error
        );
    }

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

    globalOcrInitialized =
        true;
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

/* =========================================================
   PATH NORMALIZATION
   ========================================================= */

function normalizePath(
    path
) {
    let pathname;

    try {
        pathname =
            new URL(
                String(
                    path
                    || "/"
                ),
                window.location.origin
            ).pathname;
    }
    catch {
        pathname =
            String(
                path
                || "/"
            );
    }

    pathname =
        pathname.trim();

    if (
        !pathname.startsWith(
            "/"
        )
    ) {
        pathname =
            "/"
            + pathname;
    }

    while (
        pathname.length > 1
        && pathname.endsWith(
            "/"
        )
    ) {
        pathname =
            pathname.slice(
                0,
                -1
            );
    }

    if (
        pathname ===
        "/index.html"
    ) {
        return "/";
    }

    return (
        pathname
        || "/"
    );
}

function normalizeDestination(
    destination
) {
    const url =
        new URL(
            String(
                destination
                || "/"
            ),
            window.location.origin
        );

    return (
        normalizePath(
            url.pathname
        )
        + url.search
        + url.hash
    );
}

/* =========================================================
   ROUTE RESOLUTION
   ========================================================= */

function routeExists(
    path
) {
    return Object.prototype
        .hasOwnProperty
        .call(
            ROUTES,
            normalizePath(
                path
            )
        );
}

function resolveRoute(
    path
) {
    const requestedPath =
        normalizePath(
            path
        );

    if (
        routeExists(
            requestedPath
        )
    ) {
        return {
            requestedPath,
            routePath:
                requestedPath,
            config:
                ROUTES[
                    requestedPath
                ],
            found:
                true
        };
    }

    if (
        routeExists(
            ERROR_ROUTE
        )
    ) {
        return {
            requestedPath,
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
        requestedPath,
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
        normalizePath(
            path
        );

    if (
        Object.prototype
            .hasOwnProperty
            .call(
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
                        normalizedRoute !==
                            "/"
                        && normalizedPath.startsWith(
                            normalizedRoute
                            + "/"
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
                        secondRoute.length
                        - firstRoute.length
                    );
                }
            );

    if (
        matchingRoutes.length
    ) {
        return map[
            matchingRoutes[
                0
            ]
        ];
    }

    if (
        Object.prototype
            .hasOwnProperty
            .call(
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

/* =========================================================
   MASTER CSS
   ========================================================= */

function normalizeCssPath(
    value
) {
    try {
        return new URL(
            String(
                value
                || ""
            ),
            window.location.origin
        ).pathname;
    }
    catch {
        return String(
            value
            || ""
        )
            .trim();
    }
}

function createAssetUrl(
    path
) {
    const url =
        new URL(
            path,
            window.location.origin
        );

    if (
        APP_ASSET_ID
    ) {
        url.searchParams.set(
            "v",
            APP_ASSET_ID
        );
    }

    return url.href;
}

function getCurrentMasterCssLink() {
    return document.getElementById(
        MASTER_CSS_LINK_ID
    );
}

function createPendingStylesheet(
    href
) {
    return new Promise(
        function(
            resolve,
            reject
        ) {
            const link =
                document.createElement(
                    "link"
                );

            link.rel =
                "stylesheet";

            link.href =
                href;

            link.dataset.masterCss =
                "pending";

            link.addEventListener(
                "load",
                function() {
                    resolve(
                        link
                    );
                },
                {
                    once:
                        true
                }
            );

            link.addEventListener(
                "error",
                function() {
                    link.remove();

                    reject(
                        new Error(
                            "Master stylesheet failed to load: "
                            + href
                        )
                    );
                },
                {
                    once:
                        true
                }
            );

            document.head.appendChild(
                link
            );
        }
    );
}

async function applyMasterCss(
    routePath,
    currentNavigationId
) {
    let desiredCss =
        getMasterCssForRoute(
            routePath
        );

    let desiredPath =
        normalizeCssPath(
            desiredCss
        );

    const currentLink =
        getCurrentMasterCssLink();

    const currentPath =
        normalizeCssPath(
            currentLink?.href
            || ""
        );

    if (
        currentLink
        && currentPath ===
            desiredPath
    ) {
        document.body.dataset.masterCss =
            desiredPath;

        return;
    }

    let nextLink;

    try {
        nextLink =
            await createPendingStylesheet(
                createAssetUrl(
                    desiredCss
                )
            );
    }
    catch (
        error
    ) {
        const fallbackCss =
            getMasterCssForRoute(
                ERROR_ROUTE
            );

        const fallbackPath =
            normalizeCssPath(
                fallbackCss
            );

        console.warn(
            "ROUTER: Master CSS failed to load.",
            {
                routePath,
                desiredCss,
                fallbackCss,
                error
            }
        );

        if (
            desiredPath ===
            fallbackPath
        ) {
            throw error;
        }

        const existingLink =
            getCurrentMasterCssLink();

        const existingPath =
            normalizeCssPath(
                existingLink?.href
                || ""
            );

        if (
            existingLink
            && existingPath ===
                fallbackPath
        ) {
            document.body.dataset.masterCss =
                fallbackPath;

            return;
        }

        desiredCss =
            fallbackCss;

        desiredPath =
            fallbackPath;

        nextLink =
            await createPendingStylesheet(
                createAssetUrl(
                    fallbackCss
                )
            );
    }

    if (
        !isCurrentNavigation(
            currentNavigationId
        )
    ) {
        nextLink.remove();

        return;
    }

    const previousLink =
        getCurrentMasterCssLink();

    if (
        previousLink
        && previousLink !==
            nextLink
    ) {
        previousLink.remove();
    }

    nextLink.id =
        MASTER_CSS_LINK_ID;

    nextLink.dataset.masterCss =
        "active";

    document.body.dataset.masterCss =
        desiredPath;
}

/* =========================================================
   ROUTING CONTROLS
   ========================================================= */

function getRoutingControl(
    event
) {
    if (
        !(
            event.target instanceof
            Element
        )
    ) {
        return null;
    }

    return event.target.closest(
        "a[data-router-link], button[data-router-link]"
    );
}

function getRoutingDestination(
    control
) {
    if (
        !control
    ) {
        return null;
    }

    const destination =
        control.dataset.route
        || control.getAttribute(
            "href"
        );

    if (
        !destination
    ) {
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

    if (
        !control
    ) {
        return;
    }

    if (
        event.defaultPrevented
        || event.button !==
            0
        || event.ctrlKey
        || event.metaKey
        || event.shiftKey
        || event.altKey
        || control.hasAttribute(
            "download"
        )
        || control.target ===
            "_blank"
        || control.disabled
        || control.classList.contains(
            "disabled"
        )
    ) {
        return;
    }

    const destination =
        getRoutingDestination(
            control
        );

    if (
        !destination
    ) {
        return;
    }

    event.preventDefault();

    const routeTest =
        testRoute(
            destination
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

/* =========================================================
   ROUTE TESTING
   ========================================================= */

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
                ?.requiresAuth ===
            true,

        sitemap:
            route.config
                ?.sitemap !==
            false,

        title:
            route.config
                ?.title
            || null,

        body:
            route.config
                ?.body
            || null,

        header:
            route.config
                ?.header
            || null,

        sidebar:
            route.config
                ?.sidebar
            || null,

        footer:
            route.config
                ?.footer
            || null,

        module:
            route.config
                ?.module
            || null,

        masterCss:
            getMasterCssForRoute(
                route.routePath
            )
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

/* =========================================================
   STATIC HTML
   ========================================================= */

async function fetchHTML(
    file,
    label
) {
    if (
        !file
    ) {
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
                    "Accept":
                        "text/html"
                }
            }
        );

    if (
        !response.ok
    ) {
        throw new Error(
            label
            + " failed to load: "
            + response.status
            + " ("
            + file
            + ")"
        );
    }

    return response.text();
}

/* =========================================================
   ROUTE CLASSIC SCRIPTS
   ========================================================= */

function isRouteScriptLoaded(
    src
) {
    return Array.from(
        document.scripts
    )
        .some(
            function(
                script
            ) {
                return (
                    script.dataset
                        .loadedRouteScript ===
                    src
                );
            }
        );
}

function loadRouteScript(
    placeholder
) {
    return new Promise(
        function(
            resolve,
            reject
        ) {
            const src =
                String(
                    placeholder.src
                    || ""
                )
                    .trim();

            if (
                !src
            ) {
                placeholder.remove();
                resolve();
                return;
            }

            if (
                isRouteScriptLoaded(
                    src
                )
            ) {
                placeholder.remove();
                resolve();
                return;
            }

            const script =
                document.createElement(
                    "script"
                );

            script.src =
                src;

            script.async =
                false;

            script.dataset.loadedRouteScript =
                src;

            script.addEventListener(
                "load",
                function() {
                    placeholder.remove();
                    resolve();
                },
                {
                    once:
                        true
                }
            );

            script.addEventListener(
                "error",
                function() {
                    script.remove();
                    placeholder.remove();

                    reject(
                        new Error(
                            "Failed to load route script: "
                            + src
                        )
                    );
                },
                {
                    once:
                        true
                }
            );

            document.head.appendChild(
                script
            );
        }
    );
}

async function activateRouteScripts(
    container
) {
    if (
        !container
    ) {
        return;
    }

    const routeScripts =
        Array.from(
            container.querySelectorAll(
                "script[data-route-script][src]"
            )
        );

    for (
        const placeholder
        of routeScripts
    ) {
        await loadRouteScript(
            placeholder
        );
    }
}

/* =========================================================
   AUTHENTICATION
   ========================================================= */

async function loadRouterAuthSession() {
    let result;

    if (
        window.BPDAuth
        && typeof window.BPDAuth
            .getSession ===
            "function"
    ) {
        result =
            await window.BPDAuth
                .getSession();
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
                        "Accept":
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
            await response
                .json()
                .catch(
                    function() {
                        return {};
                    }
                );
    }

    return {
        ...result,

        authenticated:
            result?.authenticated ===
            true,

        user:
            result?.user
            || result?.sessionData
            || null
    };
}

async function enforceRouteAuthentication(
    route
) {
    if (
        route.config
            ?.requiresAuth !==
        true
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
            "ROUTER: Authentication check failed.",
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
        authSession.authenticated ===
        true
    ) {
        return {
            route,
            authSession,
            redirected:
                false
        };
    }

    const fallbackUrl =
        AUTH_FALLBACK_ROUTE
        + "?returnTo="
        + encodeURIComponent(
            route.requestedPath
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
                    requestedPath:
                        route.requestedPath,

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
    if (
        !authSession
    ) {
        return;
    }

    document.dispatchEvent(
        new CustomEvent(
            "bpd:auth-changed",
            {
                detail: {
                    authenticated:
                        authSession.authenticated ===
                        true,

                    user:
                        authSession.user
                        || null
                }
            }
        )
    );
}

/* =========================================================
   HEADER
   ========================================================= */

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

    if (
        !headerElement
    ) {
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

/* =========================================================
   PAGE LOADING
   ========================================================= */

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

/* =========================================================
   SIDEBAR
   ========================================================= */

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

/* =========================================================
   ROUTE MODULE
   ========================================================= */

async function initializeLoadedRouteModule(
    moduleFile
) {
    if (
        !moduleFile
    ) {
        return;
    }

    try {
        const moduleUrl =
            new URL(
                moduleFile,
                window.location.origin
            );

        if (
            APP_ASSET_ID
        ) {
            moduleUrl.searchParams.set(
                "v",
                APP_ASSET_ID
            );
        }

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

/* =========================================================
   NAVIGATION VALIDITY
   ========================================================= */

function isCurrentNavigation(
    currentNavigationId
) {
    return (
        currentNavigationId ===
        navigationId
    );
}

/* =========================================================
   ROUTE CONTENT
   ========================================================= */

function getShellElements() {
    return {
        header:
            document.getElementById(
                "header"
            ),

        sidebar:
            document.getElementById(
                "sidebar"
            ),

        content:
            document.getElementById(
                "siteContent"
            ),

        footer:
            document.getElementById(
                "footer"
            )
    };
}

async function loadRouteFragments(
    routeConfig,
    showHeader
) {
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

    return {
        headerHTML,
        sidebarHTML,
        pageHTML,
        footerHTML
    };
}

function injectRouteFragments(
    elements,
    fragments,
    showHeader
) {
    if (
        elements.header
        && showHeader
    ) {
        elements.header.innerHTML =
            fragments.headerHTML;
    }

    elements.sidebar.innerHTML =
        fragments.sidebarHTML;

    elements.content.innerHTML =
        fragments.pageHTML;

    if (
        elements.footer
    ) {
        elements.footer.innerHTML =
            fragments.footerHTML;
    }
}

/* =========================================================
   ROUTE ERROR
   ========================================================= */

function renderRouteLoadError() {
    const contentElement =
        document.getElementById(
            "siteContent"
        );

    if (
        !contentElement
    ) {
        return;
    }

    contentElement.innerHTML = `
        <section class="route-load-error">
            <h1>
                Unable to load this page
            </h1>
            <p>
                Please refresh the page or return to the main menu.
            </p>
            <a
                href="/"
                data-router-link>
                Main Menu
            </a>
        </section>
    `;
}

/* =========================================================
   SHELL LOAD
   ========================================================= */

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

    try {
        /* -------------------------------------------------
           AUTH
           ------------------------------------------------- */

        const authCheck =
            await enforceRouteAuthentication(
                route
            );

        if (
            !isCurrentNavigation(
                currentNavigationId
            )
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
            throw new Error(
                "Route configuration was not found."
            );
        }

        /* -------------------------------------------------
           MASTER CSS
           ------------------------------------------------- */

        await applyMasterCss(
            route.routePath,
            currentNavigationId
        );

        if (
            !isCurrentNavigation(
                currentNavigationId
            )
        ) {
            return;
        }

        /* -------------------------------------------------
           SHELL CONFIG
           ------------------------------------------------- */

        const showHeader =
            findInheritedMapValue(
                HEADER_MAP,
                route.routePath,
                true
            ) !==
            false;

        const elements =
            getShellElements();

        if (
            !elements.sidebar
            || !elements.content
        ) {
            throw new Error(
                "Required shell elements were not found."
            );
        }

        setHeaderVisibility(
            showHeader
        );

        document.title =
            routeConfig.title
            || "BPD Gaming Network";

        /* -------------------------------------------------
           LOAD FRAGMENTS
           ------------------------------------------------- */

        const fragments =
            await loadRouteFragments(
                routeConfig,
                showHeader
            );

        if (
            !isCurrentNavigation(
                currentNavigationId
            )
        ) {
            return;
        }

        /* -------------------------------------------------
           INJECT FRAGMENTS
           ------------------------------------------------- */

        injectRouteFragments(
            elements,
            fragments,
            showHeader
        );

        document.body.dataset.currentRoute =
            route.routePath;

        document.body.dataset.routeFound =
            String(
                route.found
            );

        /* -------------------------------------------------
           CLASSIC ROUTE SCRIPTS
           ------------------------------------------------- */

        await activateRouteScripts(
            elements.content
        );

        if (
            !isCurrentNavigation(
                currentNavigationId
            )
        ) {
            return;
        }

        /* -------------------------------------------------
           SIDEBAR
           ------------------------------------------------- */

        await initializeLoadedSidebar(
            authCheck.authSession
        );

        if (
            !isCurrentNavigation(
                currentNavigationId
            )
        ) {
            return;
        }

        /* -------------------------------------------------
           ROUTE MODULE
           ------------------------------------------------- */

        await initializeLoadedRouteModule(
            routeConfig.module
        );

        if (
            !isCurrentNavigation(
                currentNavigationId
            )
        ) {
            return;
        }

        /* -------------------------------------------------
           OCR RESUME
           ------------------------------------------------- */

        await checkGlobalOcrSubmission();

        if (
            !isCurrentNavigation(
                currentNavigationId
            )
        ) {
            return;
        }

        /* -------------------------------------------------
           FINISH NAVIGATION
           ------------------------------------------------- */

        elements.content.focus({
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
                            authCheck.redirected,

                        masterCss:
                            getMasterCssForRoute(
                                route.routePath
                            )
                    }
                }
            )
        );
    }
    catch (
        error
    ) {
        if (
            !isCurrentNavigation(
                currentNavigationId
            )
        ) {
            return;
        }

        console.error(
            "ROUTER: Shell loading failed.",
            error
        );

        renderRouteLoadError();
    }
    finally {
        if (
            isCurrentNavigation(
                currentNavigationId
            )
        ) {
            setPageLoading(
                false
            );
        }
    }
}

/* =========================================================
   NAVIGATION
   ========================================================= */

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

    const currentDestination =
        (
            window.location.pathname
            + window.location.search
            + window.location.hash
        );

    if (
        normalizedDestination !==
        currentDestination
    ) {
        if (
            options.replace ===
            true
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
        void loadShell();
    }
);

/* =========================================================
   PUBLIC ROUTER API
   ========================================================= */

window.BPDRouter =
    Object.freeze({
        testRoute,
        testRouteNavigation,
        navigate,

        reload:
            loadShell
    });

/* =========================================================
   STARTUP
   ========================================================= */

applyInitialSidebarLayoutState();

initializeGlobalOcr();

if (
    !window.location.pathname.startsWith(
        "/api/"
    )
) {
    void loadShell();
}