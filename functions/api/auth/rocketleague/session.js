import { handleAuthSession } from "../../../services/rocketleague/session.js";

export async function onRequest(context) {
  return handleAuthSession(context.request, context.env);
}
