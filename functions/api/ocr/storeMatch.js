import {
    handleStoreMatch
} from "../../services/ocr/storeMatch.js";


export async function onRequest(
    context
) {
    return handleStoreMatch(
        context.request,
        context.env
    );
}