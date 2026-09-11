import { handleRocketLeagueProfile } from "../../../services/rl/profile.js";

export async function onRequest(context) {
    console.log(
        "[RL PROFILE ROUTE HIT]",
        {
            method:
                context.request.method,

            url:
                context.request.url
        }
    );

    return handleRocketLeagueProfile(
        context.request,
        context.env
    );
}