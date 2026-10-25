/**
 * Learner preferences — rendering (2026-10-25): the Settings section (list,
 * inline edit, delete, Add) and the 👎 "Teach this differently" action
 * with its propose → confirm/cancel dialog, fetch mocked.
 */
import React, { act } from "react";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { LearnerPreferencesSection } from "../components/settings/learner-preferences-section.tsx";
import { TeachDifferentlyAction, TEACH_DIFFERENTLY_LABEL } from "../components/teach-feedback.tsx";
import type { LearnerPreference } from "../src/core/learner-preferences.ts";

(globalThis as Record<string, unknown>).React = React;
const dom = parseHTML("<html><body></body></html>");
Object.assign(globalThis, {
	window: dom.window,
	document: dom.document,
	Element: dom.window.Element,
	HTMLElement: dom.window.HTMLElement,
	CustomEvent: dom.window.CustomEvent,
	IS_REACT_ACT_ENVIRONMENT: true,
});

const prefs: LearnerPreference[] = [
	{ id: "a", text: "Use fewer analogies", createdAt: "2026-01-01T00:00:00.000Z", source: "manual" },
	{ id: "b", text: "Show the formal definition first", createdAt: "2026-02-01T00:00:00.000Z", source: "feedback" },
];

let host: HTMLElement;
let root: Root;
beforeEach(() => {
	host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
});
afterEach(async () => {
	await act(async () => root.unmount());
	host.remove();
});

const $ = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const $$ = (sel: string) => [...document.querySelectorAll(sel)] as HTMLElement[];
async function click(el: HTMLElement | null) {
	assert.ok(el, "element to click");
	await act(async () => {
		el.click();
	});
}
/** linkedom has no native `input` event support, so React's change plugin
 *  never fires here — drive the element's React onChange prop directly
 *  (what a real keystroke would reach). */
async function type(el: HTMLInputElement | HTMLTextAreaElement, text: string) {
	const key = Object.keys(el).find((k) => k.startsWith("__reactProps"));
	assert.ok(key, "React props on the element");
	const props = (el as unknown as Record<string, { onChange?: (e: unknown) => void }>)[key]!;
	await act(async () => {
		el.value = text;
		props.onChange?.({ target: el, currentTarget: el });
	});
}
async function flush() {
	await act(async () => {
		await new Promise((r) => setTimeout(r, 0));
	});
}

describe("Settings → Learner preferences section", () => {
	it("lists rules newest first with edit/delete, plus an Add field (SSR)", () => {
		const html = renderToStaticMarkup(<LearnerPreferencesSection preferences={prefs} onSectionChange={() => {}} />);
		assert.ok(html.indexOf("Show the formal definition first") < html.indexOf("Use fewer analogies"), "newest first");
		assert.match(html, /from 👎 feedback/);
		assert.match(html, /added manually/);
		assert.match(html, /data-testid="preference-add-input"/);
		assert.equal((html.match(/data-testid="preference-delete"/g) ?? []).length, 2);
		assert.equal((html.match(/data-testid="preference-edit"/g) ?? []).length, 2);
	});

	it("empty list shows the hint", () => {
		const html = renderToStaticMarkup(<LearnerPreferencesSection preferences={undefined} onSectionChange={() => {}} />);
		assert.match(html, /data-testid="preferences-empty"/);
		assert.match(html, /Rules \(0\)/);
	});

	it("delete and inline edit call onSectionChange with the whole next list", async () => {
		const writes: LearnerPreference[][] = [];
		await act(async () => root.render(<LearnerPreferencesSection preferences={prefs} onSectionChange={(n) => writes.push(n)} />));
		await click($$('[data-testid="preference-delete"]')[0]!);
		assert.deepEqual(writes[0]!.map((p) => p.id), ["a"], "deleted the newest (first shown) rule");

		await click($$('[data-testid="preference-edit"]')[1]!);
		const input = $('[data-testid="preference-edit-input"]') as HTMLInputElement;
		assert.ok(input);
		await type(input, "Use far fewer analogies");
		await click($('[data-testid="preference-edit-save"]'));
		assert.equal(writes[1]!.find((p) => p.id === "a")?.text, "Use far fewer analogies");
		assert.equal(writes[1]!.length, 2);
	});
});

describe("👎 Teach this differently", () => {
	function fakeFetch(proposal: string | null, log: Array<{ url: string; body: unknown }>): typeof fetch {
		return (async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			log.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
			if (url.endsWith("/propose")) return Response.json({ proposal });
			return Response.json({ preference: { id: "n", text: "x", createdAt: "", source: "feedback" }, preferences: [] });
		}) as typeof fetch;
	}

	it("renders as a small action with the label (SSR), no dialog until clicked", () => {
		const html = renderToStaticMarkup(<TeachDifferentlyAction chatId="c1" messageId="a1" />);
		assert.match(html, /data-testid="teach-differently"/);
		assert.ok(html.includes(TEACH_DIFFERENTLY_LABEL));
		assert.doesNotMatch(html, /preference-proposal-dialog/);
	});

	it("click → proposes via the chat/message → editable dialog; Cancel saves nothing", async () => {
		const log: Array<{ url: string; body: unknown }> = [];
		await act(async () => root.render(<TeachDifferentlyAction chatId="c1" messageId="a1" fetchImpl={fakeFetch("Avoid calling steps trivial", log)} />));
		await click($('[data-testid="teach-differently"]'));
		await flush();
		assert.deepEqual(log, [{ url: "/api/preferences/propose", body: { chatId: "c1", messageId: "a1" } }]);
		const field = $('[data-testid="preference-proposal-text"]') as HTMLTextAreaElement;
		assert.ok(field, "dialog shown");
		assert.equal(field.value, "Avoid calling steps trivial");
		await click($('[data-testid="preference-proposal-cancel"]'));
		assert.equal($('[data-testid="preference-proposal-dialog"]'), null);
		assert.equal(log.length, 1, "Cancel wrote nothing");
	});

	it("Confirm posts the (edited) rule as feedback and closes", async () => {
		const log: Array<{ url: string; body: unknown }> = [];
		await act(async () => root.render(<TeachDifferentlyAction chatId="c1" messageId="a1" fetchImpl={fakeFetch("Avoid calling steps trivial", log)} />));
		await click($('[data-testid="teach-differently"]'));
		await flush();
		const field = $('[data-testid="preference-proposal-text"]') as HTMLTextAreaElement;
		await type(field, "Justify every step, even easy ones");
		await click($('[data-testid="preference-proposal-confirm"]'));
		await flush();
		assert.equal(log.length, 2);
		assert.deepEqual(log[1], { url: "/api/preferences", body: { text: "Justify every step, even easy ones", source: "feedback" } });
		assert.equal($('[data-testid="preference-proposal-dialog"]'), null);
	});

	it("a null proposal opens the dialog empty with Confirm disabled", async () => {
		const log: Array<{ url: string; body: unknown }> = [];
		await act(async () => root.render(<TeachDifferentlyAction chatId="c1" messageId="a1" fetchImpl={fakeFetch(null, log)} />));
		await click($('[data-testid="teach-differently"]'));
		await flush();
		const field = $('[data-testid="preference-proposal-text"]') as HTMLTextAreaElement;
		assert.equal(field.value, "");
		assert.equal(($('[data-testid="preference-proposal-confirm"]') as HTMLButtonElement).disabled, true);
	});
});
