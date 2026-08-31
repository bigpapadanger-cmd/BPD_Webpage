import { handleRocketLeagueSession } from "../../../services/rl/session.js";

export async function onRequest(context) {
  return handleRocketLeagueSession(context.request, context.env);
}
