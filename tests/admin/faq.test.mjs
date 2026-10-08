import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { handleFaq } from "../../functions/services/faq/service.js";
import { onRequest as publicRoute } from "../../functions/api/faq/index.js";
import { onRequest as submitRoute } from "../../functions/api/faq/questions.js";
import { onRequest as listRoute } from "../../functions/api/admin/faq/index.js";
import { matchFaqs, normalizeQuestion, answerCard } from "../../public/Required/FAQ/JS/shared.js";
import { initializePage as publicPage } from "../../public/Required/FAQ/JS/index.js";
import { initializePage as adminPage, availableReviewActions } from "../../public/Global/Admin/FAQ/JS/index.js";
import { ROUTES } from "../../public/routes.js";

const actor = "11111111-1111-4111-8111-111111111111", id = "22222222-2222-4222-8222-222222222222";
const key = "33333333-3333-4333-8333-333333333333", now = "2026-10-06T12:00:00Z";
const env = { SUPABASE_URL: "https://database.example", SUPABASE_AUTH: "session-key", SUPABASE_SERVICE_ROLE_KEY: "private-service-key" };
const faq = { id, question: "How do I link my Epic account?", answer: "Open Account and connect Epic.", updatedAt: now };
const published = { success: true, faqs: [faq], capturedAt: now };
const row = { id, question: faq.question, normalizedQuestion: "private-normalization", status: "pending", revision: 1,
    submitterAccountId: actor, submitterDisplayName: "Player", duplicateFaqId: null, publishedFaqId: null, createdAt: now, updatedAt: now };
const listing = { success: true, rows: [row], total: 31, page: 1, pageSize: 30, hasMore: true, capturedAt: now };
const request = (path, body, headers = {}) => new Request(`https://bpd.example${path}`, body === undefined ? { headers } : {
    method: "POST", headers: { origin: "https://bpd.example", "content-type": "application/json", ...headers }, body: JSON.stringify(body)
});
function deps(result, inspect = () => {}) {
    return { authorize: async (_, __, options) => { assert.ok(["post", "view_account"].includes(options.action)); return { accountId: actor }; },
        permissions: async () => ({ canReview: true }), fetcher: async (url, init) => {
            inspect(url, JSON.parse(init.body), init);
            assert.equal(init.headers.apikey, env.SUPABASE_SERVICE_ROLE_KEY);
            assert.equal(init.redirect, "error");
            return result instanceof Response ? result : Response.json(result);
        } };
}

test("published FAQ projection removes private fields and rejects invalid publication data", async () => {
    const result = await handleFaq(request("/api/faq"), env, "public", null, deps({ ...published,
        faqs: [{ ...faq, submitterAccountId: actor, reviewNote: "private", idempotencyKey: key }] }));
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), published);
    for (const publication_state of ["draft", "archived"]) {
        const response = await handleFaq(request("/api/faq"), env, "public", null, deps({ ...published, faqs: [{ ...faq, publication_state }] }));
        assert.equal(response.status, 503);
    }
});

test("submit derives account identity and retains retry idempotency without exposing keys", async () => {
    for (const reused of [false, true]) {
        const response = await handleFaq(request("/api/faq/questions", { question: "My question", idempotencyKey: key }), env, "submit", null,
            deps({ success: true, question: { id, status: "pending", createdAt: now, reused, idempotencyKey: key, accountId: actor }, capturedAt: now }, (_, args) => {
                assert.deepEqual(args, { p_account_id: actor, p_question: "My question", p_idempotency_key: key });
            }));
        const body = await response.json();
        assert.equal(response.status, 200); assert.equal(body.question.reused, reused);
        assert.equal(JSON.stringify(body).includes(actor), false); assert.equal(JSON.stringify(body).includes(key), false);
    }
});

test("strict input, CSRF, methods and forbidden account checks prevent invalid mutations", async () => {
    let calls = 0;
    const options = deps({}, () => calls++);
    for (const body of [{ question: "Question", idempotencyKey: key, accountId: actor }, { question: " ", idempotencyKey: key },
        { question: "x".repeat(501), idempotencyKey: key }, { question: "Question", idempotencyKey: "invalid" }]) {
        assert.equal((await handleFaq(request("/api/faq/questions", body), env, "submit", null, options)).status, 400);
    }
    assert.equal((await handleFaq(request("/api/faq/questions", { question: "Question", idempotencyKey: key }, { origin: "https://evil.example" }), env, "submit", null, options)).status, 403);
    assert.equal((await handleFaq(request("/api/faq/questions"), env, "submit", null, options)).status, 405);
    for (const [code, status] of [["AUTHENTICATION_REQUIRED", 401], ["ACCOUNT_SUSPENDED", 403], ["ACCOUNT_ACCESS_RESTRICTED", 403]]) {
        const rejected = await handleFaq(request("/api/faq/questions", { question: "Question", idempotencyKey: key }), env, "submit", null,
            { ...options, authorize: async () => { throw Object.assign(new Error("private"), { code, status }); } });
        assert.equal(rejected.status, status); assert.equal((await rejected.json()).error, code);
    }
    assert.equal(calls, 0);
});

test("safe domain errors include rate limiting and revision conflict without upstream disclosure", async () => {
    for (const [code, status] of [["FAQ_SUBMISSION_RATE_LIMITED", 429], ["FAQ_SUBMISSION_FORBIDDEN", 403], ["IDEMPOTENCY_KEY_CONFLICT", 409]]) {
        const result = await handleFaq(request("/api/faq/questions", { question: "Question", idempotencyKey: key }), env, "submit", null,
            deps(Response.json({ message: code, details: "database secret private", hint: "provider-secret" }, { status: 400 })));
        assert.equal(result.status, status);
        const body = await result.json(); assert.equal(body.error, code); assert.doesNotMatch(JSON.stringify(body), /database secret|provider-secret/);
        if (status === 429) assert.match(body.message, /limit/);
    }
    const response = await handleFaq(request("/api/faq"), env, "public", null,
        deps(Response.json({ message: "raw SQL secret" }, { status: 500 })));
    assert.equal(response.status, 503); assert.equal((await response.json()).error, "FAQ_UNAVAILABLE");
});

test("Admin list filters/pagination use session actor and strip unnecessary private data", async () => {
    for (const status of ["all", "pending", "approved", "answered", "duplicate", "rejected"]) {
        const response = await handleFaq(request(`/api/admin/faq?status=${status}&page=2`), env, "list", null, deps({ ...listing, page: 2 }, (_, args) => {
            assert.deepEqual(args, { p_actor_account_id: actor, p_status: status, p_page: 2, p_page_size: 30 });
        }));
        const result = await response.json(); assert.equal(response.status, 200); assert.equal(result.pageSize, 30);
        assert.equal(result.permissions.canReview, true); assert.equal("submitterAccountId" in result.rows[0], false);
        assert.equal("normalizedQuestion" in result.rows[0], false);
    }
    assert.equal((await handleFaq(request(`/api/admin/faq?actorAccountId=${actor}`), env, "list", null, deps(listing))).status, 400);
    const denied = await handleFaq(request("/api/admin/faq"), env, "list", null, { ...deps(listing),
        permissions: async () => { throw Object.assign(new Error("private"), { code: "USER_MANAGEMENT_FORBIDDEN", status: 403 }); } });
    assert.equal(denied.status, 403);
});

test("all review actions pass loaded revision; RPC owner/admin authority cannot be bypassed", async () => {
    for (const role of ["owner", "admin", "moderator", "staff"]) {
        for (const action of ["approve", "answer", "publish", "duplicate", "reject"]) {
            const allowed = ["owner", "admin"].includes(role);
            const result = { success: true, action, question: { id, status: "answered", revision: 2, publishedFaqId: id, duplicateFaqId: null }, capturedAt: now };
            const response = await handleFaq(request(`/api/admin/faq/${id}/review`, { action, answer: "An answer", duplicateFaqId: id,
                reviewNote: "Private note", expectedRevision: 1 }), env, "review", id, deps(allowed ? result
                    : Response.json({ message: "FAQ_REVIEW_FORBIDDEN", details: "private" }, { status: 400 }), (_, args) => {
                assert.equal(args.p_actor_account_id, actor); assert.equal(args.p_expected_revision, 1); assert.equal(args.p_action, action);
            }));
            assert.equal(response.status, allowed ? 200 : 403);
        }
    }
    const conflict = await handleFaq(request(`/api/admin/faq/${id}/review`, { action: "approve", expectedRevision: 1 }), env, "review", id,
        deps(Response.json({ message: "FAQ_QUESTION_REVISION_CONFLICT" }, { status: 400 })));
    assert.equal(conflict.status, 409); assert.match((await conflict.json()).message, /changed/);
});

test("real route wrappers authenticate BPD sessions and use current view/post enforcement", async () => {
    const previous = globalThis.fetch;
    const access = { exists: true, state: "active", accountActive: true, suspended: false, suspendedUntil: null,
        banned: false, removed: false, rocketLeague: { exists: false, active: false } };
    const runtime = { ...env, AUTH_SESSIONS: { get: async () => ({ UserId: actor, Active: true, Role: "user", LastSeenAt: Date.now(), AbsoluteExpiresAt: Date.now() + 60000 }) } };
    let allowed = true;
    globalThis.fetch = async (url, init) => {
        const rpc = String(url).split("/").at(-1);
        if (rpc === "get_account_access_state") return Response.json(access);
        if (rpc === "can_account_perform") return Response.json(allowed);
        if (rpc === "list_published_faqs") return Response.json(published);
        if (rpc === "submit_faq_question") {
            assert.equal(JSON.parse(init.body).p_account_id, actor);
            return Response.json({ success: true, question: { id, status: "pending", createdAt: now, reused: false }, capturedAt: now });
        }
        if (rpc === "admin_list_users") return Response.json({ success: true, permissions: { role: "staff", view: true, addNote: false,
            suspend: false, disableRocketLeague: false, ban: false, remove: false, manageRoles: false },
            pagination: { total: 0, limit: 30, offset: 0, hasMore: false }, users: [], capturedAt: now });
        if (rpc === "admin_list_faq_questions") return Response.json(listing);
        throw new Error("Unexpected RPC");
    };
    try {
        assert.equal((await publicRoute({ request: request("/api/faq"), env: runtime })).status, 200);
        const cookie = { cookie: "bpd_session=test-session" };
        assert.equal((await submitRoute({ request: request("/api/faq/questions", { question: "Question", idempotencyKey: key }, cookie), env: runtime })).status, 200);
        const listed = await listRoute({ request: request("/api/admin/faq", undefined, cookie), env: runtime });
        assert.equal(listed.status, 200); assert.equal((await listed.json()).permissions.canReview, false);
        allowed = false; access.state = "suspended"; access.suspended = true;
        assert.equal((await submitRoute({ request: request("/api/faq/questions", { question: "Question", idempotencyKey: key }, cookie), env: runtime })).status, 403);
    } finally { globalThis.fetch = previous; }
});

test("deterministic matching returns exact/multiple candidates and does not invent matches", () => {
    assert.equal(normalizeQuestion("  EPIC—Account?! "), "epic account");
    assert.equal(matchFaqs(faq.question, [faq])[0].score, 1);
    assert.equal(matchFaqs("link Epic account", [faq, { ...faq, id: key, question: "Can I link a Discord account?" }]).length, 2);
    assert.equal(matchFaqs("quantum bananas", [faq]).length, 0);
    assert.equal(matchFaqs("how do I", [faq]).length, 0);
    assert.deepEqual(availableReviewActions("pending"), ["approve", "duplicate", "reject"]);
    assert.deepEqual(availableReviewActions("approved"), ["answer", "duplicate", "reject"]);
    assert.deepEqual(availableReviewActions("answered"), ["publish"]);
    assert.deepEqual(availableReviewActions("duplicate"), []);
});

class Element {
    constructor(tag = "div") { this.tagName = tag; this.children = []; this.dataset = {}; this.attributes = {}; this.value = ""; this.textContent = ""; this.hidden = false; this.disabled = false; }
    append(...nodes) { for (const child of nodes) { child.parent = this; this.children.push(child); } }
    replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
    setAttribute(key, value) { this.attributes[key] = value; }
    addEventListener() {}
    querySelector(selector) { return this.children.find(child => child.tagName === selector); }
    querySelectorAll(selector) {
        const matches = child => selector === "details[data-admin-accordion]" ? child.tagName === "details" && Object.hasOwn(child.dataset, "adminAccordion")
            : selector === '[data-needs-published="true"]' ? child.dataset.needsPublished === "true" : selector.split(", ").includes(child.tagName);
        return this.children.flatMap(child => [...(matches(child) ? [child] : []), ...child.querySelectorAll(selector)]);
    }
}
function setup(ids) {
    const nodes = Object.fromEntries(ids.map(id => [id, new Element()]));
    const document = { getElementById: id => nodes[id], createElement: tag => new Element(tag), querySelectorAll: () => [] };
    return { nodes, document };
}

test("public FAQ displays candidates before submission, retries same key, and recovers failures safely", async () => {
    const previous = { document: globalThis.document, fetch: globalThis.fetch };
    const { nodes, document } = setup(["faqAskForm", "faqQuestion", "faqCheck", "faqSubmit", "faqNone", "faqMatches", "faqAskStatus", "faqPublished", "faqRetry"]);
    globalThis.document = document;
    let posts = [], error = null;
    globalThis.fetch = async (path, init) => {
        if (path === "/api/faq") return Response.json(published);
        posts.push(JSON.parse(init.body));
        if (error) return Response.json({ success: false, error, message: "You have reached the question limit." }, { status: 429 });
        return Response.json({ success: true, question: { reused: posts.length > 1 } });
    };
    try {
        await publicPage();
        nodes.faqQuestion.value = faq.question; nodes.faqQuestion.oninput();
        nodes.faqCheck.onclick(); assert.equal(nodes.faqMatches.children.length, 1); assert.equal(posts.length, 0);
        assert.equal(nodes.faqSubmit.disabled, true);
        // Opening an existing answer does not make a submission.
        nodes.faqMatches.children[0].open = true; assert.equal(posts.length, 0);
        nodes.faqNone.onclick(); assert.equal(nodes.faqSubmit.disabled, false);
        error = "FAQ_SUBMISSION_RATE_LIMITED"; await nodes.faqSubmit.onclick();
        assert.equal(nodes.faqQuestion.disabled, false); assert.equal(nodes.faqSubmit.disabled, false);
        assert.equal(nodes.faqAskStatus.dataset.state, "warning");
        error = null; await nodes.faqSubmit.onclick();
        assert.equal(posts[0].idempotencyKey, posts[1].idempotencyKey); assert.equal("accountId" in posts[0], false);
        assert.equal(nodes.faqSubmit.disabled, true);
        nodes.faqQuestion.value = "New question"; nodes.faqQuestion.oninput(); nodes.faqCheck.onclick();
        assert.equal(nodes.faqMatches.children.length, 0); nodes.faqNone.onclick();
        let finish;
        globalThis.fetch = async () => new Promise(resolve => { finish = () => resolve(Response.json({ success: true, question: { reused: false } })); });
        const pending = nodes.faqSubmit.onclick(); await Promise.resolve();
        assert.equal(nodes.faqSubmit.disabled, true); assert.equal(nodes.faqQuestion.disabled, true);
        await nodes.faqSubmit.onclick(); finish(); await pending;
        globalThis.fetch = async () => { throw new Error("Service unavailable"); };
        await publicPage(); assert.equal(nodes.faqCheck.disabled, true); assert.equal(nodes.faqRetry.disabled, false);
        const xss = answerCard({ question: "<script>alert(1)</script>", answer: "<img src=x onerror=alert(1)>" });
        assert.equal(xss.children[0].textContent, "<script>alert(1)</script>");
        assert.equal(xss.children[1].textContent, "<img src=x onerror=alert(1)>");
    } finally { globalThis.document = previous.document; globalThis.fetch = previous.fetch; }
});

test("Admin UI stays read-only for staff, uses revisions, restores controls and reloads conflicts", async () => {
    const previous = { document: globalThis.document, fetch: globalThis.fetch };
    const { nodes, document } = setup(["adminFaqPage", "adminFaqStatus", "adminFaqRefresh", "adminFaqCount", "adminFaqFilter",
        "adminFaqList", "adminFaqPrevious", "adminFaqNext", "adminFaqPageNumber"]);
    const root = nodes.adminFaqPage;
    for (const name of ["adminFaqRefresh", "adminFaqPrevious", "adminFaqNext"]) nodes[name].tagName = "button";
    nodes.adminFaqFilter.tagName = "select"; nodes.adminFaqFilter.value = "pending";
    root.append(...Object.values(nodes).filter(node => node !== root));
    globalThis.document = document;
    let canReview = false, reviewFailure = true, gets = 0, post = null;
    globalThis.fetch = async (path, init) => {
        if (path === "/api/faq") return Response.json(published);
        if (init.method === "POST") {
            post = JSON.parse(init.body);
            return reviewFailure ? Response.json({ success: false, error: "FAQ_QUESTION_REVISION_CONFLICT", message: "Question changed." }, { status: 409 }) : Response.json({ success: true });
        }
        gets++; return Response.json({ ...listing, permissions: { canReview } });
    };
    try {
        await adminPage(); assert.equal(nodes.adminFaqList.querySelectorAll("button").length, 0);
        assert.equal(nodes.adminFaqNext.disabled, false); assert.equal(nodes.adminFaqPrevious.disabled, true);
        canReview = true; await adminPage();
        const buttons = nodes.adminFaqList.querySelectorAll("button"); assert.equal(buttons.length, 3);
        const before = gets; await buttons[0].onclick(); assert.equal(gets, before + 1);
        assert.equal(post.expectedRevision, 1); assert.equal("actorAccountId" in post, false);
        assert.equal(nodes.adminFaqRefresh.disabled, false);
        globalThis.fetch = async () => { throw new Error("Failed request"); };
        await nodes.adminFaqList.querySelectorAll("button")[0].onclick();
        assert.equal(nodes.adminFaqRefresh.disabled, false); assert.equal(nodes.adminFaqList.querySelectorAll("button")[0].disabled, false);
        assert.match(nodes.adminFaqStatus.textContent, /Failed request/);
    } finally { globalThis.document = previous.document; globalThis.fetch = previous.fetch; }
});

test("FAQ routes integrate with existing shell and retain curated content without Suggestions coupling", async () => {
    assert.equal(ROUTES["/Admin/FAQReview"].requiresAuth, true);
    assert.equal(ROUTES["/Admin/FAQReview"].sitemap, false);
    const html = await readFile(new URL("../../public/Required/FAQ/HTML/index.html", import.meta.url), "utf8");
    assert.equal((html.match(/class="faq-item"/g) || []).length, 8);
    assert.match(html, /href="\/Suggestions"/);
    const client = await readFile(new URL("../../public/Required/FAQ/JS/index.js", import.meta.url), "utf8");
    assert.doesNotMatch(client, /innerHTML|SUPABASE|\/api\/suggestions/);
});

test("Admin answer/duplicate/publish UX uses valid state, published choices, and restores failed mutations", async () => {
    const previous = { document: globalThis.document, fetch: globalThis.fetch };
    const { nodes, document } = setup(["adminFaqPage", "adminFaqStatus", "adminFaqRefresh", "adminFaqCount", "adminFaqFilter",
        "adminFaqList", "adminFaqPrevious", "adminFaqNext", "adminFaqPageNumber"]);
    const root = nodes.adminFaqPage;
    for (const name of ["adminFaqRefresh", "adminFaqPrevious", "adminFaqNext"]) nodes[name].tagName = "button";
    nodes.adminFaqFilter.tagName = "select"; nodes.adminFaqFilter.value = "approved";
    root.append(...Object.values(nodes).filter(node => node !== root));
    globalThis.document = document;
    let status = "approved", posted = [], publicationFailed = false;
    globalThis.fetch = async (path, init) => {
        if (path === "/api/faq") {
            if (publicationFailed) throw new Error("Published answers unavailable");
            return Response.json(published);
        }
        if (init.method === "POST") {
            posted.push(JSON.parse(init.body));
            return Response.json({ success: false, error: "FAQ_UNAVAILABLE", message: "Review unavailable" }, { status: 503 });
        }
        return Response.json({ ...listing, rows: [{ ...row, status }], permissions: { canReview: true } });
    };
    try {
        await adminPage();
        let buttons = nodes.adminFaqList.querySelectorAll("button");
        assert.deepEqual(buttons.map(button => button.textContent), ["Save draft answer", "Mark Duplicate", "Reject"]);
        await buttons[0].onclick(); assert.equal(posted.length, 0);
        nodes.adminFaqList.querySelectorAll("textarea")[1].value = "Plain text answer";
        await buttons[0].onclick(); assert.equal(posted[0].action, "answer"); assert.equal(posted[0].answer, "Plain text answer");
        assert.equal(buttons[0].disabled, false);
        const selection = nodes.adminFaqList.querySelectorAll("select")[0];
        assert.deepEqual(selection.children.map(option => option.value), ["", id]);
        await buttons[1].onclick(); assert.equal(posted.length, 1);
        selection.value = id; await buttons[1].onclick();
        assert.equal(posted[1].duplicateFaqId, id); assert.equal(posted[1].action, "duplicate");
        await buttons[2].onclick(); assert.equal(posted[2].action, "reject");
        status = "answered"; await nodes.adminFaqRefresh.onclick();
        // The event handler starts load asynchronously; let both reads settle.
        await new Promise(resolve => setTimeout(resolve, 0));
        buttons = nodes.adminFaqList.querySelectorAll("button");
        assert.equal(buttons[0].textContent, "Publish answer");
        await buttons[0].onclick(); assert.equal(posted.at(-1).action, "publish");
        status = "pending"; publicationFailed = true;
        await adminPage();
        buttons = nodes.adminFaqList.querySelectorAll("button");
        assert.equal(buttons[1].disabled, true); assert.equal(buttons[0].disabled, false);
        assert.match(nodes.adminFaqStatus.textContent, /duplicate selection is disabled/);
    } finally { globalThis.document = previous.document; globalThis.fetch = previous.fetch; }
});

test("FAQ provider malformed/oversized responses and header timeout fail closed", async t => {
    let response = await handleFaq(request("/api/faq"), env, "public", null,
        deps(new Response("{invalid json", { status: 200 })));
    assert.equal(response.status, 503); assert.equal((await response.json()).error, "FAQ_UNAVAILABLE");
    response = await handleFaq(request("/api/faq"), env, "public", null,
        deps(new Response("small", { headers: { "Content-Length": "3000000" } })));
    assert.equal(response.status, 503);
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const pending = handleFaq(request("/api/faq"), env, "public", null, {
        ...deps({}), fetcher: async () => new Promise(() => {})
    });
    await Promise.resolve();
    t.mock.timers.tick(10001);
    response = await pending; assert.equal(response.status, 503); assert.equal((await response.json()).error, "FAQ_UNAVAILABLE");
    t.mock.timers.reset();
});


test("published FAQ diagnostics correlate stages and redact upstream/request secrets", async () => {
    const secret = "private@example.test Bearer private-token provider-subject " + actor;
    const cases = [
        [env, () => Response.json(published), 200, "response_normalization", 200, null],
        [{}, () => { throw new Error("Must not fetch"); }, 503, "configuration", null, "FAQ_UNAVAILABLE"],
        [{ ...env, SUPABASE_URL: "http://invalid.example" }, () => { throw new Error("Must not fetch"); }, 503, "configuration", null, "FAQ_UNAVAILABLE"],
        [env, () => { throw new Error(secret); }, 503, "rpc_fetch", null, "UPSTREAM_UNAVAILABLE"],
        [env, () => Response.json({ code: "PGRST202", message: secret, details: secret }, { status: 404 }), 503, "rpc_rejected", 404, "PGRST202"],
        [env, () => Response.json({ code: secret, message: secret }, { status: 500 }), 503, "rpc_rejected", 500, "UPSTREAM_REJECTED"],
        [env, () => new Response(secret), 503, "response_decode", 200, "UNRECOGNIZED_ERROR"],
        [env, () => new Response(""), 503, "response_decode", 200, "UNRECOGNIZED_ERROR"],
        [env, () => Response.json({ success: true, capturedAt: now, faqs: [{ ...faq, publicationState: "draft", email: secret }] }), 503, "response_normalization", 200, "FAQ_RESPONSE_INVALID"],
        [env, () => new Response(secret, { headers: { "Content-Length": "3000000" } }), 503, "body_read", 200, "UPSTREAM_RESPONSE_TOO_LARGE"]
    ];
    const originalInfo = console.info, originalFetch = globalThis.fetch;
    let log;
    console.info = (label, value) => { assert.equal(label, "[FAQ DIAGNOSTIC]"); log = value; };
    try {
        for (const [runtime, fetcher, status, stage, upstreamStatus, code] of cases) {
            globalThis.fetch = fetcher;
            const response = await publicRoute({ request: request("/api/faq", undefined, { cookie: secret, authorization: secret, "X-Debug-ID": secret }), env: runtime });
            assert.equal(response.status, status);
            assert.equal(response.headers.get("Cache-Control"), "no-store");
            assert.equal(response.headers.get("X-Debug-ID"), log.debugId);
            assert.match(log.debugId, /^[0-9a-f-]{36}$/);
            assert.equal(log.stage, stage); assert.equal(log.rpc, "list_published_faqs");
            assert.equal(log.operation, "published_faqs"); assert.equal(log.upstreamStatus, upstreamStatus);
            assert.equal(log.code, code); assert.equal(log.timeout, false); assert.ok(log.elapsedMs >= 0);
            const body = await response.json();
            if (status === 200) assert.deepEqual(body, published);
            else assert.deepEqual(body, { success: false, error: stage === "response_normalization" ? "FAQ_RESPONSE_INVALID" : "FAQ_UNAVAILABLE", message: "FAQ services are temporarily unavailable. Please retry." });
            const serialized = JSON.stringify(log) + JSON.stringify(body);
            for (const value of [secret, actor, "private-token", "private-service-key", "session-key", "private@example.test", "provider-subject"]) assert.equal(serialized.includes(value), false);
            assert.deepEqual(Object.keys(log).sort(), ["debugId", "stage", "operation", "rpc", "upstreamStatus", "code", "timeout", "deadlineState", "elapsedMs"].sort());
        }
    } finally { console.info = originalInfo; globalThis.fetch = originalFetch; }
});

test("FAQ stalled fetch and body preserve browser error and report timeout stage", async t => {
    const originalInfo = console.info;
    let log;
    console.info = (_, value) => { log = value; };
    try {
        for (const bodyStall of [false, true]) {
            t.mock.timers.enable({ apis: ["setTimeout"] });
            try {
                const pending = handleFaq(request("/api/faq"), env, "public", null, { fetcher: async () => bodyStall
                    ? new Response(new ReadableStream({ start() {} })) : new Promise(() => {}) });
                await new Promise(resolve => setImmediate(resolve));
                t.mock.timers.tick(10001);
                const response = await pending;
                assert.equal(response.status, 503); assert.equal(response.headers.get("Cache-Control"), "no-store");
                assert.deepEqual(await response.json(), { success: false, error: "FAQ_UNAVAILABLE", message: "FAQ services are temporarily unavailable. Please retry." });
                assert.equal(log.stage, bodyStall ? "body_read" : "rpc_fetch");
                assert.equal(log.upstreamStatus, bodyStall ? 200 : null);
                assert.equal(log.code, "UPSTREAM_TIMEOUT"); assert.equal(log.timeout, true); assert.equal(log.deadlineState, "expired");
            } finally { t.mock.timers.reset(); }
        }
    } finally { console.info = originalInfo; }
});
