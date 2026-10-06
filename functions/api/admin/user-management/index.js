"use strict";

import { listUsers, parseListInput } from "../../../services/admin/user_management.js";
import { userManagementErrorResponse, userManagementJson } from "../../../services/admin/user_management_http.js";

export async function onRequestGet({ request, env }) {
    try {
        const input = await parseListInput(request.url);
        return userManagementJson(await listUsers(request, env, input));
    } catch (error) { return userManagementErrorResponse(error); }
}
