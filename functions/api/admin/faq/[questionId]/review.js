import { handleFaq } from "../../../../services/faq/service.js";
export const onRequest = ({ request, env, params }) => handleFaq(request, env, "review", params.questionId);
