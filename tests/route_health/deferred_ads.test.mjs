import test from "node:test";
import assert from "node:assert/strict";

test("unconfigured ad placeholders never create a script or request an ad", async () => {
    const saved = globalThis.document;
    globalThis.document = { querySelectorAll: () => [], createElement: () => { throw new Error("Unexpected ad script"); } };
    try {
        const { initializePageAds } = await import("../../public/Global/Ads/JS/ads.js?empty");
        initializePageAds();
    } finally { if (saved === undefined) delete globalThis.document; else globalThis.document = saved; }
});

test("configured ads wait for visibility and room, share one script, and fill each slot once", async () => {
    const saved = { document: globalThis.document, window: globalThis.window, IntersectionObserver: globalThis.IntersectionObserver, ResizeObserver: globalThis.ResizeObserver };
    let onIntersection;
    const scripts = [];
    const makeSlot = (width, top) => ({ isConnected: true, dataset: { adSlot: "1234567890" }, children: [], clientHeight: 90,
        getBoundingClientRect: () => ({ width, height: 90, top, bottom: top + 90 }), append(node) { this.children.push(node); } });
    const visible = makeSlot(700, 100);
    const narrow = makeSlot(200, 100);
    const distant = makeSlot(700, 2000);
    globalThis.window = { innerHeight: 900 };
    globalThis.document = { querySelectorAll: () => [visible, narrow, distant], createElement: tag => ({ tag, style: {}, dataset: {}, listeners: {}, addEventListener(event, fn) { this.listeners[event] = fn; } }), head: { append(script) { scripts.push(script); } } };
    globalThis.IntersectionObserver = class { constructor(callback) { onIntersection = callback; } observe() {} unobserve() {} disconnect() {} };
    delete globalThis.ResizeObserver;
    try {
        const { initializePageAds } = await import("../../public/Global/Ads/JS/ads.js?configured");
        initializePageAds();
        assert.equal(scripts.length, 0);
        onIntersection([narrow, distant].map(target => ({ target, isIntersecting: true })));
        assert.equal(scripts.length, 0);
        onIntersection([{ target: visible, isIntersecting: true }]);
        assert.equal(scripts.length, 1);
        scripts[0].listeners.load();
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(visible.children.length, 1);
        assert.equal(window.adsbygoogle.length, 1);
        onIntersection([{ target: visible, isIntersecting: true }]);
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(visible.children.length, 1);
        assert.equal(scripts.length, 1);
        assert.equal(narrow.children.length, 0);
        assert.equal(distant.children.length, 0);
    } finally { for (const [key, value] of Object.entries(saved)) if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
});
