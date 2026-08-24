import { handleAuthSession } from "../../auth/session.js";

export async function onRequest(context) {
  return handleAuthSession(context.request, context.env);
}
