"use strict";

/* =========================================================
BPD GAMING NETWORK
OCR CONFIRMATION API ROUTE

File:
    functions/api/ocr/confirm.js

Public Route:
    POST /api/ocr/confirm

Service:
    functions/services/ocr/confirm.js

Purpose:
    Thin API wrapper for OCR result confirmation and adjustment.

Description:
    - Delegates all request handling to the OCR confirmation service.
    - Contains no authentication, ownership, or storage logic.
========================================================= */

import {
    handleOcrConfirmation
} from "../../services/ocr/confirm.js";

export async function onRequest(
    context
) {
    return handleOcrConfirmation(
        context
    );
}