import { handleAuthSession } from "../../verification/reload/reload_sessions.js";

export async function onRequest(context) {
  return handleAuthSession(context.request, context.env);
}
