"use strict";

/* =========================================================
   BPD GAMING NETWORK
   OCR ON-PAGE UI

   Owns:
   - example panel
   - result-modal closing
   - crop-fallback presentation
   ========================================================= */

document.addEventListener(
    "DOMContentLoaded",
    function(){

        const exampleToggle =
            document.getElementById(
                "exampleToggle"
            );

        const exampleContent =
            document.getElementById(
                "exampleContent"
            );

        const exampleToggleIcon =
            document.getElementById(
                "exampleToggleIcon"
            );

        const cropFallback =
            document.getElementById(
                "cropFallback"
            );

        const cropHelp =
            document.querySelector(
                ".crop-help"
            );


        /* =================================================
           EXAMPLE
           ================================================= */

        if(
            exampleToggle
            && exampleContent
            && exampleToggleIcon
        ){
            exampleToggle.addEventListener(
                "click",
                function(){

                    const isOpen =
                        !exampleContent.hidden;

                    exampleContent.hidden =
                        isOpen;

                    exampleToggle.setAttribute(
                        "aria-expanded",
                        String(
                            !isOpen
                        )
                    );

                    exampleToggleIcon.textContent =
                        isOpen
                            ? "▼"
                            : "▲";
                }
            );
        }


        /* =================================================
           RESULTS MODAL
           ================================================= */

        if(
            typeof results !== "undefined"
            && typeof resultsCloseBtn !== "undefined"
            && results
            && resultsCloseBtn
        ){
            resultsCloseBtn.addEventListener(
                "click",
                function(){
                    results.close();
                }
            );

            results.addEventListener(
                "click",
                function(
                    event
                ){
                    if(
                        event.target === results
                    ){
                        results.close();
                    }
                }
            );
        }


        /* =================================================
           INITIAL CROP FALLBACK STATE
           ================================================= */

        if(
            cropFallback
        ){
            cropFallback.hidden = true;
        }

        if(
            cropHelp
        ){
            cropHelp.textContent =
                (
                    "The full-image attempt could not reliably locate "
                    + "the scoreboard. Move and resize the green box "
                    + "around the scoreboard, then retry."
                );
        }

        if(
            resetCropBtn
        ){
            resetCropBtn.hidden = true;
        }


        /* =================================================
           CROP FALLBACK SHOWN
           ================================================= */

        document.addEventListener(
            "ocr:crop-fallback-shown",
            function(){

                if(
                    cropFallback
                ){
                    cropFallback.hidden =
                        false;
                }

                if(
                    resetCropBtn
                ){
                    resetCropBtn.hidden =
                        false;

                    resetCropBtn.disabled =
                        ocrControlsLocked;
                }

                if(
                    submitBtn
                ){
                    submitBtn.textContent =
                        "Retry Cropped Scoreboard";
                }
            }
        );


        /* =================================================
           SUCCESS
           ================================================= */

        document.addEventListener(
            "ocr:successful-result",
            function(){

                if(
                    cropFallback
                ){
                    cropFallback.hidden =
                        true;
                }

                if(
                    resetCropBtn
                ){
                    resetCropBtn.hidden =
                        true;
                }

                if(
                    submitBtn
                ){
                    submitBtn.textContent =
                        "Read Scoreboard";
                }
            }
        );
    }
);