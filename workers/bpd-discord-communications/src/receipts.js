// Only hashed operation keys and expiry timestamps are persisted. No identities,
// task records, webhook credentials, or interaction tokens belong in this object.
export class DiscordCommunicationReceipts {
    constructor(state) { this.state = state; }
    async fetch(request) {
        if (request.method !== "POST") return new Response(null, { status: 405 });
        const value = await request.json();
        if (Object.keys(value).sort().join(",") !== "expiresAt,key" || !/^[a-f0-9]{64}$/.test(value.key)
            || !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= Date.now()
            || value.expiresAt > Date.now() + 8 * 86400000) return new Response(null, { status: 400 });
        const accepted = await this.state.storage.transaction(async storage => {
            if (await storage.get(value.key)) return false;
            await storage.put(value.key, value.expiresAt);
            const alarm = await storage.getAlarm();
            if (alarm === null || alarm > value.expiresAt) await storage.setAlarm(value.expiresAt);
            return true;
        });
        return Response.json({ accepted });
    }
    async alarm() {
        // Bounded traversal; the namespace uses one object per operation.
        const entries = await this.state.storage.list({ limit: 2 });
        const now = Date.now();
        for (const [key, expiry] of entries) {
            if (expiry <= now) await this.state.storage.delete(key);
            else await this.state.storage.setAlarm(expiry);
        }
    }
}
