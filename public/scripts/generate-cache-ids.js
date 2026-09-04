"use strict";

import {
    randomInt
} from "node:crypto";

import {
    writeFile
} from "node:fs/promises";

import {
    dirname,
    resolve
} from "node:path";

import {
    fileURLToPath
} from "node:url";

/* =========================================================
   CONFIGURATION
   ========================================================= */

const CURRENT_FILE =
    fileURLToPath(
        import.meta.url
    );

const CURRENT_DIRECTORY =
    dirname(
        CURRENT_FILE
    );

const OUTPUT_FILE =
    resolve(
        CURRENT_DIRECTORY,
        "cacheHandler.js"
    );

const CACHE_ID_LENGTH =
    10;

const CACHE_LETTERS =
    "ABCDEFGHJKLMNPQRSTUVWXYZ";

const CACHE_NUMBERS =
    "23456789";

const CACHE_CHARACTERS =
    CACHE_LETTERS +
    CACHE_NUMBERS;

/* =========================================================
   RANDOM HELPERS
   ========================================================= */

function getRandomCharacter(
    characters
) {
    return characters[
        randomInt(
            0,
            characters.length
        )
    ];
}

function shuffleCharacters(
    characters
) {
    const values =
        Array.from(
            characters
        );

    for (
        let index =
            values.length - 1;
        index > 0;
        index -= 1
    ) {
        const randomIndex =
            randomInt(
                0,
                index + 1
            );

        [
            values[index],
            values[randomIndex]
        ] = [
            values[randomIndex],
            values[index]
        ];
    }

    return values.join(
        ""
    );
}

/* =========================================================
   CACHE ID
   ========================================================= */

function createCacheId() {
    const characters = [
        getRandomCharacter(
            CACHE_LETTERS
        ),
        getRandomCharacter(
            CACHE_NUMBERS
        )
    ];

    while (
        characters.length <
        CACHE_ID_LENGTH
    ) {
        characters.push(
            getRandomCharacter(
                CACHE_CHARACTERS
            )
        );
    }

    return shuffleCharacters(
        characters
    );
}

function createUniqueCacheIds() {
    const ocrScriptId =
        createCacheId();

    let appAssetId =
        createCacheId();

    while (
        appAssetId ===
        ocrScriptId
    ) {
        appAssetId =
            createCacheId();
    }

    return {
        ocrScriptId,
        appAssetId
    };
}

/* =========================================================
   OUTPUT
   ========================================================= */

function buildCacheHandler(
    ocrScriptId,
    appAssetId
) {
    return `"use strict";

export const OCR_SCRIPT_ID =
    "${ocrScriptId}";

export const APP_ASSET_ID =
    "${appAssetId}";
`;
}

async function writeCacheHandler() {
    const {
        ocrScriptId,
        appAssetId
    } =
        createUniqueCacheIds();

    const output =
        buildCacheHandler(
            ocrScriptId,
            appAssetId
        );

    await writeFile(
        OUTPUT_FILE,
        output,
        "utf8"
    );

    console.log(
        "[CACHE] Generated cache IDs."
    );

    console.log(
        "[CACHE] OCR_SCRIPT_ID:",
        ocrScriptId
    );

    console.log(
        "[CACHE] APP_ASSET_ID:",
        appAssetId
    );

    console.log(
        "[CACHE] Output:",
        OUTPUT_FILE
    );
}

/* =========================================================
   RUN
   ========================================================= */

await writeCacheHandler();