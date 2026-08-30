const MODS = {
    ark: [
        1103705,
        980486,
        1067188
    ],

    minecraft: [
        1289031,
        1548453,
        1541785,
        1511421,
        1225894,
        1572622,
        1518330,
        1535188,
        1521346,
        1547536,
        1512650,
        1258974

    ]
};


export async function onRequestGet(
    context
) {

    const {
        request,
        env
    } = context;


    const url =
        new URL(
            request.url
        );


    const game =
        String(
            url.searchParams.get(
                "game"
            ) || ""
        )
            .trim()
            .toLowerCase();


    const modId =
        String(
            url.searchParams.get(
                "id"
            ) || ""
        )
            .trim();


    if (
        !Object.prototype.hasOwnProperty.call(
            MODS,
            game
        )
    ) {

        return Response.json(
            {
                success: false,
                message: "Invalid game."
            },
            {
                status: 400
            }
        );

    }


    if (
        !/^\d+$/.test(
            modId
        )
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


    const numericModId =
        Number(
            modId
        );


    if (
        !MODS[game].includes(
            numericModId
        )
    ) {

        return Response.json(
            {
                success: false,
                message:
                    "This mod is not approved for this game."
            },
            {
                status: 403
            }
        );

    }


    try {

        const response =
            await fetch(
                `https://api.curseforge.com/v1/mods/${numericModId}`,
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
                    status:
                        response.status
                }
            );

        }


        const result =
            await response.json();


        const mod =
            result.data;


        const latestFile =
            mod.latestFiles?.find(
                function(file) {

                    return (
                        file.id ===
                        mod.mainFileId
                    );

                }
            ) ||
            mod.latestFiles?.[0] ||
            null;


        return Response.json(
            {
                success: true,

                game:
                    game,

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

                version:
                    latestFile
                        ?.displayName ||
                    latestFile
                        ?.fileName ||
                    null,

                gameVersions:
                    latestFile
                        ?.gameVersions ||
                    [],

                mainFileId:
                    mod.mainFileId,

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

        console.error(
            "CurseForge API error:",
            error
        );


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