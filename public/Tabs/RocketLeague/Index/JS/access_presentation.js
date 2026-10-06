"use strict";

export function getRocketLeagueAccessPresentation(session) {
    if (session?.authAvailable === false) {
        return {
            title: "Rocket League access check unavailable",
            message: "We could not verify your sign-in or profile status. Please try again shortly."
        };
    }

    if (session?.authenticated !== true) {
        return {
            title: "Sign in to enter the Rocket League Player Hub",
            message: "Sign in with Epic to access your Rocket League profile, rankings, MMR history, career totals, privacy settings, and community features."
        };
    }

    if (session.active === false || session.user?.active === false) {
        return {
            title: "Your BPD account needs attention",
            message: "We could not confirm that this account is active. Visit Account to review its status."
        };
    }

    if (session.epicLinked !== true) {
        return {
            title: "Connect your Epic account",
            message: "Your Epic account links your Rocket League identity to your BPD Gaming Network profile."
        };
    }

    if (session.rocketLeagueAccess === true) {
        return { title: "Rocket League registration complete", message: session.requiresEpicReauthorization === true
            ? "Your saved Rocket League data is available. Verify Epic Again before live provider operations."
            : "Your saved Rocket League profile is ready." };
    }

    if (session.requiresEpicReauthorization === true) {
        return {
            title: "Epic verification required",
            message: "Your Epic account remains linked. Renew its authorization to continue to your Rocket League profile."
        };
    }

    if (session.epicAuthorized !== true) {
        return {
            title: "Epic verification is temporarily unavailable",
            message: "Your Epic account remains linked, but we could not confirm current authorization. Please retry; your link has not been removed."
        };
    }

    if (session.profileLoaded !== true) {
        return {
            title: "Checking your Rocket League profile",
            message: "We’re confirming whether your Rocket League setup is complete."
        };
    }

    if (session.rocketLeagueAccess !== true) {
        return {
            title: "Complete your Rocket League profile",
            message: "Your Epic account is linked. Complete your BPD Rocket League profile to set your preferences, privacy, availability, and notification options."
        };
    }

    return { title: "Rocket League profile ready", message: "Your saved Rocket League profile is ready." };
}
