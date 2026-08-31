"use strict";

import {
    handleOcrConfirmation
} from "../../services/ocr/confirm.js";


export async function onRequest(
    context
){
    return handleOcrConfirmation(
        context
    );
}