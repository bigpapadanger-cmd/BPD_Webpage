"use strict";

/* =========================================================
BPD GAMING NETWORK
ROCKET LEAGUE PAGE INITIALIZER

File:
    /Tabs/RocketLeague/Index/JS/index.js

Purpose:
    Initializes Rocket League homepage-specific behavior.

Initialization Order:
    1. Mark the main Rocket League action as validating.
    2. Attach Rocket League action handlers.
    3. Resolve authentication state.
    4. Resolve Rocket League profile state.
    5. Allow auth.js to populate the final CTA state.
    6. Release the main CTA for user interaction.
========================================================= */

import {
    initializeEpicConnection,
    setMainRocketLeagueActionValidating,
    releaseMainRocketLeagueAction
} from "./connect_epic.js";

import {
    initializeRocketLeagueAuthView
} from "./auth.js";

/* =========================================================
PAGE INITIALIZATION
========================================================= */

export async function initializePage() {
    document.body.dataset.page =
        "rocket-league";

    /*
     * Do this before any authentication/profile request.
     *
     * The user should never be able to click a CTA whose
     * purpose has not yet been determined.
     */
    setMainRocketLeagueActionValidating();

    /*
     * Event listeners may safely be attached while the
     * button is disabled.
     */
    initializeEpicConnection();

    try {
        /*
         * auth.js determines the final CTA state after
         * authentication and Rocket League profile
         * validation have completed.
         */
        await initializeRocketLeagueAuthView();
    }
    finally {
        /*
         * Do not change the final text or data-action here.
         *
         * auth.js owns those values.
         */
        releaseMainRocketLeagueAction();
    }
}