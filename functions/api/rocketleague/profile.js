import { handleRocketLeagueProfile } from "../../rocketleague/profile.js";

export async function onRequest(context) {
  return handleRocketLeagueProfile(context.request, context.env);
}
