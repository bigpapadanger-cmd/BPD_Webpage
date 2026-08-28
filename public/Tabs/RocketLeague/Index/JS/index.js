"use strict";
import {
    initializeButtons
} from "./login_logout.js";
import {
    initializeRocketLeagueAuthView
} from "./auth.js";
import {
    initializeSidebarSubmenus
} from "./submenu.js";
export async function initializePage() {
    document.body.dataset.page =
        "rocket-league";
    initializeButtons();
    initializeSidebarSubmenus();
    await initializeRocketLeagueAuthView();
}