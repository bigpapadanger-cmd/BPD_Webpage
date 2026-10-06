"use strict";

import { ROCKET_LEAGUE_PROFILE_URL, ROCKET_LEAGUE_SESSION_URL } from "../../../../scripts/apiRoutes.js";

function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isRocketLeagueSessionContract(value) {
    if (!isRecord(value) || value.success !== true || typeof value.authenticated !== "boolean") return false;
    const fields = ["epicLinked", "epicAuthorized", "requiresEpicLogin", "requiresEpicReauthorization", "profileLoaded", "registrationAccepted", "profileComplete", "rocketLeagueAccess"];
    if (!fields.every(field => typeof value[field] === "boolean")) return false;
    if (value.epicAuthorized && (!value.epicLinked || value.requiresEpicReauthorization)) return false;
    if (value.requiresEpicLogin !== !value.epicLinked) return false;
    if (value.requiresEpicReauthorization && (!value.epicLinked || value.epicAuthorized)) return false;
    return value.authenticated !== true || (isRecord(value.user) && typeof value.user.active === "boolean");
}

export function isRocketLeagueProfileContract(value) {
    return isRecord(value) && value.success === true && isRecord(value.profile)
        && ["profileExists", "profileLoaded", "profileComplete", "registrationAccepted", "rocketLeagueAccess"].every(field => typeof value[field] === "boolean");
}

function showRocketLeagueRecovery(documentRef, { title, message, href, label } = {}) {
    const panel = documentRef.getElementById("rocketLeagueLoggedOut");
    if (!panel) return;
    panel.hidden = false;
    const heading = panel.querySelector("h2");
    const description = panel.querySelector("p");
    const link = panel.querySelector("a");
    if (heading && title) heading.textContent = title;
    if (description && message) description.textContent = message;
    if (link) {
        if (href) link.href = href;
        if (label) link.textContent = label;
        link.hidden = false;
    }
}

function applyRocketLeaguePageAccess(documentRef, session, { allow = true } = {}) {
    const profileValidated = session?.authenticated === true
        && session?.profileLoaded === true
        && session?.registrationAccepted === true && session?.rocketLeagueAccess === true;
    const access = allow && profileValidated;
    const loggedOut = documentRef.getElementById("rocketLeagueLoggedOut");
    const content = documentRef.getElementById("rocketLeagueAuthenticatedContent");
    const profile = documentRef.getElementById("rocketLeaguePlayerProfile");
    if (content) content.hidden = !access;
    if (profile) profile.hidden = !access;
    if (loggedOut && session?.authenticated === true && session?.epicLinked === true
        && (session?.rocketLeagueAccess === true || session?.requiresEpicReauthorization !== true)) loggedOut.hidden = true;
    documentRef.body.dataset.authenticated = session?.authenticated === true ? "true" : "false";
    documentRef.body.dataset.rlAccess = String(access);
    return access;
}

function clearRocketLeaguePageLoading(documentRef, message) {
    documentRef.querySelectorAll?.(".rank-loading").forEach(element => element.classList.remove("rank-loading"));
    const rankStatus = documentRef.getElementById("rocketLeagueRankStatus");
    if (rankStatus) {
        rankStatus.textContent = message;
        rankStatus.dataset.state = "error";
    }
}

export async function initializeRocketLeagueProtectedPage({
    renderProfile,
    renderUnavailableRanks,
    fetcher = (url, init) => fetch(url, init),
    documentRef = document,
    windowRef = window
} = {}) {
    let terminal = false;
    let session = null;
    try {
        const authResponse = await fetcher(ROCKET_LEAGUE_SESSION_URL, {
            method: "GET", credentials: "same-origin", cache: "no-store", headers: { accept: "application/json" }
        });
        const authResult = await authResponse.json().catch(() => null);
        if (!authResponse.ok) throw Object.assign(new Error("session request unavailable"), { stage: "auth" });
        if (!isRocketLeagueSessionContract(authResult)) throw Object.assign(new Error("session contract invalid"), { stage: "auth", terminalState: "validation-failed" });
        session = authResult;
        // Keep protected controls locked until both the session and the
        // page's profile contract have been independently validated.
        applyRocketLeaguePageAccess(documentRef, session, { allow: false });

        if (!session.authenticated) {
            showRocketLeagueRecovery(documentRef, { title: "Login to continue", message: "Sign in and link Epic to access Rocket League features.", href: "/auth/epic/login", label: "Login / Register with Epic Games" });
            terminal = true;
            return { state: "not-applicable", session };
        }
        if (session.requiresEpicReauthorization && session.rocketLeagueAccess !== true) {
            showRocketLeagueRecovery(documentRef, { title: "Verify Epic Again", message: "Your Epic account remains linked. Reauthorize it to restore Rocket League access.", href: "/Account?reauthorize=epic", label: "Verify Epic Again" });
            try { renderUnavailableRanks("Verify Epic Again in BPD Account to use Rocket League features."); } catch { clearRocketLeaguePageLoading(documentRef, "Rank display unavailable while Epic reauthorization is required."); }
            terminal = true;
            return { state: "reauthorization-required", session };
        }
        if (!session.epicLinked) {
            showRocketLeagueRecovery(documentRef, { title: "Connect Epic", message: "Link and authorize Epic to view Rocket League profile details.", href: "/auth/epic/login", label: "Connect Epic" });
            terminal = true;
            return { state: "not-applicable", session };
        }

        const profileResponse = await fetcher(`${ROCKET_LEAGUE_PROFILE_URL}?includePresence=false`, {
            method: "GET", credentials: "same-origin", cache: "no-store", headers: { accept: "application/json" }
        });
        const profileResult = await profileResponse.json().catch(() => null);
        if (!profileResponse.ok || !isRocketLeagueProfileContract(profileResult)) {
            applyRocketLeaguePageAccess(documentRef, session, { allow: false });
            showRocketLeagueRecovery(documentRef, { title: "Rocket League profile unavailable", message: "We couldn’t verify your Rocket League profile. Retry by reloading this page.", href: windowRef.location.pathname, label: "Retry profile check" });
            try { renderUnavailableRanks("Rocket League profile validation is unavailable."); } catch { clearRocketLeaguePageLoading(documentRef, "Rocket League profile validation is unavailable."); }
            terminal = true;
            return { state: profileResponse.ok ? "validation-failed" : "unavailable", session };
        }

        const validatedSession = {
            ...session,
            profileLoaded: profileResult.profileLoaded,
            profileComplete: profileResult.profileComplete,
            registrationAccepted: profileResult.registrationAccepted,
            rocketLeagueAccess: profileResult.rocketLeagueAccess
        };

        terminal = true;
        try {
            renderProfile?.(session.user, profileResult.profile);
            applyRocketLeaguePageAccess(documentRef, validatedSession);
        } catch (error) {
            console.error("ROCKET LEAGUE PROFILE PRESENTATION: unavailable.", { name: error?.name || "Error" });
            // Keep successful auth/profile validation distinct from page
            // presentation, but fail closed if rendering did not complete.
            applyRocketLeaguePageAccess(documentRef, validatedSession, { allow: false });
            try { renderUnavailableRanks("Rank display is temporarily unavailable."); } catch { clearRocketLeaguePageLoading(documentRef, "Rank display is temporarily unavailable."); }
        }
        return { state: "validated", session };
    } catch (error) {
        const stage = error?.stage === "auth" || !session ? "auth" : "profile";
        if (stage === "profile" && session) applyRocketLeaguePageAccess(documentRef, session, { allow: false });
        else {
            applyRocketLeaguePageAccess(documentRef, null, { allow: false });
            showRocketLeagueRecovery(documentRef, { title: "Rocket League check unavailable", message: "We couldn’t verify access right now. Retry by reloading this page.", href: windowRef.location.pathname, label: "Retry access check" });
        }
        console.error("ROCKET LEAGUE PAGE VALIDATION: unavailable.", { stage, name: error?.name || "Error" });
        try { renderUnavailableRanks?.(stage === "auth" ? "Rocket League access could not be verified." : "Rocket League profile validation is unavailable."); } catch { clearRocketLeaguePageLoading(documentRef, "Rocket League validation is unavailable."); }
        terminal = true;
        return { state: error?.terminalState || "unavailable", session };
    } finally {
        if (!terminal) {
            applyRocketLeaguePageAccess(documentRef, session, { allow: false });
            try { renderUnavailableRanks?.("Rocket League validation is unavailable."); } catch { clearRocketLeaguePageLoading(documentRef, "Rocket League validation is unavailable."); }
        }
        documentRef.body.dataset.rlValidationState = terminal ? "settled" : "unavailable";
        documentRef.querySelectorAll?.(".rank-loading").forEach(element => element.classList.remove("rank-loading"));
    }
}

export function settleUnresolvedRocketLeagueValidation({
    button,
    body = document.body,
    sidebar = document.getElementById("sidebar"),
    callout = document.getElementById("rocketLeagueAccessCallout"),
    heading = document.getElementById("rocketLeagueAccessHeading"),
    message = document.getElementById("rocketLeagueAccessMessage"),
    authenticatedContent = document.getElementById("rocketLeagueAuthenticatedContent"),
    playerProfile = document.getElementById("rocketLeaguePlayerProfile"),
    loggedOutContent = document.getElementById("rocketLeagueLoggedOut")
} = {}) {
    if (!button || button.dataset.action !== "validating") return false;

    button.disabled = false;
    button.dataset.action = "retry-validation";
    button.removeAttribute("aria-busy");
    button.setAttribute("aria-label", "Retry Rocket League access check");
    const buttonText = button.querySelector("span:last-child");
    if (buttonText) buttonText.textContent = "Retry access check";

    if (body?.dataset) body.dataset.rlAccess = "false";
    sidebar?.querySelectorAll?.("[data-rl-access='required'], [data-rl-access='unlocked']")
        .forEach(element => { element.hidden = true; });
    if (callout) callout.hidden = false;
    if (heading) heading.textContent = "Rocket League access check unavailable";
    if (message) message.textContent = "We couldn’t verify access. Please retry in a moment.";
    if (authenticatedContent) authenticatedContent.hidden = true;
    if (playerProfile) playerProfile.hidden = true;
    if (loggedOutContent) loggedOutContent.hidden = true;
    return true;
}
