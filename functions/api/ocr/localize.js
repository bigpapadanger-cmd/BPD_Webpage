import { handleOCRLocalize } from "../../services/ocr/localize.js";

export async function onRequest(context) {
  return handleOCRLocalize(context.request, context.env);
}
