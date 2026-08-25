"use strict";
import {
    initializeButtons
} from "./login_logout.js";
import {
    initializeRocketLeagueAuthView
} from "./auth.js";

export async function initializePage() {
    document.body.dataset.page =
        "rocket-league";
    initializeButtons();
    await initializeRocketLeagueAuthView();
}