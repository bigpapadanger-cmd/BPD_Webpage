"use strict";

/* =========================================================
BPD GAMING NETWORK
SPA ROUTER

File:
    /Framework/Shell/JS/router.js

Purpose:
    Controls global SPA navigation, shell fragment loading,
    route authorization, route CSS, route modules, sidebar
    initialization, OCR runtime state, and persistent shell
    components.

Initialization Priority:

    CRITICAL
    - Resolve route.
    - Enforce route authorization.
    - Apply master CSS.
    - Load and inject shell/page fragments.
    - Activate required classic route scripts.
    - Initialize the route module.
    - Complete navigation.

    INTERACTIVE / POST-PAINT
    - Load sidebar hover UI.
    - Initialize sidebar behavior.
    - Check Admin navigation eligibility.
    - Initialize submenu behavior.

    BACKGROUND
    - API connection monitor.
    - Persistent account banner.
    - OCR runtime maintenance.

Description:
    - Resolves routes from /routes.js.
    - Loads header, sidebar, page, and footer fragments.
    - Applies route-specific master stylesheets.
    - Uses Framework/Auth/auth.js as the single client-side
      authentication state source.
    - Supports route-specific auth requirements.
    - Distinguishes confirmed signed-out state from auth/API
      unavailability.
    - Redirects confirmed signed-out protected routes to
      /Login?returnTo=...
    - Does not redirect protected routes merely because
      authentication status is unavailable.
    - Initializes persistent shell services outside the
      route-rendering lifecycle.
    - Protects asynchronous navigation from race conditions.
    - Does not block page readiness on sidebar enhancements.

Security:
    - Client route authorization is navigation/UX only.
    - Protected APIs must independently enforce server-side
      authorization.
    - Provider checks in this router are not authoritative.
========================================================= */

import {
    ROUTES,
    HEADER_MAP,
    getMasterCssForRoute
} from "/routes.js";

import {
    initializeOcrRuntime,
    resumeOcrRuntime
} from "./ocr_runtime.js";

import {
    loadSidebarHover,
    initializeSidebar
} from "../JS/Sidebar/sidebar.js";

import {
    initializeRouteModule
} from "./initialization.js";

import {
    initializeApiConnectionMonitor
} from "../../../scripts/apiConnection.js";

import {
    APP_ASSET_ID
} from "/scripts/cacheHandler.js";

import {
    initializeAccountBanner
} from "../../Banner/JS/account_banner.js";

import {
    authorizeRoute
} from "../../Auth/auth.js";

/* =========================================================
ROUTER CONFIGURATION
========================================================= */

const DEFAULT_ROUTE =
    "/";

const ERROR_ROUTE =
    "/Error";

const LOGIN_ROUTE =
    "/Login";

const MASTER_CSS_LINK_ID =
    "bpdMasterCss";

/* =========================================================
NAVIGATION STATE
========================================================= */

let navigationId =
    0;

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
POST-PAINT SCHEDULING
========================================================= */

function scheduleAfterPaint(
    callback
) {
    if (
        typeof window.requestAnimationFrame ===
        "function"
    ) {
        window.requestAnimationFrame(
            () => {
                callback();
            }
        );

        return;
    }

    window.setTimeout(
        callback,
        0
    );
}

/* =========================================================
IDLE SCHEDULING
========================================================= */

function scheduleIdleTask(
    callback,
    timeout = 1000
) {
    if (
        typeof window.requestIdleCallback ===
        "function"
    ) {
        window.requestIdleCallback(
            () => {
                callback();
            },
            {
                timeout
            }
        );

        return;
    }

    window.setTimeout(
        callback,
        100
    );
}

/* =========================================================
OCR RUNTIME
========================================================= */

function initializeGlobalOcr() {
    try {
        if (
            !initializeOcrRuntime()
        ) {
            console.error(
                "ROUTER: OCR runtime did not initialize."
            );
        }
    }
    catch (
        error
    ) {
        console.error(
            "ROUTER: OCR runtime initialization failed.",
            error
        );
    }
}

function resumeGlobalOcr() {
    try {
        resumeOcrRuntime();
    }
    catch (
        error
    ) {
        console.error(
            "ROUTER: OCR runtime resume failed.",
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
        matchingRoutes.length > 0
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
ROUTE AUTH REQUIREMENTS
========================================================= */

function getRouteAuthRequirements(
    routeConfig
) {
    if (
        routeConfig?.auth
        && typeof routeConfig.auth ===
            "object"
        && !Array.isArray(
            routeConfig.auth
        )
    ) {
        return {
            required:
                routeConfig.auth.required ===
                    true,

            provider:
                typeof routeConfig.auth.provider ===
                    "string"
                    ? routeConfig.auth.provider
                        .trim()
                        .toLowerCase()
                    : null,

            role:
                typeof routeConfig.auth.role ===
                    "string"
                    ? routeConfig.auth.role
                        .trim()
                        .toLowerCase()
                    : null
        };
    }

    /*
     * Compatibility with routes that still use:
     *
     *     requiresAuth: true
     */
    if (
        routeConfig?.requiresAuth ===
            true
    ) {
        return {
            required:
                true,

            provider:
                null,

            role:
                null
        };
    }

    return {
        required:
            false,

        provider:
            null,

        role:
            null
    };
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

        auth:
            getRouteAuthRequirements(
                route.config
            ),

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
LOGIN DESTINATION
========================================================= */

function createLoginDestination(
    requestedPath
) {
    return (
        LOGIN_ROUTE
        + "?returnTo="
        + encodeURIComponent(
            requestedPath
        )
    );
}

/* =========================================================
AUTHENTICATION ENFORCEMENT
========================================================= */

async function enforceRouteAuthentication(
    route
) {
    const requirements =
        getRouteAuthRequirements(
            route.config
        );

    const authRequired =
        requirements.required ===
            true
        || Boolean(
            requirements.provider
        )
        || Boolean(
            requirements.role
        );

    if (
        !authRequired
    ) {
        return {
            route,

            authState:
                null,

            authEvaluation: {
                allowed:
                    true,

                status:
                    "allowed"
            },

            redirected:
                false,

            authUnavailable:
                false
        };
    }

    const {
        state,
        evaluation
    } =
        await authorizeRoute(
            requirements
        );

    /* -----------------------------------------------------
    AUTH SERVICE UNAVAILABLE
    ----------------------------------------------------- */

    if (
        evaluation.status ===
        "unavailable"
    ) {
        document.body.dataset.authAvailable =
            "false";

        document.dispatchEvent(
            new CustomEvent(
                "bpd:auth-unavailable",
                {
                    detail: {
                        requestedPath:
                            route.requestedPath
                    }
                }
            )
        );

        return {
            route,

            authState:
                state,

            authEvaluation:
                evaluation,

            redirected:
                false,

            authUnavailable:
                true
        };
    }

    document.body.dataset.authAvailable =
        "true";

    /* -----------------------------------------------------
    AUTHORIZED
    ----------------------------------------------------- */

    if (
        evaluation.allowed ===
            true
    ) {
        return {
            route,

            authState:
                state,

            authEvaluation:
                evaluation,

            redirected:
                false,

            authUnavailable:
                false
        };
    }

    /* -----------------------------------------------------
    CONFIRMED SIGNED OUT
    ----------------------------------------------------- */

    if (
        evaluation.status ===
        "signed_out"
    ) {
        const loginRoute =
            resolveRoute(
                LOGIN_ROUTE
            );

        const loginDestination =
            createLoginDestination(
                route.requestedPath
            );

        window.history.replaceState(
            {},
            "",
            loginDestination
        );

        document.dispatchEvent(
            new CustomEvent(
                "bpd:route-auth-denied",
                {
                    detail: {
                        requestedPath:
                            route.requestedPath,

                        reason:
                            "signed_out",

                        fallbackPath:
                            LOGIN_ROUTE
                    }
                }
            )
        );

        return {
            route:
                loginRoute,

            authState:
                state,

            authEvaluation:
                evaluation,

            redirected:
                true,

            authUnavailable:
                false
        };
    }

    /* -----------------------------------------------------
    ACCOUNT INVALID / INACTIVE
    ----------------------------------------------------- */

    if (
        evaluation.status ===
        "account_invalid"
    ) {
        document.dispatchEvent(
            new CustomEvent(
                "bpd:route-auth-denied",
                {
                    detail: {
                        requestedPath:
                            route.requestedPath,

                        reason:
                            "account_invalid"
                    }
                }
            )
        );

        return {
            route,

            authState:
                state,

            authEvaluation:
                evaluation,

            redirected:
                false,

            authUnavailable:
                false
        };
    }

    /* -----------------------------------------------------
    PROVIDER REQUIRED
    ----------------------------------------------------- */

    if (
        evaluation.status ===
        "provider_required"
    ) {
        document.dispatchEvent(
            new CustomEvent(
                "bpd:route-provider-required",
                {
                    detail: {
                        requestedPath:
                            route.requestedPath,

                        provider:
                            evaluation
                                .requiredProvider
                            || null
                    }
                }
            )
        );

        return {
            route,

            authState:
                state,

            authEvaluation:
                evaluation,

            redirected:
                false,

            authUnavailable:
                false
        };
    }

    /* -----------------------------------------------------
    ROLE REQUIRED
    ----------------------------------------------------- */

    if (
        evaluation.status ===
        "role_required"
    ) {
        document.dispatchEvent(
            new CustomEvent(
                "bpd:route-auth-denied",
                {
                    detail: {
                        requestedPath:
                            route.requestedPath,

                        reason:
                            "role_required",

                        role:
                            evaluation
                                .requiredRole
                            || null
                    }
                }
            )
        );

        return {
            route,

            authState:
                state,

            authEvaluation:
                evaluation,

            redirected:
                false,

            authUnavailable:
                false
        };
    }

    /* -----------------------------------------------------
    UNKNOWN AUTH RESULT
    ----------------------------------------------------- */

    console.error(
        "ROUTER: Unrecognized authorization result.",
        {
            requestedPath:
                route.requestedPath,

            status:
                evaluation.status
                || null
        }
    );

    document.body.dataset.authAvailable =
        "false";

    return {
        route,

        authState:
            state,

        authEvaluation:
            evaluation,

        redirected:
            false,

        authUnavailable:
            true
    };
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
SIDEBAR INITIALIZATION

The sidebar is deliberately outside the critical route path.

The route HTML is already present before this runs.

Hover HTML and sidebar enhancement setup happen after the
browser receives an opportunity to paint the page.
========================================================= */

async function initializeLoadedSidebar(
    currentNavigationId
) {
    if (
        !isCurrentNavigation(
            currentNavigationId
        )
    ) {
        return;
    }

    try {
        await loadSidebarHover();

        if (
            !isCurrentNavigation(
                currentNavigationId
            )
        ) {
            return;
        }

        initializeSidebar();

        document.dispatchEvent(
            new CustomEvent(
                "bpd:sidebar-ready",
                {
                    detail: {
                        navigationId:
                            currentNavigationId
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
            "ROUTER: Sidebar initialization failed.",
            error
        );
    }
}

function scheduleLoadedSidebar(
    currentNavigationId
) {
    scheduleAfterPaint(
        () => {
            if (
                !isCurrentNavigation(
                    currentNavigationId
                )
            ) {
                return;
            }

            void initializeLoadedSidebar(
                currentNavigationId
            );
        }
    );
}

/* =========================================================
ROUTE MODULE
========================================================= */

function isJavaScriptModulePath(
    moduleFile
) {
    if (
        !moduleFile
    ) {
        return false;
    }

    let pathname;

    try {
        pathname =
            new URL(
                moduleFile,
                window.location.origin
            ).pathname;
    }
    catch {
        pathname =
            String(
                moduleFile
            );
    }

    return (
        pathname.endsWith(
            ".js"
        )
        || pathname.endsWith(
            ".mjs"
        )
    );
}

async function initializeLoadedRouteModule(
    moduleFile,
    currentNavigationId
) {
    if (
        !moduleFile
    ) {
        return;
    }

    if (
        !isJavaScriptModulePath(
            moduleFile
        )
    ) {
        const error =
            new Error(
                "Route module must reference a JavaScript module: "
                + moduleFile
            );

        console.error(
            "ROUTER: Invalid route module configuration.",
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
                currentNavigationId
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
SHELL ELEMENTS
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

/* =========================================================
ROUTE FRAGMENTS
========================================================= */

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

    if (
        elements.sidebar
    ) {
        elements.sidebar.innerHTML =
            fragments.sidebarHTML;
    }

    if (
        elements.content
    ) {
        elements.content.innerHTML =
            fragments.pageHTML;
    }

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
                data-router-link
            >
                Main Menu
            </a>
        </section>
    `;
}

/* =========================================================
POST-NAVIGATION BACKGROUND WORK
========================================================= */

function schedulePostNavigationWork(
    currentNavigationId
) {
    scheduleIdleTask(
        () => {
            if (
                !isCurrentNavigation(
                    currentNavigationId
                )
            ) {
                return;
            }

            resumeGlobalOcr();
        },
        500
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
        /* -------------------------------------------------
        1. AUTHORIZATION
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

        document.body.dataset.authUnavailable =
            String(
                authCheck.authUnavailable ===
                    true
            );

        document.body.dataset.authStatus =
            authCheck.authEvaluation
                ?.status
            || "not_required";

        /* -------------------------------------------------
        2. MASTER CSS
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
        3. SHELL CONFIGURATION
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
        4. LOAD ROUTE FRAGMENTS IN PARALLEL
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
        5. INJECT ROUTE FRAGMENTS
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

        /*
         * Sidebar enhancement loading is intentionally
         * scheduled now instead of awaited.
         *
         * The sidebar HTML already exists, but hover/tooltips
         * should not delay page initialization.
         */
        scheduleLoadedSidebar(
            currentNavigationId
        );

        /* -------------------------------------------------
        6. REQUIRED CLASSIC ROUTE SCRIPTS
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
        7. ROUTE MODULE

        This is part of the critical path because the page may
        require initializePage() before it is usable.
        ------------------------------------------------- */

        await initializeLoadedRouteModule(
            routeConfig.module,
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
        8. FINISH CRITICAL NAVIGATION
        ------------------------------------------------- */

        if (
            typeof elements.content.focus ===
            "function"
        ) {
            elements.content.focus({
                preventScroll:
                    true
            });
        }

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

                        authUnavailable:
                            authCheck.authUnavailable,

                        authStatus:
                            authCheck.authEvaluation
                                ?.status
                            || null,

                        masterCss:
                            getMasterCssForRoute(
                                route.routePath
                            )
                    }
                }
            )
        );

        /* -------------------------------------------------
        9. BACKGROUND WORK
        ------------------------------------------------- */

        schedulePostNavigationWork(
            currentNavigationId
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
STARTUP — CRITICAL
========================================================= */

/*
 * Establish the sidebar width/collapse state before the
 * initial route render to reduce layout movement.
 */
applyInitialSidebarLayoutState();

/*
 * OCR runtime initialization establishes persistent runtime
 * state once. Per-navigation OCR resume is deferred.
 */
initializeGlobalOcr();

/* =========================================================
STARTUP — BACKGROUND SERVICES
========================================================= */

/*
 * API connection monitoring is useful globally but does not
 * need to block the first route.
 */
scheduleIdleTask(
    () => {
        void initializeApiConnectionMonitor();
    },
    1000
);

/*
 * Persistent account banner.
 *
 * The banner initializes outside the route-rendering
 * lifecycle. Route navigation may replace the header,
 * sidebar, content, and footer without replacing the banner.
 */
scheduleAfterPaint(
    () => {
        void initializeAccountBanner();
    }
);

/* =========================================================
INITIAL ROUTE
========================================================= */

if (
    !window.location.pathname.startsWith(
        "/api/"
    )
) {
    void loadShell();
}