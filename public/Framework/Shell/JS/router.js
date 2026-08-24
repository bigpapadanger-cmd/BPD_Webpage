import { ROUTES, HEADER_MAP, SIDEBAR_MAP } from "./routes.js";
import { loadSidebarHover, initializeSidebar } from "./sidebar.js";


/* -------------------------------------------
   INTERCEPT ALL INTERNAL <a> CLICKS
-------------------------------------------- */
document.addEventListener("click", (e) => {
    const link = e.target.closest("a");
    if (!link) return;

    const url = new URL(link.href);

    // Only intercept internal links
    if (url.origin !== window.location.origin) return;

    e.preventDefault();
    navigate(url.pathname);
});

/* -------------------------------------------
   HISTORY API NAVIGATION
-------------------------------------------- */
async function navigate(path) {

    // If path is empty or just "/", treat as homepage
    if (!path || path.trim() === "") {
        path = "/";
    }

    window.history.pushState({}, "", path);
    await loadShell();
}

window.addEventListener("popstate", () => {
    loadShell();
});

/* -------------------------------------------
   LOAD SHELL
-------------------------------------------- */
/* -------------------------------------------
   LOAD SHELL
-------------------------------------------- */
async function loadShell() {
    let path = window.location.pathname;

    if (!path || path === "") {
        path = "/";
    }

    console.log("loadShell() started. Path:", path);

    /* -----------------------------
       Load correct sidebar
    ----------------------------- */
    const sidebarFile = SIDEBAR_MAP[path] || SIDEBAR_MAP["/"];
    console.log("Sidebar file:", sidebarFile);

    const sidebar = await fetch(sidebarFile).then(r => r.text());
    document.getElementById("sidebar").innerHTML = sidebar;

    /* -----------------------------
       Load header (conditional)
    ----------------------------- */
    const showHeader = HEADER_MAP[path] ?? true;

    if (showHeader) {
        const header = await fetch("/shell/header.html").then(r => r.text());
        document.getElementById("header").innerHTML = header;
    } else {
        document.getElementById("header").innerHTML = "";
    }

    /* -----------------------------
       Load footer (always)
    ----------------------------- */
    const footer = await fetch("/shell/footer.html").then(r => r.text());
    document.getElementById("footer").innerHTML = footer;

    /* -----------------------------
       Load hover tooltip HTML
    ----------------------------- */
    await loadSidebarHover();

    /* -----------------------------
       Initialize sidebar (IMPORTANT)
    ----------------------------- */
    await initializeSidebar();   // ← THIS WAS MISSING

    /* -----------------------------
       Load page content
    ----------------------------- */
    await loadPage();
}


/* -------------------------------------------
   LOAD PAGE CONTENT
-------------------------------------------- */
async function loadPage() {
    const path = window.location.pathname || "/";
    const pageFile = ROUTES[path] || ROUTES["/"];

    console.log("Loading page:", pageFile);

    const page = await fetch(pageFile).then(r => r.text());
    document.getElementById("siteContent").innerHTML = page;
}

/* -------------------------------------------
   INITIAL LOAD
-------------------------------------------- */
loadShell();
