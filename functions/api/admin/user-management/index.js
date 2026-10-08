"use strict";

import { createUserManagementDiagnostics, listUsers, parseListInput } from "../../../services/admin/user_management.js";
import { userManagementErrorResponse, userManagementJson } from "../../../services/admin/user_management_http.js";

export async function onRequestGet({ request, env }) {
    const diagnostics = createUserManagementDiagnostics();
    let failure = null;
    let response;
    try {
        const input = await parseListInput(request.url);
        response = userManagementJson(await listUsers(request, env, input, diagnostics));
    } catch (error) { failure = error; response = userManagementErrorResponse(error); }
    diagnostics.finish(failure);
    response.headers.set("X-Debug-ID", diagnostics.debugId);
    return response;
}
