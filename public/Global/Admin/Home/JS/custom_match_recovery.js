"use strict";

import { apiFetch } from "/scripts/apiConnection.js";
import { boundedJson } from "/scripts/boundedRequest.js";

const lifecycle = Symbol.for("bpd.admin.customMatchRecovery");
export function initializeCustomMatchRecovery(state) {
    const panel = document.getElementById("adminCustomMatchRecovery");
    if (!panel) return;
    panel[lifecycle]?.abort();
    panel.hidden = state?.admin?.isAdmin !== true && state?.admin?.isOwner !== true;
    if (panel.hidden) return;
    const controller = new AbortController(); panel[lifecycle] = controller;
    const form = panel.querySelector("form"), status = panel.querySelector("[role=status]");
    let pending = false, transaction = null;
    form.addEventListener("submit", async event => {
        event.preventDefault();
        if (pending || !form.reportValidity()) return;
        const f = form.elements;
        const input = { matchCode: f.matchCode.value.trim(), targetMemberCode: f.targetMemberCode.value.trim(), expectedVersion: Number(f.expectedVersion.value), reason: f.reason.value.trim() };
        if (!input.reason || !Number.isSafeInteger(input.expectedVersion)) return;
        if (!window.confirm("Transfer this match's host ownership to the selected member?")) return;
        const fingerprint = JSON.stringify(input);
        if (transaction?.fingerprint !== fingerprint) transaction = { fingerprint, body: { ...input, idempotencyKey: crypto.randomUUID() } };
        pending = true; f.submitRecovery.disabled = true; status.textContent = "Checking Admin authorization and host recovery…";
        try {
            const { response, payload: value } = await boundedJson("/api/admin/rocketleague/custom-match-host-recovery", { method: "POST", credentials: "same-origin", cache: "no-store", signal: controller.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify(transaction.body) }, { fetcher: apiFetch });
            if (!panel.isConnected || controller.signal.aborted) return;
            if (response.ok && value?.success === true) {
                status.textContent = "Host transfer saved. Refresh the match to verify its current owner."; transaction = null;
            } else {
                status.textContent = response.status === 409 ? "The match changed or recovery is not allowed. Recheck the match and its version before retrying." : [401, 403].includes(response.status) ? "Current Admin authorization is required." : "Host recovery is unavailable. Please retry later.";
                if (response.status < 500) transaction = null;
            }
        } catch { if (!controller.signal.aborted) status.textContent = "Host recovery could not be confirmed. Retry with unchanged fields to reuse the same action key."; }
        finally { pending = false; if (panel.isConnected) f.submitRecovery.disabled = false; }
    }, { signal: controller.signal });
    window.addEventListener("pagehide", () => controller.abort(), { once: true, signal: controller.signal });
    document.addEventListener("bpd:page-loaded", () => { if (!panel.isConnected) controller.abort(); }, { signal: controller.signal });
}
