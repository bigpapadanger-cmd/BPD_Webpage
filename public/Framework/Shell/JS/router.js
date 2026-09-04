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
    BPD_AUTH_SESSION_URL,
    OCR_JOB_SUBMIT_URL,
    OCR_JOB_RESULT_URL,
    OCR_CONFIRM_URL
} from "../../../scripts/apiRoutes.js";

import {
    apiFetch
} from "../../../scripts/apiConnection.js";

const DEFAULT_ROUTE =
    "/";

const ERROR_ROUTE =
    "/Error";

const AUTH_FALLBACK_ROUTE =
    "/RocketLeague";

let navigationId =
    0;

/* =========================================================
   SHARED OCR API BRIDGE

   Route-owned OCR scripts are currently classic scripts.

   They cannot directly import ES modules, so the router exposes
   only the API dependencies they need through this object.

   Browser URL:
       /scripts/...

   Filesystem:
       /public/scripts/...
   ========================================================= */

window.BPDOcrApi =
    Object.freeze({
        OCR_JOB_SUBMIT_URL,
        OCR_JOB_RESULT_URL,
        OCR_CONFIRM_URL,
        apiFetch
    });

/* =========================================================
   INITIAL SIDEBAR LAYOUT
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
                    path ||
                    "/"
                ),
                window.location.origin
            ).pathname;
    }
    catch (
        error
    ) {
        pathname =
            String(
                path ||
                "/"
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
            "/" +
            pathname;
    }

    if (
        pathname.length > 1 &&
        pathname.endsWith(
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

    return pathname;
}

function normalizeDestination(
    destination
) {
    const url =
        new URL(
            String(
                destination ||
                "/"
            ),
            window.location.origin
        );

    const pathname =
        normalizePath(
            url.pathname
        );

    return (
        pathname +
        url.search +
        url.hash
    );
}

/* =========================================================
   ROUTE RESOLUTION
   ========================================================= */

function resolveRoute(
    path
) {
    const normalizedPath =
        normalizePath(
            path
        );

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
        normalizePath(
            path
        );

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
                        normalizedRoute !==
                            "/" &&
                        normalizedPath.startsWith(
                            normalizedRoute +
                            "/"
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
        control.dataset.route ||
        control.getAttribute(
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
        event.defaultPrevented ||
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey ||
        control.hasAttribute(
            "download"
        ) ||
        control.target ===
            "_blank" ||
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
                ?.title ||
            null,

        body:
            route.config
                ?.body ||
            null,

        header:
            route.config
                ?.header ||
            null,

        sidebar:
            route.config
                ?.sidebar ||
            null,

        footer:
            route.config
                ?.footer ||
            null,

        module:
            route.config
                ?.module ||
            null
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
   STATIC HTML LOADING

   Static page fragments intentionally use native fetch().
   API calls use apiFetch().
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
            label +
            " failed to load: " +
            response.status +
            " (" +
            file +
            ")"
        );
    }

    return response.text();
}

/* =========================================================
   ROUTE-DECLARED CLASSIC SCRIPTS

   Route HTML may contain:

   <script
       data-route-script
       src="/ocr/JS/example.js">
   </script>

   Scripts inserted through innerHTML do not execute
   automatically, so the router recreates them here.

   Scripts are loaded sequentially in their HTML order.
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
                    placeholder.src ||
                    ""
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

            script.dataset
                .loadedRouteScript =
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
                            "Failed to load route script: " +
                            src
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
        window.BPDAuth &&
        typeof window.BPDAuth
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
            result
                ?.authenticated ===
            true,

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
            ?.authenticated ===
        true
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
            AUTH_FALLBACK_ROUTE +
            "?returnTo=" +
            encodeURIComponent(
                requestedPath
            )
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
                        authSession
                            ?.authenticated ===
                        true,

                    user:
                        authSession
                            ?.user ||
                        null
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
   PAGE LOADING STATE
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
   SIDEBAR INITIALIZATION
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
   ROUTE MODULE INITIALIZATION

   The routeLoad query parameter forces a fresh route-module
   execution for each SPA navigation while still allowing
   initialization.js to own the actual module initialization.
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

   Stops an older asynchronous navigation from continuing
   after a newer navigation has already begun.
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

        const showHeader =
            findInheritedMapValue(
                HEADER_MAP,
                route.routePath,
                true
            ) !==
            false;

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
            throw new Error(
                "Required shell elements were not found."
            );
        }

        setHeaderVisibility(
            showHeader
        );

        document.title =
            routeConfig.title ||
            "BPD Gaming Network";

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
            !isCurrentNavigation(
                currentNavigationId
            )
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

        /*
         * Route HTML has now been inserted.
         *
         * Any classic scripts declared using data-route-script
         * must execute BEFORE the route ES module initializes.
         */
        await activateRouteScripts(
            contentElement
        );

        if (
            !isCurrentNavigation(
                currentNavigationId
            )
        ) {
            return;
        }

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

        /*
         * Resume/check an active OCR submission if one exists.
         *
         * If there is no OCR job in localStorage,
         * this is effectively a no-op.
         */
        await checkGlobalOcrSubmission();

        if (
            !isCurrentNavigation(
                currentNavigationId
            )
        ) {
            return;
        }

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

        const contentElement =
            document.getElementById(
                "siteContent"
            );

        if (
            contentElement
        ) {
            contentElement.innerHTML = `
                <section class="route-load-error">
                    <h1>
                        Unable to load this page
                    </h1>

                    <p>
                        Please refresh the page or return
                        to the main menu.
                    </p>

                    <a
                        href="/"
                        data-router-link>
                        Main Menu
                    </a>
                </section>
            `;
        }
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
   NAVIGATE
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
   GLOBAL OCR NOTIFICATIONS

   Initializes once when router.js loads.

   ocr_notifications.js owns its polling behavior and should
   only poll while an OCR job actually exists.
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
    void loadShell();
}