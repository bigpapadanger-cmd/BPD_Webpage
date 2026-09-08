export async function onRequestPost(context) {
    const { env } = context;

    try {
        const response = await fetch(
            `${env.SUPABASE_URL}/rest/v1/connection_test`,
            {
                method: "POST",
                headers: {
                    "apikey":
                        env.SUPA2CLOUDFLARE_AUTH,
                    "Authorization":
                        `Bearer ${env.SUPA2CLOUDFLARE_AUTH}`,
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

        const responseText =
            await response.text();

        let supabaseResponse;

        try {
            supabaseResponse =
                JSON.parse(
                    responseText
                );
        } catch {
            supabaseResponse =
                responseText;
        }

        if (
            !response.ok
        ) {
            return Response.json(
                {
                    ok: false,
                    source: "supabase",
                    status:
                        response.status,
                    statusText:
                        response.statusText,
                    error:
                        supabaseResponse
                },
                {
                    status:
                        response.status
                }
            );
        }

        return Response.json({
            ok: true,
            source: "supabase",
            status:
                response.status,
            message:
                "Cloudflare successfully wrote to Supabase.",
            supabaseResponse
        });
    } catch (error) {
        return Response.json(
            {
                ok: false,
                source: "cloudflare",
                error:
                    error instanceof Error
                        ? error.message
                        : String(error)
            },
            {
                status: 500
            }
        );
    }
}