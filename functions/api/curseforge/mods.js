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
                message:
                    "Invalid game."
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
                            modId,
                            game
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


                errors.push(
                    {
                        modId:
                            modIds[index],

                        message:
                            result.reason?.message ||
                            String(
                                result.reason
                            )
                    }
                );

            }
        );


        return Response.json(
            {
                success:
                    true,

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
    modId,
    game
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


    if (!response.ok) {

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


    const fileName =
        latestFile?.displayName ||
        latestFile?.fileName ||
        null;


    const modVersion =
        game ===
        "minecraft"
            ? extractMinecraftModVersion(
                fileName
            )
            : null;


    const ue5Version =
        game ===
        "ark"
            ? cleanArkVersion(
                fileName
            )
            : null;


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

        modVersion:
            modVersion,

        ue5Version:
            ue5Version,

        fileName:
            fileName,

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


function extractMinecraftModVersion(
    value
) {

    const text =
        String(
            value || ""
        )
            .trim();


    if (!text) {
        return null;
    }


    const match =
        text.match(
            /v?(\d+(?:\.\d+)+)/i
        );


    if (!match) {
        return null;
    }


    return match[1];

}


function cleanArkVersion(
    value
) {

    const text =
        String(
            value || ""
        )
            .trim();


    if (!text) {
        return null;
    }


    const decimalMatch =
        text.match(
            /(\d+(?:\.\d+)+)/
        );


    if (decimalMatch) {
        return decimalMatch[1];
    }


    const trailingNumberMatch =
        text.match(
            /(?:^|[\s_-])(\d+)(?=\.(?:zip|rar|7z)$|[\s_-]*$)/i
        );


    if (trailingNumberMatch) {
        return trailingNumberMatch[1];
    }


    return text;

}