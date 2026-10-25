/**
 * Draft persistence (owner report 2026-10-25: text typed into the thinking/
 * answer boxes vanished on a chat switch). The pure helpers: key shapes,
 * write-through, remove-on-empty, per-question clearing, and a missing or
 * broken storage that never throws.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
	clearDraft,
	clearQuestionDrafts,
	composerDraftKey,
	practiceDraftKey,
	questionDraftKey,
	readDraft,
	writeDraft,
} from "../components/draft-store.ts";

function fakeStorage(): Storage {
	const m = new Map<string, string>();
	return {
		get length() {
			return m.size;
		},
		key: (i: number) => [...m.keys()][i] ?? null,
		getItem: (k: string) => m.get(k) ?? null,
		setItem: (k: string, v: string) => void m.set(k, v),
		removeItem: (k: string) => void m.delete(k),
		clear: () => m.clear(),
	} as Storage;
}

const g = globalThis as { window?: unknown };
const originalWindow = g.window;
afterEach(() => {
	if (originalWindow === undefined) delete g.window;
	else g.window = originalWindow;
});

describe("draft store (pure helpers)", () => {
	it("keys name what the draft belongs to", () => {
		assert.equal(composerDraftKey("c1"), "lh:draft:composer:c1");
		assert.equal(questionDraftKey("call_1", "thinking"), "lh:draft:question:call_1:thinking");
		assert.equal(questionDraftKey("call_1", "reading"), "lh:draft:question:call_1:reading");
		assert.equal(practiceDraftKey("call_p"), "lh:draft:practice:call_p:thinking");
	});

	it("writes through, removes on empty, reads empty when absent", () => {
		g.window = { localStorage: fakeStorage() };
		const k = composerDraftKey("c1");
		assert.equal(readDraft(k), "");
		writeDraft(k, "half a thought");
		assert.equal(readDraft(k), "half a thought");
		writeDraft(k, "");
		assert.equal(readDraft(k), "");
		writeDraft(k, "again");
		clearDraft(k);
		assert.equal(readDraft(k), "");
	});

	it("clearing a question drops every field of THAT question only", () => {
		const s = fakeStorage();
		g.window = { localStorage: s };
		writeDraft(questionDraftKey("q1", "thinking"), "t");
		writeDraft(questionDraftKey("q1", "other"), "o");
		writeDraft(questionDraftKey("q1", "reading"), "r");
		writeDraft(questionDraftKey("q10", "thinking"), "keep — a different call id sharing the prefix text");
		writeDraft(composerDraftKey("c1"), "keep");
		clearQuestionDrafts("q1");
		assert.equal(readDraft(questionDraftKey("q1", "thinking")), "");
		assert.equal(readDraft(questionDraftKey("q1", "other")), "");
		assert.equal(readDraft(questionDraftKey("q1", "reading")), "");
		assert.ok(readDraft(questionDraftKey("q10", "thinking")).startsWith("keep"));
		assert.equal(readDraft(composerDraftKey("c1")), "keep");
	});

	it("never throws without a window or with a broken storage", () => {
		delete g.window;
		assert.equal(readDraft("lh:draft:x"), "");
		assert.doesNotThrow(() => writeDraft("lh:draft:x", "v"));
		assert.doesNotThrow(() => clearQuestionDrafts("q"));
		g.window = {
			get localStorage(): Storage {
				throw new Error("denied");
			},
		};
		assert.equal(readDraft("lh:draft:x"), "");
		assert.doesNotThrow(() => writeDraft("lh:draft:x", "v"));
		assert.doesNotThrow(() => clearQuestionDrafts("q"));
	});
});
