export async function initializeRouteModule(
    moduleFile
) {
    if (!moduleFile) {
        return;
    }
    const pageModule =
        await import(moduleFile);
    if (
        typeof pageModule.initializePage
        === "function"
    ) {
        await pageModule.initializePage();
    }
}