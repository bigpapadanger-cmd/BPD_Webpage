//      import {
//          requireApiConnection
//      } from "/scripts/apiConnection.js";

//THE ABOVE IS REQUIRED FOR ANY API CALLS FROM CLIENT

export const EPIC_AUTHORIZE_URL ="https://www.epicgames.com/id/authorize";
export const EPIC_TOKEN_URL ="https://api.epicgames.dev/epic/oauth/v2/token";
export const EPIC_USER_INFO_URL ="https://api.epicgames.dev/epic/oauth/v2/userInfo";
export const ROCKET_LEAGUE_PROFILE_API_URL ="https://api.tracker.gg/api/v2/rocket-league/standard/profile";
export const EPIC_REDIRECT_URI = "https://bpd-gaming-network.com/api/auth/epic/callback";
export const OAUTH_RETURN_URL ="https://bpd-gaming-network.com/api/auth/_oauth/callback";
export const SUPABASE_OAUTH_AUTHORIZE_URL =new URL("https://xslrwamnfqgoziaczgsn.supabase.co/auth/v1/authorize");
export const TURNSTILE_VERIFY_URL ="https://challenges.cloudflare.com/turnstile/v0/siteverify";

export const OAUTH_MODE_COOKIE ="bpd_oauth_mode";
export const OAUTH_PROVIDER_COOKIE ="bpd_oauth_provider";
export const OAUTH_PKCE_COOKIE ="bpd_oauth_pkce";
export const OAUTH_RETURN_COOKIE = "bpd_oauth_return";
export const OAUTH_COOKIE_MAX_AGE_SECONDS =300;
export const OAUTH_ACCOUNT_COOKIE ="bpd_oauth_account";
export const OAUTH_STATE_COOKIE ="bpd_oauth_state";

export const AUTH_STATE_COOKIE = "bpd_epic_state";
export const AUTH_SESSION_COOKIE = "bpd_session";
export const AUTH_STATE_MAX_AGE_SECONDS = 300;
export const AUTH_SESSION_KEY_PREFIX = "session:";

export const SESSION_IDLE_DURATION_DAYS =10;
export const SESSION_ABSOLUTE_DURATION_DAYS =28;
export const SESSION_IDLE_TTL_SECONDS =SESSION_IDLE_DURATION_DAYS *24 *60 *60;
export const SESSION_ABSOLUTE_TTL_SECONDS =SESSION_ABSOLUTE_DURATION_DAYS *24 *60 *60;
export const SESSION_REFRESH_INTERVAL_MS =5* 24* 60* 60* 1000;