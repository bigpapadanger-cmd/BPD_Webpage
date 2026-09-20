const MESSAGES = Object.freeze({
    PROVIDER_IDENTITY_ALREADY_LINKED:
        "That provider account is already linked to another BPD account. Sign into the BPD account that owns it, or choose a different provider account.",
    PROVIDER_REAUTHORIZATION_MISMATCH:
        "That provider account does not match your existing connection. Verify again using the account already linked to BPD.",
    PROVIDER_NOT_LINKED: "That provider is no longer linked. Connect it again from your Account page.",
    ACCOUNT_INACTIVE: "This BPD account is inactive. Your provider connections have been preserved.",
    AUTH_REQUIRED: "Your session expired. Sign in again to continue.",
    OAUTH_PROVIDER_REJECTED: "Provider sign-in was cancelled or declined. You can try again.",
    AUTH_SERVICE_UNAVAILABLE: "Authentication is temporarily unavailable. Please try again. Your provider connections have been preserved.",
    OAUTH_ACCOUNT_MISMATCH: "Your BPD session changed during verification. Restart verification from your Account page."
});

export function consumeOAuthError() {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("error")) return "";
    const code = url.searchParams.get("error");
    const message = Object.hasOwn(MESSAGES, code)
        ? MESSAGES[code] : "Sign-in could not be completed. Please try again from this page.";
    url.searchParams.delete("error");
    url.searchParams.delete("debugId");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    return message;
}
