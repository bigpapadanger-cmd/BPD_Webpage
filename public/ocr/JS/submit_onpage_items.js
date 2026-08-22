"use strict";
/* =========================================================
   OCR ON-PAGE UI
   Owns only non-OCR page interactions and result-modal closing.
   ========================================================= */
document.addEventListener(
    "DOMContentLoaded",
    function(){
        const exampleToggle=
            document.getElementById(
                "exampleToggle"
            );
        const exampleContent=
            document.getElementById(
                "exampleContent"
            );
        const exampleToggleIcon=
            document.getElementById(
                "exampleToggleIcon"
            );
        if(
            exampleToggle
            &&exampleContent
            &&exampleToggleIcon
        ){
            exampleToggle.addEventListener(
                "click",
                function(){
                    const isOpen=
                        !exampleContent.hidden;
                    exampleContent.hidden=
                        isOpen;
                    exampleToggle.setAttribute(
                        "aria-expanded",
                        String(
                            !isOpen
                        )
                    );
                    exampleToggleIcon.textContent=
                        isOpen
                            ?"▼"
                            :"▲";
                }
            );
        }
        if(
            typeof results!=="undefined"
            &&typeof resultsCloseBtn!=="undefined"
            &&results
            &&resultsCloseBtn
        ){
            resultsCloseBtn.addEventListener(
                "click",
                function(){
                    results.close();
                }
            );
            results.addEventListener(
                "click",
                function(event){
                    if(
                        event.target===results
                    ){
                        results.close();
                    }
                }
            );
        }
    }
);