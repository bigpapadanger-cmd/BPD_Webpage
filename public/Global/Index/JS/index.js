/* Dashboard-only personalized account summary and shortcuts. */
import {
    renderHeader
} from "/Framework/Shell/JS/renderHeader.js";
import {
    getAuthState,
    hasActiveAccount
} from "/Framework/Auth/auth.js";

renderHeader({
    title: "Dashboard"
});

export async function initializePage() {
    document.body.dataset.page = "dashboard";
    const status = document.getElementById("dashboardAccountStatus");
    const providers = document.getElementById("dashboardProviders");
    const signIn = document.getElementById("dashboardSignIn");
    const welcome = document.getElementById("dashboardWelcome");
    if (!status || !providers) return;

    try {
        const state = await getAuthState();
        if (hasActiveAccount(state)) {
            const name = String(state.displayName || "there").trim();
            welcome.textContent = name === "there" ? "Your personal starting point for BPD Gaming Network." : `Welcome back, ${name}. Here’s your personal BPD space.`;
            status.textContent = "Your account is active.";
            const linkedProviders = Array.isArray(state.linkedProviders) ? state.linkedProviders : [];
            providers.textContent = linkedProviders.length
                ? linkedProviders.map(provider => String(provider).replace(/^./, value => value.toUpperCase())).join(" · ")
                : "No linked providers yet";
            signIn.hidden = true;
            return;
        }

        if (state.available === true && state.authenticated === false) {
            status.textContent = "Sign in to see your account status and linked providers.";
            providers.textContent = "Available after sign-in";
            signIn.hidden = false;
            return;
        }

        if (state.available === true && state.authenticated === true) {
            status.textContent = "Your account is currently inactive. Contact support if you need help.";
            providers.textContent = "Account access is limited";
            return;
        }

        status.textContent = "Account information is temporarily unavailable.";
        providers.textContent = "Not available right now";
    } catch {
        status.textContent = "Account information is temporarily unavailable.";
        providers.textContent = "Not available right now";
    }
}
