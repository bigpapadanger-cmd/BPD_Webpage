import assert from "node:assert/strict";
import test from "node:test";
import { createModalFocusManager } from "../../public/Global/Admin/Shared/JS/modal_focus.js";

function fixture() {
    const listeners = new Map();
    const doc = { activeElement: null, body: { children: [] }, documentElement: { classList: { remove() {} } },
        addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
    function element(parent = null, tabIndex = -1) {
        const node = { parent, inert: false, hidden: false, disabled: false, tabIndex, isConnected: true, children: [],
            contains(item) { return item === this || this.children.some(child => child.contains(item)); },
            closest() { for (let item = this; item; item = item.parent) if (item.hidden || item.inert) return item; return null; },
            getClientRects() { return this.closest() ? [] : [{}]; },
            focus() { doc.activeElement = this; listeners.get("focusin")?.({ target: this }); } };
        parent?.children.push(node); return node;
    }
    const page = element(), originalInert = element(); originalInert.inert = true;
    const opener = element(page, 0); opener.focus();
    doc.body.children.push(page, originalInert);
    function overlay() {
        const root = element(), dialog = element(root), first = element(dialog, 0), last = element(dialog, 0);
        root.querySelector = () => dialog;
        dialog.querySelectorAll = () => dialog.children;
        doc.body.children.push(root);
        return { root, dialog, first, last };
    }
    const manager = createModalFocusManager(doc);
    return { doc, listeners, page, originalInert, opener, overlay, manager };
}

test("modal contains Tab/Shift-Tab and outside focus; restores opener and original inert state", () => {
    const f = fixture(), m = f.overlay(); f.manager.activate(m.root);
    assert.equal(f.doc.activeElement, m.first); assert.equal(f.page.inert, true);
    m.last.focus(); let prevented = false;
    f.listeners.get("keydown")({ key: "Tab", preventDefault() { prevented = true; } });
    assert.ok(prevented); assert.equal(f.doc.activeElement, m.first);
    f.listeners.get("keydown")({ key: "Tab", shiftKey: true, preventDefault() {} });
    assert.equal(f.doc.activeElement, m.last);
    f.opener.focus(); assert.equal(f.doc.activeElement, m.first);
    m.root.hidden = true; f.manager.deactivate(m.root);
    assert.equal(f.doc.activeElement, f.opener); assert.equal(f.page.inert, false);
    assert.equal(f.originalInert.inert, true); assert.equal(f.listeners.size, 0);
});

test("nested modal restores the lower modal before releasing background focus", () => {
    const f = fixture(), lower = f.overlay(); f.manager.activate(lower.root); lower.last.focus();
    const upper = f.overlay(); f.manager.activate(upper.root);
    assert.equal(lower.root.inert, true); assert.equal(f.doc.activeElement, upper.first);
    upper.root.hidden = true; f.manager.deactivate(upper.root);
    assert.equal(lower.root.inert, false); assert.equal(f.doc.activeElement, lower.last);
    assert.equal(f.page.inert, true);
    lower.root.hidden = true; f.manager.deactivate(lower.root);
    assert.equal(f.doc.activeElement, f.opener); assert.equal(f.page.inert, false);
});

test("closing a lower modal cannot steal the top modal focus", () => {
    const f = fixture(), lower = f.overlay(), upper = f.overlay();
    f.manager.activate(lower.root); f.manager.activate(upper.root);
    lower.root.hidden = true; f.manager.deactivate(lower.root);
    assert.equal(f.doc.activeElement, upper.first);
    upper.root.hidden = true; f.manager.deactivate(upper.root);
    assert.equal(f.page.inert, false);
});

test("all-disabled dialog is focusable and navigation clears overlays/listeners/background inertness", () => {
    const f = fixture(), m = f.overlay(); m.first.disabled = m.last.disabled = true;
    let dismissed = false; f.manager.activate(m.root, () => { dismissed = true; });
    assert.equal(f.doc.activeElement, m.dialog); assert.equal(m.dialog.tabIndex, -1);
    f.listeners.get("bpd:page-loaded")();
    assert.ok(dismissed); assert.equal(m.root.hidden, true);
    assert.equal(f.page.inert, false); assert.equal(f.listeners.size, 0);
});
