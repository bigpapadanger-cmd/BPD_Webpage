import test from "node:test";
import assert from "node:assert/strict";
import { createNotificationController, getNotificationReviewDestination, normalizeClientNotification } from "../../public/Framework/Shell/JS/notifications.js";

const CODE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const UUID = "11111111-1111-4111-8111-111111111111";
const validNotice = (overrides = {}) => ({ publicCode: CODE, source: "profile", severity: "notice", title: "Finish setup",
    message: "Complete your Rocket League profile.", actionRequired: true, reviewAction: "profile.complete",
    createdAt: "2026-10-08T12:00:00.000Z", expiresAt: null, internalId: UUID, ...overrides });

class FakeElement {
    constructor(document, tagName) {
        this.ownerDocument = document; this.tagName = tagName.toUpperCase(); this.children = []; this.parentElement = null;
        this.attributes = new Map(); this.listeners = new Map(); this.dataset = {}; this.hidden = false; this.disabled = false;
        this.className = ""; this.textContent = ""; this._id = "";
        this.classList = { toggle: (name, enabled) => { const set = new Set(this.className.split(/\s+/).filter(Boolean)); enabled ? set.add(name) : set.delete(name); this.className = [...set].join(" "); } };
    }
    set id(value) { this._id = value; if (value) this.ownerDocument.ids.set(value, this); }
    get id() { return this._id; }
    get isConnected() { let node = this; while (node) { if (node === this.ownerDocument.body) return true; node = node.parentElement; } return false; }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    append(...nodes) { for (const node of nodes) { node.parentElement = this; this.children.push(node); } }
    replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
    addEventListener(name, listener) { this.listeners.set(name, listener); }
    focus() { this.ownerDocument.activeElement = this; }
    remove() { this.parentElement && (this.parentElement.children = this.parentElement.children.filter(child => child !== this)); this.parentElement = null; }
    contains(node) { return node === this || this.children.some(child => child.contains(node)); }
    closest(selector) {
        let node = this;
        while (node) {
            if (selector === "button[data-acknowledge-code]" && node.tagName === "BUTTON" && node.dataset.acknowledgeCode) return node;
            if (selector === ".global-notification-card" && node.className.split(/\s+/).includes("global-notification-card")) return node;
            node = node.parentElement;
        }
        return null;
    }
    querySelectorAll(selector) { return this.children.flatMap(child => [child, ...child.querySelectorAll(selector)]).filter(node => selector === ".global-notification-card" && node.className.split(/\s+/).includes(selector.slice(1))); }
}

function fakePage(fetcher) {
    const document = { ids: new Map(), listeners: new Map(), visibilityState: "visible", activeElement: null,
        createElement(tag) { return new FakeElement(this, tag); },
        getElementById(id) { return this.ids.get(id) || null; },
        querySelector(selector) { return selector === ".bpd-account-banner__inner" ? this.inner : null; },
        addEventListener(name, handler) { this.listeners.set(name, handler); },
        dispatchEvent(event) { this.dispatched.push(event); this.listeners.get(event.type)?.(event); return true; },
        dispatched: [] };
    document.body = new FakeElement(document, "body");
    document.inner = new FakeElement(document, "div"); document.inner.className = "bpd-account-banner__inner";
    document.body.append(document.inner);
    const intervals = new Set();
    const window = { fetch: fetcher, CustomEvent: class { constructor(type, init = {}) { this.type = type; Object.assign(this, init); } },
        addEventListener() {}, setInterval(fn) { intervals.add(fn); return fn; }, clearInterval(id) { intervals.delete(id); },
        setTimeout(fn) { return fn; }, clearTimeout() {} };
    return { document, window, intervals };
}

function fire(node, type, event = {}) { node.listeners.get(type)?.({ target: node, ...event }); }

test("client normalization accepts only safe normalized fields and allowlisted review destinations", () => {
    const normalized = normalizeClientNotification(validNotice());
    assert.equal(normalized.publicCode, CODE);
    assert.equal("internalId" in normalized, false);
    assert.equal(getNotificationReviewDestination("profile.complete"), "/RocketLeague/Profile");
    assert.equal(getNotificationReviewDestination("provider.reauthorize"), "/Account?reauthorize=epic");
    assert.equal(getNotificationReviewDestination("ocr.review", "ABCD1234EFGH5678"), "/RocketLeague/SubmitMatchResults?jobId=ABCD1234EFGH5678");
    assert.equal(getNotificationReviewDestination("ocr.review", "https://attacker.example"), null);
    assert.equal(getNotificationReviewDestination("account.status"), null);
    assert.equal(getNotificationReviewDestination("https://attacker.example"), null);
    assert.equal(normalizeClientNotification(validNotice({ message: `Restriction ${UUID}` })), null);
    assert.equal(normalizeClientNotification(validNotice({ message: "Contact hidden@example.com" })), null);
    assert.equal(normalizeClientNotification(validNotice({ reviewAction: "javascript:alert(1)" })), null);
    assert.equal(normalizeClientNotification(validNotice({ source: "ocr", reviewAction: "ocr.review", reviewCode: "../../evil" })), null);
});

test("dashboard notification event exposes only display and allowlisted review fields and reports fetch failure", async () => {
    let fail = false;
    const fixture = fakePage(async () => fail
        ? Response.json({ success: false }, { status: 503 })
        : Response.json({ success: true, notifications: [validNotice({ source: "ocr", reviewAction: "ocr.review", reviewCode: "ABCD1234EFGH5678" })] }));
    const controller = createNotificationController(fixture);
    controller.mount();
    controller.setAuthState({ authenticated: true, available: true });
    await new Promise(resolve => setTimeout(resolve, 0));
    const update = fixture.document.dispatched.find(event => event.type === "bpd:notifications-updated");
    assert.equal(update.detail.signedIn, true);
    assert.deepEqual(Object.keys(update.detail.notifications[0]).sort(), ["createdAt", "message", "reviewAction", "reviewCode", "title"]);
    assert.equal(update.detail.notifications[0].reviewCode, "ABCD1234EFGH5678");
    assert.equal("publicCode" in update.detail.notifications[0], false);

    fail = true;
    await controller.refresh(true);
    const unavailable = fixture.document.dispatched.find(event => event.type === "bpd:notifications-unavailable");
    assert.equal(unavailable.detail.signedIn, true);
});

test("drawer is gated by confirmed auth, fetches same-origin without account data and restores focus on Escape", async () => {
    const calls = [];
    const fixture = fakePage(async (url, options) => { calls.push({ url, options }); return Response.json({ success: true, notifications: [validNotice()] }); });
    const controller = createNotificationController(fixture);
    controller.mount();
    controller.setAuthState({ authenticated: false, available: true });
    assert.equal(calls.length, 0, "unknown/logged-out state does not fetch");
    controller.setAuthState({ authenticated: true, available: true });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "/api/notifications");
    assert.equal(calls[0].options.credentials, "same-origin");
    assert.equal(calls[0].options.cache, "no-store");
    assert.equal("body" in calls[0].options, false);
    assert.equal(fixture.document.getElementById("globalNotificationCount").textContent, "1");

    const trigger = fixture.document.getElementById("globalNotificationTrigger");
    trigger.focus();
    fire(trigger, "click");
    const drawer = fixture.document.getElementById("globalNotificationDrawer");
    assert.equal(drawer.hidden, false);
    assert.equal(fixture.document.activeElement.id, "globalNotificationHeading");
    fire(fixture.document, "keydown", { key: "Escape" });
    assert.equal(drawer.hidden, true);
    assert.equal(fixture.document.activeElement, trigger);
    controller.open();
    const pageContent = fixture.document.createElement("main");
    pageContent.focus();
    fire(fixture.document, "bpd:page-loaded");
    assert.equal(drawer.hidden, true);
    assert.equal(fixture.document.activeElement, pageContent, "route focus remains with the destination content");
});

test("acknowledgement uses only the public code, removes on success and prevents duplicate submission", async () => {
    const calls = [];
    let acknowledged = false;
    let releaseAck;
    const fixture = fakePage((url, options) => {
        calls.push({ url, options });
        if (options.method === "POST") return new Promise(resolve => { releaseAck = () => { acknowledged = true; resolve(Response.json({ success: true, acknowledged: true })); }; });
        return Promise.resolve(Response.json({ success: true, notifications: acknowledged ? [] : [validNotice()] }));
    });
    const controller = createNotificationController(fixture);
    controller.mount(); controller.setAuthState({ authenticated: true, available: true });
    await new Promise(resolve => setTimeout(resolve, 0));
    controller.open();
    await new Promise(resolve => setTimeout(resolve, 0));
    const list = fixture.document.getElementById("globalNotificationDrawer").children[2];
    const card = list.children[0];
    const actions = card.children[3];
    const link = actions.children[0];
    assert.equal(link.href, "/RocketLeague/Profile");
    assert.equal(link.dataset.routerLink, "");
    const ack = actions.children[1];
    fire(list, "click", { target: ack });
    assert.equal(ack.disabled, true);
    fire(list, "click", { target: ack });
    assert.equal(calls.filter(call => call.options.method === "POST").length, 1);
    assert.match(calls.at(-1).url, new RegExp(`/api/notifications/${CODE}/acknowledge`));
    assert.equal("body" in calls.at(-1).options, false);
    releaseAck();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(list.children.length, 0);
});

test("empty and multiple notifications render safely, including one-time event acknowledgement controls", async () => {
    const fixture = fakePage(async () => Response.json({ success: true, notifications: [
        validNotice({ publicCode: "BBBBBBBBBBBB", source: "faq", severity: "info", title: "New FAQ answer", message: "A response is ready.",
            actionRequired: false, reviewAction: "faq.review", createdAt: "2026-10-08T13:00:00.000Z", internalId: UUID }),
        validNotice({ publicCode: "CCCCCCCCCCCC", reviewAction: "provider.reauthorize", title: "Verify your Epic account",
            message: "Your Epic account is still linked. Reauthorize it to continue using Rocket League features." })
    ] }));
    const controller = createNotificationController(fixture);
    controller.mount(); controller.setAuthState({ authenticated: true, available: true });
    await new Promise(resolve => setTimeout(resolve, 0));
    controller.open();
    await new Promise(resolve => setTimeout(resolve, 0));
    const drawer = fixture.document.getElementById("globalNotificationDrawer");
    const list = drawer.children[2];
    assert.equal(list.children.length, 2);
    const renderedText = list.children.map(card => card.children.map(part => part.textContent).join(" ")).join(" ");
    assert.match(renderedText, /New FAQ answer/);
    assert.match(renderedText, /Verify your Epic account/);
    assert.doesNotMatch(renderedText, new RegExp(UUID));
    assert.equal(list.children[0].children[3].children.length, 1, "unvalidated FAQ action has no arbitrary Review URL");
    assert.equal(list.children[1].children[3].children[0].href, "/Account?reauthorize=epic");

    const emptyFixture = fakePage(async () => Response.json({ success: true, notifications: [] }));
    const emptyController = createNotificationController(emptyFixture);
    emptyController.mount(); emptyController.setAuthState({ authenticated: true, available: true });
    await new Promise(resolve => setTimeout(resolve, 0));
    emptyController.open();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(emptyFixture.document.getElementById("globalNotificationStatus").textContent, "You’re all caught up.");
    assert.equal(emptyFixture.document.getElementById("globalNotificationCount").hidden, true);
});

test("acknowledgement failure keeps the item available and auth rejection hides the global trigger", async () => {
    const fixture = fakePage(async (_url, options) => options.method === "POST"
        ? Response.json({ success: false, error: "NOTIFICATIONS_UNAVAILABLE" }, { status: 503 })
        : Response.json({ success: true, notifications: [validNotice()] }));
    const controller = createNotificationController(fixture);
    controller.mount(); controller.setAuthState({ authenticated: true, available: true });
    await new Promise(resolve => setTimeout(resolve, 0));
    controller.open(); await new Promise(resolve => setTimeout(resolve, 0));
    const drawer = fixture.document.getElementById("globalNotificationDrawer");
    const list = drawer.children[2];
    const ack = list.children[0].children[3].children[1];
    fire(list, "click", { target: ack });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(list.children.length, 1);
    assert.equal(ack.disabled, false);
    assert.match(fixture.document.getElementById("globalNotificationStatus").textContent, /could not be acknowledged/);
    let rejectSession = false;
    const signedOutFixture = fakePage(async () => rejectSession
        ? new Response(null, { status: 401 })
        : Response.json({ success: true, notifications: [validNotice()] }));
    const signedOutController = createNotificationController(signedOutFixture);
    signedOutController.mount(); signedOutController.setAuthState({ authenticated: true, available: true });
    await new Promise(resolve => setTimeout(resolve, 0));
    rejectSession = true;
    await signedOutController.refresh(true);
    assert.equal(signedOutFixture.document.getElementById("globalNotificationTrigger").hidden, true);
    assert.equal(signedOutFixture.document.getElementById("globalNotificationDrawer").children[2].children.length, 0);
});
