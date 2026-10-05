// Singleton security authority. Never reset or delete this monotonic tombstone.
export class RlProbeSecurityAuthority {
    constructor(ctx, env = {}) { this.ctx = ctx; this.env = env; }
    async fetch(request) {
        const operation = new URL(request.url).pathname.split("/").at(-1);
        if (request.method !== "POST" || !["read", "bump"].includes(operation)) return new Response(null, { status: 404 });
        try {
            const body = JSON.parse(await request.text());
            const keys = Object.keys(body);
            if (Array.isArray(body) || keys.length > (operation === "read" ? 1 : 0)
                || keys.some(key => key !== "accountKey") || keys.length && !/^[a-f0-9]{64}$/u.test(body.accountKey)) return new Response(null, { status: 400 });
            const outcome = await this.ctx.storage.transaction(async storage => {
                const epoch = await storage.get("epoch") ?? 1;
                if (!Number.isSafeInteger(epoch) || epoch < 1 || epoch === Number.MAX_SAFE_INTEGER) throw new Error("invalid");
                const active = Object.fromEntries(Object.entries(await storage.get("active") ?? {}).filter(([, expires]) => expires > Date.now()));
                if (body.accountKey) active[body.accountKey] = Date.now() + 30 * 60000;
                if (Object.keys(active).length > 1000) throw new Error("capacity");
                const current = operation === "bump" ? epoch + 1 : epoch;
                await storage.put("epoch", current);
                await storage.put("active", active);
                return { epoch: String(current), active: Object.keys(active) };
            });
            if (operation === "bump") {
                // Epoch commits FIRST. A cleanup failure cannot make old assertions valid again.
                // Bounded sequential fanout clears live in-memory credentials and temporary state.
                let failed = false;
                for (const accountKey of outcome.active) {
                    try {
                        if (!this.env.RL_USER_SESSION) throw new Error("cleanup unavailable");
                        const stub = this.env.RL_USER_SESSION.get(this.env.RL_USER_SESSION.idFromName(accountKey));
                        const response = await stub.fetch(new Request("https://rl-probe.internal/invalidate", {
                            method: "POST", body: JSON.stringify({ accountKey, reason: "emergency" })
                        }));
                        const body = await response.json();
                        if (!response.ok || body.success !== true || body.code !== "RL_PROBE_INVALIDATED") failed = true;
                    } catch { failed = true; }
                }
                if (failed) throw new Error("cleanup unavailable");
            }
            return Response.json({ success: true, epoch: outcome.epoch }, { headers: { "Cache-Control": "no-store" } });
        } catch { return Response.json({ success: false, code: "RL_PROBE_AUTHORITY_UNAVAILABLE" }, { status: 503 }); }
    }
}

export async function readGlobalProbeEpoch(env, accountKey = null) {
    if (!env.RL_PROBE_SECURITY?.idFromName) throw new Error("RL_PROBE_AUTHORITY_UNAVAILABLE");
    const stub = env.RL_PROBE_SECURITY.get(env.RL_PROBE_SECURITY.idFromName("global-revocation-authority-v1"));
    const response = await stub.fetch(new Request("https://rl-security.internal/read", { method: "POST", body: JSON.stringify(accountKey ? { accountKey } : {}) }));
    const body = await response.json();
    if (!response.ok || body.success !== true || !/^[1-9]\d*$/u.test(body.epoch)
        || !Number.isSafeInteger(Number(body.epoch))) throw new Error("RL_PROBE_AUTHORITY_UNAVAILABLE");
    return body.epoch;
}
