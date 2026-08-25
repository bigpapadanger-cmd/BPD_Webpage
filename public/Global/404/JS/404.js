/*
=========================================================
BPD GAMING NETWORK
404 PAGE
NAVIGATION
=========================================================
*/

export function initializePage() {

    const backButton =
        document.getElementById("errorGoBack");

    if (!backButton) {
        return;
    }

    backButton.addEventListener(
        "click",
        goBack
    );

}

function goBack(event) {

    if (event) {
        event.preventDefault();
    }

    if (window.history.length > 1) {

        window.history.back();
        return;

    }

    window.location.assign("/");

}