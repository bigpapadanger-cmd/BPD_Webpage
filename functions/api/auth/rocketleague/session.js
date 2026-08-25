import { handleRocketLeagueSession } from "../../../services/rocketleague/session.js";

export async function onRequest(context) {
  return handleRocketLeagueSession(context.request, context.env);
}
