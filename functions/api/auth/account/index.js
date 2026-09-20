import { handleAccountMutation } from "../../../services/auth/account/mutations.js";

export function onRequestDelete({ request, env }) {
    return handleAccountMutation(request, env, "delete");
}

export const onRequest = onRequestDelete;
