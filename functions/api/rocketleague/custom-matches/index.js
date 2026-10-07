import { handleCustomMatchHttp, customMatchJson } from "../../../services/rl/custom_matches/http.js";
export function onRequest(context) {
    if (!["GET", "POST"].includes(context.request.method)) return customMatchJson({ success: false, code: "METHOD_NOT_ALLOWED" }, 405, { Allow: "GET, POST" });
    if (context.request.method === "POST") return handleCustomMatchHttp(context, "create");
    return handleCustomMatchHttp(context, "list");
}
