export async function onRequestPost(context) {
    const { request, env } = context;
    if (!env.OCR_API_URL) {
        return jsonResponse({
            success: false,
            message: "OCR_API_URL is not configured."
        }, 500);
    }
    if (!env.OCR_API_TEST_URL) {
        return jsonResponse({
            success: false,
            message: "OCR_API_TEST_URL is not configured."
        }, 500);
    }
    if (!env.OCR_API_KEY) {
        return jsonResponse({
            success: false,
            message: "OCR_API_KEY is not configured."
        }, 500);
    }
    let incomingForm;
    try {
        incomingForm = await request.formData();
    } catch {
        return jsonResponse({
            success: false,
            message: "Invalid multipart form data."
        }, 400);
    }
    const file = incomingForm.get("file");
    if (!(file instanceof File)) {
        return jsonResponse({
            success: false,
            message: "Missing OCR image."
        }, 400);
    }
    const imageBytes = await file.arrayBuffer();
    const productionForm = buildOcrForm(
        incomingForm,
        file,
        imageBytes
    );
    const testForm = buildOcrForm(
        incomingForm,
        file,
        imageBytes
    );
    const productionStarted = performance.now();
    const productionPromise = fetch(
        env.OCR_API_URL,
        {
            method: "POST",
            headers: {
                "X-API-Key": env.OCR_API_KEY,
                "X-BPD-OCR-Benchmark-Target": "production"
            },
            body: productionForm
        }
    ).then(async response => {
        const finished = performance.now();
        return {
            httpStatus: response.status,
            fetchSeconds: roundSeconds(
                finished - productionStarted
            ),
            result: await parseJsonResponse(response)
        };
    });
    const testStarted = performance.now();
    const testPromise = fetch(
        env.OCR_API_TEST_URL,
        {
            method: "POST",
            headers: {
                "X-API-Key": env.OCR_API_KEY,
                "X-BPD-OCR-Benchmark-Target": "variant-a"
            },
            body: testForm
        }
    ).then(async response => {
        const finished = performance.now();
        return {
            httpStatus: response.status,
            fetchSeconds: roundSeconds(
                finished - testStarted
            ),
            result: await parseJsonResponse(response)
        };
    });
    const [
        production,
        variantA
    ] = await Promise.all([
        productionPromise,
        testPromise
    ]);
    return jsonResponse({
        success: true,
        comparison: {
            production,
            variantA
        }
    });
}

function buildOcrForm(
    sourceForm,
    originalFile,
    imageBytes
) {
    const form = new FormData();
    const copiedFile = new File(
        [imageBytes],
        originalFile.name || "scoreboard.png",
        {
            type:
                originalFile.type
                || "image/png"
        }
    );
    form.append(
        "file",
        copiedFile
    );
    for (const [key, value] of sourceForm.entries()) {
        if (key === "file") {
            continue;
        }
        if (typeof value === "string") {
            form.append(
                key,
                value
            );
        }
    }
    return form;
}

async function parseJsonResponse(
    response
) {
    const text = await response.text();
    try {
        return JSON.parse(
            text
        );
    } catch {
        return {
            success: false,
            rawResponse: text
        };
    }
}

function roundSeconds(
    milliseconds
) {
    return Number(
        (
            milliseconds
            / 1000
        ).toFixed(
            4
        )
    );
}

function jsonResponse(
    body,
    status = 200
) {
    return new Response(
        JSON.stringify(
            body
        ),
        {
            status,
            headers: {
                "Content-Type":
                    "application/json"
            }
        }
    );
}