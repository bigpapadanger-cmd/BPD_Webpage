import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { initializeAdminAccordions, setAdminAccordionSummary } from "../../public/Global/Admin/Shared/JS/accordion.js";

class Element {
    constructor(tag) { this.tagName = tag; this.children = []; this.attributes = {}; this.dataset = {}; this.listeners = new Map(); this.id = ""; this.textContent = ""; this.value = ""; this.open = false; }
    append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } }
    replaceChildren(...children) { this.children = []; this.append(...children); }
    setAttribute(key, value) { this.attributes[key] = value; }
    addEventListener(type, listener) { const listeners = this.listeners.get(type) || []; listeners.push(listener); this.listeners.set(type, listeners); }
    querySelector() { return this.children.find(child => child.tagName === "summary"); }
    querySelectorAll(tag) { return this.children.flatMap(child => [...(child.tagName === tag ? [child] : []), ...child.querySelectorAll(tag)]); }
    remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); }
    toggle() { this.open = !this.open; for (const listener of this.listeners.get("toggle") || []) listener(); }
}

test("native accordion synchronizes expanded state and panel references without duplicate listeners", () => {
    const details = new Element("details"), summary = new Element("summary"), panel = new Element("div");
    details.append(summary, panel);
    const root = { querySelectorAll: () => [details] };
    initializeAdminAccordions(root);
    assert.equal(summary.attributes["aria-expanded"], "false");
    assert.equal(summary.attributes["aria-controls"], panel.id);
    initializeAdminAccordions(root);
    assert.equal(details.listeners.get("toggle").length, 1);
    details.toggle();
    assert.equal(summary.attributes["aria-expanded"], "true");
    details.toggle();
    assert.equal(summary.attributes["aria-expanded"], "false");
    assert.equal(summary.listeners.size, 0, "native summary owns Enter/Space and click activation");
});

test("reinitialization uses current summary and fresh route elements do not inherit open state", () => {
    const details = new Element("details"), first = new Element("summary"), panel = new Element("div");
    details.append(first, panel);
    const root = { querySelectorAll: () => [details] };
    initializeAdminAccordions(root);
    const second = new Element("summary"); details.replaceChildren(second, panel);
    initializeAdminAccordions(root); details.toggle();
    assert.equal(second.attributes["aria-expanded"], "true");
    const fresh = new Element("details"), freshSummary = new Element("summary"); fresh.append(freshSummary, new Element("div"));
    initializeAdminAccordions({ querySelectorAll: () => [fresh] });
    assert.equal(freshSummary.attributes["aria-expanded"], "false");
});

test("summary rendering preserves real zero and fails safely when optional markup is absent", () => {
    const label = new Element("span"); setAdminAccordionSummary(label, 0);
    assert.equal(label.textContent, "0");
    setAdminAccordionSummary(label, "Unavailable"); assert.equal(label.textContent, "Unavailable");
    setAdminAccordionSummary(null, "Unavailable");
    initializeAdminAccordions({ querySelectorAll: () => [new Element("details")] });
});

async function suggestionModule() {
    let source = await readFile(new URL("../../public/Global/Admin/Suggestions/JS/index.js", import.meta.url), "utf8");
    source = source.replace(/import \{ getAuthState, hasAdminPermission \}[^;]+;/u,
        "const getAuthState = async () => globalThis.suggestionTestAllowed; const hasAdminPermission = (_, auth) => auth;");
    source = source.replace(/import \{ ADMIN_SUGGESTIONS_API_URL, adminSuggestionReviewApiUrl \}[^;]+;/u,
        'const ADMIN_SUGGESTIONS_API_URL = "/pending"; const adminSuggestionReviewApiUrl = id => `/review/${id}`;');
    source = source.replace('"../../Shared/JS/accordion.js"', JSON.stringify(new URL("../../public/Global/Admin/Shared/JS/accordion.js", import.meta.url).href));
    source = source.replace('"../../../../scripts/boundedRequest.js"', JSON.stringify(new URL("../../public/scripts/boundedRequest.js", import.meta.url).href));
    return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

test("suggestion accordion preserves permissions, pending counts, review actions and failure recovery", async () => {
    const previous = { document: globalThis.document, fetch: globalThis.fetch };
    const nodes = Object.fromEntries(["suggestionReviewStatus", "suggestionReviewList", "suggestionReviewSection", "suggestionReviewCount"].map(id => [id, new Element("div")]));
    globalThis.document = { getElementById: id => nodes[id], querySelectorAll: () => [], createElement: tag => new Element(tag) };
    try {
        const module = await suggestionModule();
        let calls = 0;
        globalThis.fetch = async () => { calls++; return Response.json({ success: true, suggestions: [{ id: "one", title: "Idea", description: "A suggestion", created_at: "2026-10-05T00:00:00Z", upvotes: 0 }] }); };
        globalThis.suggestionTestAllowed = false;
        await module.initializePage(); assert.equal(calls, 0); assert.equal(nodes.suggestionReviewSection.hidden, true);
        globalThis.suggestionTestAllowed = true;
        await Promise.all([module.initializePage(), module.initializePage()]);
        assert.equal(calls, 1); assert.equal(nodes.suggestionReviewList.children.length, 1);
        assert.equal(nodes.suggestionReviewCount.textContent, "1 pending loaded");
        const buttons = nodes.suggestionReviewList.querySelectorAll("button");
        globalThis.fetch = async () => { throw new Error("provider failed"); };
        await buttons[0].listeners.get("click")[0]();
        assert.equal(buttons[0].disabled, false); assert.equal(buttons[1].disabled, false);
        assert.match(nodes.suggestionReviewStatus.textContent, /could not be reviewed/);
        let resolveReview, mutationCalls = 0;
        globalThis.fetch = async () => { mutationCalls++; return new Promise(resolve => { resolveReview = resolve; }); };
        const pendingReview = buttons[0].listeners.get("click")[0]();
        await buttons[1].listeners.get("click")[0]();
        assert.equal(mutationCalls, 1);
        assert.equal(buttons[0].disabled, true);
        resolveReview(Response.json({ success: true }));
        await pendingReview;
        assert.equal(nodes.suggestionReviewList.children.length, 0);
        assert.equal(nodes.suggestionReviewCount.textContent, "0 pending loaded");
        globalThis.fetch = async () => { throw new Error("failed load"); };
        await module.initializePage();
        assert.match(nodes.suggestionReviewStatus.textContent, /could not be loaded/);
        assert.equal(nodes.suggestionReviewCount.textContent, "Pending list unavailable");
    } finally { globalThis.document = previous.document; globalThis.fetch = previous.fetch; delete globalThis.suggestionTestAllowed; }
});

test("Suggestions timeout covers fetch and body decode, and malformed lists fail closed", async () => {
    const saved = { fetch: globalThis.fetch, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
    const module = await suggestionModule();
    let deadline, cleared = 0;
    globalThis.setTimeout = callback => { deadline = callback; return 1; };
    globalThis.clearTimeout = () => { cleared++; };
    try {
        globalThis.fetch = async (_, { signal }) => new Promise((resolve, reject) => {
            signal.addEventListener("abort", () => reject(new DOMException("Timed out", "AbortError")));
            queueMicrotask(() => deadline());
        });
        await assert.rejects(module.requestSuggestionReview("/pending"), /The request timed out/);
        globalThis.fetch = async (_, { signal }) => ({ ok: true, json: async () => {
            deadline();
            if (signal.aborted) throw new DOMException("Body timed out", "AbortError");
        } });
        await assert.rejects(module.requestSuggestionReview("/pending"), /The request timed out/);
        globalThis.fetch = async () => Response.json({ success: false, message: "private" });
        await assert.rejects(module.requestSuggestionReview("/pending"), /REVIEW_UNAVAILABLE/);
        assert.equal(cleared, 3);
    } finally { Object.assign(globalThis, saved); }
});

test("Admin navigation reuses shared controlled submenus and keeps all existing destinations", async () => {
    const html = await readFile(new URL("../../public/Framework/Shell/HTML/Sidebar/admin.html", import.meta.url), "utf8");
    for (const [id, labels] of [["adminOperationsSubmenu", ["Taskboard", "User Management", "Match Management"]],
        ["adminReviewSubmenu", ["FAQ", "Suggestions"]], ["adminSystemSubmenu", ["System Status"]]]) {
        assert.ok(html.includes(`aria-controls="${id}"`));
        const body = html.match(new RegExp(`<div[^>]*id="${id}"[^>]*hidden>([\\s\\S]*?)</div>`))?.[1];
        assert.ok(body);
        for (const label of labels) assert.ok(body.includes(label));
    }
    assert.match(html, /data-nav-route="\/Admin"[^>]*data-nav-exact/);
    for (const destination of ["/Dashboard", "/Settings", "/TOS", "/Privacy", "/Admin/FAQReview"]) assert.ok(html.includes(`href="${destination}"`));
    assert.doesNotMatch(html, /onclick|<script|fetch\(/);
    const shared = await readFile(new URL("../../public/Framework/Shell/JS/Sidebar/submenu.js", import.meta.url), "utf8");
    assert.match(shared, /submenuInitialized/);
    assert.match(shared, /event.key === "Escape"/);
});

test("Admin integrations keep critical status outside disclosures and activate the FAQ review link", async () => {
    const home = await readFile(new URL("../../public/Global/Admin/Home/HTML/index.html", import.meta.url), "utf8");
    const health = await readFile(new URL("../../public/Global/Admin/WorkerStatus/HTML/index.html", import.meta.url), "utf8");
    const suggestion = await readFile(new URL("../../public/Global/Admin/Suggestions/HTML/index.html", import.meta.url), "utf8");
    assert.match(home, /Review FAQ Questions/); assert.match(home, /href="\/Admin\/FAQReview"/);
    assert.doesNotMatch(home, /\/api\/faq/);
    assert.ok(suggestion.indexOf('id="suggestionReviewStatus"') < suggestion.indexOf('id="suggestionReviewSection"'));
    assert.ok(health.indexOf('id="routeDiagnosticsStatus"') < health.indexOf('id="systemDiagnostics"'));
    assert.ok(health.indexOf('id="rlForceRefreshMessage"') < health.indexOf('id="rocketLeagueForceRefresh"'));
    assert.match(health, /workerStatusIssues/);
    const userModule = await readFile(new URL("../../public/Global/Admin/UserManagement/JS/index.js", import.meta.url), "utf8");
    assert.match(userModule, /if \(state.detail\) detail.append\(renderDetail\(state.detail\)\)/);
    assert.doesNotMatch(userModule, /state\.detail\?\.account\?\.accountId/);
});
