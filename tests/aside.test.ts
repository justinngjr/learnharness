/**
 * Asides (2026-10-24 — pi's `/btw` semantics): a side question over a
 * READ-ONLY fork of a session. Pins the pure core (the /btw parser, the
 * transcript rendering + its tail-keeping cut, the context marker and its
 * view projection), the store's aside kind + origin, and the sidebar's
 * nesting order.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";

const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "lh-aside-"));
process.env.LH_DATA_DIR = TMP_DATA;

const { chatStore } = await import("../src/store/chats.ts");
const { parseBtw, renderParentTranscript, newAsideContextMessage, asideTitle, projectView, nativeInputCause, toLlmMessages } =
	await import("../src/core/index.ts");
const { nestAsides } = await import("../components/sidebar.tsx");
const { POST } = await import("../app/api/chats/route.ts");
const { listSourceSegments, allSegmentPaths } = await import("../src/agent/prompt-segments.ts");
const { composeInstructions } = await import("../src/agent/teacher-agent.ts");

after(() => {
	fs.rmSync(TMP_DATA, { recursive: true, force: true });
});

type Msg = import("../src/core/index.ts").LhMessage;
const user = (id: string, text: string): Msg => ({ id, role: "user", content: [{ type: "text", text }], timestamp: 1 });
const assistant = (id: string, text: string): Msg =>
	({ id, role: "assistant", content: [{ type: "text", text }], api: "x", provider: "x", model: "x", usage: {} as never, stopReason: "stop", timestamp: 2 }) as unknown as Msg;

describe("/btw parsing", () => {
	it("recognises /btw with and without a question; everything else is a message", () => {
		assert.equal(parseBtw("/btw why is the sky blue?"), "why is the sky blue?");
		assert.equal(parseBtw("  /BTW   trailing   "), "trailing");
		assert.equal(parseBtw("/btw"), "");
		assert.equal(parseBtw("/btwx"), null);
		assert.equal(parseBtw("by the way, /btw"), null);
		assert.equal(parseBtw("hello"), null);
	});
});

describe("the forked transcript", () => {
	it("renders Learner/Teacher lines from text blocks only", () => {
		const r = renderParentTranscript([user("u1", "what is a limit?"), assistant("a1", "A limit is …")]);
		assert.equal(r.text, "Learner: what is a limit?\n\nTeacher: A limit is …");
		assert.equal(r.messageCount, 2);
		assert.equal(r.truncated, false);
	});

	it("a check left open renders as the posed question — never as the synthesized INTERRUPTED result (owner report 2026-10-25: the aside re-posed the quiz)", () => {
		const quiz = {
			id: "a2",
			role: "assistant",
			content: [
				{ type: "text", text: "Here is a check." },
				{ type: "toolCall", id: "call_1", name: "quiz", arguments: { question: "Is R a function from A to B?", options: ["yes", "no"] } },
			],
			api: "x", provider: "x", model: "x", usage: {}, stopReason: "toolUse", timestamp: 2,
		} as unknown as Msg;
		const r = renderParentTranscript([user("u1", "teach me functions"), quiz]);
		assert.ok(r.text.includes("(the lesson posed a check via quiz: Is R a function from A to B?)"), r.text);
		assert.ok(!r.text.includes("interrupted"), `no synthesized result leaks: ${r.text}`);
		assert.ok(!r.text.includes("tool result"), "no tool-result line without a real result");
		// A REAL result still renders.
		const answered: Msg = { id: "t1", role: "toolResult", toolCallId: "call_1", toolName: "quiz", content: [{ type: "text", text: "Learner answered: no" }], isError: false, timestamp: 3 } as unknown as Msg;
		assert.ok(renderParentTranscript([user("u1", "teach me functions"), quiz, answered]).text.includes("(tool result — quiz): Learner answered: no"));
		// The marker closes with the hands-off trailer.
		const marker = newAsideContextMessage({ chatId: "c1", title: "Functions" }, [user("u1", "teach me functions"), quiz]);
		const text = toLlmMessages([marker]).map((m) => JSON.stringify(m.content)).join("");
		assert.ok(text.includes("[End of lesson transcript]"), "trailer present");
		assert.ok(text.includes("Do not resume, re-ask, grade"), "the hands-off rule is spelled out");
	});

	it("keeps the TAIL under the budget and flags the cut", () => {
		const msgs = Array.from({ length: 20 }, (_, i) => user(`u${i}`, `turn ${i} ${"x".repeat(50)}`));
		const r = renderParentTranscript(msgs, 300);
		assert.equal(r.truncated, true);
		assert.equal(r.messageCount, 20);
		assert.ok(r.text.startsWith("[earlier turns omitted"));
		assert.ok(r.text.includes("turn 19"), "the newest turn survives");
		assert.ok(!r.text.includes("turn 0 "), "the oldest turn is cut");
	});

	it("the context marker carries the quote for the model AND the card, and is model-visible neutral input", () => {
		const origin = { chatId: "chat_p", title: "Limits", quote: "ε-δ definition" };
		const m = newAsideContextMessage(origin, [user("u1", "hi")]);
		assert.equal(m.customType, "aside-context");
		assert.ok(m.content.startsWith("[Aside context]"));
		assert.ok(m.content.includes("Learner: hi"));
		assert.ok(m.content.includes("> ε-δ definition"));
		assert.deepEqual(m.details, { parentChatId: "chat_p", parentTitle: "Limits", quote: "ε-δ definition", messageCount: 1, truncated: false });
		assert.equal(nativeInputCause(m, []), "neutral");
		const wire = toLlmMessages([m as Msg]);
		assert.equal(wire.length, 1);
		assert.equal(wire[0]?.role, "user");
		const view = projectView([m as Msg]);
		assert.equal(view.length, 1);
		assert.equal(view[0]?.parts[0]?.type, "data-aside-context");
	});

	it("titles: the quote's head, else the parent's title", () => {
		assert.equal(asideTitle({ chatId: "c", title: "Limits" }), "Aside: Limits");
		assert.equal(asideTitle({ chatId: "c", title: "Limits", quote: "the  squeeze\ntheorem" }), "Aside: the squeeze theorem");
		assert.ok(asideTitle({ chatId: "c", title: "L", quote: "w".repeat(100) }).endsWith("…"));
	});
});

describe("the aside record", () => {
	it("createChat(kind aside, origin) stamps kind + aside on record and list", () => {
		const parent = chatStore.createChat("Limits");
		const aside = chatStore.createChat("Aside: ε-δ", "aside", { chatId: parent.id, title: parent.title, quote: "ε-δ" });
		assert.equal(aside.kind, "aside");
		assert.deepEqual(aside.aside, { chatId: parent.id, title: "Limits", quote: "ε-δ" });
		const listed = chatStore.listChats().find((c) => c.id === aside.id);
		assert.equal(listed?.kind, "aside");
		assert.equal(listed?.aside?.chatId, parent.id);
		// The parent never learns about the aside.
		assert.equal(chatStore.getChat(parent.id)?.messages.length, 0);
		assert.equal("aside" in (chatStore.getChat(parent.id) ?? {}), false);
	});
});

describe("the aside agent's prompt", () => {
	it("composes its own base plus voice/accuracy/formatting only — no tool mechanics", () => {
		const paths = listSourceSegments("aside").map((s) => s.path);
		assert.deepEqual(paths, ["aside/00-base.md", "shared/10-voice.md", "shared/15-accuracy.md", "shared/40-formatting.md"]);
		assert.ok(allSegmentPaths().includes("aside/00-base.md"));
		const text = composeInstructions("aside");
		assert.ok(text.includes("SIDE QUESTION"));
		assert.ok(!text.includes("plan_init"), "no teacher tool mechanics leak in");
	});
});

describe("sidebar nesting", () => {
	it("asides follow their parent; orphans stay flat in place", () => {
		const list = [
			{ id: "a1", kind: "aside", aside: { chatId: "p1" } },
			{ id: "p2" },
			{ id: "orphan", kind: "aside", aside: { chatId: "gone" } },
			{ id: "p1" },
			{ id: "a2", kind: "aside", aside: { chatId: "p1" } },
		];
		assert.deepEqual(nestAsides(list).map((c) => c.id), ["p2", "orphan", "p1", "a1", "a2"]);
	});
});

describe("POST /api/chats {kind: aside}", () => {
	const post = (body: unknown) =>
		POST(new Request("http://test/api/chats", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));

	it("forks the parent: kind + origin + the context marker as message[0]; inherits the parent's model; parent untouched", async () => {
		const parent = chatStore.createChat("Limits");
		chatStore.saveMessages(parent.id, [user("u1", "what is a limit?"), assistant("a1", "A limit is …")]);
		chatStore.saveSettings(parent.id, { model: { provider: "openai", id: "gpt-x" }, thinkingLevel: "low" } as never);
		const res = await post({ kind: "aside", aside: { chatId: parent.id, quote: "A limit is", messageId: "a1" } });
		assert.equal(res.status, 200);
		const { id, title } = (await res.json()) as { id: string; title: string };
		assert.equal(title, "Aside: A limit is");
		const rec = chatStore.getChat(id);
		assert.equal(rec?.kind, "aside");
		assert.deepEqual(rec?.aside, { chatId: parent.id, title: "Limits", quote: "A limit is", messageId: "a1" });
		assert.equal(rec?.settings?.model?.id, "gpt-x");
		const first = rec?.messages[0];
		assert.equal(first?.role, "custom");
		assert.equal(first?.role === "custom" && first.customType, "aside-context");
		assert.ok(first?.role === "custom" && first.content.includes("Teacher: A limit is …"));
		assert.equal(chatStore.getChat(parent.id)?.messages.length, 2, "the parent record is only read");
	});

	it("refuses a missing parent (404) and forking an aside (400)", async () => {
		assert.equal((await post({ kind: "aside", aside: { chatId: "chat_nope" } })).status, 404);
		const parent = chatStore.createChat("P");
		const a = chatStore.createChat("A", "aside", { chatId: parent.id, title: "P" });
		assert.equal((await post({ kind: "aside", aside: { chatId: a.id } })).status, 400);
	});
});
