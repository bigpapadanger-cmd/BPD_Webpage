export const OCR_API_PREFIX = "/api/ocr";
export const EPIC_AUTHORIZE_URL =
    "https://www.epicgames.com/id/authorize";
export const EPIC_TOKEN_URL =
    "https://api.epicgames.dev/epic/oauth/v2/token";
export const EPIC_USER_INFO_URL =
    "https://api.epicgames.dev/epic/oauth/v2/userInfo";
export const ROCKET_LEAGUE_PROFILE_API_URL =
    "https://api.tracker.gg/api/v2/rocket-league/standard/profile";
export const AUTH_STATE_COOKIE = "bpd_epic_state";
export const AUTH_SESSION_COOKIE = "bpd_session";
export const AUTH_STATE_MAX_AGE_SECONDS = 600;
export const AUTH_SESSION_KEY_PREFIX = "session:";
const SESSION_DURATION_HOURS = 24; // change this anytime
export const ttlSeconds = SESSION_DURATION_HOURS * 3600;
