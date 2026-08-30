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


    try {

        const modIds =
            MODS[game];


        const results =
            await Promise.allSettled(
                modIds.map(
                    modId =>
                        fetchCurseForgeMod(
                            env,
                            modId
                        )
                )
            );

    const mods =
        [];

    const errors =
        [];


    results.forEach(
        (
            result,
            index
        ) => {

            if (
                result.status ===
                "fulfilled"
            ) {

                mods.push(
                    result.value
                );

                return;

            }


            errors.push({
                modId:
                    modIds[index],

                message:
                    result.reason?.message ||
                    "Unknown error"
            });

        }
    );


    return Response.json(
        {
            success: true,

            game:
                game,

            mods:
                mods,

            errors:
                errors
        }
    );

    }
    catch (
        error
    ) {

        console.error(
            "CurseForge mods error:",
            error
        );


        return Response.json(
            {
                success: false,
                message:
                    "Unable to load CurseForge mods."
            },
            {
                status: 500
            }
        );

    }

}


async function fetchCurseForgeMod(
    env,
    modId
) {

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

        throw new Error(
            `CurseForge mod ${modId} returned ${response.status}`
        );

    }


    const result =
        await response.json();


    const mod =
        result.data;


    const latestFile =
        mod.latestFiles?.find(
            file =>
                file.id ===
                mod.mainFileId
        ) ||
        mod.latestFiles?.[0] ||
        null;


    return {
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
            latestFile?.displayName ||
            latestFile?.fileName ||
            null,

        gameVersions:
            latestFile?.gameVersions ||
            [],

        mainFileId:
            mod.mainFileId,

        logo:
            mod.logo,

        links:
            mod.links
    };

}