export function getMmrControlModel(service, canDeployMmr) {
    const isMmr = service?.id === "mmr-api";
    const supportsBuildUpdate = isMmr && service.supportsBuildUpdate === true;
    const showDeploy = isMmr && canDeployMmr === true;
    return {
        actions: Array.isArray(service?.actions) ? service.actions : [],
        showBuildUpdate: supportsBuildUpdate,
        showDeploy,
        showOperations: supportsBuildUpdate || showDeploy
    };
}
