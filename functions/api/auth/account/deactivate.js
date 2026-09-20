import { handleAccountMutation } from "../../../services/auth/account/mutations.js";

export function onRequestPost({ request, env }) {
    return handleAccountMutation(request, env, "deactivate");
}

export const onRequest = onRequestPost;
