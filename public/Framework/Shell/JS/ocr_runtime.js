"use strict";

/* =========================================================
   BPD GAMING NETWORK
   OCR CLIENT RUNTIME
   ========================================================= */

import {
    initializeOcrResults
} from "./ocr_results.js";

import {
    initializeOcrNotifications,
    restorePendingNotifications
} from "./ocr_notifications.js";

import {
    initializeOcrJobMonitor,
    checkActiveOcrSubmission
} from "./ocr_job_monitor.js";

const OCR_RUNTIME_VERSION =
    "ocr-runtime-1.1";

let OCR_RUNTIME_READY =
    false;

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

    return true;
}