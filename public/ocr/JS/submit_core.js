"use strict";

/* =========================================================
   BPD GAMING NETWORK
   OCR CLIENT CORE
   ========================================================= */

const OCR_STATE_KEY =
    "rocketLeagueOcrStateV2";

const OCR_HANDLE_SIZE =
    10;

const OCR_MIN_CROP_WIDTH =
    140;

const OCR_MIN_CROP_HEIGHT =
    80;

const OCR_MIN_SOURCE_CROP_WIDTH =
    320;

const OCR_MIN_SOURCE_CROP_HEIGHT =
    120;


/* =========================================================
   CURRENT PAGE ELEMENTS
   ========================================================= */

let imageInput = null;
let matchSize = null;
let resetCropBtn = null;
let submitBtn = null;
let canvas = null;
let emptyState = null;
let statusBox = null;
let results = null;
let resultsSummary = null;
let resultsOutput = null;
let resultsCloseBtn = null;
let canvasWrap = null;
let playerNamesContainer = null;
let ctx = null;


/* =========================================================
   STATE
   ========================================================= */

let sourceImage = null;
let sourceFile = null;
let sourceFileName = "scoreboard.png";

let displayScale = 1;
let ocrControlsLocked = false;
let cropFallbackVisible = false;

let dragMode = null;
let dragStart = null;

let crop = {
    x: 0,
    y: 0,
    width: 0,
    height: 0
};

let OCR_CORE_READY = false;
let ocrCoreWindowEventsBound = false;


/* =========================================================
   DOM
   ========================================================= */

function resolveOcrCoreElements() {
    imageInput =
        document.getElementById(
            "imageInput"
        );

    matchSize =
        document.getElementById(
            "matchSize"
        );

    resetCropBtn =
        document.getElementById(
            "resetCropBtn"
        );

    submitBtn =
        document.getElementById(
            "submitBtn"
        );

    canvas =
        document.getElementById(
            "scoreboardCanvas"
        );

    emptyState =
        document.getElementById(
            "emptyState"
        );

    statusBox =
        document.getElementById(
            "status"
        );

    results =
        document.getElementById(
            "results"
        );

    resultsSummary =
        document.getElementById(
            "resultsSummary"
        );

    resultsOutput =
        document.getElementById(
            "resultsOutput"
        );

    resultsCloseBtn =
        document.getElementById(
            "resultsCloseBtn"
        );

    canvasWrap =
        document.getElementById(
            "canvasWrap"
        );

    playerNamesContainer =
        document.getElementById(
            "playerNamesContainer"
        );

    ctx =
        canvas
            ? canvas.getContext("2d")
            : null;
}


/* =========================================================
   STATUS
   ========================================================= */

function setStatus(message) {
    if (!statusBox) {
        return;
    }

    statusBox.textContent =
        String(message || "");
}


/* =========================================================
   PLAYER NAMES
   ========================================================= */

function getPlayerNameInputs() {
    if (!playerNamesContainer) {
        return [];
    }

    return Array.from(
        playerNamesContainer.querySelectorAll(
            ".player-name-input"
        )
    );
}

function setOcrControlsLocked(locked) {
    ocrControlsLocked =
        Boolean(locked);

    if (imageInput) {
        imageInput.disabled =
            ocrControlsLocked;
    }

    if (matchSize) {
        matchSize.disabled =
            ocrControlsLocked;
    }

    getPlayerNameInputs().forEach(
        function(input) {
            input.disabled =
                ocrControlsLocked;
        }
    );

    if (resetCropBtn) {
        resetCropBtn.disabled =
            (
                ocrControlsLocked ||
                !sourceImage ||
                !cropFallbackVisible
            );
    }

    if (submitBtn) {
        submitBtn.disabled =
            (
                ocrControlsLocked ||
                !sourceImage
            );
    }

    if (canvas) {
        canvas.setAttribute(
            "aria-disabled",
            String(ocrControlsLocked)
        );

        canvas.style.cursor =
            ocrControlsLocked
                ? "not-allowed"
                : cropFallbackVisible
                    ? "crosshair"
                    : "default";
    }

    if (ocrControlsLocked) {
        dragMode = null;
        dragStart = null;
    }
}

function getPlayerNameState() {
    return getPlayerNameInputs().map(
        function(input) {
            return input.value;
        }
    );
}

function buildPlayerNameInputs(
    savedNames = null
) {
    if (
        !playerNamesContainer ||
        !matchSize
    ) {
        return;
    }

    const playersPerTeam =
        Number(matchSize.value);

    const previousNames =
        Array.isArray(savedNames)
            ? savedNames
            : getPlayerNameState();

    playerNamesContainer
        .replaceChildren();

    let globalIndex = 0;

    for (
        let teamIndex = 1;
        teamIndex <= 2;
        teamIndex += 1
    ) {
        const teamGroup =
            document.createElement(
                "div"
            );

        teamGroup.className =
            "player-team-group";

        const teamTitle =
            document.createElement(
                "div"
            );

        teamTitle.className =
            "player-team-title";

        teamTitle.textContent =
            `Team ${teamIndex}`;

        teamGroup.appendChild(
            teamTitle
        );

        for (
            let playerIndex = 1;
            playerIndex <= playersPerTeam;
            playerIndex += 1
        ) {
            const input =
                document.createElement(
                    "input"
                );

            input.type = "text";

            input.className =
                "player-name-input";

            input.disabled =
                ocrControlsLocked;

            input.placeholder =
                `Player ${playerIndex} username`;

            input.autocomplete =
                "off";

            input.spellcheck =
                false;

            input.dataset.team =
                String(teamIndex);

            input.dataset.player =
                String(playerIndex);

            input.setAttribute(
                "aria-label",
                `Team ${teamIndex} Player ${playerIndex} username`
            );

            input.value =
                String(
                    previousNames[
                        globalIndex
                    ] || ""
                ).toUpperCase();

            input.addEventListener(
                "input",
                function() {
                    const start =
                        input.selectionStart;

                    const end =
                        input.selectionEnd;

                    input.value =
                        input.value
                            .toUpperCase();

                    if (
                        start !== null &&
                        end !== null
                    ) {
                        input.setSelectionRange(
                            start,
                            end
                        );
                    }

                    savePageState();
                }
            );

            teamGroup.appendChild(
                input
            );

            globalIndex += 1;
        }

        playerNamesContainer
            .appendChild(
                teamGroup
            );
    }
}

function getExpectedPlayerNames() {
    return getPlayerNameInputs()
        .map(
            function(input) {
                return input.value
                    .trim()
                    .toUpperCase();
            }
        )
        .filter(Boolean);
}

function validateExpectedPlayerNames() {
    if (!matchSize) {
        return {
            valid: false,
            names: [],
            message:
                "Match size is unavailable."
        };
    }

    const playersPerTeam =
        Number(matchSize.value);

    const expectedPlayers =
        playersPerTeam * 2;

    const names =
        getExpectedPlayerNames();

    if (
        names.length !==
        expectedPlayers
    ) {
        return {
            valid: false,
            names,
            message:
                "Enter all " +
                expectedPlayers +
                " player names for this " +
                playersPerTeam +
                "v" +
                playersPerTeam +
                " match."
        };
    }

    if (
        new Set(names).size !==
        names.length
    ) {
        return {
            valid: false,
            names,
            message:
                "Each expected player name must be unique."
        };
    }

    return {
        valid: true,
        names
    };
}


/* =========================================================
   PAGE STATE
   ========================================================= */

function getNormalizedCrop() {
    if (
        !canvas ||
        !canvas.width ||
        !canvas.height
    ) {
        return null;
    }

    return {
        x:
            crop.x /
            canvas.width,

        y:
            crop.y /
            canvas.height,

        width:
            crop.width /
            canvas.width,

        height:
            crop.height /
            canvas.height
    };
}

function savePageState() {
    if (!sourceImage) {
        return;
    }

    const state = {
        imageData:
            sourceImage.src,

        sourceFileName,

        matchSize:
            matchSize?.value ||
            "3",

        playerNames:
            getPlayerNameState(),

        cropFallbackVisible,

        normalizedCrop:
            getNormalizedCrop(),

        status:
            statusBox?.textContent ||
            ""
    };

    try {
        sessionStorage.setItem(
            OCR_STATE_KEY,
            JSON.stringify(state)
        );
    } catch (error) {
        console.error(
            "[OCR] Could not save page state.",
            error
        );
    }
}

function clearPageState() {
    try {
        sessionStorage.removeItem(
            OCR_STATE_KEY
        );
    } catch (error) {
        console.error(
            "[OCR] Could not clear page state.",
            error
        );
    }
}

function restoreNormalizedCrop(
    normalizedCrop
) {
    if (
        !normalizedCrop ||
        !canvas?.width ||
        !canvas?.height
    ) {
        return false;
    }

    const values = [
        normalizedCrop.x,
        normalizedCrop.y,
        normalizedCrop.width,
        normalizedCrop.height
    ].map(Number);

    if (
        values.some(
            function(value) {
                return !Number.isFinite(
                    value
                );
            }
        )
    ) {
        return false;
    }

    crop.x =
        values[0] *
        canvas.width;

    crop.y =
        values[1] *
        canvas.height;

    crop.width =
        values[2] *
        canvas.width;

    crop.height =
        values[3] *
        canvas.height;

    clampCrop();

    return true;
}

function restorePageState() {
    let state = null;

    try {
        state =
            JSON.parse(
                sessionStorage.getItem(
                    OCR_STATE_KEY
                ) || "null"
            );
    } catch {
        clearPageState();
        return false;
    }

    if (!state?.imageData) {
        return false;
    }

    if (
        state.matchSize &&
        matchSize
    ) {
        matchSize.value =
            String(
                state.matchSize
            );
    }

    buildPlayerNameInputs(
        state.playerNames ||
        null
    );

    sourceFileName =
        state.sourceFileName ||
        "scoreboard.png";

    const image =
        new Image();

    image.onload =
        function() {
            sourceImage = image;
            sourceFile = null;

            fitCanvasToImage();

            if (emptyState) {
                emptyState.hidden =
                    true;
            }

            if (canvas) {
                canvas.hidden =
                    false;
            }

            cropFallbackVisible =
                Boolean(
                    state.cropFallbackVisible
                );

            if (cropFallbackVisible) {
                if (
                    !restoreNormalizedCrop(
                        state.normalizedCrop
                    )
                ) {
                    resetCrop();
                }
            } else {
                crop = {
                    x: 0,
                    y: 0,
                    width: 0,
                    height: 0
                };
            }

            draw();

            setStatus(
                state.status ||
                (
                    cropFallbackVisible
                        ? "Adjust the crop and retry."
                        : "Image restored. Ready to read scoreboard."
                )
            );

            setOcrControlsLocked(
                false
            );
        };

    image.onerror =
        function() {
            clearPageState();

            sourceImage = null;
            sourceFile = null;

            buildPlayerNameInputs(
                state.playerNames ||
                null
            );

            setOcrControlsLocked(
                false
            );

            setStatus(
                "FAIL: Saved image could not be restored."
            );
        };

    image.src =
        state.imageData;

    return true;
}


/* =========================================================
   CANVAS
   ========================================================= */

function fitCanvasToImage() {
    if (
        !sourceImage ||
        !canvas ||
        !canvasWrap
    ) {
        return;
    }

    const maximumCssWidth =
        Math.min(
            1100,
            canvasWrap.clientWidth ||
            1100
        );

    const maximumCssHeight =
        760;

    const cssScale =
        Math.min(
            1,
            maximumCssWidth /
                sourceImage.naturalWidth,
            maximumCssHeight /
                sourceImage.naturalHeight
        );

    const pixelRatio =
        Math.min(
            3,
            Math.max(
                1,
                window.devicePixelRatio ||
                1
            )
        );

    displayScale =
        Math.min(
            1,
            cssScale *
                pixelRatio
        );

    canvas.width =
        Math.round(
            sourceImage.naturalWidth *
            displayScale
        );

    canvas.height =
        Math.round(
            sourceImage.naturalHeight *
            displayScale
        );

    canvas.style.width =
        Math.round(
            sourceImage.naturalWidth *
            cssScale
        ) + "px";

    canvas.style.height =
        Math.round(
            sourceImage.naturalHeight *
            cssScale
        ) + "px";
}

function clampCrop() {
    if (!canvas) {
        return;
    }

    crop.width =
        Math.max(
            OCR_MIN_CROP_WIDTH,
            Math.min(
                canvas.width,
                crop.width
            )
        );

    crop.height =
        Math.max(
            OCR_MIN_CROP_HEIGHT,
            Math.min(
                canvas.height,
                crop.height
            )
        );

    crop.x =
        Math.max(
            0,
            Math.min(
                canvas.width -
                    crop.width,
                crop.x
            )
        );

    crop.y =
        Math.max(
            0,
            Math.min(
                canvas.height -
                    crop.height,
                crop.y
            )
        );
}

function resetCrop() {
    if (
        !sourceImage ||
        !canvas
    ) {
        return;
    }

    crop.width =
        canvas.width * 0.96;

    crop.height =
        canvas.height * 0.72;

    crop.x =
        (
            canvas.width -
            crop.width
        ) / 2;

    crop.y =
        (
            canvas.height -
            crop.height
        ) / 2;

    clampCrop();
    draw();
    savePageState();
}

function showCropFallback(
    message = null
) {
    if (!sourceImage) {
        return;
    }

    cropFallbackVisible =
        true;

    resetCrop();

    if (resetCropBtn) {
        resetCropBtn.disabled =
            ocrControlsLocked;
    }

    if (canvas) {
        canvas.style.cursor =
            ocrControlsLocked
                ? "not-allowed"
                : "crosshair";
    }

    setStatus(
        message ||
        "The full-image scan could not reliably locate the scoreboard. Adjust the crop box and retry."
    );

    draw();
    savePageState();

    document.dispatchEvent(
        new CustomEvent(
            "ocr:crop-fallback-shown"
        )
    );
}

function hideCropFallback() {
    cropFallbackVisible =
        false;

    crop = {
        x: 0,
        y: 0,
        width: 0,
        height: 0
    };

    if (resetCropBtn) {
        resetCropBtn.disabled =
            true;
    }

    if (canvas) {
        canvas.style.cursor =
            "default";
    }

    draw();
    savePageState();
}

function getHandlePoints() {
    const left =
        crop.x;

    const right =
        crop.x +
        crop.width;

    const top =
        crop.y;

    const bottom =
        crop.y +
        crop.height;

    const centerX =
        crop.x +
        crop.width / 2;

    const centerY =
        crop.y +
        crop.height / 2;

    return {
        nw: {
            x: left,
            y: top
        },
        n: {
            x: centerX,
            y: top
        },
        ne: {
            x: right,
            y: top
        },
        e: {
            x: right,
            y: centerY
        },
        se: {
            x: right,
            y: bottom
        },
        s: {
            x: centerX,
            y: bottom
        },
        sw: {
            x: left,
            y: bottom
        },
        w: {
            x: left,
            y: centerY
        }
    };
}

function drawHandles() {
    if (
        !ctx ||
        !cropFallbackVisible
    ) {
        return;
    }

    const points =
        getHandlePoints();

    ctx.fillStyle =
        "#00ff66";

    Object.values(points).forEach(
        function(point) {
            ctx.fillRect(
                point.x -
                    OCR_HANDLE_SIZE / 2,
                point.y -
                    OCR_HANDLE_SIZE / 2,
                OCR_HANDLE_SIZE,
                OCR_HANDLE_SIZE
            );
        }
    );
}

function draw() {
    if (
        !sourceImage ||
        !ctx ||
        !canvas
    ) {
        return;
    }

    ctx.imageSmoothingEnabled =
        true;

    ctx.imageSmoothingQuality =
        "high";

    ctx.clearRect(
        0,
        0,
        canvas.width,
        canvas.height
    );

    ctx.drawImage(
        sourceImage,
        0,
        0,
        canvas.width,
        canvas.height
    );

    if (!cropFallbackVisible) {
        return;
    }

    ctx.save();

    ctx.fillStyle =
        "rgba(0, 0, 0, 0.48)";

    ctx.fillRect(
        0,
        0,
        canvas.width,
        canvas.height
    );

    ctx.clearRect(
        crop.x,
        crop.y,
        crop.width,
        crop.height
    );

    ctx.drawImage(
        sourceImage,
        crop.x /
            displayScale,
        crop.y /
            displayScale,
        crop.width /
            displayScale,
        crop.height /
            displayScale,
        crop.x,
        crop.y,
        crop.width,
        crop.height
    );

    ctx.strokeStyle =
        "#00ff66";

    ctx.lineWidth =
        3;

    ctx.strokeRect(
        crop.x,
        crop.y,
        crop.width,
        crop.height
    );

    drawHandles();

    ctx.restore();
}


/* =========================================================
   POINTERS
   ========================================================= */

function getPointerPosition(event) {
    if (!canvas) {
        return {
            x: 0,
            y: 0
        };
    }

    const rect =
        canvas.getBoundingClientRect();

    if (
        rect.width <= 0 ||
        rect.height <= 0
    ) {
        return {
            x: 0,
            y: 0
        };
    }

    return {
        x:
            (
                event.clientX -
                rect.left
            ) *
            (
                canvas.width /
                rect.width
            ),

        y:
            (
                event.clientY -
                rect.top
            ) *
            (
                canvas.height /
                rect.height
            )
    };
}

function hitTestHandle(x, y) {
    const points =
        getHandlePoints();

    for (
        const [name, point]
        of Object.entries(points)
    ) {
        if (
            Math.abs(
                x - point.x
            ) <=
                OCR_HANDLE_SIZE &&
            Math.abs(
                y - point.y
            ) <=
                OCR_HANDLE_SIZE
        ) {
            return name;
        }
    }

    return null;
}

function pointInsideCrop(x, y) {
    return (
        x >= crop.x &&
        x <=
            crop.x +
            crop.width &&
        y >= crop.y &&
        y <=
            crop.y +
            crop.height
    );
}

function handleCanvasPointerDown(
    event
) {
    if (
        !sourceImage ||
        ocrControlsLocked ||
        !cropFallbackVisible ||
        !canvas
    ) {
        return;
    }

    const point =
        getPointerPosition(event);

    const handle =
        hitTestHandle(
            point.x,
            point.y
        );

    if (handle) {
        dragMode = handle;
    } else {
        dragMode = "move";

        if (
            !pointInsideCrop(
                point.x,
                point.y
            )
        ) {
            crop.x =
                point.x -
                crop.width / 2;

            crop.y =
                point.y -
                crop.height / 2;

            clampCrop();
        }
    }

    dragStart = {
        x: point.x,
        y: point.y,
        crop: {
            ...crop
        }
    };

    canvas.setPointerCapture(
        event.pointerId
    );

    draw();
}

function handleCanvasPointerMove(
    event
) {
    if (
        ocrControlsLocked ||
        !cropFallbackVisible ||
        !dragMode ||
        !dragStart
    ) {
        return;
    }

    const point =
        getPointerPosition(event);

    const dx =
        point.x -
        dragStart.x;

    const dy =
        point.y -
        dragStart.y;

    const start =
        dragStart.crop;

    if (dragMode === "move") {
        crop.x =
            start.x + dx;

        crop.y =
            start.y + dy;
    } else {
        let left = start.x;
        let right =
            start.x +
            start.width;

        let top = start.y;
        let bottom =
            start.y +
            start.height;

        if (
            dragMode.includes("w")
        ) {
            left += dx;
        }

        if (
            dragMode.includes("e")
        ) {
            right += dx;
        }

        if (
            dragMode.includes("n")
        ) {
            top += dy;
        }

        if (
            dragMode.includes("s")
        ) {
            bottom += dy;
        }

        if (
            right -
            left <
            OCR_MIN_CROP_WIDTH
        ) {
            if (
                dragMode.includes("w")
            ) {
                left =
                    right -
                    OCR_MIN_CROP_WIDTH;
            } else {
                right =
                    left +
                    OCR_MIN_CROP_WIDTH;
            }
        }

        if (
            bottom -
            top <
            OCR_MIN_CROP_HEIGHT
        ) {
            if (
                dragMode.includes("n")
            ) {
                top =
                    bottom -
                    OCR_MIN_CROP_HEIGHT;
            } else {
                bottom =
                    top +
                    OCR_MIN_CROP_HEIGHT;
            }
        }

        crop.x = left;
        crop.y = top;

        crop.width =
            right - left;

        crop.height =
            bottom - top;
    }

    clampCrop();
    draw();
}

function handleCanvasPointerUp(
    event
) {
    dragMode = null;
    dragStart = null;

    if (
        canvas &&
        canvas.hasPointerCapture(
            event.pointerId
        )
    ) {
        canvas.releasePointerCapture(
            event.pointerId
        );
    }

    savePageState();
}

function handleCanvasPointerCancel(
    event
) {
    dragMode = null;
    dragStart = null;

    if (
        canvas &&
        canvas.hasPointerCapture(
            event.pointerId
        )
    ) {
        canvas.releasePointerCapture(
            event.pointerId
        );
    }
}


/* =========================================================
   IMAGE OUTPUT
   ========================================================= */

function getOriginalImageBlob() {
    if (sourceFile) {
        return Promise.resolve(
            sourceFile
        );
    }

    return new Promise(
        function(resolve, reject) {
            if (!sourceImage) {
                reject(
                    new Error(
                        "No image loaded."
                    )
                );

                return;
            }

            const outputCanvas =
                document.createElement(
                    "canvas"
                );

            outputCanvas.width =
                sourceImage.naturalWidth;

            outputCanvas.height =
                sourceImage.naturalHeight;

            const outputContext =
                outputCanvas.getContext(
                    "2d",
                    {
                        alpha: false
                    }
                );

            if (!outputContext) {
                reject(
                    new Error(
                        "Could not prepare uploaded image."
                    )
                );

                return;
            }

            outputContext.drawImage(
                sourceImage,
                0,
                0
            );

            outputCanvas.toBlob(
                function(blob) {
                    if (!blob) {
                        reject(
                            new Error(
                                "Could not prepare uploaded image."
                            )
                        );

                        return;
                    }

                    resolve(blob);
                },
                "image/png"
            );
        }
    );
}

function createScoreboardCropBlob() {
    return new Promise(
        function(resolve, reject) {
            if (!sourceImage) {
                reject(
                    new Error(
                        "No image loaded."
                    )
                );

                return;
            }

            if (!cropFallbackVisible) {
                reject(
                    new Error(
                        "Crop fallback is not active."
                    )
                );

                return;
            }

            const normalized =
                getNormalizedCrop();

            if (!normalized) {
                reject(
                    new Error(
                        "Scoreboard crop is invalid."
                    )
                );

                return;
            }

            const naturalWidth =
                sourceImage.naturalWidth;

            const naturalHeight =
                sourceImage.naturalHeight;

            const sourceLeft =
                Math.max(
                    0,
                    Math.floor(
                        normalized.x *
                        naturalWidth
                    )
                );

            const sourceTop =
                Math.max(
                    0,
                    Math.floor(
                        normalized.y *
                        naturalHeight
                    )
                );

            const sourceRight =
                Math.min(
                    naturalWidth,
                    Math.ceil(
                        (
                            normalized.x +
                            normalized.width
                        ) *
                        naturalWidth
                    )
                );

            const sourceBottom =
                Math.min(
                    naturalHeight,
                    Math.ceil(
                        (
                            normalized.y +
                            normalized.height
                        ) *
                        naturalHeight
                    )
                );

            const sourceWidth =
                sourceRight -
                sourceLeft;

            const sourceHeight =
                sourceBottom -
                sourceTop;

            if (
                sourceWidth <
                    OCR_MIN_SOURCE_CROP_WIDTH ||
                sourceHeight <
                    OCR_MIN_SOURCE_CROP_HEIGHT
            ) {
                reject(
                    new Error(
                        "Scoreboard crop is too small."
                    )
                );

                return;
            }

            const outputCanvas =
                document.createElement(
                    "canvas"
                );

            outputCanvas.width =
                sourceWidth;

            outputCanvas.height =
                sourceHeight;

            const outputContext =
                outputCanvas.getContext(
                    "2d",
                    {
                        alpha: false
                    }
                );

            if (!outputContext) {
                reject(
                    new Error(
                        "Could not prepare scoreboard crop."
                    )
                );

                return;
            }

            outputContext.drawImage(
                sourceImage,
                sourceLeft,
                sourceTop,
                sourceWidth,
                sourceHeight,
                0,
                0,
                sourceWidth,
                sourceHeight
            );

            outputCanvas.toBlob(
                function(blob) {
                    if (!blob) {
                        reject(
                            new Error(
                                "Could not create scoreboard crop."
                            )
                        );

                        return;
                    }

                    resolve(blob);
                },
                "image/png"
            );
        }
    );
}


/* =========================================================
   IMAGE LOADING
   ========================================================= */

function loadImageFile(file) {
    if (
        !file ||
        ocrControlsLocked
    ) {
        return;
    }

    sourceFile = file;

    sourceFileName =
        file.name ||
        "scoreboard.png";

    const reader =
        new FileReader();

    reader.onload =
        function(event) {
            const image =
                new Image();

            image.onload =
                function() {
                    sourceImage = image;

                    fitCanvasToImage();

                    if (emptyState) {
                        emptyState.hidden =
                            true;
                    }

                    if (canvas) {
                        canvas.hidden =
                            false;
                    }

                    cropFallbackVisible =
                        false;

                    crop = {
                        x: 0,
                        y: 0,
                        width: 0,
                        height: 0
                    };

                    draw();

                    setOcrControlsLocked(
                        false
                    );

                    setStatus(
                        "Image loaded. The first attempt will use the full uploaded image."
                    );

                    savePageState();
                };

            image.onerror =
                function() {
                    setStatus(
                        "FAIL: Could not load the selected image."
                    );
                };

            image.src =
                event.target?.result ||
                "";
        };

    reader.onerror =
        function() {
            setStatus(
                "FAIL: Could not read the selected image."
            );
        };

    reader.readAsDataURL(file);
}


/* =========================================================
   EVENTS
   ========================================================= */

function handleImageInputChange() {
    if (
        ocrControlsLocked ||
        !imageInput
    ) {
        return;
    }

    loadImageFile(
        imageInput.files?.[0]
    );
}

function handleMatchSizeChange() {
    if (ocrControlsLocked) {
        return;
    }

    const names =
        getPlayerNameState();

    buildPlayerNameInputs(names);

    savePageState();
}

function handleResetCropClick(event) {
    event.preventDefault();

    if (
        !sourceImage ||
        ocrControlsLocked ||
        !cropFallbackVisible
    ) {
        return;
    }

    resetCrop();

    setStatus(
        "Crop reset. Adjust the green box around the scoreboard."
    );
}

function handleWindowResize() {
    if (
        !sourceImage ||
        !canvas ||
        !canvasWrap
    ) {
        return;
    }

    const normalizedCrop =
        cropFallbackVisible
            ? getNormalizedCrop()
            : null;

    fitCanvasToImage();

    if (
        cropFallbackVisible &&
        !restoreNormalizedCrop(
            normalizedCrop
        )
    ) {
        resetCrop();
    }

    draw();
    savePageState();
}

function bindElementEventOnce(
    element,
    eventName,
    handler,
    marker
) {
    if (!element) {
        return;
    }

    const datasetKey =
        `ocr${marker}`;

    if (
        element.dataset[
            datasetKey
        ] === "true"
    ) {
        return;
    }

    element.addEventListener(
        eventName,
        handler
    );

    element.dataset[
        datasetKey
    ] = "true";
}

function bindCoreEvents() {
    bindElementEventOnce(
        canvas,
        "pointerdown",
        handleCanvasPointerDown,
        "PointerDown"
    );

    bindElementEventOnce(
        canvas,
        "pointermove",
        handleCanvasPointerMove,
        "PointerMove"
    );

    bindElementEventOnce(
        canvas,
        "pointerup",
        handleCanvasPointerUp,
        "PointerUp"
    );

    bindElementEventOnce(
        canvas,
        "pointercancel",
        handleCanvasPointerCancel,
        "PointerCancel"
    );

    bindElementEventOnce(
        imageInput,
        "change",
        handleImageInputChange,
        "ImageChange"
    );

    bindElementEventOnce(
        matchSize,
        "change",
        handleMatchSizeChange,
        "MatchSizeChange"
    );

    bindElementEventOnce(
        resetCropBtn,
        "click",
        handleResetCropClick,
        "ResetCrop"
    );

    if (
        !ocrCoreWindowEventsBound
    ) {
        window.addEventListener(
            "resize",
            handleWindowResize
        );

        ocrCoreWindowEventsBound =
            true;
    }
}


/* =========================================================
   INITIALIZE
   ========================================================= */

function initializeOcrCore() {
    resolveOcrCoreElements();

    const requiredElements = {
        imageInput,
        matchSize,
        resetCropBtn,
        submitBtn,
        canvas,
        emptyState,
        statusBox,
        canvasWrap,
        playerNamesContainer
    };

    const missing =
        Object.entries(
            requiredElements
        )
        .filter(
            function(
                [, element]
            ) {
                return !element;
            }
        )
        .map(
            function([name]) {
                return name;
            }
        );

    if (missing.length > 0) {
        OCR_CORE_READY = false;

        console.error(
            "[OCR] Missing required HTML elements:",
            missing
        );

        return false;
    }

    bindCoreEvents();

    if (!restorePageState()) {
        sourceImage = null;
        sourceFile = null;
        sourceFileName =
            "scoreboard.png";

        displayScale = 1;
        ocrControlsLocked = false;
        cropFallbackVisible = false;
        dragMode = null;
        dragStart = null;

        crop = {
            x: 0,
            y: 0,
            width: 0,
            height: 0
        };

        buildPlayerNameInputs();

        setOcrControlsLocked(
            false
        );

        if (emptyState) {
            emptyState.hidden =
                false;
        }

        if (canvas) {
            canvas.hidden =
                true;
        }
    }

    OCR_CORE_READY = true;

    return true;
}

window.initializeOcrCore =
    initializeOcrCore;