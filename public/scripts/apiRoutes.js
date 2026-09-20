"use strict";

/* =========================================================
BPD GAMING NETWORK
CLIENT ROUTES

File:
    /Global/scripts/apiRoutes.js

Purpose:
    Centralizes browser-callable API routes and shared
    application route constants used by the BPD Gaming
    Network client.

Description:
    - Keeps browser API paths in one location.
    - Keeps commonly reused application/page routes in one
      location.
    - Prevents route strings from being duplicated across
      browser-side JavaScript.
    - Provides consistent route names for authentication,
      account management, Rocket League, OCR, FAQ, health,
      CurseForge, and other client-accessible services.
    - Contains routes intended to be called or navigated to
      by client-side application code.

Important:
    - OAuth callback routes are intentionally not listed here.
    - Provider callbacks are handled by provider/server flows.
    - Provider reauthorization is started through the generic
      provider link route. The server determines whether the
      operation is a new link or a reauthorization.
    - New shared browser-callable routes should be added here
      instead of being hard-coded in individual modules.
========================================================= */

/* =========================================================
APPLICATION ROUTES
========================================================= */

export const BPD_HOME_URL =
    "/";

export const BPD_LOGIN_PAGE_URL =
    "/Login";

export const BPD_ACCOUNT_PAGE_URL =
    "/Account";

/* =========================================================
GLOBAL AUTH
========================================================= */

export const BPD_AUTH_SESSION_URL =
    "/api/auth/session";

export const BPD_AUTH_LOGOUT_URL =
    "/api/auth/logout";

/* =========================================================
ACCOUNT MANAGEMENT
========================================================= */

export const BPD_AUTH_ACCOUNT_PROFILE_URL =
    "/api/auth/account/profile";

export const BPD_AUTH_ACCOUNT_URL =
    "/api/auth/account";

/* =========================================================
PROVIDER LINKING / REAUTHORIZATION
========================================================= */

export const BPD_AUTH_LINK_URL =
    "/api/auth/link";

export const BPD_AUTH_UNLINK_URL =
    "/api/auth/unlink";

/*
 * BPD_AUTH_LINK_URL handles both:
 *
 *     new provider link
 *     existing provider reauthorization
 *
 * The browser supplies the provider and returnTo values.
 * The server determines the correct authorization mode from
 * authoritative provider-link state.
 */

/* =========================================================
GOOGLE AUTH
========================================================= */

export const BPD_AUTH_GOOGLE_LOGIN_URL =
    "/api/auth/google/login";

/* =========================================================
DISCORD AUTH
========================================================= */

export const BPD_AUTH_DISCORD_LOGIN_URL =
    "/api/auth/discord/login";

/* =========================================================
EPIC AUTH
========================================================= */

export const BPD_AUTH_EPIC_LOGIN_URL =
    "/api/auth/epic/login";

/* =========================================================
ROCKET LEAGUE PAGES
========================================================= */

export const ROCKET_LEAGUE_PAGE_URL =
    "/RocketLeague";

export const ROCKET_LEAGUE_PROFILE_PAGE_URL =
    "/RocketLeague/Profile";

export const ROCKET_LEAGUE_WEEKLY_MATCHES_PAGE_URL =
    "/RocketLeague/WeeklyMatches";

export const ROCKET_LEAGUE_MY_MATCHES_PAGE_URL =
    "/RocketLeague/MyMatches";

export const ROCKET_LEAGUE_PRIVATE_MATCHES_PAGE_URL =
    "/RocketLeague/PrivateMatches";

export const ROCKET_LEAGUE_SUBMIT_RESULTS_PAGE_URL =
    "/RocketLeague/SubmitMatchResults";

/* =========================================================
ROCKET LEAGUE AUTH / PROFILE
========================================================= */

export const DISCORD_NOTIFICATION_STATUS_URL =
    "/api/auth/rocketleague/discord-notifications";

export const ROCKET_LEAGUE_SESSION_URL =
    "/api/auth/rocketleague/session";

export const ROCKET_LEAGUE_PROFILE_URL =
    "/api/auth/rocketleague/profile";

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
FAQ
========================================================= */

export const FAQ_API_URL =
    "/api/faq";

export const FAQ_UPVOTE_URL =
    "/api/faq/upvote";

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
export const BPD_AUTH_ACCOUNT_DEACTIVATE_URL = "/api/auth/account/deactivate";
