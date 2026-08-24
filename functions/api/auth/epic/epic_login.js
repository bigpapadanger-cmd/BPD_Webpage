import { handleEpicLogin } from "../../../auth/epic/login.js";

export async function onRequest(context) {
  return handleEpicLogin(context.request, context.env);
}
