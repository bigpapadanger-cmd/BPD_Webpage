"use strict";
import { trustedScriptURLFromApprovedThirdParty } from "../../../scripts/trustedDom.js";

// Approved display-unit IDs belong on existing slots as data-ad-slot.
// Unconfigured placeholders never download advertising code.
const CLIENT = "ca-pub-9161533706304827";
let scriptPromise;
let observer;
let resizeObserver;

function fitsViewport(slot) {
    const rect = slot.getBoundingClientRect();
    return rect.width >= 250 && rect.height >= 50 && rect.top < window.innerHeight + 200 && rect.bottom > -200;
}

function loadAdScript() {
    if (scriptPromise) return scriptPromise;
    scriptPromise = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.async = true;
        script.crossOrigin = "anonymous";
        script.src = trustedScriptURLFromApprovedThirdParty(`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${CLIENT}`);
        script.addEventListener("load", resolve, { once: true });
        script.addEventListener("error", () => { script.remove(); scriptPromise = null; reject(new Error("Advertising unavailable.")); }, { once: true });
        document.head.append(script);
    });
    return scriptPromise;
}

async function fillSlot(slot) {
    if (!slot.isConnected || slot.dataset.adRequested || !fitsViewport(slot)) return;
    slot.dataset.adRequested = "true";
    try {
        await loadAdScript();
        if (!slot.isConnected) return;
        if (!fitsViewport(slot)) { delete slot.dataset.adRequested; observer?.observe(slot); return; }
        const ad = document.createElement("ins");
        ad.className = "adsbygoogle";
        ad.style.display = "block";
        ad.style.width = "100%";
        ad.style.height = `${slot.clientHeight}px`;
        ad.dataset.adClient = CLIENT;
        ad.dataset.adSlot = slot.dataset.adSlot;
        ad.dataset.fullWidthResponsive = "false";
        slot.append(ad);
        (window.adsbygoogle ||= []).push({});
    } catch { slot.dataset.adState = "unavailable"; }
}

export function initializePageAds() {
    observer?.disconnect();
    resizeObserver?.disconnect();
    const slots = [...document.querySelectorAll(".ad-slot[data-ad-slot]")]
        .filter(slot => /^\d{6,20}$/.test(slot.dataset.adSlot || "") && !slot.dataset.adRequested);
    if (!slots.length) return;
    if (typeof IntersectionObserver === "function") {
        observer = new IntersectionObserver(entries => {
            for (const entry of entries) if (entry.isIntersecting && fitsViewport(entry.target)) {
                observer.unobserve(entry.target);
                void fillSlot(entry.target);
            }
        }, { rootMargin: "200px 0px" });
        slots.forEach(slot => observer.observe(slot));
        if (typeof ResizeObserver === "function") {
            resizeObserver = new ResizeObserver(entries => {
                for (const entry of entries) if (fitsViewport(entry.target)) void fillSlot(entry.target);
            });
            slots.forEach(slot => resizeObserver.observe(slot));
        }
    } else {
        for (const slot of slots) {
            const rect = slot.getBoundingClientRect();
            if (rect.top < window.innerHeight && rect.bottom > 0) void fillSlot(slot);
        }
    }
}
