import { handleRocketLeagueProfile } from "../../../services/rl/profile.js";

export async function onRequest(context) {
  return handleRocketLeagueProfile(context.request, context.env);
}
