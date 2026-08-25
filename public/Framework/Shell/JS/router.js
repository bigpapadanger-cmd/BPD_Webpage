import { ROUTES, HEADER_MAP } from "./routes.js";
import { loadSidebarHover, initializeSidebar } from "./sidebar.js";
const DEFAULT_HEADER_FILE = "/Framework/Shell/HTML/Header/header.html";
const DEFAULT_FOOTER_FILE = "/Framework/Shell/HTML/Footer/footer.html";
const DEFAULT_ROUTE = "/";
const ERROR_ROUTE = "/Error";
let navigationId = 0;


function normalizePath(path) {
    let normalizedPath = String(path || "/").trim();
    if (!normalizedPath.startsWith("/")) {
        normalizedPath = `/${normalizedPath}`;
    }
    if (normalizedPath.length > 1 && normalizedPath.endsWith("/")) {
        normalizedPath = normalizedPath.slice(0, -1);
    }
    if (normalizedPath === "/index.html") {
        return "/";
    }
    return normalizedPath;
}
function resolveRoute(path) {
    const normalizedPath = normalizePath(path);
    if (Object.prototype.hasOwnProperty.call(ROUTES, normalizedPath)) {
        return {
            requestedPath: normalizedPath,
            routePath: normalizedPath,
            config: ROUTES[normalizedPath],
            found: true
        };
    }
    if (Object.prototype.hasOwnProperty.call(ROUTES, ERROR_ROUTE)) {
        return {
            requestedPath: normalizedPath,
            routePath: ERROR_ROUTE,
            config: ROUTES[ERROR_ROUTE],
            found: false
        };
    }
    return {
        requestedPath: normalizedPath,
        routePath: DEFAULT_ROUTE,
        config: ROUTES[DEFAULT_ROUTE],
        found: false
    };
}
function findInheritedMapValue(map, path, fallbackValue) {
    const normalizedPath = normalizePath(path);
    if (Object.prototype.hasOwnProperty.call(map, normalizedPath)) {
        return map[normalizedPath];
    }
    const matchingRoutes = Object.keys(map)
        .filter(function(route) {
            const normalizedRoute = normalizePath(route);
            return normalizedRoute !== "/" && normalizedPath.startsWith(`${normalizedRoute}/`);
        })
        .sort(function(firstRoute, secondRoute) {
            return secondRoute.length - firstRoute.length;
        });
    if (matchingRoutes.length > 0) {
        return map[matchingRoutes[0]];
    }
    if (Object.prototype.hasOwnProperty.call(map, DEFAULT_ROUTE)) {
        return map[DEFAULT_ROUTE];
    }
    return fallbackValue;
}
async function fetchHTML(file, label) {
    if (!file) {
        return "";
    }
    const response = await fetch(file, {
        method: "GET",
        cache: "no-store",
        headers: {
            "accept": "text/html"
        }
    });
    if (!response.ok) {
        throw new Error(
            `${label} failed to load: ${response.status} (${file})`
        );
    }
    return response.text();
}
function setHeaderVisibility(showHeader) {
    const headerElement = document.getElementById("header");
    document.body.dataset.header = showHeader ? "visible" : "hidden";
    document.body.classList.toggle("header-hidden", !showHeader);
    if (!headerElement) {
        return;
    }
    headerElement.hidden = !showHeader;
    if (!showHeader) {
        headerElement.innerHTML = "";
    }
}
function setPageLoading(loading) {
    document.body.dataset.pageLoading = String(loading);
    document.body.classList.toggle("page-loading", loading);
}
async function loadShell() {
    const currentNavigationId = ++navigationId;
    const route = resolveRoute(window.location.pathname);
    const routeConfig = route.config;
    const showHeader = findInheritedMapValue(
        HEADER_MAP,
        route.routePath,
        true
    ) !== false;
    const headerFile =
        routeConfig.header;
    const sidebarFile =
        routeConfig.sidebar;
    const pageFile =
        routeConfig.body;
    const footerFile =
        routeConfig.footer;
    await loadRouteStyles(
        routeConfig.stylesheets || []
    );
    const headerElement = document.getElementById("header");
    const sidebarElement = document.getElementById("sidebar");
    const contentElement = document.getElementById("siteContent");
    const footerElement = document.getElementById("footer");
    if (!sidebarElement || !contentElement) {
        console.error("ROUTER: Required shell elements were not found.");
        return;
    }
    setPageLoading(true);
    setHeaderVisibility(showHeader);
    try {
        const [
            headerHTML,
            sidebarHTML,
            pageHTML,
            footerHTML
        ] = await Promise.all([
            showHeader
                ? fetchHTML(headerFile, "Header")
                : Promise.resolve(""),
            fetchHTML(sidebarFile, "Sidebar"),
            fetchHTML(pageFile, "Page"),
            fetchHTML(footerFile, "Footer")
        ]);
        if (currentNavigationId !== navigationId) {
            return;
        }
        if (headerElement && showHeader) {
            headerElement.innerHTML = headerHTML;
        }
        sidebarElement.innerHTML = sidebarHTML;
        contentElement.innerHTML = pageHTML;
        if (footerElement) {
            footerElement.innerHTML = footerHTML;
        }
        document.body.dataset.currentRoute = route.routePath;
        document.body.dataset.routeFound = String(route.found);
        await loadSidebarHover();
        initializeSidebar();
        contentElement.focus({
            preventScroll: true
        });
        window.scrollTo({
            top: 0,
            left: 0,
            behavior: "instant"
        });
        document.dispatchEvent(
            new CustomEvent("bpd:page-loaded", {
                detail: {
                    requestedPath: route.requestedPath,
                    routePath: route.routePath,
                    found: route.found
                }
            })
        );
    } catch (error) {
        console.error("ROUTER: Shell loading failed.", error);
        contentElement.innerHTML = `
            <section class="route-load-error">
                <h1>Unable to load this page</h1>
                <p>Please refresh the page or return to the main menu.</p>
                <a href="/" data-router-link>Main Menu</a>
            </section>
        `;
    } finally {
        if (currentNavigationId === navigationId) {
            setPageLoading(false);
        }
    }
}
async function navigate(path, options = {}) {
    const normalizedPath = normalizePath(path);
    const replace = options.replace === true;
    const currentPath = normalizePath(window.location.pathname);
    if (normalizedPath !== currentPath) {
        if (replace) {
            window.history.replaceState({}, "", normalizedPath);
        } else {
            window.history.pushState({}, "", normalizedPath);
        }
    }
    await loadShell();
}
document.addEventListener("click", function(event) {
    const link = event.target.closest("a[data-router-link]");
    if (!link) {
        return;
    }
    if (link.hasAttribute("download") || link.target === "_blank") {
        return;
    }
    const url = new URL(link.href, window.location.origin);
    if (url.origin !== window.location.origin) {
        return;
    }
    event.preventDefault();
    navigate(`${url.pathname}${url.search}${url.hash}`);
});
window.addEventListener("popstate", function() {
    loadShell();
});
async function loadRouteStyles(stylesheets = []) {
    document.querySelectorAll(
        'link[data-route-stylesheet="true"]'
    ).forEach(function(link) {
        link.remove();
    });
    const files = Array.isArray(stylesheets)
        ? stylesheets
        : [stylesheets];
    await Promise.all(
        files.filter(Boolean).map(function(file) {
            return new Promise(function(resolve, reject) {
                const link = document.createElement("link");
                link.rel = "stylesheet";
                link.href = file;
                link.dataset.routeStylesheet = "true";
                link.addEventListener("load", resolve, {
                    once: true
                });
                link.addEventListener("error", function() {
                    reject(
                        new Error(
                            `Stylesheet failed to load: ${file}`
                        )
                    );
                }, {
                    once: true
                });
                document.head.appendChild(link);
            });
        })
    );
}
loadShell();