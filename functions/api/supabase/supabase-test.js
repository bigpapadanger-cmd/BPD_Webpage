export async function onRequestPost(context) {
    const { env } = context;

    try {
        const response = await fetch(
            `${env.SUBABASE_URL}connection_test`,
            {
                method: "POST",
                headers: {
                    "apikey":
                        env.SUPABASE_AUTH,
                    "Content-Type":
                        "application/json",
                    "Prefer":
                        "return=representation"
                },
                body: JSON.stringify({
                    message:
                        "Cloudflare connected successfully"
                })
            }
        );

        const text =
            await response.text();

        return Response.json({
            ok:
                response.ok,
            status:
                response.status,
            statusText:
                response.statusText,
            response:
                text
        });
    } catch (error) {
        return Response.json({
            ok: false,
            error:
                error instanceof Error
                    ? error.message
                    : String(error),
            hasUrl:
                Boolean(
                    env.SUBABASE_URL
                ),
            hasSecret:
                Boolean(
                    env.SUPABASE_AUTH
                )
        });
    }
}