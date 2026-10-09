/* Dashboard-only personalized account summary and shortcuts. */
import {
    renderHeader
} from "/Framework/Shell/JS/renderHeader.js";
import {
    getAuthState,
    hasActiveAccount
} from "/Framework/Auth/auth.js";
import {
    beginVerificationNotice,
    finishVerificationNotice
} from "/scripts/verificationNotice.js";
import {
    getNotificationReviewDestination
} from "/Framework/Shell/JS/notification_destinations.js";

renderHeader({
    title: "Dashboard"
});

export async function initializePage() {
    document.body.dataset.page = "dashboard";
    const status = document.getElementById("dashboardAccountStatus");
    const providers = document.getElementById("dashboardProviders");
    const signIn = document.getElementById("dashboardSignIn");
    const welcome = document.getElementById("dashboardWelcome");
    const updatesStatus = document.getElementById("dashboardUpdatesStatus");
    const updatesList = document.getElementById("dashboardUpdatesList");
    if (!status || !providers) return;

    const renderUpdates = values => {
        if (!updatesStatus || !updatesList) return;
        const notifications = Array.isArray(values) ? values.filter(value => value
            && typeof value.title === "string" && value.title.length <= 100
            && typeof value.message === "string" && value.message.length <= 280
            && typeof value.createdAt === "string" && Number.isFinite(Date.parse(value.createdAt))
            && typeof value.reviewAction === "string").slice(0, 3) : [];
        updatesList.replaceChildren();
        if (!notifications.length) {
            updatesStatus.textContent = "No open notifications. Account updates will appear here.";
            return;
        }
        updatesStatus.textContent = `${notifications.length} recent update${notifications.length === 1 ? "" : "s"}.`;
        for (const notification of notifications) {
            const item = document.createElement("li");
            item.className = "dashboard-update-card";
            const content = document.createElement("div");
            const title = document.createElement("h3");
            title.textContent = notification.title;
            const message = document.createElement("p");
            message.textContent = notification.message;
            const time = document.createElement("time");
            time.dateTime = notification.createdAt;
            time.textContent = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(notification.createdAt));
            content.append(title, message, time);
            item.append(content);
            const destination = getNotificationReviewDestination(notification.reviewAction, notification.reviewCode,
                window.location?.origin || "https://bpd-gaming-network.com");
            if (destination) {
                const link = document.createElement("a");
                link.href = destination;
                link.dataset.routerLink = "";
                link.textContent = "Review";
                link.setAttribute("aria-label", `Review: ${notification.title}`);
                item.append(link);
            }
            updatesList.append(item);
        }
    };

    document.addEventListener("bpd:notifications-updated", event => {
        if (event.detail?.signedIn !== true) {
            if (updatesStatus) updatesStatus.textContent = "Sign in to see updates for your account.";
            updatesList?.replaceChildren();
            return;
        }
        renderUpdates(event.detail?.notifications);
    });
    document.addEventListener("bpd:notifications-unavailable", event => {
        if (event.detail?.signedIn === true && updatesStatus) {
            updatesStatus.textContent = "Your account updates are temporarily unavailable.";
        }
    });

    beginVerificationNotice(status, {
        checkingText: "Checking account…",
        fallbackText: "Account status"
    });
    const setStatus = value => finishVerificationNotice(status, value);

    try {
        const state = await getAuthState();
        if (hasActiveAccount(state)) {
            const name = String(state.displayName || "there").trim();
            welcome.textContent = name === "there" ? "Your personal starting point for BPD Gaming Network." : `Welcome back, ${name}. Here’s your personal BPD space.`;
            setStatus("Your account is active.");
            const linkedProviders = Array.isArray(state.linkedProviders) ? state.linkedProviders : [];
            providers.textContent = linkedProviders.length
                ? linkedProviders.map(provider => String(provider).replace(/^./, value => value.toUpperCase())).join(" · ")
                : "No linked providers yet";
            signIn.hidden = true;
            if (updatesStatus) updatesStatus.textContent = "Checking your account updates…";
            document.dispatchEvent(new Event("bpd:notifications-refresh"));
            return;
        }

        if (state.available === true && state.authenticated === false) {
            setStatus("Sign in to see your account status and linked providers.");
            providers.textContent = "Available after sign-in";
            signIn.hidden = false;
            if (updatesStatus) updatesStatus.textContent = "Sign in to see updates for your account.";
            return;
        }

        if (state.available === true && state.authenticated === true) {
            setStatus("Your account is currently inactive. Contact support if you need help.");
            providers.textContent = "Account access is limited";
            if (updatesStatus) updatesStatus.textContent = "Account updates are unavailable while access is limited.";
            return;
        }

        setStatus("Account information is temporarily unavailable.");
        providers.textContent = "Not available right now";
        if (updatesStatus) updatesStatus.textContent = "Your updates are temporarily unavailable.";
    } catch {
        setStatus("Account information is temporarily unavailable.");
        providers.textContent = "Not available right now";
        if (updatesStatus) updatesStatus.textContent = "Your updates are temporarily unavailable.";
    }
}
