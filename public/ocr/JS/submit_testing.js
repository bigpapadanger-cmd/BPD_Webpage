"use strict";
/* =========================================================
   OCR ACCURACY TESTING
   Owns only Accurate/Incorrect verification, the 60-second
   response timer, and the Google Sheets verification request.
   ========================================================= */
const OCR_ACCURACY_TESTING_ENABLED=true;
const OCR_ACCURACY_RESPONSE_SECONDS=180;
const OCR_ACCURACY_TIMEOUT_VERDICT="accurate";
const ocrTestingPanel=document.getElementById("ocrTestingPanel");
const ocrTestingAccurateBtn=document.getElementById("ocrTestingAccurateBtn");
const ocrTestingIncorrectBtn=document.getElementById("ocrTestingIncorrectBtn");
const ocrTestingStatus=document.getElementById("ocrTestingStatus");
let ocrTestingCurrentJobId="";
let ocrTestingCurrentResult=null;
let ocrTestingResponseTimer=null;
let ocrTestingDeadline=0;
let ocrTestingSubmitting=false;
function getOcrTestingStorageKey(jobId){
    return"ocrAccuracyVerification:"+String(jobId||"");
}
function getOcrTestingDeadlineKey(jobId){
    return"ocrAccuracyVerificationDeadline:"+String(jobId||"");
}
function clearOcrTestingResponseTimer(){
    if(ocrTestingResponseTimer!==null){
        clearTimeout(
            ocrTestingResponseTimer
        );
        ocrTestingResponseTimer=null;
    }
}
function setOcrTestingButtonsDisabled(disabled){
    if(ocrTestingAccurateBtn){
        ocrTestingAccurateBtn.disabled=
            Boolean(
                disabled
            );
    }
    if(ocrTestingIncorrectBtn){
        ocrTestingIncorrectBtn.disabled=
            Boolean(
                disabled
            );
    }
}
function getOcrTestingValidationPassed(result){
    if(
        result?.validation?.pass!==undefined
    ){
        return(
            result.validation.pass===true
        );
    }
    return(
        result?.validation?.overall==="validated"
    );
}
function getOcrTestingRuntimeSeconds(result){
    return(
        result?.performance?.totalSeconds
        ??result?.totalSeconds
        ??result?.runReport?.totalSeconds
        ??""
    );
}
function buildOcrAccuracyVerificationUrl(
    verdict,
    reason="",
    automatic=false
){
    const result=
        ocrTestingCurrentResult
        ||{};
    const confidenceSummary=
        typeof getOcrConfidenceSummary==="function"
            ?getOcrConfidenceSummary(
                result
            )
            :{
                players:[],
                averageConfidence:null,
                minimumConfidence:null
            };
    const playerConfidences=
        Array.isArray(
            confidenceSummary.players
        )
            ?confidenceSummary.players.map(
                function(item){
                    return{
                        team:String(
                            item.player?.team
                            ||item.team
                            ||""
                        ),
                        player:
                            typeof getOcrPlayerName==="function"
                                ?getOcrPlayerName(
                                    item.player
                                )
                                :String(
                                    item.player?.matchedName
                                    ||item.player?.username
                                    ||item.player?.name
                                    ||""
                                ),
                        confidence:
                            typeof getOcrPlayerConfidence==="function"
                                ?getOcrPlayerConfidence(
                                    item.player
                                )
                                :(
                                    item.player?.confidence
                                    ??null
                                )
                    };
                }
            )
            :[];
    const testingUrl=
        new URL(
            OCR_TRACKING_URL
        );
    testingUrl.searchParams.set(
        "action",
        "verify_ocr_accuracy"
    );
    testingUrl.searchParams.set(
        "jobId",
        ocrTestingCurrentJobId
    );
    testingUrl.searchParams.set(
        "verdict",
        verdict
    );
    testingUrl.searchParams.set(
        "reason",
        String(
            reason||""
        )
    );
    testingUrl.searchParams.set(
        "automatic",
        String(
            automatic===true
        )
    );
    testingUrl.searchParams.set(
        "ocrSuccess",
        String(
            result?.success===true
        )
    );
    testingUrl.searchParams.set(
        "validationPass",
        String(
            getOcrTestingValidationPassed(
                result
            )
        )
    );
    testingUrl.searchParams.set(
        "matchSize",
        String(
            result?.matchSize
            ||matchSize?.value
            ||""
        )
    );
    testingUrl.searchParams.set(
        "averageConfidence",
        confidenceSummary.averageConfidence===null
            ?""
            :String(
                confidenceSummary.averageConfidence
            )
    );
    testingUrl.searchParams.set(
        "minimumConfidence",
        confidenceSummary.minimumConfidence===null
            ?""
            :String(
                confidenceSummary.minimumConfidence
            )
    );
    testingUrl.searchParams.set(
        "playersNeedingReview",
        String(
            result?.validation?.players_needing_review
            ??0
        )
    );
    testingUrl.searchParams.set(
        "playerConfidences",
        JSON.stringify(
            playerConfidences
        )
    );
    testingUrl.searchParams.set(
        "runtimeSeconds",
        String(
            getOcrTestingRuntimeSeconds(
                result
            )
        )
    );
    testingUrl.searchParams.set(
        "responseSeconds",
        String(
            OCR_ACCURACY_RESPONSE_SECONDS
        )
    );
    return testingUrl;
}
async function submitOcrAccuracyVerification(
    verdict,
    options={}
){
    if(
        !OCR_ACCURACY_TESTING_ENABLED
        ||!ocrTestingCurrentJobId
        ||!ocrTestingCurrentResult
        ||ocrTestingSubmitting
    ){
        if(
            !ocrTestingCurrentJobId
            ||!ocrTestingCurrentResult
        ){
            if(ocrTestingStatus){
                ocrTestingStatus.textContent=
                    "No OCR result is available to verify.";
            }
        }
        return false;
    }
    const storageKey=
        getOcrTestingStorageKey(
            ocrTestingCurrentJobId
        );
    if(
        sessionStorage.getItem(
            storageKey
        )
    ){
        return true;
    }
    const automatic=
        options.automatic===true;
    const reason=
        String(
            options.reason||""
        );
    ocrTestingSubmitting=true;
    clearOcrTestingResponseTimer();
    setOcrTestingButtonsDisabled(
        true
    );
    if(ocrTestingStatus){
        ocrTestingStatus.textContent=
            automatic
                ?"No response received. Saving result automatically..."
                :"Saving accuracy verification...";
    }
    const testingUrl=
        buildOcrAccuracyVerificationUrl(
            verdict,
            reason,
            automatic
        );
        try{
            await fetch(
                testingUrl.toString(),
                {
                    method:"GET",
                    mode:"no-cors",
                    cache:"no-store",
                    keepalive:true
                }
            );
            console.log(
                "[OCR TESTING] Verification request sent:",
                {
                    jobId:
                        ocrTestingCurrentJobId,
                    verdict:
                        verdict,
                    automatic:
                        automatic
                }
            );
            sessionStorage.setItem(
                storageKey,
                verdict
            );
            sessionStorage.removeItem(
                getOcrTestingDeadlineKey(
                    ocrTestingCurrentJobId
                )
            );
            ocrTestingDeadline=0;
            if(ocrTestingStatus){
                if(automatic){
                    ocrTestingStatus.textContent=
                        "No response received within 60 seconds. Result was automatically accepted.";
                }else{
                    ocrTestingStatus.textContent=(
                        verdict==="accurate"
                            ?"Accuracy confirmed and sent."
                            :"Correction requirement sent."
                    );
                }
            }
            return true;
        }catch(error){
            console.warn(
                "[OCR TESTING] Accuracy verification failed:",
                error
            );
            ocrTestingSubmitting=false;
            if(automatic){
                scheduleOcrAccuracyTimeout(
                    Date.now()+5000
                );
                if(ocrTestingStatus){
                    ocrTestingStatus.textContent=
                        "Automatic verification could not be sent. Retrying...";
                }
            }else{
                setOcrTestingButtonsDisabled(
                    false
                );
                if(ocrTestingStatus){
                    ocrTestingStatus.textContent=
                        "Accuracy verification could not be sent. Please try again.";
                }
            }
            return false;
        }finally{
            if(
                sessionStorage.getItem(
                    storageKey
                )
            ){
                ocrTestingSubmitting=false;
            }
        }
}
function handleOcrAccuracyTimeout(){
    if(
        !ocrTestingCurrentJobId
        ||!ocrTestingCurrentResult
    ){
        return;
    }
    const storageKey=
        getOcrTestingStorageKey(
            ocrTestingCurrentJobId
        );
    if(
        sessionStorage.getItem(
            storageKey
        )
    ){
        clearOcrTestingResponseTimer();
        return;
    }
    submitOcrAccuracyVerification(
        OCR_ACCURACY_TIMEOUT_VERDICT,
        {
            automatic:true,
            reason:
                "No user response within 60 seconds."
        }
    );
}
function scheduleOcrAccuracyTimeout(deadline){
    clearOcrTestingResponseTimer();
    ocrTestingDeadline=
        Number(
            deadline
        )
        ||(
            Date.now()
            +OCR_ACCURACY_RESPONSE_SECONDS
            *1000
        );
    sessionStorage.setItem(
        getOcrTestingDeadlineKey(
            ocrTestingCurrentJobId
        ),
        String(
            ocrTestingDeadline
        )
    );
    const remaining=
        Math.max(
            0,
            ocrTestingDeadline
            -Date.now()
        );
    if(remaining<=0){
        handleOcrAccuracyTimeout();
        return;
    }
    ocrTestingResponseTimer=
        setTimeout(
            handleOcrAccuracyTimeout,
            remaining
        );
}
function restoreOrStartOcrAccuracyTimeout(){
    const deadlineKey=
        getOcrTestingDeadlineKey(
            ocrTestingCurrentJobId
        );
    const storedDeadline=
        Number(
            sessionStorage.getItem(
                deadlineKey
            )||0
        );
    if(storedDeadline>0){
        scheduleOcrAccuracyTimeout(
            storedDeadline
        );
        return;
    }
    scheduleOcrAccuracyTimeout(
        Date.now()
        +OCR_ACCURACY_RESPONSE_SECONDS
        *1000
    );
}
function showOcrAccuracyTesting(
    jobId,
    result
){
    if(
        !OCR_ACCURACY_TESTING_ENABLED
        ||!ocrTestingPanel
    ){
        return;
    }
    clearOcrTestingResponseTimer();
    ocrTestingCurrentJobId=
        String(
            jobId
            ||result?.jobId
            ||""
        ).trim();
    ocrTestingCurrentResult=
        result||null;
    ocrTestingSubmitting=false;
    ocrTestingPanel.hidden=false;
    if(
        !ocrTestingCurrentJobId
        ||!ocrTestingCurrentResult
    ){
        setOcrTestingButtonsDisabled(
            true
        );
        if(ocrTestingStatus){
            ocrTestingStatus.textContent=
                "No OCR result is available to verify.";
        }
        return;
    }
    const existingVerification=
        sessionStorage.getItem(
            getOcrTestingStorageKey(
                ocrTestingCurrentJobId
            )
        );
    if(existingVerification){
        setOcrTestingButtonsDisabled(
            true
        );
        if(ocrTestingStatus){
            ocrTestingStatus.textContent=(
                existingVerification==="accurate"
                    ?"Accuracy confirmed for this OCR job."
                    :"This OCR job was marked as needing correction."
            );
        }
        return;
    }
    setOcrTestingButtonsDisabled(
        false
    );
    if(ocrTestingStatus){
        ocrTestingStatus.textContent=
            "Please review the result. If no response is received within 60 seconds, it will be accepted automatically.";
    }
    restoreOrStartOcrAccuracyTimeout();
}
function recheckOcrAccuracyDeadline(){
    if(
        !ocrTestingCurrentJobId
        ||!ocrTestingCurrentResult
        ||sessionStorage.getItem(
            getOcrTestingStorageKey(
                ocrTestingCurrentJobId
            )
        )
    ){
        return;
    }
    const storedDeadline=
        Number(
            sessionStorage.getItem(
                getOcrTestingDeadlineKey(
                    ocrTestingCurrentJobId
                )
            )||0
        );
    if(
        storedDeadline>0
        &&Date.now()>=storedDeadline
    ){
        handleOcrAccuracyTimeout();
        return;
    }
    if(
        storedDeadline>0
        &&ocrTestingResponseTimer===null
    ){
        scheduleOcrAccuracyTimeout(
            storedDeadline
        );
    }
}
if(ocrTestingPanel){
    ocrTestingPanel.hidden=true;
}
document.addEventListener(
    "ocrtesting:result-rendered",
    function(event){
        showOcrAccuracyTesting(
            event.detail?.jobId,
            event.detail?.result
        );
    }
);
ocrTestingAccurateBtn?.addEventListener(
    "click",
    function(){
        submitOcrAccuracyVerification(
            "accurate",
            {
                automatic:false,
                reason:
                    "User confirmed OCR result."
            }
        );
    }
);
ocrTestingIncorrectBtn?.addEventListener(
    "click",
    function(){
        submitOcrAccuracyVerification(
            "needs_correction",
            {
                automatic:false,
                reason:
                    "User marked OCR result as needing correction."
            }
        );
    }
);
document.addEventListener(
    "visibilitychange",
    function(){
        if(
            document.visibilityState==="visible"
        ){
            recheckOcrAccuracyDeadline();
        }
    }
);
window.addEventListener(
    "pageshow",
    recheckOcrAccuracyDeadline
);