import { handleEpicCallback } from "../../../auth/epic/callback.js";

export async function onRequest(context) {
  return handleEpicCallback(context.request, context.env);
}
