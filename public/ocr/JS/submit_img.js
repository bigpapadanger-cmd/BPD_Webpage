"use strict";
/* =========================================================
   OCR IMAGE SUBMISSION
   Owns API endpoints, loading/progress, OCR submission,
   job polling, result rendering, and result tracking.
   It does NOT restore page/crop state or bind crop controls.
   ========================================================= */
const OCR_API_URL="/api/ocr";
const OCR_LOCALIZE_URL="/api/ocr/localize";

let OCR_LOADING_TIMER=null;
let OCR_LOADING_PROGRESS=0;
let OCR_LOADING_LAST_STATE_SAVE=0;
let OCR_LOADING_BACKEND_PROGRESS=0;
let OCR_LOADING_BACKEND_STAGE="";
let OCR_LOADING_BACKEND_STAGE_STARTED_AT=null;
let OCR_LOCALIZATION_SEQUENCE=0;
let OCR_LOADING_STAGE_STARTED_AT=null;
let OCR_LOADING_CATCHUP_TARGET=null;
let OCR_LOADING_CATCHUP_STARTED_AT=null;
let OCR_LOADING_CATCHUP_FROM=0;
let OCR_LOADING_STAGE_FROM=0;
let OCR_LOADING_DISPLAY_STAGE="";
let OCR_LOADING_STAGE_QUEUE=[];
let OCR_LOADING_QUEUE_STAGE_STARTED_AT=null;
let OCR_LOADING_QUEUE_STAGE_FROM=0;
let OCR_LOADING_QUEUE_STAGE_TARGET=0;
let OCR_LOADING_PENDING_SUCCESS=false;
const OCR_LOADING_STATE_KEY="ocrLoadingState";
const OCR_LOADING_DEFAULT_STAGE_SECONDS=10;
const OCR_LOADING_CATCHUP_SECONDS=2;
const OCR_LOADING_FINISH_SECONDS=1.5;
const OCR_STATUS_POLL_MS=2000;
const OCR_LOADING_TICK_MS=100;
const OCR_LOADING_STAGE_SECONDS={
    job_accepted:4,
    retry_pending:8,
    initializing:4,
    paddle_warmup:20,
    preflight:7,
    rows_located:4,
    tesseract_pass12:10,
    tesseract_pass3a:12,
    tesseract_pass3b:16,
    recovery:16,
    paddle:35,
    final_validation:6
};
const OCR_LOADING_STAGE_TEXT={
    initializing:"Initializing Scoreboard Reader...",
    job_accepted:"OCR Job Accepted...",
    retry_pending:"OCR Worker Restarting - Job Safely Queued...",
    paddle_warmup:"Preparing Paddle Recognition Model...",
    processing:"Preparing Scoreboard Reader...",
    preflight:"Validating Scoreboard Structure...",
    rows_located:"Identifying Player Rows...",
    tesseract:"Primary Scan Over Scoreboard Data...",
    tesseract_pass12:"Primary Scans Over Scoreboard Data...",
    tesseract_pass3a:"Recovery Scan A Over Low-Confidence Data...",
    tesseract_pass3b:"Recovery Scan B Over Remaining Data...",
    recovery:"Targeted Recovery Over Unresolved Values...",
    paddle:"Paddle Validation Over Remaining Values...",
    final_validation:"Compiling And Validating Results...",
    completed:"Scoreboard Scan Completed!"
};
const OCR_LOADING_STAGE_PROGRESS={
    job_accepted:3,
    retry_pending:4,
    initializing:5,
    paddle_warmup:8,
    processing:10,
    preflight:16,
    rows_located:30,
    tesseract:45,
    tesseract_pass12:45,
    tesseract_pass3a:60,
    tesseract_pass3b:74,
    recovery:82,
    paddle:90,
    final_validation:97,
    completed:100
};
const OCR_LOADING_STAGE_ORDER=[
    "job_accepted",
    "retry_pending",
    "initializing",
    "paddle_warmup",
    "preflight",
    "rows_located",
    "tesseract_pass12",
    "tesseract_pass3a",
    "tesseract_pass3b",
    "recovery",
    "paddle",
    "final_validation",
    "completed"
];
function getOcrLoadingStageIndex(stage){
    return OCR_LOADING_STAGE_ORDER.indexOf(
        String(stage||"")
    );
}
function getOcrLoadingStageText(stage){
    return(
        OCR_LOADING_STAGE_TEXT[
            String(stage||"")
        ]
        ||null
    );
}
function getOcrLoadingStageSeconds(stage){
    return Number(
        OCR_LOADING_STAGE_SECONDS[
            String(stage||"")
        ]
    )||OCR_LOADING_DEFAULT_STAGE_SECONDS;
}
function getOcrStageMarker(stage){
    return Number(
        OCR_LOADING_STAGE_PROGRESS[
            String(stage||"")
        ]
    )||0;
}
function getOcrNextStageMarker(stage){
    const stageIndex=
        getOcrLoadingStageIndex(
            stage
        );
    if(
        stageIndex<0
        ||stageIndex>=
            OCR_LOADING_STAGE_ORDER.length-1
    ){
        return getOcrStageMarker(
            stage
        );
    }
    return getOcrStageMarker(
        OCR_LOADING_STAGE_ORDER[
            stageIndex+1
        ]
    );
}
function getOcrCatchupCeiling(backendStage){
    const backendIndex=
        getOcrLoadingStageIndex(
            backendStage
        );
    if(backendIndex<=0){
        return OCR_LOADING_PROGRESS;
    }
    const previousStage=
        OCR_LOADING_STAGE_ORDER[
            backendIndex-1
        ];
    return getOcrStageMarker(
        previousStage
    );
}
function updateOcrLoading(
    progress,
    text=null
){
    const loadingWrap=
        document.getElementById(
            "loadingWrap"
        );
    const loadingFill=
        document.getElementById(
            "loadingFill"
        );
    const loadingPercent=
        document.getElementById(
            "loadingPercent"
        );
    const loadingText=
        document.getElementById(
            "loadingText"
        );
    if(
        !loadingWrap
        ||!loadingFill
        ||!loadingPercent
        ||!loadingText
    ){
        return;
    }
    const numericProgress=
        Number(
            progress
        );
    if(
        Number.isFinite(
            numericProgress
        )
    ){
        OCR_LOADING_PROGRESS=
            Math.max(
                OCR_LOADING_PROGRESS,
                Math.max(
                    0,
                    Math.min(
                        100,
                        numericProgress
                    )
                )
            );
    }
    loadingWrap.hidden=false;
    loadingFill.style.width=
        OCR_LOADING_PROGRESS+"%";
    loadingPercent.textContent=
        Math.round(
            OCR_LOADING_PROGRESS
        )+"%";
    if(text){
        loadingText.textContent=
            text;
    }
    saveOcrLoadingState();
}
function saveOcrLoadingState(force=false){
    const now=Date.now();
    if(
        !force
        &&now-OCR_LOADING_LAST_STATE_SAVE<250
    ){
        return;
    }
    OCR_LOADING_LAST_STATE_SAVE=
        now;
    localStorage.setItem(
        OCR_LOADING_STATE_KEY,
        JSON.stringify({
            progress:
                OCR_LOADING_PROGRESS,
            backendProgress:
                OCR_LOADING_BACKEND_PROGRESS,
            backendStage:
                OCR_LOADING_BACKEND_STAGE,
            backendStageStartedAt:
                OCR_LOADING_BACKEND_STAGE_STARTED_AT,
            displayStage:
                OCR_LOADING_DISPLAY_STAGE,
            stageQueue:[
                ...OCR_LOADING_STAGE_QUEUE
            ],
            stageFrom:
                OCR_LOADING_STAGE_FROM,
            stageElapsedMs:
                OCR_LOADING_STAGE_STARTED_AT===null
                    ?0
                    :Math.max(
                        0,
                        now
                        -OCR_LOADING_STAGE_STARTED_AT
                    ),
            catchupTarget:
                OCR_LOADING_CATCHUP_TARGET,
            catchupFrom:
                OCR_LOADING_CATCHUP_FROM,
            catchupElapsedMs:
                OCR_LOADING_CATCHUP_STARTED_AT===null
                    ?0
                    :Math.max(
                        0,
                        now
                        -OCR_LOADING_CATCHUP_STARTED_AT
                    ),
            pendingSuccess:
                OCR_LOADING_PENDING_SUCCESS
        })
    );
}
function clearOcrLoadingState(){
    localStorage.removeItem(
        OCR_LOADING_STATE_KEY
    );
    OCR_LOADING_PROGRESS=0;
    OCR_LOADING_BACKEND_PROGRESS=0;
    OCR_LOADING_BACKEND_STAGE="";
    OCR_LOADING_BACKEND_STAGE_STARTED_AT=null;
    OCR_LOADING_STAGE_STARTED_AT=null;
    OCR_LOADING_CATCHUP_TARGET=null;
    OCR_LOADING_CATCHUP_STARTED_AT=null;
    OCR_LOADING_CATCHUP_FROM=0;
    OCR_LOADING_STAGE_FROM=0;
    OCR_LOADING_DISPLAY_STAGE="";
    OCR_LOADING_STAGE_QUEUE=[];
    OCR_LOADING_QUEUE_STAGE_STARTED_AT=null;
    OCR_LOADING_QUEUE_STAGE_FROM=0;
    OCR_LOADING_QUEUE_STAGE_TARGET=0;
    OCR_LOADING_PENDING_SUCCESS=false;
}
function restoreOcrLoadingState(){
    const rawState=
        localStorage.getItem(
            OCR_LOADING_STATE_KEY
        );
    if(!rawState){
        return false;
    }
    try{
        const state=
            JSON.parse(
                rawState
            );
        const progress=
            Number(
                state.progress
            );
        const backendStage=
            String(
                state.backendStage||""
            );
        const displayStage=
            String(
                state.displayStage
                ||backendStage
                ||"job_accepted"
            );
        if(
            !Number.isFinite(
                progress
            )
            ||progress<0
            ||progress>100
            ||getOcrLoadingStageIndex(
                backendStage
            )<0
            ||getOcrLoadingStageIndex(
                displayStage
            )<0
        ){
            clearOcrLoadingState();
            return false;
        }
        OCR_LOADING_PROGRESS=
            progress;
        OCR_LOADING_BACKEND_PROGRESS=
            Number.isFinite(
                Number(
                    state.backendProgress
                )
            )
                ?Number(
                    state.backendProgress
                )
                :getOcrStageMarker(
                    backendStage
                );
        OCR_LOADING_BACKEND_STAGE=
            backendStage;
        OCR_LOADING_BACKEND_STAGE_STARTED_AT=(
            state.backendStageStartedAt
            ?String(state.backendStageStartedAt)
            :null
        );
        OCR_LOADING_DISPLAY_STAGE=
            displayStage;
        OCR_LOADING_STAGE_QUEUE=
            Array.isArray(
                state.stageQueue
            )
                ?state.stageQueue.filter(
                    function(stage){
                        return(
                            getOcrLoadingStageIndex(
                                stage
                            )>=0
                            &&stage!=="completed"
                            &&stage!==displayStage
                        );
                    }
                )
                :[];
        OCR_LOADING_STAGE_FROM=
            Number.isFinite(
                Number(
                    state.stageFrom
                )
            )
                ?Number(
                    state.stageFrom
                )
                :OCR_LOADING_PROGRESS;
        const stageElapsedMs=
            Math.max(
                0,
                Number(
                    state.stageElapsedMs
                )||0
            );
        OCR_LOADING_STAGE_STARTED_AT=
            Date.now()
            -Math.min(
                stageElapsedMs,
                getOcrLoadingStageSeconds(
                    OCR_LOADING_DISPLAY_STAGE
                )*1000
            );
        const restoredCatchupTarget=
            Number(
                state.catchupTarget
            );
        const restoredCatchupFrom=
            Number(
                state.catchupFrom
            );
        const catchupElapsedMs=
            Math.max(
                0,
                Number(
                    state.catchupElapsedMs
                )||0
            );
        if(
            Number.isFinite(
                restoredCatchupTarget
            )
            &&restoredCatchupTarget>
                OCR_LOADING_PROGRESS
        ){
            OCR_LOADING_CATCHUP_TARGET=
                restoredCatchupTarget;
            OCR_LOADING_CATCHUP_FROM=
                Number.isFinite(
                    restoredCatchupFrom
                )
                    ?restoredCatchupFrom
                    :OCR_LOADING_PROGRESS;
            OCR_LOADING_CATCHUP_STARTED_AT=
                Date.now()
                -Math.min(
                    catchupElapsedMs,
                    OCR_LOADING_CATCHUP_SECONDS
                    *1000
                );
        }else{
            OCR_LOADING_CATCHUP_TARGET=null;
            OCR_LOADING_CATCHUP_STARTED_AT=null;
            OCR_LOADING_CATCHUP_FROM=
                OCR_LOADING_PROGRESS;
        }
        OCR_LOADING_PENDING_SUCCESS=
            Boolean(
                state.pendingSuccess
            );
        OCR_LOADING_QUEUE_STAGE_STARTED_AT=null;
        OCR_LOADING_QUEUE_STAGE_FROM=
            OCR_LOADING_PROGRESS;
        OCR_LOADING_QUEUE_STAGE_TARGET=
            OCR_LOADING_PROGRESS;
        updateOcrLoading(
            OCR_LOADING_PROGRESS,
            getOcrLoadingStageText(
                OCR_LOADING_DISPLAY_STAGE
            )
        );
        console.log(
            "[OCR LOADING] RESTORED:",
            {
                progress:
                    OCR_LOADING_PROGRESS,
                displayStage:
                    OCR_LOADING_DISPLAY_STAGE,
                backendStage:
                    OCR_LOADING_BACKEND_STAGE,
                queue:[
                    ...OCR_LOADING_STAGE_QUEUE
                ]
            }
        );
        return true;
    }catch(error){
        console.error(
            "[OCR] Could not restore loading state:",
            error
        );
        clearOcrLoadingState();
        return false;
    }
}
function beginOcrCatchup(targetProgress){
    const target=
        Math.min(
            99,
            Math.max(
                OCR_LOADING_PROGRESS,
                Number(
                    targetProgress
                )||0
            )
        );
    if(
        target<=OCR_LOADING_PROGRESS
    ){
        OCR_LOADING_CATCHUP_TARGET=null;
        OCR_LOADING_CATCHUP_STARTED_AT=null;
        OCR_LOADING_CATCHUP_FROM=
            OCR_LOADING_PROGRESS;
        return;
    }
    OCR_LOADING_CATCHUP_FROM=
        OCR_LOADING_PROGRESS;
    OCR_LOADING_CATCHUP_TARGET=
        Math.max(
            OCR_LOADING_CATCHUP_TARGET||0,
            target
        );
    OCR_LOADING_CATCHUP_STARTED_AT=
        Date.now();
    console.log(
        "[OCR LOADING] CATCHUP:",
        {
            from:
                OCR_LOADING_CATCHUP_FROM,
            target:
                OCR_LOADING_CATCHUP_TARGET,
            backendStage:
                OCR_LOADING_BACKEND_STAGE
        }
    );
}
function queueOcrStagesThrough(
    backendStage
){
    let backendIndex=
        getOcrLoadingStageIndex(
            backendStage
        );
    if(backendIndex<0){
        console.warn(
            "[OCR LOADING] Unknown backend stage:",
            backendStage
        );
        return;
    }
    const completedIndex=
        getOcrLoadingStageIndex(
            "completed"
        );
    if(
        backendIndex===completedIndex
    ){
        backendIndex=
            getOcrLoadingStageIndex(
                "final_validation"
            );
    }
    const currentDisplayIndex=
        getOcrLoadingStageIndex(
            OCR_LOADING_DISPLAY_STAGE
        );
    if(
        backendIndex<=currentDisplayIndex
    ){
        return;
    }
    const confirmedStage=
        OCR_LOADING_STAGE_ORDER[
            backendIndex
        ];
    const catchupCeiling=
        getOcrCatchupCeiling(
            confirmedStage
        );
    if(
        catchupCeiling>
        OCR_LOADING_PROGRESS
    ){
        beginOcrCatchup(
            catchupCeiling
        );
    }
    OCR_LOADING_STAGE_QUEUE=[];
    for(
        let index=
            Math.max(
                0,
                currentDisplayIndex+1
            );
        index<=backendIndex;
        index++
    ){
        const stage=
            OCR_LOADING_STAGE_ORDER[
                index
            ];
        if(
            !stage
            ||stage==="completed"
        ){
            continue;
        }
        OCR_LOADING_STAGE_QUEUE.push(
            stage
        );
    }
    if(
        OCR_LOADING_DISPLAY_STAGE==="initializing"
        &&OCR_LOADING_STAGE_QUEUE.length>0
        &&OCR_LOADING_CATCHUP_TARGET===null
    ){
        startNextQueuedOcrStage();
    }
    saveOcrLoadingState();
}
function startNextQueuedOcrStage(){
    if(
        OCR_LOADING_CATCHUP_TARGET!==null
    ){
        return;
    }
    if(
        OCR_LOADING_STAGE_QUEUE.length===0
    ){
        if(
            OCR_LOADING_PENDING_SUCCESS
        ){
            OCR_LOADING_PENDING_SUCCESS=false;
            finishOcrLoading(
                true
            );
        }
        return;
    }
    const nextStage=
        OCR_LOADING_STAGE_QUEUE.shift();
    if(
        !nextStage
        ||nextStage==="completed"
    ){
        startNextQueuedOcrStage();
        return;
    }
    OCR_LOADING_DISPLAY_STAGE=
        nextStage;
    OCR_LOADING_STAGE_FROM=
        OCR_LOADING_PROGRESS;
    OCR_LOADING_STAGE_STARTED_AT=
        Date.now();
    OCR_LOADING_QUEUE_STAGE_STARTED_AT=null;
    OCR_LOADING_QUEUE_STAGE_FROM=
        OCR_LOADING_PROGRESS;
    OCR_LOADING_QUEUE_STAGE_TARGET=
        OCR_LOADING_PROGRESS;
    updateOcrLoading(
        OCR_LOADING_PROGRESS,
        getOcrLoadingStageText(
            nextStage
        )
    );
    saveOcrLoadingState();
    console.log(
        "[OCR LOADING] DISPLAYING:",
        nextStage,
        {
            from:
                OCR_LOADING_STAGE_FROM,
            backendStage:
                OCR_LOADING_BACKEND_STAGE,
            backendProgress:
                OCR_LOADING_BACKEND_PROGRESS,
            queued:[
                ...OCR_LOADING_STAGE_QUEUE
            ]
        }
    );
}
function completeCurrentQueuedOcrStage(){
    OCR_LOADING_QUEUE_STAGE_STARTED_AT=null;
    OCR_LOADING_QUEUE_STAGE_FROM=
        OCR_LOADING_PROGRESS;
    OCR_LOADING_QUEUE_STAGE_TARGET=
        OCR_LOADING_PROGRESS;
    startNextQueuedOcrStage();
}
function applyOcrBackendProgress(
    progress,
    stage,
    stageStartedAt=null
){
    const reportedStage=
        String(
            stage
            ||OCR_LOADING_BACKEND_STAGE
            ||"job_accepted"
        );
    const reportedIndex=
        getOcrLoadingStageIndex(
            reportedStage
        );
    const currentBackendIndex=
        getOcrLoadingStageIndex(
            OCR_LOADING_BACKEND_STAGE
        );
    if(stageStartedAt){
        const parsedStageStartedAt=Date.parse(
            stageStartedAt
        );
        if(Number.isFinite(parsedStageStartedAt)){
            OCR_LOADING_BACKEND_STAGE_STARTED_AT=
                new Date(parsedStageStartedAt).toISOString();
        }
    }
    if(reportedIndex<0){
        console.warn(
            "[OCR LOADING] Unknown backend stage:",
            reportedStage
        );
        return;
    }
    const numericProgress=
        Number(
            progress
        );
    if(
        Number.isFinite(
            numericProgress
        )
    ){
        OCR_LOADING_BACKEND_PROGRESS=
            Math.max(
                OCR_LOADING_BACKEND_PROGRESS,
                Math.min(
                    100,
                    numericProgress
                )
            );
    }
    if(reportedStage==="retry_pending"){
        OCR_LOADING_BACKEND_STAGE=reportedStage;
        OCR_LOADING_DISPLAY_STAGE=reportedStage;
        OCR_LOADING_STAGE_QUEUE=[];
        OCR_LOADING_STAGE_FROM=OCR_LOADING_PROGRESS;
        OCR_LOADING_STAGE_STARTED_AT=Date.now();
        updateOcrLoading(
            OCR_LOADING_PROGRESS,
            getOcrLoadingStageText(reportedStage)
        );
        saveOcrLoadingState(true);
        return;
    }
    if(
        currentBackendIndex>=0
        &&reportedIndex<
            currentBackendIndex
    ){
        console.warn(
            "[OCR LOADING] OUT-OF-SEQUENCE BACKEND REPORT:",
            reportedStage,
            "arrived after",
            OCR_LOADING_BACKEND_STAGE,
            "- keeping furthest stage."
        );
        saveOcrLoadingState();
        return;
    }
    if(
        reportedIndex>
        currentBackendIndex
    ){
        OCR_LOADING_BACKEND_STAGE=
            reportedStage;
        queueOcrStagesThrough(
            reportedStage
        );
    }
    saveOcrLoadingState();
}
function tickOcrLoading(){
    const now=
        Date.now();
    if(
        OCR_LOADING_CATCHUP_TARGET!==null
        &&OCR_LOADING_CATCHUP_STARTED_AT!==null
    ){
        const elapsed=
            now
            -OCR_LOADING_CATCHUP_STARTED_AT;
        const duration=
            OCR_LOADING_CATCHUP_SECONDS
            *1000;
        const ratio=
            Math.min(
                1,
                elapsed/duration
            );
        const progress=
            OCR_LOADING_CATCHUP_FROM
            +(
                OCR_LOADING_CATCHUP_TARGET
                -OCR_LOADING_CATCHUP_FROM
            )
            *ratio;
        updateOcrLoading(
            progress,
            getOcrLoadingStageText(
                OCR_LOADING_DISPLAY_STAGE
            )
        );
        if(ratio>=1){
            OCR_LOADING_PROGRESS=
                Math.max(
                    OCR_LOADING_PROGRESS,
                    OCR_LOADING_CATCHUP_TARGET
                );
            OCR_LOADING_CATCHUP_TARGET=null;
            OCR_LOADING_CATCHUP_STARTED_AT=null;
            OCR_LOADING_CATCHUP_FROM=
                OCR_LOADING_PROGRESS;
            startNextQueuedOcrStage();
        }
        return;
    }
    if(
        !OCR_LOADING_DISPLAY_STAGE
    ){
        OCR_LOADING_DISPLAY_STAGE=
            OCR_LOADING_BACKEND_STAGE
            ||"job_accepted";
    }
    if(
        !OCR_LOADING_STAGE_STARTED_AT
    ){
        OCR_LOADING_STAGE_STARTED_AT=
            now;
        OCR_LOADING_STAGE_FROM=
            OCR_LOADING_PROGRESS;
    }
    const currentMarker=
        getOcrStageMarker(
            OCR_LOADING_DISPLAY_STAGE
        );
    const nextMarker=
        getOcrNextStageMarker(
            OCR_LOADING_DISPLAY_STAGE
        );
    let stageElapsed=
        Math.max(
            0,
            now
            -OCR_LOADING_STAGE_STARTED_AT
        );
    if(
        OCR_LOADING_DISPLAY_STAGE===
            OCR_LOADING_BACKEND_STAGE
        &&OCR_LOADING_BACKEND_STAGE_STARTED_AT
    ){
        const serverStageStartedAt=Date.parse(
            OCR_LOADING_BACKEND_STAGE_STARTED_AT
        );
        if(Number.isFinite(serverStageStartedAt)){
            stageElapsed=Math.max(
                stageElapsed,
                now-serverStageStartedAt
            );
        }
    }
    const stageDuration=
        getOcrLoadingStageSeconds(
            OCR_LOADING_DISPLAY_STAGE
        )
        *1000;
    const slowRatio=
        Math.min(
            1,
            stageElapsed/stageDuration
        );
    const slowStart=
        Math.max(
            OCR_LOADING_STAGE_FROM,
            currentMarker
        );
    const slowTarget=
        Math.max(
            slowStart,
            Math.min(
                99,
                nextMarker-0.75
            )
        );
    const frameProgress=
        slowStart
        +(
            slowTarget
            -slowStart
        )
        *slowRatio;
    updateOcrLoading(
        frameProgress,
        getOcrLoadingStageText(
            OCR_LOADING_DISPLAY_STAGE
        )
    );
    if(
        slowRatio>=1
        &&OCR_LOADING_STAGE_QUEUE.length>0
    ){
        const nextStage=
            OCR_LOADING_STAGE_QUEUE[0];
        const nextStageIndex=
            getOcrLoadingStageIndex(
                nextStage
            );
        const backendIndex=
            getOcrLoadingStageIndex(
                OCR_LOADING_BACKEND_STAGE
            );
        if(
            nextStageIndex>=0
            &&nextStageIndex<=backendIndex
        ){
            const nextStageMarker=
                getOcrStageMarker(
                    nextStage
                );
            if(
                OCR_LOADING_PROGRESS>=
                Math.max(
                    currentMarker,
                    nextStageMarker-0.75
                )
            ){
                startNextQueuedOcrStage();
            }
        }
    }
}
function runOcrLoadingTimer(){
    if(OCR_LOADING_TIMER){
        clearInterval(
            OCR_LOADING_TIMER
        );
        OCR_LOADING_TIMER=null;
    }
    tickOcrLoading();
    OCR_LOADING_TIMER=
        setInterval(
            tickOcrLoading,
            OCR_LOADING_TICK_MS
        );
}
function startOcrLoading(){
    if(OCR_LOADING_TIMER){
        clearInterval(
            OCR_LOADING_TIMER
        );
        OCR_LOADING_TIMER=null;
    }
    OCR_LOADING_PROGRESS=1;
    OCR_LOADING_BACKEND_PROGRESS=1;
    OCR_LOADING_BACKEND_STAGE=
        "initializing";
    OCR_LOADING_DISPLAY_STAGE=
        "initializing";
    OCR_LOADING_STAGE_QUEUE=[];
    OCR_LOADING_QUEUE_STAGE_STARTED_AT=null;
    OCR_LOADING_QUEUE_STAGE_FROM=0;
    OCR_LOADING_QUEUE_STAGE_TARGET=0;
    OCR_LOADING_PENDING_SUCCESS=false;
    OCR_LOADING_STAGE_FROM=1;
    OCR_LOADING_STAGE_STARTED_AT=
        Date.now();
    OCR_LOADING_CATCHUP_TARGET=null;
    OCR_LOADING_CATCHUP_STARTED_AT=null;
    OCR_LOADING_CATCHUP_FROM=1;
    saveOcrLoadingState(
        true
    );
    updateOcrLoading(
        1,
        getOcrLoadingStageText(
            "initializing"
        )
    );
    runOcrLoadingTimer();
}
function resumeOcrLoading(){
    if(OCR_LOADING_TIMER){
        return;
    }
    if(
        !OCR_LOADING_BACKEND_STAGE
    ){
        restoreOcrLoadingState();
    }
    if(
        !OCR_LOADING_BACKEND_STAGE
    ){
        OCR_LOADING_PROGRESS=1;
        OCR_LOADING_BACKEND_PROGRESS=1;
        OCR_LOADING_BACKEND_STAGE=
            "initializing";
        OCR_LOADING_DISPLAY_STAGE=
            "initializing";
        OCR_LOADING_STAGE_QUEUE=[];
        OCR_LOADING_QUEUE_STAGE_STARTED_AT=null;
        OCR_LOADING_QUEUE_STAGE_FROM=0;
        OCR_LOADING_QUEUE_STAGE_TARGET=0;
        OCR_LOADING_PENDING_SUCCESS=false;
        OCR_LOADING_STAGE_STARTED_AT=
            Date.now();
        OCR_LOADING_STAGE_FROM=1;
        saveOcrLoadingState(
            true
        );
    }
    updateOcrLoading(
        OCR_LOADING_PROGRESS,
        getOcrLoadingStageText(
            OCR_LOADING_DISPLAY_STAGE
            ||OCR_LOADING_BACKEND_STAGE
        )
    );
    runOcrLoadingTimer();
}
function finishOcrLoading(
    success,
    onComplete=null
){
    const loadingWrap=
        document.getElementById(
            "loadingWrap"
        );
    const loadingFill=
        document.getElementById(
            "loadingFill"
        );
    const loadingPercent=
        document.getElementById(
            "loadingPercent"
        );
    const loadingText=
        document.getElementById(
            "loadingText"
        );
    if(OCR_LOADING_TIMER){
        clearInterval(
            OCR_LOADING_TIMER
        );
        OCR_LOADING_TIMER=null;
    }
    if(
        !loadingWrap
        ||!loadingFill
        ||!loadingPercent
        ||!loadingText
    ){
        clearOcrLoadingState();
        if(
            typeof onComplete==="function"
        ){
            onComplete();
        }
        return;
    }
    loadingWrap.hidden=false;
    if(success){
        const finishFrom=
            Math.min(
                99,
                Math.max(
                    0,
                    OCR_LOADING_PROGRESS
                )
            );
        const finishStartedAt=
            Date.now();
        const finishDuration=
            OCR_LOADING_FINISH_SECONDS
            *1000;
        OCR_LOADING_TIMER=
            setInterval(
                function(){
                    const ratio=
                        Math.min(
                            1,
                            (
                                Date.now()
                                -finishStartedAt
                            )
                            /finishDuration
                        );
                    const eased=
                        1-Math.pow(
                            1-ratio,
                            2
                        );
                    const progress=
                        finishFrom
                        +(
                            100
                            -finishFrom
                        )
                        *eased;
                    updateOcrLoading(
                        progress,
                        OCR_LOADING_STAGE_TEXT.completed
                    );
                    if(ratio>=1){
                        clearInterval(
                            OCR_LOADING_TIMER
                        );
                        OCR_LOADING_TIMER=null;
                        OCR_LOADING_PROGRESS=100;
                        loadingFill.style.width=
                            "100%";
                        loadingPercent.textContent=
                            "100%";
                        loadingText.textContent=
                            OCR_LOADING_STAGE_TEXT.completed;
                        clearOcrLoadingState();
                        if(
                            typeof onComplete==="function"
                        ){
                            onComplete();
                        }
                        setTimeout(
                            function(){
                                loadingWrap.hidden=true;
                            },
                            800
                        );
                    }
                },
                OCR_LOADING_TICK_MS
            );
        return;
    }
    clearOcrLoadingState();
    loadingText.textContent=
        "OCR failed";
    if(
        typeof onComplete==="function"
    ){
        onComplete();
    }
    setTimeout(
        function(){
            loadingWrap.hidden=true;
        },
        1200
    );
}
/* =========================================================
   RESULT HELPERS AND TRACKING
   ========================================================= */
function getOcrResultPlayers(result){
    const players=[];
    const addPlayers=function(
        teamName,
        teamPlayers
    ){
        if(
            !Array.isArray(
                teamPlayers
            )
        ){
            return;
        }
        teamPlayers.forEach(
            function(player){
                if(
                    player
                    &&typeof player==="object"
                ){
                    players.push({
                        team:teamName,
                        player:player
                    });
                }
            }
        );
    };
    addPlayers(
        "Team 1",
        result?.team1
    );
    addPlayers(
        "Team 2",
        result?.team2
    );
    if(players.length===0){
        addPlayers(
            "Scoreboard",
            result?.players
        );
    }
    return players;
}
function getOcrPlayerName(player){
    return String(
        player?.matchedName
        ||player?.player
        ||player?.username
        ||player?.playerName
        ||player?.name
        ||"Unknown Player"
    );
}
function getOcrPlayerConfidence(player){
    const confidence=
        Number(
            player?.confidence
            ??player?.matchConfidence
        );
    return Number.isFinite(
        confidence
    )
        ?Math.max(
            0,
            Math.min(
                100,
                confidence
            )
        )
        :null;
}
function getOcrConfidenceSummary(result){
    const players=
        getOcrResultPlayers(
            result
        );
    const confidenceValues=
        players
            .map(
                function(item){
                    return getOcrPlayerConfidence(
                        item.player
                    );
                }
            )
            .filter(
                function(value){
                    return value!==null;
                }
            );
    const averageConfidence=
        confidenceValues.length>0
            ?confidenceValues.reduce(
                function(
                    total,
                    value
                ){
                    return total+value;
                },
                0
            )
            /confidenceValues.length
            :null;
    const minimumConfidence=
        confidenceValues.length>0
            ?Math.min(
                ...confidenceValues
            )
            :null;
    return{
        players:players,
        averageConfidence:
            averageConfidence===null
                ?null
                :Number(
                    averageConfidence.toFixed(
                        2
                    )
                ),
        minimumConfidence:
            minimumConfidence===null
                ?null
                :Number(
                    minimumConfidence.toFixed(
                        2
                    )
                )
    };
}
function createResultMetric(
    label,
    value
){
    const metric=
        document.createElement(
            "div"
        );
    metric.className=
        "results-metric";
    const metricLabel=
        document.createElement(
            "span"
        );
    metricLabel.className=
        "results-metric-label";
    metricLabel.textContent=
        label;
    const metricValue=
        document.createElement(
            "span"
        );
    metricValue.className=
        "results-metric-value";
    metricValue.textContent=
        value;
    metric.append(
        metricLabel,
        metricValue
    );
    return metric;
}
function renderOcrResultSummary(
    result
){
    if(!resultsSummary){
        return;
    }
    resultsSummary.replaceChildren();
    const confidenceSummary=
        getOcrConfidenceSummary(
            result
        );
    const validationPassed=(
        result?.validation?.pass===true
        ||result?.validation?.overall==="validated"
    );
    const matchSizeLabel=
        String(
            result?.matchSize
            ||(
                matchSize?.value
                    ?`${matchSize.value}v${matchSize.value}`
                    :"Unknown"
            )
        );
    const metrics=
        document.createElement(
            "div"
        );
    metrics.className=
        "results-metrics";
    metrics.append(
        createResultMetric(
            "Result",
            validationPassed
                ?"Passed"
                :"Review"
        ),
        createResultMetric(
            "Match",
            matchSizeLabel
        ),
        createResultMetric(
            "Average confidence",
            confidenceSummary.averageConfidence===null
                ?"Unavailable"
                :`${confidenceSummary.averageConfidence.toFixed(2)}%`
        )
    );
    const playerList=
        document.createElement(
            "div"
        );
    playerList.className=
        "results-player-list";
    confidenceSummary.players.forEach(
        function(item){
            const playerRow=
                document.createElement(
                    "div"
                );
            playerRow.className=
                "results-player";
            const identity=
                document.createElement(
                    "div"
                );
            const playerName=
                document.createElement(
                    "div"
                );
            playerName.className=
                "results-player-name";
            playerName.textContent=
                getOcrPlayerName(
                    item.player
                );
            const playerTeam=
                document.createElement(
                    "div"
                );
            playerTeam.className=
                "results-player-team";
            playerTeam.textContent=
                String(
                    item.player?.team
                    ||item.team
                );
            identity.append(
                playerName,
                playerTeam
            );
            const playerConfidence=
                document.createElement(
                    "div"
                );
            playerConfidence.className=
                "results-player-confidence";
            const confidence=
                getOcrPlayerConfidence(
                    item.player
                );
            playerConfidence.textContent=
                confidence===null
                    ?"—"
                    :`${confidence.toFixed(2)}%`;
            playerRow.append(
                identity,
                playerConfidence
            );
            playerList.appendChild(
                playerRow
            );
        }
    );
    resultsSummary.append(
        metrics,
        playerList
    );
}
function renderOcrResult(
    result,
    jobId=null
){
    if(
        !results
        ||!resultsOutput
    ){
        return;
    }
    renderOcrResultSummary(
        result
    );
    resultsOutput.textContent=
        JSON.stringify(
            result,
            null,
            4
        );
    document.dispatchEvent(
        new CustomEvent(
            "ocrtesting:result-rendered",
            {
                detail:{
                    jobId:String(
                        jobId
                        ||activeOcrJobId
                        ||result?.jobId
                        ||""
                    ),
                    result:result
                }
            }
        )
    );
    if(
        typeof results.showModal==="function"
    ){
        if(!results.open){
            results.showModal();
        }
        return;
    }
    results.setAttribute(
        "open",
        ""
    );
}
function hasOcrResultData(result){
    return Boolean(
        Array.isArray(
            result?.team1
        )
        ||Array.isArray(
            result?.team2
        )
        ||Array.isArray(
            result?.players
        )
        ||result?.validation
    );
}
function trackOcrResult(
    jobId,
    result,
    responseData=null
){
    if(
        !OCR_TRACKING_URL
        ||!jobId
    ){
        return;
    }
    const trackingKey=
        `ocrTracking:${jobId}`;
    if(
        sessionStorage.getItem(
            trackingKey
        )==="sent"
    ){
        return;
    }
    const confidenceSummary=
        getOcrConfidenceSummary(
            result
        );
    const trackingUrl=
        new URL(
            OCR_TRACKING_URL
        );
    const validationPassed=(
        result?.validation?.pass===true
        ||result?.validation?.overall==="validated"
    );
    const playerConfidences=
        confidenceSummary.players.map(
            function(item){
                return{
                    team:String(
                        item.player?.team
                        ||item.team
                    ),
                    player:
                        getOcrPlayerName(
                            item.player
                        ),
                    confidence:
                        getOcrPlayerConfidence(
                            item.player
                        )
                };
            }
        );
    trackingUrl.searchParams.set(
        "action",
        "track_ocr_result"
    );
    trackingUrl.searchParams.set(
        "jobId",
        jobId
    );
    trackingUrl.searchParams.set(
        "success",
        String(
            result?.success===true
        )
    );
    trackingUrl.searchParams.set(
        "validationPass",
        String(
            validationPassed
        )
    );
    trackingUrl.searchParams.set(
        "matchSize",
        String(
            result?.matchSize
            ||matchSize?.value
            ||""
        )
    );
    trackingUrl.searchParams.set(
        "averageConfidence",
        confidenceSummary.averageConfidence===null
            ?""
            :String(
                confidenceSummary.averageConfidence
            )
    );
    trackingUrl.searchParams.set(
        "minimumConfidence",
        confidenceSummary.minimumConfidence===null
            ?""
            :String(
                confidenceSummary.minimumConfidence
            )
    );
    trackingUrl.searchParams.set(
        "playersNeedingReview",
        String(
            result?.validation?.players_needing_review
            ??0
        )
    );
    trackingUrl.searchParams.set(
        "playerConfidences",
        JSON.stringify(
            playerConfidences
        )
    );
    const runtimeSeconds=(
        result?.performance?.totalSeconds
        ??result?.performance?.runtimeSeconds
        ??result?.runtimeSeconds
        ??result?.totalSeconds
        ??result?.runReport?.totalSeconds
        ??responseData?.performance?.totalSeconds
        ??responseData?.performance?.runtimeSeconds
        ??responseData?.runtimeSeconds
        ??responseData?.totalSeconds
        ??responseData?.runReport?.totalSeconds
        ??""
    );

    console.log(
        "[OCR TRACKING] Runtime:",
        {
            runtimeSeconds:
                runtimeSeconds,
            resultPerformance:
                result?.performance,
            responsePerformance:
                responseData?.performance
        }
    );

    trackingUrl.searchParams.set(
        "runtimeSeconds",
        String(
            runtimeSeconds
        )
    );
    fetch(
        trackingUrl.toString(),
        {
            method:"GET",
            mode:"no-cors",
            cache:"no-store",
            keepalive:true
        }
    ).then(
        function(){
            sessionStorage.setItem(
                trackingKey,
                "sent"
            );
        }
    ).catch(
        function(error){
            console.warn(
                "[OCR TRACKING] Request failed:",
                error
            );
        }
    );
}
/* =========================================================
   SCOREBOARD LOCALIZATION
   Lightweight structural pass. No Paddle and no full OCR.
   ========================================================= */
async function requestScoreboardLocalization(){
    if(
        !sourceImage
        ||activeOcrJobId
        ||ocrControlsLocked
    ){
        return false;
    }
    const requestSequence=++OCR_LOCALIZATION_SEQUENCE;
    beginAutoCropSearch();
    setStatus(
        "Locating scoreboard..."
    );
    try{
        const blob=await createLocalizationBlob();
        if(requestSequence!==OCR_LOCALIZATION_SEQUENCE){
            return false;
        }
        const formData=new FormData();
        formData.append(
            "image",
            blob,
            "scoreboard_localize.jpg"
        );
        formData.append(
            "playersPerTeam",
            String(Number(matchSize.value))
        );
        const response=await fetch(
            OCR_LOCALIZE_URL,
            {
                method:"POST",
                body:formData,
                cache:"no-store"
            }
        );
        const rawText=await response.text();
        let data=null;
        try{
            data=JSON.parse(rawText);
        }catch(error){
            console.warn(
                "[OCR LOCALIZE] Invalid JSON:",
                rawText
            );
        }
        if(requestSequence!==OCR_LOCALIZATION_SEQUENCE){
            return false;
        }
        if(
            response.ok
            &&data?.success===true
            &&data?.bounds
        ){
            const applied=applyAutoCropBounds(
                data.bounds,
                data.confidence,
                data.method
            );
            if(!applied){
                throw new Error(
                    "Automatic localization returned invalid crop bounds."
                );
            }
            const confidencePercent=Math.round(
                Math.max(
                    0,
                    Math.min(
                        1,
                        Number(data.confidence)||0
                    )
                )*100
            );
            setStatus(
                "Scoreboard located automatically"
                +(confidencePercent
                    ?` (${confidencePercent}% structural confidence). `
                    :". ")
                +"Adjust the green box only if needed, then submit."
            );
            savePageState();
            return true;
        }
        enableManualCropFallback();
        setStatus(
            "Automatic localization could not confidently locate the scoreboard. Adjust the green box manually, then submit."
        );
        ocrDebug(
            "OCR LOCALIZATION FALLBACK",
            data||rawText
        );
        return false;
    }catch(error){
        if(requestSequence!==OCR_LOCALIZATION_SEQUENCE){
            return false;
        }
        console.warn(
            "[OCR LOCALIZE] ERROR:",
            error
        );
        enableManualCropFallback();
        setStatus(
            "Automatic localization was unavailable. Adjust the green box manually, then submit."
        );
        return false;
    }
}

/* =========================================================
   OCR JOB POLLING
   ========================================================= */
async function checkOcrJobStatus(
    jobId
){
    if(
        !jobId
        ||jobId!==activeOcrJobId
    ){
        return;
    }

    ocrDebug(
        "CHECKING OCR JOB",
        jobId
    );

    try{
        const statusUrl=
            "/api/ocr/status/"
            +encodeURIComponent(
                jobId
            );

        const response=await fetch(
            statusUrl,
            {
                method:"GET",
                cache:"no-store"
            }
        );

        const rawText=
            await response.text();

        let data=null;

        try{
            data=JSON.parse(
                rawText
            );
        }catch(error){
            console.error(
                "[OCR STATUS] NON-JSON RESPONSE:",
                {
                    status:response.status,
                    statusText:response.statusText,
                    body:rawText
                }
            );
        }

        /*
        =====================================================
        TRANSIENT CLOUD RUN / PROXY FAILURE
        =====================================================
        Do not abandon the OCR job because of one temporary
        502/503/504 response.
        =====================================================
        */

        if(
            response.status===502
            ||response.status===503
            ||response.status===504
        ){
            console.warn(
                "[OCR STATUS] TEMPORARY SERVER FAILURE:",
                {
                    jobId:jobId,
                    status:response.status,
                    statusText:response.statusText,
                    body:rawText
                }
            );

            resumeOcrLoading();

            setStatus(
                "OCR server is temporarily unavailable. Retrying..."
            );

            savePageState();

            submitBtn.disabled=true;

            jobPollTimer=
                setTimeout(
                    function(){
                        checkOcrJobStatus(
                            jobId
                        );
                    },
                    OCR_STATUS_POLL_MS
                );

            return;
        }

        /*
        =====================================================
        JOB NOT FOUND
        =====================================================
        */

        if(
            response.status===404
        ){
            console.error(
                "[OCR STATUS] JOB NOT FOUND:",
                {
                    jobId:jobId,
                    data:data,
                    body:rawText
                }
            );

            clearOcrJobId();

            finishOcrLoading(
                false
            );

            setStatus(
                "FAIL: OCR job was not found."
            );

            savePageState();

            startOcrSubmissionCooldown();

            return;
        }

        /*
        =====================================================
        INVALID JSON
        =====================================================
        */

        if(
            !data
        ){
            throw new Error(
                "OCR status server returned "
                +response.status
                +" "
                +response.statusText
                +"."
            );
        }

        /*
        =====================================================
        OTHER HTTP ERROR
        =====================================================
        */

        if(
            !response.ok
            &&data.status!=="failed"
        ){
            console.error(
                "[OCR STATUS] SERVER ERROR:",
                {
                    status:response.status,
                    data:data
                }
            );

            throw new Error(
                data.message
                ||(
                    "OCR status request failed with HTTP "
                    +response.status
                    +"."
                )
            );
        }

        ocrDebug(
            "OCR JOB STATUS RESPONSE",
            data
        );

        /*
        =====================================================
        QUEUED / PROCESSING
        =====================================================
        */

        if(
            data.status==="queued"
            ||data.status==="processing"
        ){
            applyOcrBackendProgress(
                data.progress,
                data.stage,
                data.stageStartedAt
            );

            resumeOcrLoading();

            setStatus(
                getOcrLoadingStageText(
                    data.stage
                )
                ||"Reading scoreboard..."
            );

            savePageState();

            submitBtn.disabled=true;

            jobPollTimer=
                setTimeout(
                    function(){
                        checkOcrJobStatus(
                            jobId
                        );
                    },
                    OCR_STATUS_POLL_MS
                );

            return;
        }

        /*
        =====================================================
        FAILED
        =====================================================
        */

        if(
            data.status==="failed"
        ){
            if(
                hasOcrResultData(
                    data
                )
            ){
                renderOcrResult(
                    data,
                    jobId
                );

                trackOcrResult(
                    jobId,
                    data
                );
            }

            clearOcrJobId();

            finishOcrLoading(
                false
            );

            setStatus(
                "FAIL: "
                +(
                    data.message
                    ||"OCR processing failed."
                )
            );

            savePageState();

            startOcrSubmissionCooldown();

            return;
        }

        /*
        =====================================================
        COMPLETED
        =====================================================
        */

        if(
            data.status==="completed"
        ){
            applyOcrBackendProgress(
                data.progress,
                data.stage,
                data.stageStartedAt
            );

            const result=(
                data.result
                &&typeof data.result==="object"
            )
                ?data.result
                :data;

            const detectedPlayers=
                result.detectedPlayers
                ??result.players?.length
                ??0;

            const expectedPlayers=
                result.expectedPlayers
                ??Number(
                    matchSize.value
                )*2;

            const validationStatus=(
                result.success===true
                ||result.validation?.pass===true
            )
                ?"validated"
                :(
                    result.validation?.overall
                    ||"review"
                );

            const matching=
                result.playerMatching
                ||{};

            ocrDebug(
                "FULL OCR VALIDATION RESULT",
                result.validation
            );

            ocrDebug(
                "FULL OCR PLAYERS RESULT",
                result.players
            );

            ocrDebug(
                "FULL OCR PLAYER MATCHING RESULT",
                matching
            );

            console.log(
                "[OCR VALIDATION FULL]",
                JSON.stringify(
                    result.validation,
                    null,
                    4
                )
            );

            console.log(
                "[OCR PLAYERS FULL]",
                JSON.stringify(
                    result.players,
                    null,
                    4
                )
            );

            console.log(
                "[OCR PLAYER MATCHING FULL]",
                JSON.stringify(
                    matching,
                    null,
                    4
                )
            );

            clearOcrJobId();

            finishOcrLoading(
                true,
                function(){
                    renderOcrResult(
                        result,
                        jobId
                    );

                    trackOcrResult(
                        jobId,
                        result,
                        data
                    );

                    if(
                        validationStatus===
                        "validated"
                    ){
                        setStatus(
                            "SUCCESS: Scoreboard read successfully. "
                            +detectedPlayers
                            +"/"
                            +expectedPlayers
                            +" players detected."
                        );
                    }else if(
                        validationStatus===
                        "review"
                    ){
                        if(
                            matching.needsReview
                        ){
                            setStatus(
                                "REVIEW: Scoreboard read "
                                +detectedPlayers
                                +"/"
                                +expectedPlayers
                                +" players, but one or more player-name matches need review."
                            );
                        }else{
                            setStatus(
                                "REVIEW: Scoreboard read successfully, but one or more values need review. "
                                +detectedPlayers
                                +"/"
                                +expectedPlayers
                                +" players detected."
                            );
                        }
                    }else{
                        setStatus(
                            "FAIL: Scoreboard validation failed. "
                            +detectedPlayers
                            +"/"
                            +expectedPlayers
                            +" players detected."
                        );
                    }

                    savePageState();

                    startOcrSubmissionCooldown();
                }
            );

            return;
        }

        throw new Error(
            "Unknown OCR job status."
        );

    }catch(error){
        console.error(
            "[OCR JOB] STATUS CHECK ERROR:",
            error
        );
        ocrDebug(
            "OCR JOB STATUS ERROR",
            {
                jobId:jobId,
                message:error.message
            }
        );
        // A durable Firestore/Cloud Tasks job must survive browser/network
        // interruptions. Keep the job ID and retry instead of abandoning it.
        resumeOcrLoading();
        setStatus(
            "OCR job is still saved. Status check failed temporarily; retrying..."
        );
        savePageState();
        submitBtn.disabled=true;
        jobPollTimer=setTimeout(
            function(){
                checkOcrJobStatus(
                    jobId
                );
            },
            OCR_STATUS_POLL_MS
        );
    }
}
/* =========================================================
   OCR SUBMISSION
   ========================================================= */
async function submitScoreboard(
    event
){
    event.preventDefault();

    if(!sourceImage){
        setStatus(
            "FAIL: No image loaded."
        );
        return;
    }

    if(activeOcrJobId){
        lockOcrSubmissionControls();
        resumeOcrLoading();
        setStatus(
            "Resuming OCR job..."
        );
        submitBtn.disabled=true;
        checkOcrJobStatus(
            activeOcrJobId
        );
        return;
    }

    if(ocrControlsLocked){
        setStatus(
            "Please wait for the current OCR request or cooldown to finish."
        );
        return;
    }

    if(ocrAutoCropState.mode==="searching"){
        setStatus(
            "Please wait for automatic scoreboard localization to finish."
        );
        return;
    }

    if(
        ocrAutoCropState.mode!=="auto"
        &&ocrAutoCropState.mode!=="manual"
    ){
        enableManualCropFallback();
        setStatus(
            "Adjust the crop box around the scoreboard, then submit again."
        );
        return;
    }

    const playerNameValidation=
        validateExpectedPlayerNames();

    if(!playerNameValidation.valid){
        setStatus(
            "FAIL: "
            +(
                playerNameValidation.message
                ||"Expected player names are invalid."
            )
        );
        return;
    }

    const expectedPlayerNames=
        playerNameValidation.names
        ||[];
    const playersPerTeam=Number(
        matchSize.value
    );
    const expectedPlayers=
        playersPerTeam*2;
    const jobId=createJobId();
    const uploadFileName=(
        sourceFileName.replace(
            /\.[^.]+$/,
            ""
        )
        +"_scoreboard.png"
    );

    lockOcrSubmissionControls();
    startOcrLoading();
    submitBtn.disabled=true;
    setStatus(
        "Preparing high-resolution scoreboard crop..."
    );
    savePageState();
    saveOcrJobId(jobId);

    try{
        ocrDebugState(
            "STATE AT SUBMIT START"
        );

        const blob=
            await createScoreboardCropBlob();
        const formData=
            new FormData();

        formData.append(
            "image",
            blob,
            uploadFileName
        );
        formData.append(
            "playersPerTeam",
            String(playersPerTeam)
        );
        formData.append(
            "expectedPlayers",
            String(expectedPlayers)
        );
        formData.append(
            "expectedPlayerNames",
            JSON.stringify(
                expectedPlayerNames
            )
        );
        formData.append(
            "jobId",
            jobId
        );

        ocrDebug(
            "SENDING DURABLE OCR JOB",
            {
                jobId:jobId,
                url:OCR_API_URL,
                filename:uploadFileName,
                cropMode:ocrAutoCropState.mode,
                cropMethod:ocrAutoCropState.method,
                manualOverride:
                    ocrAutoCropState.manualOverride,
                normalizedCrop:
                    getNormalizedCrop(),
                playersPerTeam:
                    playersPerTeam,
                expectedPlayers:
                    expectedPlayers,
                expectedPlayerNames:
                    expectedPlayerNames
            }
        );

        const response=await fetch(
            OCR_API_URL,
            {
                method:"POST",
                body:formData
            }
        );
        const rawText=await response.text();
        let data=null;

        try{
            data=JSON.parse(rawText);
        }catch(error){
            throw new Error(
                "Server returned invalid JSON."
            );
        }

        if(!response.ok){
            clearOcrJobId();
            finishOcrLoading(false);
            setStatus(
                "FAIL: "
                +(
                    data?.message
                    ||`HTTP ${response.status}`
                )
            );
            savePageState();
            startOcrSubmissionCooldown();
            return;
        }

        if(!data?.jobId){
            throw new Error(
                "Server did not return an OCR job ID."
            );
        }

        saveOcrJobId(
            data.jobId
        );
        applyOcrBackendProgress(
            data.progress,
            data.stage,
            data.stageStartedAt
        );
        setStatus(
            getOcrLoadingStageText(
                data.stage
            )
            ||"OCR job queued."
        );
        savePageState();
        checkOcrJobStatus(
            data.jobId
        );

    }catch(error){
        console.error(
            "[OCR SUBMIT] ERROR:",
            error
        );

        // The POST may have reached the durable backend even if the browser
        // lost the response. Keep the job ID and ask the status endpoint
        // before deciding the job does not exist.
        resumeOcrLoading();
        setStatus(
            "OCR submission response was interrupted. Checking durable job status..."
        );
        savePageState();
        jobPollTimer=setTimeout(
            function(){
                checkOcrJobStatus(
                    jobId
                );
            },
            OCR_STATUS_POLL_MS
        );
    }
}
/* =========================================================
   OCR MODULE EVENT BINDINGS
   Core owns page-state restoration. This file never calls
   restorePageState().
   ========================================================= */
function handleBeforeUnload(){
    if(activeOcrJobId){
        saveOcrLoadingState(
            true
        );
    }
    ocrDebug(
        "BEFOREUNLOAD - PAGE RELOADING/LEAVING"
    );
}
function handlePageHide(
    event
){
    if(activeOcrJobId){
        saveOcrLoadingState(
            true
        );
    }
    ocrDebug(
        "PAGEHIDE",
        {
            persisted:event.persisted,
            activeOcrJobId:
                activeOcrJobId
        }
    );
}
function handlePageShow(
    event
){
    ocrDebug(
        "PAGESHOW",
        {
            persisted:
                event.persisted,
            navigationType:
                performance
                    .getEntriesByType(
                        "navigation"
                    )[0]
                    ?.type
                ||"unknown"
        }
    );
}
function bindOcrEvents(){
    submitBtn.addEventListener(
        "click",
        submitScoreboard
    );
    window.addEventListener(
        "beforeunload",
        handleBeforeUnload
    );
    window.addEventListener(
        "pagehide",
        handlePageHide
    );
    window.addEventListener(
        "pageshow",
        handlePageShow
    );
}
if(OCR_CORE_READY){
    bindOcrEvents();
    if(activeOcrJobId){
        lockOcrSubmissionControls();
        resumeOcrLoading();
        setStatus(
            "Reading scoreboard..."
        );
        submitBtn.disabled=true;
        checkOcrJobStatus(
            activeOcrJobId
        );
    }
    ocrDebug(
        "OCR IMAGE MODULE INITIALIZED"
    );
}else{
    console.error(
        "[OCR] submit_core.js did not initialize correctly."
    );
}
