import {
    handleLogout
} from "../../../services/epic/logout.js";

export async function onRequestPost(
    context
) {
    return handleLogout(
        context.request,
        context.env
    );
}

export function onRequestGet() {
    return Response.json(
        {
            success: false,
            message:
                "Logout requires a POST request."
        },
        {
            status: 405,
            headers: {
                "Allow": "POST"
            }
        }
    );
}