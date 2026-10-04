import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { completeOAuthCallback } from "../../../functions/services/auth/oauth/callback_response.js";
import { handleOAuthCallback } from "../../../functions/services/auth/oauth/callback.js";

const request = new Request("https://bpd.invalid/api/auth/_oauth/callback?error=access_denied");
const signedOut = { AUTH_SESSIONS: { get: async () => null } };

test("cancelled Google/Discord callback redirects to a friendly Login error", async () => {
    const response = await handleOAuthCallback(request, signedOut);
    assert.equal(response.status, 302);
    const location = new URL(response.headers.get("location"), request.url);
    assert.equal(location.pathname, "/Login");
    assert.equal(location.searchParams.get("error"), "OAUTH_PROVIDER_REJECTED");
    assert.match(location.searchParams.get("debugId") || "", /^[0-9a-f-]{36}$/iu);
    assert.match(response.headers.get("set-cookie"), /Max-Age=0/);
    assert.doesNotMatch(response.headers.get("set-cookie"), /bpd_session=/);
});

test("callback outage routes to recovery without clearing the BPD session", async () => {
    const response = await completeOAuthCallback(request, {}, async () => { throw Error("secret"); });
    const location = new URL(response.headers.get("location"), request.url);
    assert.equal(location.pathname, "/Account");
    assert.equal(location.searchParams.get("error"), "AUTH_SERVICE_UNAVAILABLE");
    assert.match(location.searchParams.get("debugId") || "", /^[0-9a-f-]{36}$/iu);
    assert.doesNotMatch(response.headers.get("set-cookie"), /bpd_session=/);
    assert.equal(response.headers.get("cache-control"), "no-store");
});

test("unknown upstream errors cannot inject sensitive text into redirects", async () => {
    const response = await completeOAuthCallback(request, signedOut,
        async () => Response.json({ code: "token=secret", message: "secret" }, { status: 409 }));
    assert.equal(response.headers.get("location"), "/Login?error=OAUTH_CALLBACK_FAILED");
});

test("successful callbacks keep their session cookie and destination", async () => {
    const expected = new Response(null, { status: 302, headers: {
        location: "/RocketLeague/Profile", "set-cookie": "bpd_session=new; HttpOnly"
    } });
    assert.equal(await completeOAuthCallback(request, signedOut, async () => expected), expected);
});

test("frontend consumes safe friendly errors and preserves unrelated query parameters", async () => {
    const source = await readFile(new URL("../../../public/Framework/Auth/oauthErrors.js", import.meta.url), "utf8");
    const context = { URL, window: { location: { href: "https://bpd.invalid/Account?error=PROVIDER_IDENTITY_ALREADY_LINKED&debugId=123&keep=1" },
        history: { state: { retained: true }, replaceState(state, _, url) { this.url = url; this.saved = state; } } } };
    vm.runInNewContext(source.replace("export function", "function") + "\nthis.consume = consumeOAuthError;", context);
    assert.match(context.consume(), /already linked to another BPD account/);
    assert.equal(context.window.history.url, "/Account?keep=1");
    context.window.location.href = "https://bpd.invalid/Login?error=__proto__";
    assert.equal(typeof context.consume(), "string");
});

test("Login preserves callback errors, rebinds new markup, and ignores events off-page", async () => {
    let source = await readFile(new URL("../../../public/Global/Login/JS/index.js", import.meta.url), "utf8");
    source = source.replace(/import\s*\{[\s\S]*?\}\s*from\s*"[^"]+";/g, "")
        .replace("export async function initializePage", "async function initializePage");
    let page, status, turnstile, buttons, subscriptions = 0, renders = 0, removes = 0;
    const mount = () => {
        page = { dataset: {} }; status = { dataset: {}, hidden: true, textContent: "" };
        turnstile = { clientWidth: renders ? 240 : 320, dataset: { siteKey: "test" } };
        buttons = ["google", "discord", "epic"].map(provider => ({ dataset: { loginProvider: provider },
            listeners: 0, addEventListener() { this.listeners++; } }));
    };
    mount();
    const context = { URL, console, navigator: { onLine: true },
        BPD_AUTH_GOOGLE_LOGIN_URL: "/google", BPD_AUTH_DISCORD_LOGIN_URL: "/discord", BPD_AUTH_EPIC_LOGIN_URL: "/epic",
        consumeOAuthError: () => "Provider sign-in was cancelled.",
        getAuthState: async () => ({ available: true, authenticated: false, status: "unauthenticated" }),
        subscribeToAuthState: () => { subscriptions++; return () => {}; },
        document: { getElementById: id => ({ loginPage: page, loginStatus: status, loginTurnstile: turnstile })[id],
            querySelectorAll: selector => selector === "[data-login-provider]" ? buttons : [], addEventListener() {} },
        window: { location: { href: "https://bpd.invalid/Login", assign() { throw Error("Unexpected redirect"); } },
            turnstile: { render(element, options) { assert.equal(options.size, element.clientWidth < 300 ? "compact" : "normal"); return ++renders; }, remove() { removes++; } } }
    };
    vm.runInNewContext(source + "\nthis.pageApi={initializePage,handleTurnstileSuccess,handleAuthStateChanged,handleNetworkStatus,getReturnTo};", context);
    await context.pageApi.initializePage();
    assert.match(status.textContent, /cancelled/);
    context.pageApi.handleTurnstileSuccess("verified");
    assert.match(status.textContent, /cancelled/);
    assert.ok(buttons.every(button => button.listeners === 1));
    mount();
    await context.pageApi.initializePage();
    assert.ok(buttons.every(button => button.listeners === 1));
    assert.equal(renders, 2); assert.equal(removes, 1); assert.equal(subscriptions, 1);
    context.window.location.href = "https://bpd.invalid/Login?returnTo=%2F%5Cexample.invalid";
    assert.equal(context.pageApi.getReturnTo(), "/Account");
    page = null;
    context.pageApi.handleAuthStateChanged({ available: true, authenticated: true });
    context.pageApi.handleNetworkStatus({ detail: { online: true, apiReady: true } });
});

test("Account rebinds new markup and does not redirect on an auth outage or off-page event", async () => {
    let source = await readFile(new URL("../../../public/Global/Account/JS/index.js", import.meta.url), "utf8");
    source = source.replace(/import\s*\{[\s\S]*?\}\s*from\s*"[^"]+";/g, "")
        .replace("export async function initializePage", "async function initializePage");
    let page = { dataset: {} }, status = { dataset: {} }, subscriptions = 0;
    const context = { URL, console, navigator: { onLine: true },
        consumeOAuthError: () => "That provider account is already linked.",
        getAuthState: async () => ({ available: false, authenticated: null, status: "unavailable" }),
        subscribeToAuthState: () => { subscriptions++; return () => {}; },
        document: { getElementById: id => ({ accountPage: page, accountPageStatus: status })[id],
            querySelector: () => null, querySelectorAll: () => [], addEventListener() {} },
        window: { location: { href: "https://bpd.invalid/Account", assign() { throw Error("Unexpected logout redirect"); } } }
    };
    vm.runInNewContext(source + "\nthis.pageApi={initializePage,handleAuthStateChanged};", context);
    await context.pageApi.initializePage();
    assert.match(status.textContent, /already linked/);
    page = { dataset: {} }; status = { dataset: {} };
    await context.pageApi.initializePage();
    assert.match(status.textContent, /already linked/);
    assert.equal(subscriptions, 1);
    page = null;
    context.pageApi.handleAuthStateChanged({ available: true, authenticated: false });
});

test("registration restores a draft after healthy reauthorization without overwriting a complete profile", async () => {
    let source = await readFile(new URL("../../../public/Tabs/RocketLeague/Registration/JS/index.js", import.meta.url), "utf8");
    source = source.replace(/import\s*\{[\s\S]*?\}\s*from\s*"[^"]+";/g, "")
        .replace("export async function initializePage", "async function initializePage");
    const applied = [], messages = [];
    const draft = { email: "draft@example.test", preferredMode: "2s" };
    const context = { console, document: { addEventListener() {} }, draft, applied, messages };
    vm.runInNewContext(source + `
        readRegistrationDraft = () => draft;
        populateDraft = value => applied.push(value);
        showMessage = message => messages.push(message);
        this.restore = restoreRegistrationDraft;
    `, context);
    assert.equal(context.restore({ profileLoaded: true, profile: { profileComplete: false } }), true);
    assert.equal(applied[0], draft);
    assert.match(messages[0], /confirm the required consent/);
    assert.equal(context.restore({ profileLoaded: false, profile: { profileComplete: false } }), true);
    assert.equal(context.restore({ profileLoaded: true, profile: { profileComplete: true } }), false);
    assert.equal(applied.length, 2);
});

test("unlink success followed by a session outage stays on Account; confirmed logout redirects", async () => {
    let source = await readFile(new URL("../../../public/Global/Account/JS/index.js", import.meta.url), "utf8");
    source = source.replace(/import\s*\{[\s\S]*?\}\s*from\s*"[^"]+";/g, "")
        .replace("export async function initializePage", "async function initializePage");
    for (const available of [false, true]) {
        const status = { dataset: {} }, redirects = [];
        const context = { URL, console, navigator: { onLine: true },
            refreshAuthState: async () => ({ available, authenticated: available ? false : null,
                status: available ? "unauthenticated" : "unavailable" }),
            document: { getElementById: id => ({ accountPage: { dataset: {} }, accountPageStatus: status })[id],
                querySelector: () => null, querySelectorAll: () => [] },
            window: { confirm: () => true, location: { href: "https://bpd.invalid/Account",
                origin: "https://bpd.invalid", pathname: "/Account", search: "", hash: "",
                assign: url => redirects.push(url), replace: url => redirects.push(url) } }
        };
        vm.runInNewContext(source + `
            currentAuthState = { authenticated: true, active: true };
            unlinkProvider = async () => ({ success: true });
            this.run = handleProviderAction;
        `, context);
        await context.run({ currentTarget: { dataset: { providerAction: "epic", action: "disconnect" } } });
        assert.equal(redirects.length, available ? 1 : 0);
        if (!available) assert.match(status.textContent, /unavailable/i);
    }
});

test("unsupported Steam authorization is disabled without hiding an existing permanent link", async () => {
    let source = await readFile(new URL("../../../public/Global/Account/JS/index.js", import.meta.url), "utf8");
    source = source.replace(/import\s*\{[\s\S]*?\}\s*from\s*"[^"]+";/g, "")
        .replace("export async function initializePage", "async function initializePage");
    const row = { dataset: {} }, status = {}, action = { dataset: {} };
    const context = { document: { querySelector: selector => selector.includes('provider-status') ? status
        : selector.includes('provider-action') ? action : row } };
    vm.runInNewContext(source + "\nthis.render = setProviderStatus;", context);
    context.render("steam", false, {});
    assert.equal(action.disabled, true);
    assert.equal(action.dataset.action, "unavailable");
    context.render("steam", true, {});
    assert.equal(row.dataset.connected, "true");
    assert.match(status.textContent, /^Connected/);
    assert.equal(action.dataset.action, "disconnect");
});

test("registration drafts stay with their BPD account and never restore unowned legacy data", async () => {
    let source = await readFile(new URL("../../../public/Tabs/RocketLeague/Registration/JS/index.js", import.meta.url), "utf8");
    source = source.replace(/import\s*\{[\s\S]*?\}\s*from\s*"[^"]+";/g, "")
        .replace("export async function initializePage", "async function initializePage");
    const records = new Map([["bpdRocketLeagueRegistrationDraft", JSON.stringify({ email: "legacy@example.test" })]]);
    const context = { console, document: { addEventListener() {} }, localStorage: {
        getItem: key => records.get(key) ?? null,
        setItem: (key, value) => records.set(key, value), removeItem: key => records.delete(key)
    } };
    vm.runInNewContext(source + `
        this.drafts = { save: saveRegistrationDraft, read: readRegistrationDraft, clear: clearRegistrationDraft,
            owner(value) { registrationDraftAccountId = value; } };
    `, context);
    const { drafts } = context;
    drafts.owner("account-a");
    assert.equal(drafts.read(), null);
    drafts.save({ email: "a@example.test", ageConsent: true, policyConsent: true, location: "private" });
    assert.equal(drafts.read().email, "a@example.test");
    assert.equal(drafts.read().ageConsent, undefined);
    assert.equal(drafts.read().location, undefined);
    drafts.owner("account-b");
    assert.equal(drafts.read(), null);
    drafts.save({ email: "b@example.test" });
    drafts.owner("account-a");
    assert.equal(drafts.read().email, "a@example.test");
    drafts.clear();
    drafts.owner("account-b");
    assert.equal(drafts.read().email, "b@example.test");
    drafts.owner("");
    assert.equal(drafts.read(), null);
    assert.ok(records.has("bpdRocketLeagueRegistrationDraft"));
});

test("Account mutations are enabled and permanent deletion still requires confirmation", async () => {
    let source = await readFile(new URL("../../../public/Global/Account/JS/index.js", import.meta.url), "utf8");
    source = source.replace(/import\s*\{[\s\S]*?\}\s*from\s*"[^"]+";/g, "")
        .replace("export async function initializePage", "async function initializePage");
    const elements = { accountDisplayName: {}, accountSaveProfileButton: {}, accountDeleteButton: {}, accountDeactivateButton: {} };
    const context = { document: { getElementById: id => elements[id] },
        apiFetch() { throw Error("Cancelled deletion must not call the API"); },
        window: { confirm() { return false; } } };
    vm.runInNewContext(source + `
        currentAuthState = { authenticated: true, active: true, user: { displayName: "Player" } };
        renderProfile(currentAuthState);
        updateProfileSaveState();
        renderDangerZone(true);
        this.actions = { remove: handleDeleteAccount, deactivate: handleDeactivateAccount };
    `, context);
    assert.equal(elements.accountDisplayName.disabled, false);
    assert.equal(elements.accountSaveProfileButton.disabled, true);
    assert.equal(elements.accountDeleteButton.disabled, false);
    assert.equal(elements.accountDeactivateButton.disabled, false);
    await context.actions.remove();
    await context.actions.deactivate();
});
