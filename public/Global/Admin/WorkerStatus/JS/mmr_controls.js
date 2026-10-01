"use strict";

export function getMmrControlModel(service, canDeploy) {
    const isMmr = service?.id === "mmr-api";
    const advertisedActions = Array.isArray(service?.actions) ? service.actions : [];
    return {
        actions: advertisedActions.filter(action => action !== "validate-build"),
        showBuildUpdate: isMmr && service?.supportsBuildUpdate === true && advertisedActions.includes("validate-build"),
        showFunctionalTest: isMmr,
        showDeploy: isMmr && canDeploy === true,
        showOperations: isMmr
    };
}
