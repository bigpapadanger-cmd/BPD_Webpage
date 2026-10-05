"use strict";

let root = null;
let stopCarousel = () => {};
const FALLBACK_IMAGE = "/Assets/logo/gaming_network_logo_128px_no_border.png";
const SHOP_STALE_AFTER_MS = 2 * 60 * 60 * 1000;

function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function safeImage(value) {
    try {
        const url = new URL(value);
        return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
    } catch {
        return null;
    }
}

function dateLabel(value) {
    if (typeof value !== "string" || !value) return null;
    const date = new Date(value);
    return Number.isFinite(date.getTime())
        ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date)
        : null;
}

export function isSnapshotStale(snapshot, now = Date.now()) {
    const capturedAt = Date.parse(snapshot?.capturedAt || "");
    if (!Number.isFinite(capturedAt) || capturedAt > now + 5 * 60 * 1000 || now - capturedAt > SHOP_STALE_AFTER_MS) {
        return true;
    }

    const shops = Array.isArray(snapshot?.shops) ? snapshot.shops : [];
    const catalogues = Array.isArray(snapshot?.catalogues) ? snapshot.catalogues : [];
    const shopsById = new Map(shops.map(shop => [String(shop.id), shop]));
    const displayedSections = catalogues.filter(entry => Array.isArray(entry.items) && entry.items.length);
    return displayedSections.length > 0 && displayedSections.every(entry => {
        const endsAt = Date.parse(shopsById.get(String(entry.shop_id))?.ends_at || "");
        return Number.isFinite(endsAt) && endsAt <= now;
    });
}

function timingLabel(startsAt, endsAt) {
    const start = dateLabel(startsAt);
    const end = dateLabel(endsAt);
    if (start && end) return `Available ${start} – ${end}`;
    if (start) return `Available from ${start}`;
    if (end) return `Available until ${end}`;
    return null;
}

export function shopImage(value, alt, className) {
    const image = element("img", className);
    image.src = safeImage(value) || FALLBACK_IMAGE;
    image.alt = alt;
    image.loading = "lazy";
    image.referrerPolicy = "no-referrer";
    image.addEventListener("error", () => {
        image.removeAttribute("srcset");
        image.src = FALLBACK_IMAGE;
    }, { once: true });
    return image;
}

export function itemCard(item) {
    const card = element("article", "rl-shop-item");
    card.append(shopImage(item.image_url, item.title ? `${item.title} artwork` : "BPD item artwork placeholder", "rl-shop-item__image"));
    card.append(element("h3", "rl-shop-item__title", item.title || "Shop item"));
    if (item.description) card.append(element("p", "rl-shop-item__description", item.description));

    const price = item.costs.flatMap(cost => cost.prices).find(value => Number.isSafeInteger(value.amount));
    if (price) card.append(element("p", "rl-shop-item__price", `${price.amount.toLocaleString()} · Currency ${price.currency_id}`));
    else card.append(element("p", "rl-shop-item__price", "Price unavailable"));

    const timing = timingLabel(
        item.starts_at || item.costs.find(cost => cost.starts_at)?.starts_at,
        item.ends_at || item.costs.find(cost => cost.ends_at)?.ends_at
    );
    if (timing) card.append(element("p", "rl-shop-item__timing", timing));
    return card;
}

export function shopPages(snapshot) {
    const shops = new Map(snapshot.shops.map(shop => [String(shop.id), shop]));
    return snapshot.catalogues.flatMap(catalogue => {
        const items = Array.isArray(catalogue.items) ? catalogue.items : [];
        const pages = [];
        for (let offset = 0; offset < items.length; offset += 5) {
            pages.push({ shop: shops.get(String(catalogue.shop_id)), shopId: String(catalogue.shop_id),
                items: items.slice(offset, offset + 5), first: offset + 1, total: items.length });
        }
        return pages;
    });
}

function initializeCarousel(snapshot) {
    stopCarousel();
    const catalogues = snapshot.catalogues.filter(entry => Array.isArray(entry.items) && entry.items.length);
    const shopsById = new Map(snapshot.shops.map(shop => [String(shop.id), shop]));
    const sections = catalogues.map(catalogue => ({ catalogue, shop: shopsById.get(String(catalogue.shop_id)) }));
    const status = root.querySelector("[data-shop-status]");
    const panel = root.querySelector("[data-shop-panel]");
    const previous = root.querySelector("[data-shop-previous]");
    const next = root.querySelector("[data-shop-next]");
    const position = root.querySelector("[data-shop-position]");
    const sectionTitle = root.querySelector("[data-shop-section-title]");
    const sectionTiming = root.querySelector("[data-shop-section-timing]");
    const items = root.querySelector("[data-shop-items]");

    if (!snapshot.available || !sections.length) {
        status.textContent = "Shop rotation unavailable";
        root.querySelector("[data-shop-capture]").textContent = snapshot.capturedAt
            ? `Last saved snapshot: ${dateLabel(snapshot.capturedAt) || snapshot.capturedAt}`
            : "No saved shop snapshot is available yet.";
        return;
    }

    const captured = dateLabel(snapshot.capturedAt);
    const stale = isSnapshotStale(snapshot);
    status.textContent = stale ? "Saved shop rotation may be out of date" : "Current saved shop rotation";
    root.querySelector("[data-shop-capture]").textContent = captured ? `Data captured ${captured}` : "Showing the latest saved shop data.";
    panel.hidden = false;
    const pages = shopPages(snapshot);
    const categories = root.querySelector("[data-shop-categories]");
    const pause = root.querySelector("[data-shop-pause]");
    const carouselRoot = root;
    const listeners = new AbortController();
    let paused = false;
    let interacting = false;
    let index = 0;
    const categoryButtons = sections.map(entry => {
        const button = element("button", "rl-shop-category", entry.shop?.title || entry.shop?.name || entry.shop?.type || "Shop category");
        button.type = "button";
        button.addEventListener("click", () => {
            index = pages.findIndex(page => page.shopId === String(entry.catalogue.shop_id));
            render();
        }, { signal: listeners.signal });
        return button;
    });
    categories.replaceChildren(...categoryButtons);
    const render = () => {
        const entry = pages[index];
        const shop = entry.shop;
        sectionTitle.textContent = shop?.title || shop?.name || shop?.type || "Shop rotation";
        const logo = root.querySelector("[data-shop-logo]");
        if (logo) logo.replaceChildren(shopImage(shop?.logo_url, `${sectionTitle.textContent} logo`, "rl-shop-logo"));
        sectionTiming.textContent = timingLabel(shop?.starts_at, shop?.ends_at) || "Shop dates unavailable";
        position.textContent = `Items ${entry.first}–${entry.first + entry.items.length - 1} of ${entry.total} · ${index + 1}/${pages.length}`;
        items.replaceChildren(...entry.items.map(itemCard));
        categoryButtons.forEach((button, categoryIndex) => button.setAttribute("aria-pressed",
            String(String(sections[categoryIndex].catalogue.shop_id) === entry.shopId)));
        previous.disabled = pages.length < 2;
        next.disabled = pages.length < 2;
        pause.disabled = pages.length < 2;
        previous.setAttribute("aria-label", "Previous shop items");
        next.setAttribute("aria-label", "Next shop items");
    };
    const advance = direction => { index = (index + direction + pages.length) % pages.length; render(); };
    previous.addEventListener("click", () => advance(-1), { signal: listeners.signal });
    next.addEventListener("click", () => advance(1), { signal: listeners.signal });
    pause.addEventListener("click", () => {
        paused = !paused;
        pause.textContent = paused ? "Resume cycling" : "Pause cycling";
        pause.setAttribute("aria-pressed", String(paused));
    }, { signal: listeners.signal });
    carouselRoot.addEventListener("pointerenter", () => { interacting = true; }, { signal: listeners.signal });
    carouselRoot.addEventListener("pointerleave", () => { interacting = false; }, { signal: listeners.signal });
    // Cycling only changes the displayed cached items; it never fetches data.
    const timer = pages.length > 1 ? setInterval(() => {
        if (!carouselRoot.isConnected) { stopCarousel(); return; }
        if (!paused && !interacting && !document.hidden && !carouselRoot.contains(document.activeElement)
            && document.body.dataset.animations !== "off"
            && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) advance(1);
    }, 8000) : null;
    stopCarousel = () => { clearInterval(timer); listeners.abort(); };
    render();
}

async function loadShop() {
    if (!root) return;
    const loadingRoot = root;
    const status = root.querySelector("[data-shop-status]");
    try {
        const response = await fetch("/api/rocketleague/shop", { headers: { Accept: "application/json" } });
        if (!response.ok) throw new Error("shop unavailable");
        const payload = await response.json();
        if (root !== loadingRoot || !loadingRoot.isConnected) return;
        if (!payload || payload.success !== true || !Array.isArray(payload.shops) || !Array.isArray(payload.catalogues)) throw new Error("invalid shop response");
        initializeCarousel(payload);
    } catch {
        if (root !== loadingRoot || !loadingRoot.isConnected) return;
        status.textContent = "Shop rotation unavailable";
        root.querySelector("[data-shop-capture]").textContent = "The saved shop data could not be loaded. Please try again later.";
    }
}

export async function initializePage() {
    stopCarousel();
    root = document.querySelector("[data-rl-shop]");
    if (!root) return;
    await loadShop();
}
