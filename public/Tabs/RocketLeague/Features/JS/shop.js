"use strict";

let root = null;
let stopCarousel = () => {};
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

export function canShowLastSavedShop(snapshot, now = Date.now()) {
    return snapshot?.available === false
        && Number.isSafeInteger(snapshot.snapshotId) && snapshot.snapshotId > 0
        && typeof snapshot.capturedAt === "string" && Number.isFinite(Date.parse(snapshot.capturedAt))
        && shopPages(snapshot, now).length > 0;
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
    const url = safeImage(value);
    if (!url) return null;
    const image = element("img", className);
    image.src = url;
    image.alt = alt;
    image.loading = "lazy";
    image.referrerPolicy = "no-referrer";
    image.addEventListener("error", () => {
        image.remove();
    }, { once: true });
    return image;
}

export function itemCard(item) {
    const card = element("article", "rl-shop-item");
    if (typeof item?.title !== "string" || !item.title.trim()) return null;
    // Multi-product offers are the confirmed bundle discriminator.
    const products = Array.isArray(item.products) ? item.products : [];
    if (products.length > 1) {
        card.classList.add("rl-shop-item--bundle");
        card.append(element("span", "rl-shop-bundle-badge", "Bundle"));
        const count = products.every(product => Number.isSafeInteger(product.count) && product.count > 0)
            ? products.reduce((sum, product) => sum + product.count, 0) : null;
        if (Number.isSafeInteger(count)) card.append(element("p", "rl-shop-item__metadata", `${count} items in the listed contents`));
    }
    const image = shopImage(item.image_url, `${item.title} artwork`, "rl-shop-item__image");
    if (image) card.append(image);
    card.append(element("h3", "rl-shop-item__title", item.title));
    if (item.description) card.append(element("p", "rl-shop-item__description", item.description));

    const price = (Array.isArray(item.costs) ? item.costs : []).flatMap(cost => Array.isArray(cost.prices) ? cost.prices : [])
        .find(value => Number.isSafeInteger(value.amount));
    if (price) card.append(element("p", "rl-shop-item__price", `${price.amount.toLocaleString()} · Currency ${price.currency_id}`));
    else card.append(element("p", "rl-shop-item__price", "Price unavailable"));

    const variants = (Array.isArray(item.products) ? item.products : [])
        .flatMap(product => Array.isArray(product.attributes) ? product.attributes : [])
        .filter(attribute => /^(paint|painted|certification|certified|specialedition|special edition)$/i.test(attribute?.key || "")
            && typeof attribute.value === "string" && attribute.value.trim())
        .map(attribute => `${attribute.key}: ${attribute.value.trim()}`);
    if (variants.length) card.append(element("p", "rl-shop-item__metadata", [...new Set(variants)].join(" · ")));

    const timing = timingLabel(
        item.starts_at || item.costs.find(cost => cost.starts_at)?.starts_at,
        item.ends_at || item.costs.find(cost => cost.ends_at)?.ends_at
    );
    if (timing) card.append(element("p", "rl-shop-item__timing", timing));
    return card;
}

export function shopCategoryName(shop) {
    return [shop?.title, shop?.name, shop?.type].find(value => typeof value === "string" && value.trim()
        && !/^(region\s*:|shop category$|shop rotation$)/i.test(value.trim()))?.trim() || null;
}

function isActive(value, now) {
    const start = Date.parse(value?.starts_at || "");
    const end = Date.parse(value?.ends_at || "");
    return (!Number.isFinite(start) || start <= now) && (!Number.isFinite(end) || end > now);
}

export function shopPages(snapshot, now = Date.now()) {
    const shops = new Map(snapshot.shops.map(shop => [String(shop.id), shop]));
    return snapshot.catalogues.flatMap(catalogue => {
        const shop = shops.get(String(catalogue.shop_id));
        if (!shopCategoryName(shop) || !isActive(shop, now)) return [];
        const items = Array.isArray(catalogue.items) ? catalogue.items.filter(item =>
            typeof item.title === "string" && item.title.trim() && isActive(item, now)) : [];
        const pages = [];
        for (let offset = 0; offset < items.length; offset += 3) {
            pages.push({ shop, shopId: String(catalogue.shop_id),
                items: items.slice(offset, offset + 3), first: offset + 1, total: items.length });
        }
        return pages;
    });
}

function initializeCarousel(snapshot) {
    stopCarousel();
    const pages = shopPages(snapshot);
    const status = root.querySelector("[data-shop-status]");
    const panel = root.querySelector("[data-shop-panel]");
    const previous = root.querySelector("[data-shop-previous]");
    const next = root.querySelector("[data-shop-next]");
    const position = root.querySelector("[data-shop-position]");
    const sectionTitle = root.querySelector("[data-shop-section-title]");
    const sectionTiming = root.querySelector("[data-shop-section-timing]");
    const items = root.querySelector("[data-shop-items]");

    const lastSavedFallback = canShowLastSavedShop(snapshot);
    if ((!snapshot.available && !lastSavedFallback) || !pages.length) {
        panel.hidden = true;
        status.textContent = "No active shop items available";
        root.querySelector("[data-shop-capture]").textContent = snapshot.capturedAt
            ? `Last saved snapshot: ${dateLabel(snapshot.capturedAt) || snapshot.capturedAt}`
            : "No saved shop snapshot is available yet.";
        return;
    }

    const captured = dateLabel(snapshot.capturedAt);
    const stale = isSnapshotStale(snapshot) || lastSavedFallback;
    status.textContent = lastSavedFallback
        ? "Showing the last saved shop rotation · refresh unavailable"
        : stale ? "Saved shop rotation may be out of date" : "Current saved shop rotation";
    root.querySelector("[data-shop-capture]").textContent = captured ? `Data captured ${captured}` : "Showing the latest saved shop data.";
    panel.hidden = false;
    const pause = root.querySelector("[data-shop-pause]");
    const carouselRoot = root;
    const listeners = new AbortController();
    let paused = false;
    let interacting = false;
    let index = 0;
    const render = () => {
        const entry = pages[index];
        const shop = entry.shop;
        sectionTitle.textContent = shopCategoryName(shop);
        const logo = root.querySelector("[data-shop-logo]");
        if (logo) {
            const image = shopImage(shop?.logo_url, `${sectionTitle.textContent} logo`, "rl-shop-logo");
            logo.replaceChildren(...(image ? [image] : []));
        }
        sectionTiming.textContent = timingLabel(shop?.starts_at, shop?.ends_at) || "Shop dates unavailable";
        position.textContent = `Items ${entry.first}–${entry.first + entry.items.length - 1} of ${entry.total} · ${index + 1}/${pages.length}`;
        items.replaceChildren(...entry.items.map(itemCard).filter(Boolean));
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
        if (pages.some(page => !isActive(page.shop, Date.now()) || page.items.some(item => !isActive(item, Date.now())))) {
            initializeCarousel(snapshot);
            return;
        }
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
