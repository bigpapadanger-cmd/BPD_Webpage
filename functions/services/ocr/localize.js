export async function handleOCRLocalize(request, env) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!file) {
      return new Response(
        JSON.stringify({ error: "Missing file upload" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const buffer = await file.arrayBuffer();

    // Call your localization API (bounding boxes, text regions, etc.)
    const localizeResponse = await fetch(env.OCR_LOCALIZE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "x-api-key": env.OCR_API_KEY
      },
      body: buffer
    });

    if (!localizeResponse.ok) {
      return new Response(
        JSON.stringify({ error: "Localization provider failed" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const result = await localizeResponse.json();

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Localization failed", details: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
