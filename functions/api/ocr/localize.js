import { handleOCRLocalize } from "../../../ocr/localize.js";

export async function onRequest(context) {
  return handleOCRLocalize(context.request, context.env);
}
