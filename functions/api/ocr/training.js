import {
    handleOCRTrainingUpload
} from "../../services/ocr/training.js";


export async function onRequest(
    context
) {
    return handleOCRTrainingUpload(
        context.request,
        context.env
    );
}