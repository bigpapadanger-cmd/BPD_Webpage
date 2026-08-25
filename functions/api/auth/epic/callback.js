import {
    handleEpicCallback
} from "../../../services/epic/callback.js";

export async function onRequest(context) {
    const debugId =
        crypto.randomUUID();

    const requestUrl =
        new URL(context.request.url);

    console.info(
        "EPIC CALLBACK ROUTE: Request received.",
        {
            debugId,
            method:
                context.request.method,
            pathname:
                requestUrl.pathname,
            hasCode:
                requestUrl.searchParams.has("code"),
            hasState:
                requestUrl.searchParams.has("state"),
            hasError:
                requestUrl.searchParams.has("error")
        }
    );

    try {
        const response =
            await handleEpicCallback(
                context.request,
                context.env
            );

        console.info(
            "EPIC CALLBACK ROUTE: Request completed.",
            {
                debugId,
                status:
                    response.status,
                location:
                    response.headers.get("location")
            }
        );

        return response;
    } catch (error) {
        console.error(
            "EPIC CALLBACK ROUTE: Unexpected failure.",
            {
                debugId,
                name:
                    error?.name || "Error",
                message:
                    error?.message || "Unknown error",
                stack:
                    error?.stack || null
            }
        );

        return Response.json(
            {
                success: false,
                message:
                    "Epic callback failed unexpectedly.",
                debugId
            },
            {
                status: 500
            }
        );
    }
}