import { ROUTES, HEADER_MAP, SIDEBAR_MAP } from "./routes.js";

async function loadShell() {
    const path = window.location.pathname;

    // -----------------------------
    // Load correct sidebar
    // -----------------------------
    const sidebarFile = SIDEBAR_MAP[path] || SIDEBAR_MAP["/"];
    const sidebar = await fetch(sidebarFile).then(r => r.text());
    document.getElementById("sidebar").innerHTML = sidebar;

    // -----------------------------
    // Load header (conditional)
    // -----------------------------
    const showHeader = HEADER_MAP[path] ?? true;   // default: show header

    if (showHeader) {
        const header = await fetch("/shell/header.html").then(r => r.text());
        document.getElementById("header").innerHTML = header;
    } else {
        document.getElementById("header").innerHTML = ""; // hide header
    }

    // -----------------------------
    // Load footer (always)
    // -----------------------------
    const footer = await fetch("/shell/footer.html").then(r => r.text());
    document.getElementById("footer").innerHTML = footer;

    // -----------------------------
    // Load hover tooltip HTML
    // -----------------------------
    await loadSidebarHover();

    // -----------------------------
    // Load page content
    // -----------------------------
    loadPage();
}

async function loadPage() {
    const path = window.location.pathname;
    const pageFile = ROUTES[path] || ROUTES["/"];
    const page = await fetch(pageFile).then(r => r.text());
    document.getElementById("siteContent").innerHTML = page;
}

loadShell();
