// No repository caller or supported payload contract remains. Do not forward
// arbitrary input or upstream responses through this legacy route.
export function onRequest({ request }) {
  return Response.json({ success: false, code: "OCR_TRACKING_RETIRED" }, {
    status: request.method === "POST" ? 410 : 405,
    headers: { "Cache-Control": "no-store", Allow: "POST" }
  });
}
