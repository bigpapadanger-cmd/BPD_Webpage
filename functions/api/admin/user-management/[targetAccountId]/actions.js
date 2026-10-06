"use strict";

import { mutateUser, parseMutationInput } from "../../../../services/admin/user_management.js";
import { readUserManagementJson, userManagementErrorResponse, userManagementJson } from "../../../../services/admin/user_management_http.js";

export async function onRequestPost({ request, env, params }) {
    try {
        const input = parseMutationInput(await readUserManagementJson(request));
        if (input.action === "add-note") throw Object.assign(new Error(), { code: "USER_MANAGEMENT_INPUT_INVALID", status: 400 });
        return userManagementJson(await mutateUser(request, env, params?.targetAccountId, input.action, input));
    } catch (error) { return userManagementErrorResponse(error); }
}
