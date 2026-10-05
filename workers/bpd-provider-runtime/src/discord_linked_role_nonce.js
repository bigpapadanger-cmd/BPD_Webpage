const ACTION = "discord_linked_roles_verify";
const MAX_TTL_MS = 5 * 60 * 1000;
const NONCE = /^[A-Za-z0-9_-]{43}$/u;
const HASH = /^[a-f0-9]{64}$/u;

function json(code, status = 200) {
    return Response.json({ success: status === 200, code }, { status, headers: { "Cache-Control": "no-store" } });
}

export class DiscordLinkedRoleNonceAuthority {
    constructor(ctx) { this.ctx = ctx; }

    async fetch(request) {
        if (request.method !== "POST") return json("METHOD_NOT_ALLOWED", 405);
        try {
            const input = await request.json();
            const path = new URL(request.url).pathname;
            const bindingKeys = ["nonce", "accountBinding", "discordBinding", "action"];
            const keys = path === "/create" ? [...bindingKeys, "expiresAt"] : bindingKeys;
            if (!input || typeof input !== "object" || Array.isArray(input)
                || Object.keys(input).length !== keys.length || keys.some(key => !Object.hasOwn(input, key))
                || typeof input.nonce !== "string" || !NONCE.test(input.nonce)
                || typeof input.accountBinding !== "string" || !HASH.test(input.accountBinding)
                || typeof input.discordBinding !== "string" || !HASH.test(input.discordBinding)
                || input.action !== ACTION || (path === "/create" && !Number.isSafeInteger(input.expiresAt))
                || !["/create", "/begin", "/consume"].includes(path)) return json("DISCORD_NONCE_INVALID", 400);
            const outcome = await this.ctx.storage.transaction(async txn => {
                const saved = await txn.get("transaction");
                const now = Date.now();
                if (path === "/create") {
                    if (input.expiresAt <= now || input.expiresAt > now + MAX_TTL_MS) return json("DISCORD_NONCE_EXPIRED", 409);
                    if (saved) return json("DISCORD_NONCE_REPLAYED", 409);
                    await txn.put("transaction", { ...input, stage: "created" });
                    await this.ctx.storage.setAlarm(input.expiresAt);
                    return json("DISCORD_NONCE_CREATED");
                }
                if (!saved || saved.expiresAt <= now) return json("DISCORD_NONCE_EXPIRED", 409);
                if (bindingKeys.some(key => saved[key] !== input[key])) return json("DISCORD_NONCE_MISMATCH", 409);
                const requiredStage = path === "/begin" ? "created" : "begun";
                if (saved.stage !== requiredStage) return json("DISCORD_NONCE_REPLAYED", 409);
                // Commit before OAuth initiation or any eligibility/provider work.
                await txn.put("transaction", { ...saved, stage: path === "/begin" ? "begun" : "consumed" });
                return json(path === "/begin" ? "DISCORD_NONCE_BEGUN" : "DISCORD_NONCE_CONSUMED");
            });
            return outcome;
        } catch { return json("DISCORD_NONCE_UNAVAILABLE", 503); }
    }

    async alarm() {
        await this.ctx.storage.transaction(async txn => {
            const saved = await txn.get("transaction");
            if (!saved || saved.expiresAt <= Date.now()) {
                await this.ctx.storage.deleteAll();
                await this.ctx.storage.deleteAlarm();
            } else await this.ctx.storage.setAlarm(saved.expiresAt);
        });
    }
}
