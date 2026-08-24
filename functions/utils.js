export function createRandomState() {
    return crypto.randomUUID();
}

export function getMissingAuthConfiguration(env) {
    const missing = [];

    if (!env.EPIC_CLIENT_ID) missing.push("EPIC_CLIENT_ID");
    if (!env.EPIC_CLIENT_SECRET) missing.push("EPIC_CLIENT_SECRET");
    if (!env.EPIC_REDIRECT_URI) missing.push("EPIC_REDIRECT_URI");

    return missing;
}
