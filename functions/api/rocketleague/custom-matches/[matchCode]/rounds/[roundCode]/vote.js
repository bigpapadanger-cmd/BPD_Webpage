import { handleCustomMatchHttp } from "../../../../../../services/rl/custom_matches/http.js";
export const onRequest = context => handleCustomMatchHttp(context, "castVote");
