export async function handleOCRRequest(request, env) {
  try {
    // Expecting multipart/form-data with an image file
    const formData = await request.formData();
    const file = formData.get("file");

    if (!file) {
      return new Response(
        JSON.stringify({ error: "Missing file upload" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Convert file to ArrayBuffer for sending to your OCR provider
    const buffer = await file.arrayBuffer();

    // Call your OCR provider (Google Vision, Tesseract API, etc.)
    const ocrResponse = await fetch(env.OCR_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "x-api-key": env.OCR_API_KEY
      },
      body: buffer
    });

    if (!ocrResponse.ok) {
      return new Response(
        JSON.stringify({ error: "OCR provider failed" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const result = await ocrResponse.json();

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    return new Response(
      JSON.stringify({ error: "OCR request failed", details: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
