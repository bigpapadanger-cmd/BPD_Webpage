export async function onRequest({ request, env }) {
  const body = await request.text();

  const response = await fetch(env.OCR_TRACKING_URL, {
    method: "POST",
    body,
    headers: { "Content-Type": "application/json" }
  });

  return response;
}
