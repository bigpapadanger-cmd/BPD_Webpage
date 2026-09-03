"use strict";

/* =========================================================
   BPD GAMING NETWORK
   OCR REVIEW POLICY
   ========================================================= */

const OCR_RESULT_EDITS_LOCKED =
    false;


/* =========================================================
   POLICY
   ========================================================= */

function areOcrResultEditsLocked() {
    return (
        OCR_RESULT_EDITS_LOCKED
        === true
    );
}


/* =========================================================
   PUBLIC API
   ========================================================= */

window.OCRReviewPolicy =
    Object.freeze({
        areEditsLocked:
            areOcrResultEditsLocked
    });


window.initializeOcrReviewPolicy =
    function() {
        return true;
    };