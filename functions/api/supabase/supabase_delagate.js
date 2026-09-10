export async function onRequestGet(
    context
) {
    const url =
        new URL(
            context.request.url
        );

    const action =
        url.searchParams.get(
            "action"
        );

    switch (
        action
    ) {
        default:
            return Response.json(
                {
                    ok: false,
                    error:
                        "Unknown GET action."
                },
                {
                    status: 400
                }
            );
    }
}

export async function onRequestPost(
    context
) {
    let body;

    try {
        body =
            await context.request.json();
    } catch {
        return Response.json(
            {
                ok: false,
                error:
                    "Invalid JSON body."
            },
            {
                status: 400
            }
        );
    }

    switch (
        body.action
    ) {
        default:
            return Response.json(
                {
                    ok: false,
                    error:
                        "Unknown POST action."
                },
                {
                    status: 400
                }
            );
    }
}