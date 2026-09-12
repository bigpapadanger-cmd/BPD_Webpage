"use strict";

/* =========================================================
BPD GAMING NETWORK
EPIC LOGIN API ROUTE

File:
    functions/api/auth/epic/login.js

Purpose:
    Public API entry point for Epic Games authentication.

Description:
    - Accepts POST login requests from the public login page.
    - Delegates Turnstile verification and OAuth initialization.
    - Returns an Epic authentication redirect URL as JSON.
    - Rejects unsupported request methods.

Public Route:
    POST /api/auth/epic/login

Service:
    functions/services/auth/providers/epic/login.js
========================================================= */

import {
    handleEpicLogin
} from "../../../services/auth/providers/epic/login.js";

import {
    methodNotAllowedResponse
} from "../../../services/http/responses.js";

/* =========================================================
POST
========================================================= */

export async function onRequestPost(
    context
) {
    return handleEpicLogin(
        context.request,
        context.env
    );
}

/* =========================================================
UNSUPPORTED METHODS
========================================================= */

export async function onRequestGet() {
    return methodNotAllowedResponse(
        [
            "POST"
        ]
    );
}

export async function onRequestPut() {
    return methodNotAllowedResponse(
        [
            "POST"
        ]
    );
}

export async function onRequestPatch() {
    return methodNotAllowedResponse(
        [
            "POST"
        ]
    );
}

export async function onRequestDelete() {
    return methodNotAllowedResponse(
        [
            "POST"
        ]
    );
}