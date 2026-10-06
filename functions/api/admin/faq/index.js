import { handleFaq } from "../../../services/faq/service.js";
export const onRequest = ({ request, env }) => handleFaq(request, env, "list");
