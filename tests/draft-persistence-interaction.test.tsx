/**
 * Draft persistence through a remount (owner report 2026-10-25): the dock
 * fields are React state that dies with the chat view on every switch —
 * usePersistedDraft keeps the typed text in the draft store and restores it
 * on mount. Pinned on the question dock (a stored thinking draft comes
 * back; answering clears every field of the question) and on the hook
 * itself (write-through; a key change never inherits).
 *
 * linkedom note: simulated `input` events don't reach React's onChange and
 * textarea values don't round-trip, so typing is driven through the
 * component's own setter and restoration is read off the submit button's
 * enabled state and the submitted answer; buttons don't implicitly submit
 * their form, so the form's own submit event is fired.
 */
import React, { act, useCallback, useState } from "react";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { QuestionDock } from "../components/question-dock.tsx";
import { questionDraftKey, readDraft, usePersistedDraft, writeDraft } from "../components/draft-store.ts";

(globalThis as Record<string, unknown>).React = React;
const dom = parseHTML("<html><body></body></html>");
const store = new Map<string, string>();
const localStorage = {
	get length() {
		return store.size;
	},
	key: (i: number) => [...store.keys()][i] ?? null,
	getItem: (k: string) => store.get(k) ?? null,
	setItem: (k: string, v: string) => void store.set(k, v),
	removeItem: (k: string) => void store.delete(k),
	clear: () => store.clear(),
};
Object.defineProperty(dom.window, "localStorage", { value: localStorage, configurable: true });
Object.assign(globalThis, {
	window: dom.window,
	document: dom.document,
	Element: dom.window.Element,
	HTMLElement: dom.window.HTMLElement,
	CustomEvent: dom.window.CustomEvent,
	IS_REACT_ACT_ENVIRONMENT: true,
});

const quizInput = {
	question: "Which planet is closest to the sun?",
	options: [{ label: "Venus" }, { label: "Mercury" }, { label: "Mars" }],
	correctAnswer: "Mercury",
	explanation: "Mercury is the innermost planet.",
};

let host: HTMLElement;
let root: Root;
beforeEach(() => {
	store.clear();
	host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
});
afterEach(async () => {
	await act(async () => root.unmount());
	host.remove();
});

function dock(toolCallId: string, onSubmit: (o: unknown) => void = () => {}) {
	return (
		<QuestionDock
			toolName="quiz"
			toolCallId={toolCallId}
			input={quizInput as never}
			expanded={true}
			onExpand={() => {}}
			onSubmit={onSubmit}
		/>
	);
}

describe("draft persistence through a remount (owner report 2026-10-25)", () => {
	it("a fresh mount of the dock restores the question's stored answer draft", async () => {
		const ask = (toolCallId: string, onSubmit: (o: unknown) => void = () => {}) => (
			<QuestionDock
				toolName="ask_user_question"
				toolCallId={toolCallId}
				input={{ question: "In your own words, what makes a relation a function?" } as never}
				expanded={true}
				onExpand={() => {}}
				onSubmit={onSubmit}
			/>
		);
		const submitButton = () => host.querySelector('button[type="submit"]') as HTMLButtonElement;
		await act(async () => root.render(ask("q1")));
		assert.ok(submitButton().disabled, "no draft: nothing to submit yet");
		await act(async () => root.unmount());

		// What a previous visit left behind (written through on every edit).
		writeDraft(questionDraftKey("q1", "answer"), "each input maps to exactly one output");
		let submitted = null as { text?: string } | null;
		root = createRoot(host);
		await act(async () => root.render(ask("q1", (o) => (submitted = o as { text?: string }))));
		assert.ok(!submitButton().disabled, "the restored draft is submittable");
		const form = host.querySelector("form")!;
		await act(async () => form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })));
		assert.equal(submitted?.text, "each input maps to exactly one output", "the answer carries the restored text");
		assert.equal(readDraft(questionDraftKey("q1", "answer")), "", "answering cleared it");
		await act(async () => root.unmount());

		// A different question never sees another's draft.
		writeDraft(questionDraftKey("q1", "answer"), "left over");
		root = createRoot(host);
		await act(async () => root.render(ask("q2")));
		assert.ok(submitButton().disabled, "q2 starts empty");
		assert.equal(readDraft(questionDraftKey("q1", "answer")), "left over", "mounting q2 left q1's draft alone");
	});

	it("answering clears EVERY draft of that question — thinking, Other and the reading box", async () => {
		writeDraft(questionDraftKey("q3", "thinking"), "hmm");
		writeDraft(questionDraftKey("q3", "other"), "Pluto");
		writeDraft(questionDraftKey("q3", "reading"), "notes while reading");
		writeDraft(questionDraftKey("q30", "thinking"), "another question's draft");
		let submitted: unknown = null;
		await act(async () => root.render(dock("q3", (o) => (submitted = o))));
		const option = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Mercury"));
		assert.ok(option, "the option row renders");
		await act(async () => option!.click());
		// linkedom has no implicit form submission: fire the form's own
		// submit event, which is what the button click would raise.
		const form = host.querySelector("form");
		assert.ok(form, "the answer form renders");
		await act(async () => form!.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })));
		assert.ok(submitted, "the answer went out");
		assert.equal(readDraft(questionDraftKey("q3", "thinking")), "");
		assert.equal(readDraft(questionDraftKey("q3", "other")), "");
		assert.equal(readDraft(questionDraftKey("q3", "reading")), "");
		assert.equal(readDraft(questionDraftKey("q30", "thinking")), "another question's draft", "only q3 was cleared");
	});

	it("the hook writes every edit through; a key change takes the NEW key's draft", async () => {
		writeDraft("lh:draft:test:b", "b's own draft");
		let setter: ((v: string) => void) | null = null;
		let shown = "";
		function Probe({ k }: { k: string }) {
			const [v, setV] = useState("");
			const apply = useCallback((x: string) => setV(x), []);
			usePersistedDraft(k, v, apply);
			setter = setV;
			shown = v;
			return null;
		}
		await act(async () => root.render(<Probe k="lh:draft:test:a" />));
		assert.equal(shown, "", "no draft under a");
		await act(async () => setter!("typed under a"));
		assert.equal(readDraft("lh:draft:test:a"), "typed under a", "written through");
		await act(async () => setter!("typed under a, more"));
		assert.equal(readDraft("lh:draft:test:a"), "typed under a, more");

		await act(async () => root.render(<Probe k="lh:draft:test:b" />));
		assert.equal(shown, "b's own draft", "the field shows b's draft, not a's leftover");
		assert.equal(readDraft("lh:draft:test:a"), "typed under a, more", "a's draft is untouched by the switch");

		await act(async () => root.render(<Probe k="lh:draft:test:c" />));
		assert.equal(shown, "", "no draft under c: the field resets");
		assert.equal(readDraft("lh:draft:test:b"), "b's own draft", "leaving b wrote nothing under it");
		assert.equal(readDraft("lh:draft:test:c"), "", "nothing written under c either");

		await act(async () => setter!(""));
		await act(async () => setter!("x"));
		await act(async () => setter!(""));
		assert.equal(readDraft("lh:draft:test:c"), "", "emptying removes the entry");
	});
});
