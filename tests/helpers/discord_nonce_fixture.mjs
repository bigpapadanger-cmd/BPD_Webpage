import { createHash } from "node:crypto";
import { DiscordLinkedRoleNonceAuthority } from "../../workers/bpd-provider-runtime/src/discord_linked_role_nonce.js";
import runtime from "../../workers/bpd-provider-runtime/src/index.js";

export function transactionalStorage() {
    const values = new Map();
    let tail = Promise.resolve();
    const storage = {
        alarm: null,
        get: async key => structuredClone(values.get(key)),
        put: async (key, value) => { values.set(key, structuredClone(value)); },
        deleteAll: async () => { values.clear(); },
        setAlarm: async time => { storage.alarm = time; },
        deleteAlarm: async () => { storage.alarm = null; },
        transaction(callback) {
            const operation = tail.then(() => callback(storage));
            tail = operation.catch(() => {});
            return operation;
        }
    };
    return storage;
}

export const nonceBindings = (accountId, discordId, nonce) => ({ nonce,
    accountBinding: createHash("sha256").update(`bpd-account:${accountId}`).digest("hex"),
    discordBinding: createHash("sha256").update(`discord-identity:${discordId}`).digest("hex"),
    action: "discord_linked_roles_verify" });

export async function nonceRuntimeFixture({ accountId = "canonical", discordId = "900000000000000001", nonce = "x".repeat(43), stage = "begun", expired = false } = {}) {
    const storage = transactionalStorage();
    const object = new DiscordLinkedRoleNonceAuthority({ storage });
    const env = { PROVIDER_RUNTIME_CALLER_SECRET: "p".repeat(64),
        DISCORD_LINKED_ROLE_NONCE: { idFromName: key => key, get: () => object } };
    const binding = { fetch: request => runtime.fetch(request, env) };
    const body = nonceBindings(accountId, discordId, nonce);
    const call = (operation, input) => binding.fetch(new Request(`https://provider-runtime.internal/internal/discord/linked-roles/nonce/${operation}`, {
        method: "POST", headers: { Authorization: `Bearer ${env.PROVIDER_RUNTIME_CALLER_SECRET}`, "Content-Type": "application/json" }, body: JSON.stringify(input)
    }));
    if (stage !== "missing") {
        await call("create", { ...body, expiresAt: Date.now() + 60_000 });
        if (stage === "begun") await call("begin", body);
        if (expired) await storage.put("transaction", { ...await storage.get("transaction"), expiresAt: 1 });
    }
    return { object, storage, binding, env, body, call };
}
