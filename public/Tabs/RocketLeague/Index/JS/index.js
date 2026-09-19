"use strict";

/* =========================================================
BPD GAMING NETWORK
ROCKET LEAGUE PAGE INITIALIZER

File:
    /Tabs/RocketLeague/Index/JS/index.js

Purpose:
    Initializes Rocket League homepage-specific behavior.
========================================================= */

import {
    initializeEpicConnection
} from "./connect_epic.js";

import {
    initializeRocketLeagueAuthView
} from "./auth.js";

export async function initializePage() {
    document.body.dataset.page =
        "rocket-league";

    initializeEpicConnection();

    await initializeRocketLeagueAuthView();
}