"use strict";
/* =========================================================
   OCR CORE
   Owns shared page state, controls, player inputs, image/crop,
   persistence, canvas behavior, and core-only event bindings.
   ========================================================= */
const OCR_STATE_KEY="rocketLeagueOcrState";
const OCR_JOB_KEY="rocketLeagueOcrJobId";
const OCR_DEBUG=false;
const OCR_HANDLE_SIZE=10;
const OCR_MIN_CROP_WIDTH=140;
const OCR_MIN_CROP_HEIGHT=80;
const OCR_LOCALIZE_MAX_WIDTH=1100;
const OCR_LOCALIZE_MAX_HEIGHT=760;
const OCR_FALLBACK_CROP_MAX_WIDTH=2200;
const OCR_MIN_SOURCE_CROP_WIDTH=320;
const OCR_MIN_SOURCE_CROP_HEIGHT=120;
const OCR_MIN_SCOREBOARD_ASPECT_RATIO=1.2;
const OCR_MAX_SCOREBOARD_ASPECT_RATIO=8;
const OCR_SUBMISSION_COOLDOWN_SECONDS=30;
const OCR_SUBMISSION_COOLDOWN_KEY="ocrSubmissionCooldownUntil";
const imageInput=document.getElementById("imageInput");
const matchSize=document.getElementById("matchSize");
const resetCropBtn=document.getElementById("resetCropBtn");
const submitBtn=document.getElementById("submitBtn");
const canvas=document.getElementById("scoreboardCanvas");
const emptyState=document.getElementById("emptyState");
const statusBox=document.getElementById("status");
const results=document.getElementById("results");
const resultsSummary=document.getElementById("resultsSummary");
const resultsOutput=document.getElementById("resultsOutput");
const resultsCloseBtn=document.getElementById("resultsCloseBtn");
const canvasWrap=document.getElementById("canvasWrap");
const playerNamesContainer=document.getElementById("playerNamesContainer");
const ctx=canvas?canvas.getContext("2d"):null;
let sourceImage=null;
let sourceFileName="scoreboard.png";
let displayScale=1;
let activeOcrJobId=localStorage.getItem(OCR_JOB_KEY);
let jobPollTimer=null;
let crop={
    x:0,
    y:0,
    width:0,
    height:0
};
let ocrAutoCropState={
    mode:"idle",
    bounds:null,
    confidence:0,
    method:null,
    manualOverride:false
};
let dragMode=null;
let dragStart=null;
let ocrControlsLocked=false;
let ocrCooldownTimer=null;
const OCR_DEBUG_SESSION_ID=
    Date.now().toString(36)
    +"-"
    +Math.random().toString(36).slice(2,8);
function ocrDebug(label,data){
    if(!OCR_DEBUG){
        return;
    }
    if(typeof data==="undefined"){
        console.log(
            `[OCR DEBUG ${OCR_DEBUG_SESSION_ID}] ${label}`
        );
        return;
    }
    console.log(
        `[OCR DEBUG ${OCR_DEBUG_SESSION_ID}] ${label}`,
        data
    );
}
function ocrDebugState(label){
    ocrDebug(
        label,
        {
            sourceImageExists:!!sourceImage,
            sourceImageComplete:!!sourceImage?.complete,
            sourceImageNaturalWidth:sourceImage?.naturalWidth||0,
            sourceImageNaturalHeight:sourceImage?.naturalHeight||0,
            canvasHidden:canvas?.hidden,
            canvasWidth:canvas?.width||0,
            canvasHeight:canvas?.height||0,
            displayScale:displayScale,
            crop:{...crop},
            selectedFile:imageInput?.files?.[0]?.name||sourceFileName||null,
            matchSize:matchSize?.value||null,
            activeOcrJobId:activeOcrJobId,
            submitDisabled:submitBtn?.disabled,
            resetDisabled:resetCropBtn?.disabled,
            documentVisibility:document.visibilityState
        }
    );
}
function setStatus(message){
    ocrDebug(
        "STATUS CHANGE",
        message
    );
    if(statusBox){
        statusBox.textContent=message;
    }
}
function clearOcrCooldownTimer(){
    if(ocrCooldownTimer!==null){
        clearInterval(ocrCooldownTimer);
        ocrCooldownTimer=null;
    }
}
function setOcrControlsLocked(locked){
    ocrControlsLocked=Boolean(locked);
    imageInput.disabled=ocrControlsLocked;
    matchSize.disabled=ocrControlsLocked;
    resetCropBtn.disabled=(
        ocrControlsLocked
        ||!sourceImage
    );
    submitBtn.disabled=(
        ocrControlsLocked
        ||!sourceImage
    );
    getPlayerNameInputs().forEach(function(input){
        input.disabled=ocrControlsLocked;
    });
    if(canvas){
        canvas.setAttribute(
            "aria-disabled",
            String(ocrControlsLocked)
        );
        canvas.style.cursor=ocrControlsLocked
            ?"not-allowed"
            :"crosshair";
    }
    if(ocrControlsLocked){
        dragMode=null;
        dragStart=null;
    }
}
function lockOcrSubmissionControls(){
    clearOcrCooldownTimer();
    sessionStorage.removeItem(
        OCR_SUBMISSION_COOLDOWN_KEY
    );
    setOcrControlsLocked(true);
}
function startOcrSubmissionCooldown(baseMessage=null,seconds=OCR_SUBMISSION_COOLDOWN_SECONDS){
    clearOcrCooldownTimer();
    const safeSeconds=Math.max(
        1,
        Math.ceil(Number(seconds)||OCR_SUBMISSION_COOLDOWN_SECONDS)
    );
    const cooldownUntil=Date.now()+safeSeconds*1000;
    const stableMessage=String(
        baseMessage
        ||statusBox?.textContent
        ||"OCR request finished."
    ).replace(/\s+New submission available in \d+ seconds?\.$/i,"");
    sessionStorage.setItem(
        OCR_SUBMISSION_COOLDOWN_KEY,
        String(cooldownUntil)
    );
    setOcrControlsLocked(true);
    function updateCooldown(){
        const remaining=Math.max(
            0,
            Math.ceil((cooldownUntil-Date.now())/1000)
        );
        if(remaining<=0){
            clearOcrCooldownTimer();
            sessionStorage.removeItem(
                OCR_SUBMISSION_COOLDOWN_KEY
            );
            setOcrControlsLocked(false);
            setStatus(
                stableMessage
                +" You may submit another image."
            );
            savePageState();
            return;
        }
        setStatus(
            stableMessage
            +" New submission available in "
            +remaining
            +" second"
            +(remaining===1?"":"s")
            +"."
        );
    }
    updateCooldown();
    ocrCooldownTimer=setInterval(
        updateCooldown,
        1000
    );
}
function restoreOcrSubmissionCooldown(){
    const cooldownUntil=Number(
        sessionStorage.getItem(
            OCR_SUBMISSION_COOLDOWN_KEY
        )||0
    );
    const remaining=Math.ceil(
        (cooldownUntil-Date.now())/1000
    );
    if(remaining>0){
        startOcrSubmissionCooldown(
            statusBox?.textContent||"OCR request finished.",
            remaining
        );
        return true;
    }
    sessionStorage.removeItem(
        OCR_SUBMISSION_COOLDOWN_KEY
    );
    return false;
}
function getCropHeightRatio(playersPerTeam){
    const ratios={
        1:0.42,
        2:0.55,
        3:0.68,
        4:0.82
    };
    return ratios[playersPerTeam]||0.68;
}
function getPlayerNameInputs(){
    return Array.from(
        document.querySelectorAll(
            ".player-name-input"
        )
    );
}
function getPlayerNameState(){
    return getPlayerNameInputs().map(
        input=>input.value
    );
}
function buildPlayerNameInputs(savedNames=null){
    if(!playerNamesContainer||!matchSize){
        return;
    }
    const playersPerTeam=Number(matchSize.value);
    const previousNames=
        Array.isArray(savedNames)
            ?savedNames
            :getPlayerNameState();
    playerNamesContainer.innerHTML="";
    let globalIndex=0;
    for(let teamIndex=1;teamIndex<=2;teamIndex+=1){
        const teamGroup=document.createElement("div");
        teamGroup.className="player-team-group";
        const teamTitle=document.createElement("div");
        teamTitle.className="player-team-title";
        teamTitle.textContent=`Team ${teamIndex}`;
        teamGroup.appendChild(teamTitle);
        for(let playerIndex=1;playerIndex<=playersPerTeam;playerIndex+=1){
            const input=document.createElement("input");
            input.type="text";
            input.className="player-name-input";
            input.disabled=ocrControlsLocked;
            input.placeholder=`Player ${playerIndex} username`;
            input.autocomplete="off";
            input.spellcheck=false;
            input.dataset.team=String(teamIndex);
            input.dataset.player=String(playerIndex);
            input.setAttribute(
                "aria-label",
                `Team ${teamIndex} Player ${playerIndex} username`
            );
            input.value=String(previousNames[globalIndex]||"").toUpperCase();
            input.addEventListener(
                "input",
                function(){
                    const start=input.selectionStart;
                    const end=input.selectionEnd;
                    input.value=input.value.toUpperCase();
                    if(start!==null&&end!==null){
                        input.setSelectionRange(start,end);
                    }
                    savePageState();
                }
            );
            teamGroup.appendChild(input);
            globalIndex+=1;
        }
        playerNamesContainer.appendChild(teamGroup);
    }
}
function getExpectedPlayerNames(){
    return getPlayerNameInputs()
        .map(
            input=>input.value.trim().toUpperCase()
        )
        .filter(Boolean);
}
function validateExpectedPlayerNames(){
    const playersPerTeam=Number(matchSize.value);
    const expectedPlayers=playersPerTeam*2;
    const names=getExpectedPlayerNames();
    if(names.length===0){
        return{
            valid:false,
            names:[],
            message:
                "Enter all "
                +expectedPlayers
                +" expected player names before submitting the image."
        };
    }
    if(names.length!==expectedPlayers){
        return{
            valid:false,
            names:names,
            message:
                "Enter all "
                +expectedPlayers
                +" player names for this "
                +playersPerTeam
                +"v"
                +playersPerTeam
                +" match."
        };
    }
    if(new Set(names).size!==names.length){
        return{
            valid:false,
            names:names,
            message:"Each expected player name must be unique."
        };
    }
    return{
        valid:true,
        names:names
    };
}
function savePageState(){
    if(!sourceImage){
        return;
    }
    const state={
        imageData:sourceImage.src,
        sourceFileName:sourceFileName,
        matchSize:matchSize.value,
        crop:{...crop},
        normalizedCrop:getNormalizedCrop(),
        autoCropState:{
            ...ocrAutoCropState,
            bounds:ocrAutoCropState.bounds
                ?{...ocrAutoCropState.bounds}
                :null
        },
        sourceImage:{
            width:sourceImage.naturalWidth,
            height:sourceImage.naturalHeight,
            orientation:getImageOrientation(
                sourceImage.naturalWidth,
                sourceImage.naturalHeight
            )
        },
        canvas:{
            width:canvas.width,
            height:canvas.height
        },
        status:statusBox.textContent,
        playerNames:getPlayerNameState()
    };
    try{
        sessionStorage.setItem(
            OCR_STATE_KEY,
            JSON.stringify(state)
        );
        ocrDebug(
            "PAGE STATE SAVED",
            {
                sourceFileName:state.sourceFileName,
                matchSize:state.matchSize,
                crop:state.crop,
                status:state.status,
                playerNames:state.playerNames,
                imageDataLength:state.imageData?.length||0
            }
        );
    }catch(error){
        console.error(
            "[OCR] Could not save page state:",
            error
        );
    }
}
function getImageOrientation(width,height){
    if(width===height){
        return"square";
    }
    return width>height
        ?"landscape"
        :"portrait";
}
function getNormalizedCrop(){
    if(!canvas.width||!canvas.height){
        return null;
    }
    return{
        x:crop.x/canvas.width,
        y:crop.y/canvas.height,
        width:crop.width/canvas.width,
        height:crop.height/canvas.height
    };
}
function restoreNormalizedCrop(normalizedCrop){
    if(!normalizedCrop||!canvas.width||!canvas.height){
        return false;
    }
    const values=[
        normalizedCrop.x,
        normalizedCrop.y,
        normalizedCrop.width,
        normalizedCrop.height
    ].map(Number);
    if(values.some(function(item){
        return!Number.isFinite(item);
    })){
        return false;
    }
    crop.x=values[0]*canvas.width;
    crop.y=values[1]*canvas.height;
    crop.width=values[2]*canvas.width;
    crop.height=values[3]*canvas.height;
    clampCrop();
    return true;
}
function restoreLegacyCrop(savedCrop,savedCanvas){
    if(!savedCrop||!savedCanvas?.width||!savedCanvas?.height){
        return false;
    }
    return restoreNormalizedCrop({
        x:Number(savedCrop.x)/Number(savedCanvas.width),
        y:Number(savedCrop.y)/Number(savedCanvas.height),
        width:Number(savedCrop.width)/Number(savedCanvas.width),
        height:Number(savedCrop.height)/Number(savedCanvas.height)
    });
}
function restorePageState(){
    let state;
    try{
        state=JSON.parse(
            sessionStorage.getItem(OCR_STATE_KEY)||"null"
        );
    }catch(error){
        console.warn(
            "[OCR] Saved page state was invalid:",
            error
        );
        clearPageState();
        return false;
    }
    if(!state?.imageData){
        return false;
    }
    if(state.matchSize){
        matchSize.value=String(state.matchSize);
    }
    buildPlayerNameInputs(
        state.playerNames||null
    );
    sourceFileName=
        state.sourceFileName
        ||"scoreboard.png";
    const image=new Image();
    image.onload=function(){
        sourceImage=image;
        fitCanvasToImage();
        if(
            state.autoCropState
            &&typeof state.autoCropState==="object"
        ){
            ocrAutoCropState={
                mode:String(
                    state.autoCropState.mode
                    ||"manual"
                ),
                bounds:state.autoCropState.bounds
                    ?{...state.autoCropState.bounds}
                    :null,
                confidence:Number(
                    state.autoCropState.confidence
                    ||0
                ),
                method:state.autoCropState.method
                    ||null,
                manualOverride:Boolean(
                    state.autoCropState.manualOverride
                )
            };
        }else{
            ocrAutoCropState={
                mode:"manual",
                bounds:null,
                confidence:0,
                method:null,
                manualOverride:true
            };
        }
        const cropRestored=(
            restoreNormalizedCrop(
                state.normalizedCrop
            )
            ||restoreLegacyCrop(
                state.crop,
                state.canvas
            )
        );
        if(!cropRestored){
            enableManualCropFallback();
        }
        emptyState.hidden=true;
        canvas.hidden=false;
        draw();
        setStatus(
            state.status
            ||"Image and crop restored."
        );
        if(activeOcrJobId){
            setOcrControlsLocked(
                true
            );
        }else if(
            !restoreOcrSubmissionCooldown()
        ){
            setOcrControlsLocked(
                false
            );
        }
        if(
            !activeOcrJobId
            &&ocrAutoCropState.mode==="searching"
            &&typeof requestScoreboardLocalization
                ==="function"
        ){
            setTimeout(
                requestScoreboardLocalization,
                0
            );
        }
        ocrDebugState(
            "PAGE STATE RESTORED"
        );
    };
    image.onerror=function(){
        clearPageState();
        buildPlayerNameInputs(
            state.playerNames||null
        );
        if(activeOcrJobId){
            setOcrControlsLocked(
                true
            );
        }else if(
            !restoreOcrSubmissionCooldown()
        ){
            setOcrControlsLocked(
                false
            );
        }
    };
    image.src=state.imageData;
    return true;
}
function clearPageState(){
    sessionStorage.removeItem(
        OCR_STATE_KEY
    );
    ocrDebug(
        "PAGE STATE CLEARED"
    );
}
function createJobId(){
    if(
        globalThis.crypto
        &&typeof globalThis.crypto.randomUUID==="function"
    ){
        return globalThis.crypto.randomUUID();
    }
    const randomBytes=new Uint32Array(4);
    if(
        globalThis.crypto
        &&typeof globalThis.crypto.getRandomValues==="function"
    ){
        globalThis.crypto.getRandomValues(randomBytes);
        return(
            Date.now().toString(36)
            +"-"
            +Array.from(randomBytes)
                .map(function(value){
                    return value.toString(36);
                })
                .join("")
        );
    }
    return(
        Date.now().toString(36)
        +"-"
        +Math.random().toString(36).slice(2,14)
    );
}
function saveOcrJobId(jobId){
    activeOcrJobId=jobId;
    localStorage.setItem(
        OCR_JOB_KEY,
        jobId
    );
    ocrDebug(
        "OCR JOB ID SAVED",
        jobId
    );
}
function clearOcrJobId(){
    activeOcrJobId=null;
    localStorage.removeItem(
        OCR_JOB_KEY
    );
    if(jobPollTimer){
        clearTimeout(
            jobPollTimer
        );
        jobPollTimer=null;
    }
    ocrDebug(
        "OCR JOB ID CLEARED"
    );
}
function fitCanvasToImage(){
    if(
        !sourceImage
        ||!canvas
        ||!canvasWrap
    ){
        return;
    }
    const maximumCssWidth=
        Math.min(
            1100,
            canvasWrap.clientWidth
            ||1100
        );
    const maximumCssHeight=760;
    const cssScale=
        Math.min(
            1,
            maximumCssWidth
            /sourceImage.naturalWidth,
            maximumCssHeight
            /sourceImage.naturalHeight
        );
    const pixelRatio=
        Math.min(
            3,
            Math.max(
                1,
                window.devicePixelRatio
                ||1
            )
        );
    displayScale=
        Math.min(
            1,
            cssScale*pixelRatio
        );
    canvas.width=
        Math.round(
            sourceImage.naturalWidth
            *displayScale
        );
    canvas.height=
        Math.round(
            sourceImage.naturalHeight
            *displayScale
        );
    canvas.style.width=
        Math.round(
            sourceImage.naturalWidth
            *cssScale
        )
        +"px";
    canvas.style.height=
        Math.round(
            sourceImage.naturalHeight
            *cssScale
        )
        +"px";
}
function clampCrop(){
    crop.width=
        Math.max(
            OCR_MIN_CROP_WIDTH,
            Math.min(
                canvas.width,
                crop.width
            )
        );
    crop.height=
        Math.max(
            OCR_MIN_CROP_HEIGHT,
            Math.min(
                canvas.height,
                crop.height
            )
        );
    crop.x=
        Math.max(
            0,
            Math.min(
                canvas.width
                -crop.width,
                crop.x
            )
        );
    crop.y=
        Math.max(
            0,
            Math.min(
                canvas.height
                -crop.height,
                crop.y
            )
        );
}
function resetCrop(){
    if(!sourceImage){
        return;
    }
    const playersPerTeam=
        Number(
            matchSize.value
        );
    crop.width=
        canvas.width*0.96;
    crop.height=
        canvas.height
        *getCropHeightRatio(
            playersPerTeam
        );
    crop.x=
        (
            canvas.width
            -crop.width
        )/2;
    crop.y=
        Math.max(
            0,
            canvas.height*0.04
        );
    if(
        crop.y+crop.height>
        canvas.height
    ){
        crop.y=
            Math.max(
                0,
                canvas.height
                -crop.height
            );
    }
    clampCrop();
    draw();
}
function getHandlePoints(){
    const left=crop.x;
    const right=
        crop.x+crop.width;
    const top=crop.y;
    const bottom=
        crop.y+crop.height;
    const centerX=
        crop.x
        +crop.width/2;
    const centerY=
        crop.y
        +crop.height/2;
    return{
        nw:{
            x:left,
            y:top
        },
        n:{
            x:centerX,
            y:top
        },
        ne:{
            x:right,
            y:top
        },
        e:{
            x:right,
            y:centerY
        },
        se:{
            x:right,
            y:bottom
        },
        s:{
            x:centerX,
            y:bottom
        },
        sw:{
            x:left,
            y:bottom
        },
        w:{
            x:left,
            y:centerY
        }
    };
}
function drawHandles(){
    const points=
        getHandlePoints();
    ctx.fillStyle=
        "#00ff66";
    Object.values(
        points
    ).forEach(
        point=>{
            ctx.fillRect(
                point.x
                -OCR_HANDLE_SIZE/2,
                point.y
                -OCR_HANDLE_SIZE/2,
                OCR_HANDLE_SIZE,
                OCR_HANDLE_SIZE
            );
        }
    );
}
function draw(){
    if(
        !sourceImage
        ||!ctx
    ){
        return;
    }
    ctx.imageSmoothingEnabled=true;
    ctx.imageSmoothingQuality="high";
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
    if(
        ocrAutoCropState.mode!=="auto"
        &&ocrAutoCropState.mode!=="manual"
    ){
        return;
    }
    ctx.save();
    ctx.fillStyle="rgba(0, 0, 0, 0.48)";
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
        crop.x/displayScale,
        crop.y/displayScale,
        crop.width/displayScale,
        crop.height/displayScale,
        crop.x,
        crop.y,
        crop.width,
        crop.height
    );
    ctx.strokeStyle="#00ff66";
    ctx.lineWidth=3;
    ctx.strokeRect(
        crop.x,
        crop.y,
        crop.width,
        crop.height
    );
    drawHandles();
    ctx.restore();
}
function getPointerPosition(event){
    const rect=
        canvas.getBoundingClientRect();
    return{
        x:
            (
                event.clientX
                -rect.left
            )
            *(
                canvas.width
                /rect.width
            ),
        y:
            (
                event.clientY
                -rect.top
            )
            *(
                canvas.height
                /rect.height
            )
    };
}
function hitTestHandle(x,y){
    const points=
        getHandlePoints();
    for(
        const[
            name,
            point
        ]
        of Object.entries(
            points
        )
    ){
        if(
            Math.abs(
                x-point.x
            )<=OCR_HANDLE_SIZE
            &&Math.abs(
                y-point.y
            )<=OCR_HANDLE_SIZE
        ){
            return name;
        }
    }
    return null;
}
function pointInsideCrop(x,y){
    return(
        x>=crop.x
        &&x<=crop.x+crop.width
        &&y>=crop.y
        &&y<=crop.y+crop.height
    );
}
function handleCanvasPointerDown(event){
    if(
        !sourceImage
        ||ocrControlsLocked
        ||(
            ocrAutoCropState.mode!=="auto"
            &&ocrAutoCropState.mode!=="manual"
        )
    ){
        return;
    }
    markCropManualOverride();
    const point=
        getPointerPosition(
            event
        );
    const handle=
        hitTestHandle(
            point.x,
            point.y
        );
    if(handle){
        dragMode=handle;
    }else{
        dragMode="move";
        if(
            !pointInsideCrop(
                point.x,
                point.y
            )
        ){
            crop.x=
                point.x
                -crop.width/2;
            crop.y=
                point.y
                -crop.height/2;
            clampCrop();
        }
    }
    dragStart={
        x:point.x,
        y:point.y,
        crop:{...crop}
    };
    canvas.setPointerCapture(
        event.pointerId
    );
    draw();
}
function handleCanvasPointerMove(event){
    if(
        ocrControlsLocked
        ||!dragMode
        ||!dragStart
    ){
        return;
    }
    const point=
        getPointerPosition(
            event
        );
    const dx=
        point.x-dragStart.x;
    const dy=
        point.y-dragStart.y;
    const start=
        dragStart.crop;
    if(dragMode==="move"){
        crop.x=
            start.x+dx;
        crop.y=
            start.y+dy;
    }else{
        let left=
            start.x;
        let right=
            start.x
            +start.width;
        let top=
            start.y;
        let bottom=
            start.y
            +start.height;
        if(
            dragMode.includes(
                "w"
            )
        ){
            left+=dx;
        }
        if(
            dragMode.includes(
                "e"
            )
        ){
            right+=dx;
        }
        if(
            dragMode.includes(
                "n"
            )
        ){
            top+=dy;
        }
        if(
            dragMode.includes(
                "s"
            )
        ){
            bottom+=dy;
        }
        if(
            right-left<
            OCR_MIN_CROP_WIDTH
        ){
            if(
                dragMode.includes(
                    "w"
                )
            ){
                left=
                    right
                    -OCR_MIN_CROP_WIDTH;
            }else{
                right=
                    left
                    +OCR_MIN_CROP_WIDTH;
            }
        }
        if(
            bottom-top<
            OCR_MIN_CROP_HEIGHT
        ){
            if(
                dragMode.includes(
                    "n"
                )
            ){
                top=
                    bottom
                    -OCR_MIN_CROP_HEIGHT;
            }else{
                bottom=
                    top
                    +OCR_MIN_CROP_HEIGHT;
            }
        }
        crop.x=left;
        crop.y=top;
        crop.width=
            right-left;
        crop.height=
            bottom-top;
    }
    clampCrop();
    draw();
}
function handleCanvasPointerUp(event){
    dragMode=null;
    dragStart=null;
    if(
        canvas.hasPointerCapture(
            event.pointerId
        )
    ){
        canvas.releasePointerCapture(
            event.pointerId
        );
    }
    savePageState();
}
function handleCanvasPointerCancel(event){
    dragMode=null;
    dragStart=null;
    if(
        canvas.hasPointerCapture(
            event.pointerId
        )
    ){
        canvas.releasePointerCapture(
            event.pointerId
        );
    }
}
function beginAutoCropSearch(){
    ocrAutoCropState={
        mode:"searching",
        bounds:null,
        confidence:0,
        method:null,
        manualOverride:false
    };
    crop={
        x:0,
        y:0,
        width:0,
        height:0
    };
    draw();
}
function applyAutoCropBounds(
    normalizedBounds,
    confidence=0,
    method="structural_geometry"
){
    if(
        !sourceImage
        ||!normalizedBounds
    ){
        return false;
    }
    const values=[
        normalizedBounds.x,
        normalizedBounds.y,
        normalizedBounds.width,
        normalizedBounds.height
    ].map(Number);
    if(
        values.some(
            value=>!Number.isFinite(value)
        )
        ||values[2]<=0
        ||values[3]<=0
    ){
        return false;
    }
    crop.x=values[0]*canvas.width;
    crop.y=values[1]*canvas.height;
    crop.width=values[2]*canvas.width;
    crop.height=values[3]*canvas.height;
    clampCrop();
    const appliedBounds=getNormalizedCrop();
    ocrAutoCropState={
        mode:"auto",
        bounds:appliedBounds
            ?{...appliedBounds}
            :null,
        confidence:Number(confidence)||0,
        method:String(method||"structural_geometry"),
        manualOverride:false
    };
    draw();
    savePageState();
    return true;
}
function markCropManualOverride(){
    if(
        ocrAutoCropState.mode!=="auto"
        &&ocrAutoCropState.mode!=="manual"
    ){
        return;
    }
    ocrAutoCropState.mode="manual";
    ocrAutoCropState.manualOverride=true;
    ocrAutoCropState.bounds=getNormalizedCrop();
}
function enableManualCropFallback(){
    if(!sourceImage){
        return;
    }
    if(
        typeof OCR_LOCALIZATION_SEQUENCE!=="undefined"
    ){
        OCR_LOCALIZATION_SEQUENCE++;
    }
    const playersPerTeam=Number(
        matchSize.value
    );
    crop.width=canvas.width*0.96;
    crop.height=canvas.height
        *getCropHeightRatio(
            playersPerTeam
        );
    crop.x=(canvas.width-crop.width)/2;
    crop.y=Math.max(
        0,
        canvas.height*0.04
    );
    clampCrop();
    ocrAutoCropState={
        mode:"manual",
        bounds:getNormalizedCrop(),
        confidence:0,
        method:"manual_fallback",
        manualOverride:true
    };
    draw();
    savePageState();
}
function resetCrop(){
    enableManualCropFallback();
}
function createLocalizationBlob(){
    return new Promise(
        (resolve,reject)=>{
            if(!sourceImage){
                reject(new Error("No image loaded."));
                return;
            }
            const naturalWidth=Number(
                sourceImage.naturalWidth
                ||sourceImage.width
                ||0
            );
            const naturalHeight=Number(
                sourceImage.naturalHeight
                ||sourceImage.height
                ||0
            );
            if(
                naturalWidth<=0
                ||naturalHeight<=0
            ){
                reject(new Error("Selected image dimensions are invalid."));
                return;
            }
            const scale=Math.min(
                1,
                OCR_LOCALIZE_MAX_WIDTH/naturalWidth,
                OCR_LOCALIZE_MAX_HEIGHT/naturalHeight
            );
            const outputCanvas=document.createElement("canvas");
            outputCanvas.width=Math.max(
                1,
                Math.round(naturalWidth*scale)
            );
            outputCanvas.height=Math.max(
                1,
                Math.round(naturalHeight*scale)
            );
            const outputContext=outputCanvas.getContext(
                "2d",
                {alpha:false}
            );
            if(!outputContext){
                reject(new Error("Could not prepare localization image."));
                return;
            }
            outputContext.imageSmoothingEnabled=scale<1;
            if(scale<1){
                outputContext.imageSmoothingQuality="high";
            }
            outputContext.drawImage(
                sourceImage,
                0,
                0,
                naturalWidth,
                naturalHeight,
                0,
                0,
                outputCanvas.width,
                outputCanvas.height
            );
            outputCanvas.toBlob(
                blob=>{
                    if(!blob){
                        reject(new Error("Could not create localization image."));
                        return;
                    }
                    resolve(blob);
                },
                "image/jpeg",
                0.82
            );
        }
    );
}
function createScoreboardCropBlob(){
    return new Promise(
        (resolve,reject)=>{
            if(!sourceImage){
                reject(new Error("No image loaded."));
                return;
            }
            if(
                ocrAutoCropState.mode!=="auto"
                &&ocrAutoCropState.mode!=="manual"
            ){
                reject(new Error("Scoreboard crop has not been selected."));
                return;
            }
            const normalized=getNormalizedCrop();
            if(!normalized){
                reject(new Error("Scoreboard crop is invalid."));
                return;
            }
            const naturalWidth=sourceImage.naturalWidth;
            const naturalHeight=sourceImage.naturalHeight;
            const sourceLeft=Math.max(
                0,
                Math.floor(normalized.x*naturalWidth)
            );
            const sourceTop=Math.max(
                0,
                Math.floor(normalized.y*naturalHeight)
            );
            const sourceRight=Math.min(
                naturalWidth,
                Math.ceil(
                    (normalized.x+normalized.width)
                    *naturalWidth
                )
            );
            const sourceBottom=Math.min(
                naturalHeight,
                Math.ceil(
                    (normalized.y+normalized.height)
                    *naturalHeight
                )
            );
            const sourceWidth=sourceRight-sourceLeft;
            const sourceHeight=sourceBottom-sourceTop;
            if(
                sourceWidth<OCR_MIN_SOURCE_CROP_WIDTH
                ||sourceHeight<OCR_MIN_SOURCE_CROP_HEIGHT
            ){
                reject(new Error("Scoreboard crop is too small."));
                return;
            }
            const outputCanvas=document.createElement("canvas");
            outputCanvas.width=sourceWidth;
            outputCanvas.height=sourceHeight;
            const outputContext=outputCanvas.getContext(
                "2d",
                {alpha:false}
            );
            if(!outputContext){
                reject(new Error("Could not prepare scoreboard crop."));
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
                blob=>{
                    if(!blob){
                        reject(new Error("Could not create scoreboard crop."));
                        return;
                    }
                    resolve(blob);
                },
                "image/png"
            );
        }
    );
}

function loadImageFile(file){
    if(
        !file
        ||ocrControlsLocked
    ){
        return;
    }
    clearOcrJobId();
    sourceFileName=
        file.name
        ||"scoreboard.png";
    ocrDebug(
        "IMAGE FILE SELECTED",
        {
            name:file.name,
            type:file.type,
            size:file.size,
            lastModified:
                file.lastModified
        }
    );
    const reader=
        new FileReader();
    reader.onload=
        function(event){
            const image=
                new Image();
            image.onload=
                function(){
                    sourceImage=
                        image;
                    fitCanvasToImage();
                    emptyState.hidden=
                        true;
                    canvas.hidden=
                        false;
                    setOcrControlsLocked(
                        false
                    );
                    beginAutoCropSearch();
                    setStatus(
                        "Locating scoreboard..."
                    );
                    savePageState();
                    if(
                        typeof requestScoreboardLocalization
                        ==="function"
                    ){
                        requestScoreboardLocalization();
                    }else{
                        enableManualCropFallback();
                        setStatus(
                            "Automatic localization is unavailable. Adjust the crop box manually."
                        );
                    }
                    ocrDebugState(
                        "IMAGE UPLOAD COMPLETE"
                    );
                };
            image.onerror=
                function(){
                    setStatus(
                        "FAIL: Could not load the selected image."
                    );
                };
            image.src=
                event.target.result;
        };
    reader.onerror=
        function(){
            setStatus(
                "FAIL: Could not read the selected image."
            );
        };
    reader.readAsDataURL(
        file
    );
}
function handleImageInputChange(){
    if(ocrControlsLocked){
        return;
    }
    loadImageFile(
        imageInput.files?.[0]
    );
}
function handleMatchSizeChange(){
    if(ocrControlsLocked){
        return;
    }
    const names=
        getPlayerNameState();
    buildPlayerNameInputs(
        names
    );
    clearOcrJobId();
    if(sourceImage){
        beginAutoCropSearch();
        setStatus(
            `Relocating scoreboard for ${matchSize.value}v${matchSize.value}...`
        );
        savePageState();
        if(
            typeof requestScoreboardLocalization
            ==="function"
        ){
            requestScoreboardLocalization();
        }else{
            enableManualCropFallback();
        }
    }
}
function handleResetCropClick(event){
    event.preventDefault();
    if(
        !sourceImage
        ||ocrControlsLocked
    ){
        return;
    }
    clearOcrJobId();
    enableManualCropFallback();
    setStatus(
        "Manual crop enabled. Adjust the green box around the scoreboard."
    );
    savePageState();
}
function handleWindowResize(){
    if(!sourceImage){
        return;
    }
    const hasVisibleCrop=(
        ocrAutoCropState.mode==="auto"
        ||ocrAutoCropState.mode==="manual"
    );
    const normalizedCrop=hasVisibleCrop
        ?getNormalizedCrop()
        :null;
    fitCanvasToImage();
    if(
        hasVisibleCrop
        &&!restoreNormalizedCrop(
            normalizedCrop
        )
    ){
        enableManualCropFallback();
    }
    draw();
    savePageState();
}
function bindCoreEvents(){
    canvas.addEventListener(
        "pointerdown",
        handleCanvasPointerDown
    );
    canvas.addEventListener(
        "pointermove",
        handleCanvasPointerMove
    );
    canvas.addEventListener(
        "pointerup",
        handleCanvasPointerUp
    );
    canvas.addEventListener(
        "pointercancel",
        handleCanvasPointerCancel
    );
    imageInput.addEventListener(
        "change",
        handleImageInputChange
    );
    matchSize.addEventListener(
        "change",
        handleMatchSizeChange
    );
    resetCropBtn.addEventListener(
        "click",
        handleResetCropClick
    );
    window.addEventListener(
        "resize",
        handleWindowResize
    );
}
function initializeCore(){
    const requiredElements={
        imageInput:imageInput,
        matchSize:matchSize,
        resetCropBtn:resetCropBtn,
        submitBtn:submitBtn,
        canvas:canvas,
        emptyState:emptyState,
        statusBox:statusBox,
        canvasWrap:canvasWrap,
        playerNamesContainer:
            playerNamesContainer
    };
    const missing=
        Object.entries(
            requiredElements
        )
            .filter(
                (
                    [
                        ,
                        element
                    ]
                )=>!element
            )
            .map(
                (
                    [
                        name
                    ]
                )=>name
            );
    if(
        missing.length>0
    ){
        console.error(
            "[OCR] Missing required HTML elements:",
            missing
        );
        return false;
    }
    bindCoreEvents();
    if(
        !restorePageState()
    ){
        buildPlayerNameInputs();
        if(activeOcrJobId){
            setOcrControlsLocked(
                true
            );
        }else if(
            !restoreOcrSubmissionCooldown()
        ){
            setOcrControlsLocked(
                false
            );
        }
    }
    ocrDebug(
        "CORE INITIALIZED"
    );
    return true;
}
const OCR_CORE_READY=
    initializeCore();