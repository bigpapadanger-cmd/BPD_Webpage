import { handleRocketLeagueProfile } from "../../../services/rocketleague/profile.js";

export async function onRequest(context) {
  return handleRocketLeagueProfile(context.request, context.env);
}
