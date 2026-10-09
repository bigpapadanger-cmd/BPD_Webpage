"use strict";
import "./ocr_review_policy.js";

/* =========================================================
   BPD GAMING NETWORK
   OCR CLIENT RUNTIME
   ========================================================= */

import {
    initializeOcrResults,
    openOcrReview
} from "./ocr_results.js";

import {
    initializeOcrNotifications,
    restorePendingNotifications
} from "./ocr_notifications.js";

import {
    initializeOcrJobMonitor,
    checkActiveOcrSubmission
} from "./ocr_job_monitor.js";
import { OCR_JOB_STATUS_URL } from "../../../scripts/apiRoutes.js";
import { apiFetch } from "../../../scripts/apiConnection.js";

const OCR_RUNTIME_VERSION =
    "ocr-runtime-1.1";

let OCR_RUNTIME_READY =
    false;
let OCR_NOTIFICATION_REVIEW_OPENED = "";

const OCR_JOB_ID = /^[A-Z0-9]{16}$/;

/* =========================================================
   INITIALIZE
   ========================================================= */

export function initializeOcrRuntime() {
    if (
        OCR_RUNTIME_READY
    ) {
        return true;
    }

    try {
        /*
         * Register consumers before starting the producer.
         */
        initializeOcrResults();
        initializeOcrNotifications();

        OCR_RUNTIME_READY =
            true;

        /*
         * Monitor starts last because it may emit immediately.
         */
        initializeOcrJobMonitor();

        console.log(
            `[OCR RUNTIME] ${OCR_RUNTIME_VERSION} ready.`
        );

        return true;
    }
    catch (
        error
    ) {
        OCR_RUNTIME_READY =
            false;

        console.error(
            "[OCR RUNTIME] Initialization failed.",
            error
        );

        return false;
    }
}

/* =========================================================
   RESUME
   ========================================================= */

export function resumeOcrRuntime() {
    if (
        !OCR_RUNTIME_READY
    ) {
        if (
            !initializeOcrRuntime()
        ) {
            return false;
        }
    }

    restorePendingNotifications();
    checkActiveOcrSubmission();
    void openNotificationReview();

    return true;
}

async function openNotificationReview() {
    const requestedJobId = new URL(window.location.href).searchParams.get("jobId")?.trim().toUpperCase() || "";
    if (!OCR_JOB_ID.test(requestedJobId) || requestedJobId === OCR_NOTIFICATION_REVIEW_OPENED) return;
    OCR_NOTIFICATION_REVIEW_OPENED = requestedJobId;
    const url = new URL(OCR_JOB_STATUS_URL, window.location.origin);
    url.searchParams.set("jobId", requestedJobId);
    try {
        const response = await apiFetch(url.pathname + url.search, {
            method: "GET", credentials: "same-origin", cache: "no-store",
            headers: { Accept: "application/json" }
        });
        const body = await response.json().catch(() => null);
        const job = body?.job;
        if (!response.ok || body?.success !== true || job?.reviewRequired !== true) {
            throw new Error("review_unavailable");
        }
        const matchId = String(job?.matchId || "").trim().toUpperCase();
        if (!OCR_JOB_ID.test(matchId)) {
            // The owner-checked job exists, but OCR did not create a real
            // scoreboard report. Reopen that honest review state and invite
            // the owner to submit a clearer image; never invent a match ID.
            const status = document.getElementById("status");
            if (status) status.textContent = "This scoreboard needs another look, but OCR could not create a reviewable result. Upload a clearer screenshot with the player rows and scores visible to continue.";
            document.getElementById("imageInput")?.focus();
            return;
        }
        await openOcrReview({ matchId });
    } catch {
        const status = document.getElementById("status");
        if (status) status.textContent = "This scoreboard review could not be loaded. Sign in with the account that submitted it and try again.";
    }
}
