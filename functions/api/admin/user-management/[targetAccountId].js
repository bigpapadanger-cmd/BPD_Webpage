"use strict";

import { getUserDetails } from "../../../services/admin/user_management.js";
import { userManagementErrorResponse, userManagementJson } from "../../../services/admin/user_management_http.js";

export async function onRequestGet({ request, env, params }) {
    try { return userManagementJson(await getUserDetails(request, env, params?.targetAccountId)); }
    catch (error) { return userManagementErrorResponse(error); }
}
