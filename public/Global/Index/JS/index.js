/*
=========================================================
BPD GAMING NETWORK
HOMEPAGE MODULE
=========================================================
This module contains only homepage-specific behavior.
Global sidebar behavior is handled separately by:
    /Framework/Shell/JS/sidebar.js
=========================================================
*/
export function initializePage() {
    document.body.dataset.page = "dashboard";
    initializeHomepageCards();
    initializeHomepageAds();
}
function initializeHomepageCards() {
    const cards = document.querySelectorAll(
        ".home-page .info-card"
    );
    cards.forEach(function(card) {
        card.setAttribute(
            "data-initialized",
            "true"
        );
    });
}
function initializeHomepageAds() {
    const adSlots = document.querySelectorAll(
        ".home-page .ad-slot"
    );
    if (adSlots.length === 0) {
        return;
    }
    document.dispatchEvent(
        new CustomEvent(
            "bpd:ads-ready",
            {
                detail: {
                    page: "dashboard",
                    slots: adSlots.length
                }
            }
        )
    );
}