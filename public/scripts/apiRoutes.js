"use strict";

/* =========================================================
BPD GAMING NETWORK
CLIENT API ROUTES

Purpose:
    Centralizes browser-callable API route constants used by
    the BPD Gaming Network client.

Description:
    - Keeps client API paths in one location.
    - Prevents route strings from being duplicated throughout
      browser-side JavaScript.
    - Contains only routes intended to be called or navigated
      to by client-side application code.

Important:
    - OAuth callback routes are intentionally not listed here.
    - Provider callbacks are handled by the authentication
      providers/server flow rather than application code.
========================================================= */

/* =========================================================
OCR
========================================================= */

export const OCR_API_URL =
    "/api/ocr";

export const OCR_LOCALIZE_URL =
    "/api/ocr/localize";

export const OCR_TRACKING_URL =
    "/api/ocr/localTracking";

export const OCR_JOB_SUBMIT_URL =
    "/api/ocr/jobs/submit_job";

export const OCR_JOB_RESULT_URL =
    "/api/ocr/jobs/get_result";

export const OCR_JOB_STATUS_URL =
    "/api/ocr/jobs/get_job";

export const OCR_CONFIRM_URL =
    "/api/ocr/confirm";

/* =========================================================
GLOBAL AUTH
========================================================= */

export const BPD_AUTH_SESSION_URL =
    "/api/auth/session";

export const BPD_AUTH_LOGOUT_URL =
    "/api/auth/logout";

export const BPD_AUTH_LINK_URL =
    "/api/auth/link";

export const BPD_AUTH_UNLINK_URL =
    "/api/auth/unlink";

/* =========================================================
GOOGLE AUTH
========================================================= */

export const GOOGLE_LOGIN_URL =
    "/api/auth/google/login";

/* =========================================================
EPIC AUTH
========================================================= */

export const EPIC_LOGIN_URL =
    "/api/auth/epic/login";

/* =========================================================
ROCKET LEAGUE
========================================================= */

export const ROCKET_LEAGUE_SESSION_URL =
    "/api/auth/rocketleague/session";

export const ROCKET_LEAGUE_PROFILE_URL =
    "/api/auth/rocketleague/profile";

/* =========================================================
HEALTH
========================================================= */

export const API_HEALTH_URL =
    "/api/health/apihealth";

/* =========================================================
CURSEFORGE
========================================================= */

export const CF_MOD_LIST_API =
    "/api/curseforge/mods";