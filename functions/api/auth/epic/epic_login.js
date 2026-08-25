import {
    handleEpicLogin
} from "../../../services/epic/login.js";

export async function onRequest(context) {
    const debugId =
        crypto.randomUUID();

    const requestUrl =
        new URL(context.request.url);

    console.info(
        "EPIC LOGIN ROUTE: Request received.",
        {
            debugId,
            method:
                context.request.method,
            pathname:
                requestUrl.pathname
        }
    );

    try {
        const response =
            await handleEpicLogin(
                context.request,
                context.env
            );

        console.info(
            "EPIC LOGIN ROUTE: Request completed.",
            {
                debugId,
                status:
                    response.status,
                hasLocation:
                    response.headers.has(
                        "location"
                    ),
                locationOrigin:
                    getLocationOrigin(
                        response.headers.get(
                            "location"
                        )
                    )
            }
        );

        return response;
    } catch (error) {
        console.error(
            "EPIC LOGIN ROUTE: Unexpected failure.",
            {
                debugId,
                name:
                    error?.name ||
                    "Error",
                message:
                    error?.message ||
                    "Unknown error",
                stack:
                    error?.stack ||
                    null
            }
        );

        return Response.json(
            {
                success: false,
                message:
                    "Epic login failed unexpectedly.",
                debugId
            },
            {
                status: 500
            }
        );
    }
}

function getLocationOrigin(location) {
    if (!location) {
        return null;
    }

    try {
        return new URL(location).origin;
    } catch {
        return "invalid-location";
    }
}