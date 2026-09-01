/*
=========================================================
BPD GAMING NETWORK
404 PAGE
NAVIGATION
=========================================================
*/

export function initializePage() {
    const backButton =
        document.getElementById(
            "errorGoBack"
        );

    if (!backButton) {
        return;
    }

    if (
        backButton.dataset.initialized ===
        "true"
    ) {
        return;
    }

    backButton.addEventListener(
        "click",
        goBack
    );

    backButton.dataset.initialized =
        "true";
}

function goBack(event) {
    if (event) {
        event.preventDefault();
    }

    const referrer =
        document.referrer;

    const sameSiteReferrer =
        referrer &&
        new URL(
            referrer,
            window.location.origin
        ).origin ===
            window.location.origin;

    if (
        sameSiteReferrer &&
        window.history.length > 1
    ) {
        window.history.back();
        return;
    }

    if (
        window.BPDRouter &&
        typeof window.BPDRouter.navigate ===
            "function"
    ) {
        window.BPDRouter.navigate("/");
        return;
    }

    window.location.assign("/");
}