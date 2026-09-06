"use strict";

(function() {

/* =========================================================
   BPD GAMING NETWORK
   OCR REVIEW POLICY
   ========================================================= */

const OCR_RESULT_EDITS_LOCKED =
    false;

const OCR_REVIEW_TIME_ZONE =
    "America/New_York";

/* =========================================================
   NORMALIZATION
   ========================================================= */

function normalizeDeadline(
    value
) {
    const normalized =
        String(
            value
            || ""
        )
            .trim();

    if (
        !normalized
    ) {
        return null;
    }

    const timestamp =
        Date.parse(
            normalized
        );

    return Number.isFinite(
        timestamp
    )
        ? timestamp
        : null;
}

/* =========================================================
   GLOBAL LOCK
   ========================================================= */

function areOcrResultEditsGloballyLocked() {
    return (
        OCR_RESULT_EDITS_LOCKED ===
        true
    );
}

/* =========================================================
   DEADLINE
   ========================================================= */

function isEditDeadlineExpired(
    editDeadlineAt
) {
    const deadlineMs =
        normalizeDeadline(
            editDeadlineAt
        );

    if (
        deadlineMs ===
        null
    ) {
        return true;
    }

    return (
        Date.now() >=
        deadlineMs
    );
}

/* =========================================================
   POLICY
   ========================================================= */

function areOcrResultEditsLocked(
    editDeadlineAt = null
) {
    if (
        areOcrResultEditsGloballyLocked()
    ) {
        return true;
    }

    return isEditDeadlineExpired(
        editDeadlineAt
    );
}

function canModifyOcrResult(
    editDeadlineAt = null
) {
    return !areOcrResultEditsLocked(
        editDeadlineAt
    );
}

/* =========================================================
   DEADLINE DISPLAY
   ========================================================= */

function formatEditDeadline(
    editDeadlineAt
) {
    const deadlineMs =
        normalizeDeadline(
            editDeadlineAt
        );

    if (
        deadlineMs ===
        null
    ) {
        return "";
    }

    try {
        return new Intl.DateTimeFormat(
            "en-US",
            {
                timeZone:
                    OCR_REVIEW_TIME_ZONE,

                weekday:
                    "long",

                month:
                    "long",

                day:
                    "numeric",

                year:
                    "numeric",

                hour:
                    "numeric",

                minute:
                    "2-digit",

                timeZoneName:
                    "short"
            }
        ).format(
            new Date(
                deadlineMs
            )
        );
    }
    catch {
        return "";
    }
}

/* =========================================================
   POLICY STATE
   ========================================================= */

function getOcrReviewPolicyState(
    editDeadlineAt = null
) {
    const deadlineMs =
        normalizeDeadline(
            editDeadlineAt
        );

    const globallyLocked =
        areOcrResultEditsGloballyLocked();

    const deadlineExpired = (
        deadlineMs ===
            null
            ? true
            : Date.now() >=
                deadlineMs
    );

    const locked = (
        globallyLocked
        || deadlineExpired
    );

    return {
        locked,

        canModify:
            !locked,

        globallyLocked,

        deadlineExpired,

        editDeadlineAt:
            deadlineMs ===
                null
                ? null
                : new Date(
                    deadlineMs
                ).toISOString(),

        editDeadlineDisplay:
            deadlineMs ===
                null
                ? ""
                : formatEditDeadline(
                    editDeadlineAt
                )
    };
}

/* =========================================================
   PUBLIC API
   ========================================================= */

window.OCRReviewPolicy =
    Object.freeze({
        areEditsLocked:
            areOcrResultEditsLocked,

        areEditsGloballyLocked:
            areOcrResultEditsGloballyLocked,

        canModify:
            canModifyOcrResult,

        isDeadlineExpired:
            isEditDeadlineExpired,

        formatDeadline:
            formatEditDeadline,

        getState:
            getOcrReviewPolicyState
    });

window.initializeOcrReviewPolicy =
    function() {
        return true;
    };

})();