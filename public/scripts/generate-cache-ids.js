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

const CURRENT_FILE =
    fileURLToPath(
        import.meta.url
    );

const CURRENT_DIRECTORY =
    dirname(
        CURRENT_FILE
    );

const PROJECT_ROOT =
    resolve(
        CURRENT_DIRECTORY,
        ".."
    );

const OUTPUT_FILE =
    resolve(
        PROJECT_ROOT,
        "public",
        "scripts",
        "cacheHandler.js"
    );

const CACHE_ID_CHARACTERS =
    "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const CACHE_ID_LENGTH =
    10;

function createCacheId() {
    let value =
        "";

    for (
        let index = 0;
        index < CACHE_ID_LENGTH;
        index += 1
    ) {
        value +=
            CACHE_ID_CHARACTERS[
                randomInt(
                    0,
                    CACHE_ID_CHARACTERS.length
                )
            ];
    }

    return value;
}

const OCR_SCRIPT_ID =
    createCacheId();

let APP_ASSET_ID =
    createCacheId();

while (
    APP_ASSET_ID ===
    OCR_SCRIPT_ID
) {
    APP_ASSET_ID =
        createCacheId();
}

const output = `"use strict";

export const OCR_SCRIPT_ID =
    "${OCR_SCRIPT_ID}";

export const APP_ASSET_ID =
    "${APP_ASSET_ID}";
`;

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
    OCR_SCRIPT_ID
);

console.log(
    "[CACHE] APP_ASSET_ID:",
    APP_ASSET_ID
);