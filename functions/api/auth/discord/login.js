import {
    handleDiscordLogin
} from "../../../services/auth/providers/discord/login.js";

import {
    methodNotAllowedResponse
} from "../../../services/http/responses.js";

export async function onRequestPost(
    context
) {
    return handleDiscordLogin(
        context.request,
        context.env
    );
}

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