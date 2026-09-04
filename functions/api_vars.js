//      import {
//          requireApiConnection
//      } from "/scripts/apiConnection.js";

//THE ABOVE IS REQUIRED FOR ANY API CALLS FROM CLIENT

export const EPIC_AUTHORIZE_URL =
    "https://www.epicgames.com/id/authorize";
export const EPIC_TOKEN_URL =
    "https://api.epicgames.dev/epic/oauth/v2/token";
export const EPIC_USER_INFO_URL =
    "https://api.epicgames.dev/epic/oauth/v2/userInfo";
export const ROCKET_LEAGUE_PROFILE_API_URL =
    "https://api.tracker.gg/api/v2/rocket-league/standard/profile";
export const EPIC_REDIRECT_URI = "https://bpd-gaming-network.com/api/auth/epic/callback";

export const AUTH_STATE_COOKIE = "bpd_epic_state";
export const AUTH_SESSION_COOKIE = "bpd_session";
export const AUTH_STATE_MAX_AGE_SECONDS = 600;
export const AUTH_SESSION_KEY_PREFIX = "session:";
export const SESSION_IDLE_DURATION_DAYS =
    10;

export const SESSION_ABSOLUTE_DURATION_DAYS =
    28;

export const SESSION_IDLE_TTL_SECONDS =
    SESSION_IDLE_DURATION_DAYS *
    24 *
    60 *
    60;

export const SESSION_ABSOLUTE_TTL_SECONDS =
    SESSION_ABSOLUTE_DURATION_DAYS *
    24 *
    60 *
    60;

const SESSION_REFRESH_INTERVAL_MS =
    5
    * 24
    * 60
    * 60
    * 1000;