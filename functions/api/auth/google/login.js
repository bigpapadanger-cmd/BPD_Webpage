"use strict";

/* =========================================================
BPD GAMING NETWORK
GOOGLE LOGIN API ROUTE

File:
    functions/api/auth/google/login.js

Purpose:
    Public API entry point for Google authentication.

Description:
    - Accepts POST login requests from the public login page.
    - Delegates Turnstile verification and OAuth initialization.
    - Returns a provider redirect URL as JSON.
    - Rejects unsupported request methods.

Public Route:
    POST /api/auth/google/login

Service:
    functions/services/auth/providers/google/login.js
========================================================= */

import {
    handleGoogleLogin
} from "../../../services/auth/providers/google/login.js";

import {
    methodNotAllowedResponse
} from "../../../services/http/responses.js";

/* =========================================================
POST
========================================================= */

export async function onRequestPost(
    context
) {
    return handleGoogleLogin(
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