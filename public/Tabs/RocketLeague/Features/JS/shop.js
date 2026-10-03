"use strict";

const root = document.querySelector("[data-rl-shop]");

function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function safeImage(value) {
    try {
        const url = new URL(value);
        return url.protocol === "https:" ? url.href : null;
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

function itemCard(item) {
    const card = element("article", "rl-shop-item");
    const imageUrl = safeImage(item.image_url);
    if (imageUrl) {
        const image = element("img", "rl-shop-item__image");
        image.src = imageUrl;
        image.alt = item.title ? `${item.title} artwork` : "Rocket League item artwork";
        image.loading = "lazy";
        image.referrerPolicy = "no-referrer";
        card.append(image);
    } else {
        card.append(element("div", "rl-shop-item__image rl-shop-item__image--empty", "Artwork unavailable"));
    }
    card.append(element("h3", "rl-shop-item__title", item.title || "Shop item"));
    if (item.description) card.append(element("p", "rl-shop-item__description", item.description));

    const price = item.costs.flatMap(cost => cost.prices).find(value => Number.isSafeInteger(value.amount));
    if (price) card.append(element("p", "rl-shop-item__price", `${price.amount.toLocaleString()} · Currency ${price.currency_id}`));
    else card.append(element("p", "rl-shop-item__price", "Price unavailable"));

    const timing = dateLabel(item.ends_at);
    if (timing) card.append(element("p", "rl-shop-item__timing", `Listed until ${timing}`));
    return card;
}

function initializeCarousel(snapshot) {
    const catalogues = snapshot.catalogues.filter(entry => Array.isArray(entry.items) && entry.items.length);
    const shopsById = new Map(snapshot.shops.map(shop => [String(shop.id), shop]));
    const sections = catalogues.map(catalogue => ({ catalogue, shop: shopsById.get(String(catalogue.shop_id)) }));
    const status = root.querySelector("[data-shop-status]");
    const panel = root.querySelector("[data-shop-panel]");
    const previous = root.querySelector("[data-shop-previous]");
    const next = root.querySelector("[data-shop-next]");
    const position = root.querySelector("[data-shop-position]");
    const sectionTitle = root.querySelector("[data-shop-section-title]");
    const items = root.querySelector("[data-shop-items]");

    if (!snapshot.available || !sections.length) {
        status.textContent = "Shop rotation unavailable";
        root.querySelector("[data-shop-capture]").textContent = snapshot.capturedAt
            ? `Last saved snapshot: ${dateLabel(snapshot.capturedAt) || snapshot.capturedAt}`
            : "No saved shop snapshot is available yet.";
        return;
    }

    const captured = dateLabel(snapshot.capturedAt);
    status.textContent = "Saved shop rotation";
    root.querySelector("[data-shop-capture]").textContent = captured ? `Data captured ${captured}` : "Showing the latest saved shop data.";
    panel.hidden = false;
    let index = 0;
    const render = () => {
        const entry = sections[index];
        const shop = entry.shop;
        sectionTitle.textContent = shop?.title || shop?.name || shop?.type || "Shop rotation";
        position.textContent = `${index + 1} of ${sections.length}`;
        items.replaceChildren(...entry.catalogue.items.map(itemCard));
        previous.disabled = sections.length < 2;
        next.disabled = sections.length < 2;
        previous.setAttribute("aria-label", "Previous shop section");
        next.setAttribute("aria-label", "Next shop section");
    };
    previous.addEventListener("click", () => { index = (index - 1 + sections.length) % sections.length; render(); });
    next.addEventListener("click", () => { index = (index + 1) % sections.length; render(); });
    render();
}

async function loadShop() {
    if (!root) return;
    const status = root.querySelector("[data-shop-status]");
    try {
        const response = await fetch("/api/rocketleague/shop", { headers: { Accept: "application/json" } });
        if (!response.ok) throw new Error("shop unavailable");
        const payload = await response.json();
        if (!payload || payload.success !== true || !Array.isArray(payload.shops) || !Array.isArray(payload.catalogues)) throw new Error("invalid shop response");
        initializeCarousel(payload);
    } catch {
        status.textContent = "Shop rotation unavailable";
        root.querySelector("[data-shop-capture]").textContent = "The saved shop data could not be loaded. Please try again later.";
    }
}

loadShop();
