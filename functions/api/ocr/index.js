import { handleOCRRequest } from "../../../ocr/handler.js";

export async function onRequest(context) {
  return handleOCRRequest(context.request, context.env);
}
