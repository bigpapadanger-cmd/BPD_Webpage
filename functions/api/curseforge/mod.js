export async function onRequestGet(context) {
    const {
        request,
        env,
        params
    } = context;

    const modId =
        params.id;

    if (
        !modId ||
        !/^\d+$/.test(modId)
    ) {
        return Response.json(
            {
                success: false,
                message: "Invalid mod ID."
            },
            {
                status: 400
            }
        );
    }

    try {
        const response =
            await fetch(
                `https://api.curseforge.com/v1/mods/${modId}`,
                {
                    headers: {
                        "x-api-key":
                            env.CURSEFORGE_API_KEY
                    }
                }
            );

        if (
            !response.ok
        ) {
            return Response.json(
                {
                    success: false,
                    message:
                        "CurseForge request failed.",
                    status:
                        response.status
                },
                {
                    status: response.status
                }
            );
        }

        const result =
            await response.json();

        const mod =
            result.data;

        return Response.json(
            {
                success: true,

                id:
                    mod.id,

                name:
                    mod.name,

                slug:
                    mod.slug,

                summary:
                    mod.summary,

                downloads:
                    mod.downloadCount,

                lastUpdated:
                    mod.dateModified,

                mainFileId:
                    mod.mainFileId,

                latestFiles:
                    mod.latestFiles,

                logo:
                    mod.logo,

                links:
                    mod.links
            }
        );
    }
    catch (
        error
    ) {
        return Response.json(
            {
                success: false,
                message:
                    "Unable to contact CurseForge."
            },
            {
                status: 500
            }
        );
    }
}