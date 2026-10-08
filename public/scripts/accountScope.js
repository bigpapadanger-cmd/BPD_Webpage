// A stable, correlatable UI namespace. Never an authorization credential or RPC identity.
export async function createAccountScope(accountId) {
    const normalized = typeof accountId === "string" ? accountId.trim().toLowerCase() : "";
    if (!normalized) throw new TypeError("Account scope requires an account");
    const bytes = new TextEncoder().encode(`bpd:browser-account-scope:v1:${normalized}`);
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return `bpd-v1-${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function normalizeAccountScope(value) {
    return typeof value === "string" && /^bpd-v1-[a-f0-9]{64}$/u.test(value) ? value : "";
}

// Only migrate a legacy UUID-owned draft whose hash matches the server-issued scope.
// Storage failures and account changes preserve legacy data rather than guessing ownership.
export async function migrateRegistrationDraft(storage, prefix, scope, isCurrent = () => true) {
    if (!normalizeAccountScope(scope)) return false;
    try {
        const target = `${prefix}:${scope}`;
        const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
        for (const key of keys) {
            if (typeof key !== "string" || !key.startsWith(`${prefix}:`)) continue;
            const owner = key.slice(prefix.length + 1);
            if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu.test(owner)) continue;
            if (await createAccountScope(owner) !== scope) continue;
            if (!isCurrent()) return false;
            if (storage.getItem(target) !== null) return false; // Existing scoped draft wins.
            const raw = storage.getItem(key);
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
            const draft = {};
            for (const field of ["primaryPlatform", "showOnlineStatus", "findProfileEnabled", "email", "phone", "preferredMode", "otherMode", "availability", "notificationsV2"]) {
                if (Object.hasOwn(parsed, field)) draft[field] = parsed[field];
            }
            if (!isCurrent()) return false;
            storage.setItem(target, JSON.stringify(draft));
            storage.removeItem(key);
            return true;
        }
    } catch { /* Never log private draft contents or legacy keys. */ }
    return false;
}
