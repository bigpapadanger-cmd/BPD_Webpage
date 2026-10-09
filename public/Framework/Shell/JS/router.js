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
    - Initialize hidden Admin navigation shortcuts.
    - Initialize submenu behavior.

    BACKGROUND
    - After route readiness and window load: notifications, Admin access.
    - After optional services: configured, near-viewport advertisement slots.
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
    getMasterCssForRoute,
    resolveHumanPageRoute,
    getRocketLeagueSettingsContext,
    getPageMetadata,
    getRouteStyles
} from "/routes.js";

let ocrRuntimePromise;
const loadOcrRuntime = () => ocrRuntimePromise ||= import("./ocr_runtime.js").catch(error => { ocrRuntimePromise = null; throw error; });

let sidebarModulePromise;
const loadSidebarModule = () => sidebarModulePromise ||= import("./Sidebar/sidebar.js");

import {
    initializeRouteModule
} from "./initialization.js";


import {
    APP_ASSET_ID
} from "/scripts/cacheHandler.js";

import {
    initializeAccountBanner
} from "../../Banner/JS/account_banner.js";


import {
    authorizeRoute
} from "../../Auth/auth.js";

import {
    applyAppearancePreferences
} from "./preferences.js";

import {
    readSidebarPreference
} from "./preferences.js";

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
    applyAppearancePreferences();
    const savedSidebar = readSidebarPreference();

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

async function initializeGlobalOcr() {
    try {
        const { initializeOcrRuntime } = await loadOcrRuntime();
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

async function resumeGlobalOcr() {
    if (!ocrRuntimePromise && !needsOcrRuntime()) return;
    try {
        const { resumeOcrRuntime } = await loadOcrRuntime();
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

    const humanRoute =
        resolveHumanPageRoute(requestedPath);

    if (humanRoute) {
        return {
            requestedPath,

            routePath:
                humanRoute.canonicalPath,

            config: humanRoute.canonicalPath === "/Settings" && getRocketLeagueSettingsContext(window.location.search)
                ? { ...humanRoute.config, sidebar: getRocketLeagueSettingsContext(window.location.search).sidebar }
                : humanRoute.config,

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
            const deadline = window.setTimeout(() => { link.remove(); reject(new Error("Stylesheet request timed out.")); }, 12000);

            link.addEventListener(
                "load",
                function() {
                    window.clearTimeout(deadline);
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
                    window.clearTimeout(deadline);
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
            routePath === "/Settings" && getRocketLeagueSettingsContext(window.location.search)
                ? "/RocketLeague" : routePath
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
            recovery: routeConfig.auth.recovery === true,
            rocketLeague: routeConfig.auth.rocketLeague === true,
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

    let assetUrl;
    try {
        assetUrl = new URL(file, window.location.origin);
        if (assetUrl.origin !== window.location.origin || !assetUrl.pathname.toLowerCase().endsWith(".html")) throw new Error();
    } catch {
        throw new Error(label + " URL is not an approved local HTML asset.");
    }

    const response =
        await fetch(
            assetUrl.href,
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

    if (response.redirected) {
        throw new Error(label + " asset redirected unexpectedly.");
    }

    const markup = await response.text();
    const { trustedHTMLFromStaticAsset } = await import("/scripts/trustedDom.js");
    return trustedHTMLFromStaticAsset(markup, assetUrl.href);
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

            import("/scripts/trustedDom.js")
                .then(({ trustedScriptURLFromLocalAsset }) => {
                    script.src = trustedScriptURLFromLocalAsset(src);
                    script.async = false;
                    script.dataset.loadedRouteScript = src;
                    script.addEventListener("load", function() {
                        placeholder.remove();
                        resolve();
                    }, { once: true });
                    script.addEventListener("error", function() {
                        script.remove();
                        placeholder.remove();
                        reject(new Error("Failed to load route script."));
                    }, { once: true });
                    document.head.appendChild(script);
                })
                .catch(error => {
                    placeholder.remove();
                    reject(error);
                });
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

    if (evaluation.status === "signed_out") {
        document.dispatchEvent(new CustomEvent("bpd:before-auth-redirect"));
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

    if (["provider_reauthorization_required", "profile_provider_required", "rl_registration_required", "provider_required"].includes(evaluation.status)) {
        document.dispatchEvent(new CustomEvent("bpd:before-auth-redirect"));
        const destination = evaluation.status === "rl_registration_required"
            ? "/RocketLeague/Profile"
            : evaluation.status === "provider_reauthorization_required"
                ? "/Account?reauthorize=" + encodeURIComponent(evaluation.requiredProvider)
                : "/Account";
        window.history.replaceState({}, "", destination);
        return { route: resolveRoute(destination), authState: state, authEvaluation: evaluation,
            redirected: true, authUnavailable: false };
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
        headerElement.replaceChildren();
    }
}

/* =========================================================
PAGE LOADING
========================================================= */

function setPageLoading(
    loading
) {
    document.getElementById("siteContent")?.setAttribute("aria-busy", String(loading));
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
        const { loadSidebarHover, initializeSidebar } = await loadSidebarModule();
        initializeSidebar();
        await loadSidebarHover();

        if (
            !isCurrentNavigation(
                currentNavigationId
            )
        ) {
            return;
        }


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
        if (fragments.headerHTML) elements.header.innerHTML = fragments.headerHTML;
        else elements.header.replaceChildren();
        // Whitespace-only navigation must not allocate a padded empty row.
        for (const navigation of elements.header.querySelectorAll(".header-navigation")) {
            if (navigation.childElementCount === 0) navigation.remove();
        }
    }

    if (
        elements.sidebar
    ) {
        if (fragments.sidebarHTML) elements.sidebar.innerHTML = fragments.sidebarHTML;
        else elements.sidebar.replaceChildren();
    }

    if (
        elements.content
    ) {
        if (fragments.pageHTML) elements.content.innerHTML = fragments.pageHTML;
        else elements.content.replaceChildren();
        // The persistent shell owns the single main landmark. Route fragments
        // retain their labels, classes and IDs as sections inside that landmark.
        for (const nestedMain of elements.content.querySelectorAll("main")) {
            const section = document.createElement("section");
            for (const attribute of nestedMain.attributes) section.setAttribute(attribute.name, attribute.value);
            section.append(...nestedMain.childNodes);
            nestedMain.replaceWith(section);
        }
    }

    if (
        elements.footer
    ) {
        if (fragments.footerHTML) elements.footer.innerHTML = fragments.footerHTML;
        else elements.footer.replaceChildren();
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

    const section = document.createElement("section");
    section.className = "route-load-error";
    const heading = document.createElement("h1");
    heading.textContent = "Unable to load this page";
    const message = document.createElement("p");
    message.textContent = "Please refresh the page or return to the main menu.";
    const link = document.createElement("a");
    link.href = "/";
    link.dataset.routerLink = "";
    link.textContent = "Main Menu";
    section.append(heading, message, link);
    contentElement.replaceChildren(section);
}

/* =========================================================
POST-NAVIGATION BACKGROUND WORK
========================================================= */

function schedulePostNavigationWork(
    currentNavigationId
) {
    void startDeferredPageServices(currentNavigationId).catch(() => {});
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

let pageServicesReady = null;
async function startDeferredPageServices(id) {
    if (document.readyState !== "complete") await new Promise(resolve => window.addEventListener("load", resolve, { once: true }));
    await new Promise(resolve => scheduleAfterPaint(() => scheduleIdleTask(resolve)));
    if (!isCurrentNavigation(id)) return;
    pageServicesReady ||= (async () => {
        const auth = await import("../../Auth/auth.js");
        auth.subscribeToAuthState(state => {
            if (state.authenticated && state.active && !state.admin?.checked) {
                scheduleIdleTask(() => { if (!document.body.classList.contains("page-loading")) void auth.loadDeferredAdminAccess(); });
            }
        });
        const notifications = await import("./notifications.js");
        await notifications.initializeGlobalNotifications();
        const monitor = await import("../../../scripts/apiConnection.js");
        void monitor.initializeApiConnectionMonitor();
    })().catch(() => { pageServicesReady = null; });
    await pageServicesReady;
    if (!isCurrentNavigation(id)) return;
    const auth = await import("../../Auth/auth.js");
    await auth.loadDeferredAdminAccess();
    if (!isCurrentNavigation(id)) return;
    const ads = await import("../../../Global/Ads/JS/ads.js");
    ads.initializePageAds();
}

/* =========================================================
SHELL LOAD
========================================================= */

async function loadShell() {
    const currentNavigationId =
        ++navigationId;

    applyAppearancePreferences();

    setPageLoading(
        true
    );

    renderRouteLoadingShell();

    let route =
        resolveRoute(
            window.location.pathname
        );

    if (route.config?.redirectTo) {
        const redirectUrl = new URL(window.location.href);
        redirectUrl.pathname = route.config.redirectTo;
        window.history.replaceState({}, "", redirectUrl.href);
        route = resolveRoute(redirectUrl.pathname);
    }

    if (
        route.found
        && window.location.pathname !== route.routePath
    ) {
        const canonicalUrl =
            new URL(window.location.href);

        canonicalUrl.pathname =
            route.routePath;

        window.history.replaceState(
            {},
            "",
            canonicalUrl.href
        );
    }

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

        const metadata = getPageMetadata(route.routePath, window.location.search);
        if (window.location.hostname.endsWith(".pages.dev")) metadata.robots = "noindex, nofollow";
        // Keep old route styles until new ones finish loading; no unstyled shell.
        const oldStyles = [...document.head.querySelectorAll("link[data-route-style]")];
        const styleResults = await Promise.allSettled(getRouteStyles(route.routePath).map(async path => {
            const link = await createPendingStylesheet(createAssetUrl(path));
            link.dataset.routeStyle = "true"; return link;
        }));
        const newStyles = styleResults.filter(result => result.status === "fulfilled").map(result => result.value);
        if (styleResults.some(result => result.status === "rejected")) {
            newStyles.forEach(link => link.remove()); throw new Error("Page styling is temporarily unavailable.");
        }
        if (!isCurrentNavigation(currentNavigationId)) { newStyles.forEach(link => link.remove()); return; }
        oldStyles.forEach(link => link.remove());
        document.title = metadata.title;
        for (const [name, content] of Object.entries({ description: metadata.description, robots: metadata.robots,
            "og:title": metadata.title, "og:description": metadata.description, "og:url": metadata.canonical,
            "og:type": "website", "twitter:card": "summary", "twitter:title": metadata.title, "twitter:description": metadata.description })) {
            const property = name.startsWith("og:") ? "property" : "name";
            let tag = document.head.querySelector(`meta[${property}="${name}"]`);
            if (!tag) { tag = document.createElement("meta"); tag.setAttribute(property, name); document.head.append(tag); }
            tag.content = content;
        }
        let canonical = document.head.querySelector('link[rel="canonical"]');
        if (!canonical) { canonical = document.createElement("link"); canonical.rel = "canonical"; document.head.append(canonical); }
        canonical.href = metadata.canonical;

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

        if (!authCheck.redirected && authCheck.authEvaluation?.allowed === false) {
            document.dispatchEvent(new CustomEvent("bpd:before-auth-redirect"));
            elements.content.replaceChildren();
            const message = document.createElement("p");
            message.setAttribute("role", "status");
            message.textContent = authCheck.authUnavailable
                ? "Authorization is temporarily unavailable. Please retry. Your login has not been cleared."
                : "This account cannot access this page.";
            const accountLink = document.createElement("a");
            accountLink.href = "/Account";
            accountLink.textContent = "BPD Account";
            elements.content.append(message, accountLink);
            return;
        }

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

function renderRouteLoadingShell() {
    const content = document.getElementById("siteContent");
    if (!content) return;
    const shell = document.createElement("section");
    shell.className = "route-loading-shell";
    shell.setAttribute("aria-busy", "true");
    shell.setAttribute("aria-label", "Loading page");
    const status = document.createElement("p");
    status.setAttribute("role", "status");
    status.textContent = "Loading page…";
    const placeholder = document.createElement("div");
    placeholder.className = "route-loading-placeholder";
    placeholder.setAttribute("aria-hidden", "true");
    shell.append(status, placeholder);
    content.replaceChildren(shell);
}

/* =========================================================
NAVIGATION
========================================================= */

async function navigate(
    destination,
    options = {}
) {
    const destinationUrl = new URL(
        normalizeDestination(destination),
        window.location.origin
    );

    const humanRoute =
        resolveHumanPageRoute(destinationUrl.pathname);

    if (humanRoute) {
        destinationUrl.pathname = humanRoute.canonicalPath;
    }

    const normalizedDestination =
        destinationUrl.pathname
        + destinationUrl.search
        + destinationUrl.hash;

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
function needsOcrRuntime() {
    if (/submit|matchresults|privatematches|weeklymatches/i.test(window.location.pathname)) return true;
    try { return ["rocketLeagueOcrActiveJobV1", "rocketLeagueOcrPendingReviewsV1", "rocketLeagueOcrPendingFailuresV1"].some(key => {
        const value = localStorage.getItem(key); return value && value !== "[]" && value !== "{}";
    }); } catch { return true; }
}
scheduleIdleTask(() => { if (needsOcrRuntime()) void initializeGlobalOcr(); }, 1000);
window.addEventListener("storage", () => { if (needsOcrRuntime()) void resumeGlobalOcr(); });

/* =========================================================
STARTUP — BACKGROUND SERVICES
========================================================= */

/*
 * API connection monitoring is useful globally but does not
 * need to block the first route.
 */

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
