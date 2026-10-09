"use strict";

import { getAuthState, hasAdminAccess } from "/Framework/Auth/auth.js";

export async function initializePage() {
    const page = document.querySelector(".admin-match-placeholder");
    if (!page) return;

    let state;
    try {
        state = await getAuthState();
    } catch {
        state = null;
    }
    if (state?.available === true && state?.authenticated === true && hasAdminAccess(state)) return;

    page.replaceChildren();
    const message = document.createElement("p");
    message.setAttribute("role", "status");
    message.textContent = "Admin access could not be verified.";
    const link = document.createElement("a");
    link.href = "/Dashboard";
    link.dataset.routerLink = "";
    link.textContent = "Return to Dashboard";
    page.append(message, link);
}
