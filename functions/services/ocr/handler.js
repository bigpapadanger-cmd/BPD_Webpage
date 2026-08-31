// ============================================================
// BPD GAMING NETWORK
// OCR REQUEST HANDLER
// ============================================================
import {
    getStoredSession
} from "../common_helpers/reload_sessions.js";
const OCR_HANDLER_VERSION =
    "ocr-handler-2.0";

async function createOwnerHash(
    epicUniqueId,
    secret
) {
    const encoder = new TextEncoder();

    const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(
            String(
                secret
            )
        ),
        {
            name:
                "HMAC",

            hash:
                "SHA-256"
        },
        false,
        [
            "sign"
        ]
    );

    const signature = await crypto.subtle.sign(
        "HMAC",
        key,
        encoder.encode(
            String(
                epicUniqueId
            )
        )
    );

    return Array.from(
        new Uint8Array(
            signature
        )
    )
        .map(
            function(
                byte
            ) {
                return byte
                    .toString(
                        16
                    )
                    .padStart(
                        2,
                        "0"
                    );
            }
        )
        .join(
            ""
        );
}
// ============================================================
// JSON RESPONSE
// ============================================================

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
                    "application/json",

                "Cache-Control":
                    "no-store"
            }
        }
    );
}


// ============================================================
// MAIN OCR REQUEST
// ============================================================

export async function handleOCRRequest(
    request,
    env
) {
    try {

        /* ====================================================
           METHOD
           ==================================================== */

        if (
            request.method
            !== "POST"
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    error:
                        "Method not allowed."
                },
                405
            );
        }


        /* ====================================================
           CONFIGURATION
           ==================================================== */

        if (
            !env.OCR_API_URL
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    error:
                        "OCR API URL is not configured."
                },
                503
            );
        }

        if (
            !env.OCR_API_KEY
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    error:
                        "OCR API authentication is not configured."
                },
                503
            );
        }

        if (
            !env.OCR_OWNER_SECRET
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    error:
                        "OCR owner hashing is not configured."
                },
                503
            );
        }


        /* ====================================================
           REQUEST CONTENT TYPE
           ==================================================== */

        const contentType =
            String(
                request.headers.get(
                    "Content-Type"
                )
                || ""
            );

        if (
            !contentType
                .toLowerCase()
                .includes(
                    "multipart/form-data"
                )
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    error:
                        "OCR requests must use multipart/form-data."
                },
                400
            );
        }


        /* ====================================================
           AUTHENTICATED SESSION
           ==================================================== */

        const session =
            await getStoredSession(
                request,
                env
            );

        if (
            !session
            || !session.sessionData
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    message:
                        "Authentication required."
                },
                401
            );
        }

        const epicUniqueId =
            String(
                session
                    .sessionData
                    .EpicUniqueId
                || ""
            ).trim();

        if (
            !epicUniqueId
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    message:
                        "Authenticated account is missing an EpicUniqueId."
                },
                401
            );
        }


        /* ====================================================
           CREATE MASKED OWNER ID
           ==================================================== */

        const ownerSecret =
            String(
                env.OCR_OWNER_SECRET
                || ""
            ).trim();

        if (
            !ownerSecret
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    message:
                        "OCR owner hashing is not configured."
                },
                503
            );
        }

        const submittedBy =
            await createOwnerHash(
                epicUniqueId,
                ownerSecret
            );


        /* ====================================================
           PARSE MULTIPART FORM

           The request is intentionally rebuilt as FormData so
           Cloudflare can inject trusted server-side fields
           before forwarding it to Cloud Run.
           ==================================================== */

        const formData =
            await request.formData();


        /* ====================================================
           VALIDATE IMAGE
           ==================================================== */

        const file =
            formData.get(
                "file"
            )
            || formData.get(
                "image"
            );

        if (
            !file
            || typeof file.arrayBuffer
                !== "function"
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    error:
                        "Missing file upload."
                },
                400
            );
        }

        if (
            file.size !== undefined
            && file.size <= 0
        ) {
            return jsonResponse(
                {
                    success:
                        false,

                    error:
                        "Uploaded image is empty."
                },
                400
            );
        }


        /* ====================================================
           FORCE SERVER-DERIVED OWNER

           set() replaces any browser-supplied submittedBy.
           The client is never trusted to provide ownership.
           ==================================================== */

        formData.set(
            "submittedBy",
            submittedBy
        );


        /* ====================================================
           FORWARD TO CLOUD RUN

           Do NOT manually set Content-Type here.
           When FormData is used, fetch generates the correct
           multipart boundary automatically.
           ==================================================== */

        const upstreamHeaders =
            new Headers();

        upstreamHeaders.set(
            "X-API-Key",
            env.OCR_API_KEY
        );

        upstreamHeaders.set(
            "X-BPD-OCR-Handler-Version",
            OCR_HANDLER_VERSION
        );

        const ocrResponse =
            await fetch(
                env.OCR_API_URL,
                {
                    method:
                        "POST",

                    headers:
                        upstreamHeaders,

                    body:
                        formData
                }
            );


        /* ====================================================
           READ UPSTREAM RESPONSE
           ==================================================== */

        const responseContentType =
            String(
                ocrResponse.headers.get(
                    "Content-Type"
                )
                || ""
            );

        let result;

        if (
            responseContentType
                .toLowerCase()
                .includes(
                    "application/json"
                )
        ) {
            try {
                result =
                    await ocrResponse.json();

            } catch {
                result = {
                    success:
                        false,

                    error:
                        "OCR provider returned invalid JSON."
                };
            }

        } else {
            const text =
                await ocrResponse.text();

            result = {
                success:
                    ocrResponse.ok,

                message:
                    (
                        text
                        || (
                            ocrResponse.ok
                                ? "OCR request completed."
                                : "OCR provider failed."
                        )
                    )
            };
        }


        /* ====================================================
           PRESERVE PROVIDER STATUS
           ==================================================== */

        return jsonResponse(
            {
                ...(
                    typeof result
                        === "object"
                    && result !== null
                        ? result
                        : {
                            result:
                                result
                        }
                ),

                handlerVersion:
                    OCR_HANDLER_VERSION
            },
            ocrResponse.status
        );

    } catch (
        error
    ) {
        return jsonResponse(
            {
                success:
                    false,

                error:
                    "OCR request failed.",

                details:
                    String(
                        error?.message
                        || error
                    ),

                handlerVersion:
                    OCR_HANDLER_VERSION
            },
            500
        );
    }
}