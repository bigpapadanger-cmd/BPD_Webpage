"use strict";

import {
    initializeRocketLeagueAuthView
} from "./auth.js";

export async function initializePage() {
    document.body.dataset.page =
        "rocket-league";

    await initializeRocketLeagueAuthView();
}