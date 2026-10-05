import { startLinkedRolesVerification } from "../../../../services/auth/providers/discord/linked_roles.js";

export function onRequest({ request, env }) {
    return startLinkedRolesVerification(request, env);
}
