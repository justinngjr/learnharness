/**
 * Asides (2026-10-24) — the pure core of pi's `/btw` semantics in
 * LearnHarness: a side question asked over a READ-ONLY FORK of a session's
 * transcript. The aside is its own session record (kind "aside", origin on
 * `aside`); its message[0] is an aside-context marker whose model-facing
 * text is a rendering of the parent transcript (compaction cut applied)
 * plus the highlighted passage. The parent record never changes.
 */
import type { AsideOrigin } from "./contracts/chat.ts";
import { newMessageId, toLlmMessages, type LhMessage, type LhMarkerMessage } from "./native-messages.ts";

/** `/btw <question>` — the composer's side-question command (pi's name).
 *  Returns the question, or null when the text is not a /btw. The bare
 *  command with no question is a /btw with an empty question ("" —
 *  the caller opens the panel and lets the learner type). */
export function parseBtw(text: string): string | null {
	const m = /^\/btw(?:\s+([\s\S]*))?$/i.exec(text.trim());
	if (!m) return null;
	return (m[1] ?? "").trim();
}

/** The aside-context marker's UI payload (the collapsed card). */
export interface AsideContextData {
	parentChatId: string;
	parentTitle: string;
	quote?: string;
	/** Parent messages rendered into the context (after the cut). */
	messageCount: number;
	/** True when the head of the transcript was dropped for length. */
	truncated: boolean;
}

/** Default budget for the forked transcript text (chars ≈ tokens × 4). */
export const ASIDE_CONTEXT_MAX_CHARS = 60_000;

/** The highlight chip's one-click lane (owner 2026-10-25): "Explain this"
 *  opens the aside over the quoted passage and asks this at once — the
 *  passage itself rides the aside-context marker, so the question needs
 *  no copy of it. */
export const ASIDE_EXPLAIN_PROMPT = "Explain this passage.";

/** Closes the forked transcript: the lesson is paused, not handed over.
 *  Owner report 2026-10-25 — an aside opened over a lesson with a check
 *  waiting answered as the teacher ("Back to the check that got cut
 *  off…") and re-posed the quiz. */
export const ASIDE_CONTEXT_TRAILER =
	"[End of lesson transcript] That lesson is PAUSED while this aside runs — it is not yours to continue. Do not resume, re-ask, grade, or refer to any check or quiz left open above; the lesson's own teacher picks it up when the learner returns. Answer only the learner's side question below.";

const OMITTED = "[earlier turns omitted for length]";

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((b) => {
			const block = b as { type?: string; text?: string; name?: string; arguments?: unknown };
			if (block.type === "text") return block.text ?? "";
			// Tool calls read as a one-line note — the aside sees WHAT was
			// asked (a quiz, a plan), never the machinery. A check carries
			// its question so a side question ABOUT the check has it.
			if (block.type === "toolCall") {
				const q = (block.arguments as { question?: unknown } | undefined)?.question;
				return typeof q === "string" && q.trim()
					? `(the lesson posed a check via ${block.name ?? "?"}: ${q.trim()})`
					: `(used tool: ${block.name ?? "?"})`;
			}
			return "";
		})
		.filter(Boolean)
		.join("\n");
}

/** Render a parent transcript as plain text for the aside's context:
 *  compaction cut applied (toLlmMessages), text blocks only, Learner/
 *  Teacher labels, tool results summarised, tail kept under `maxChars`. */
export function renderParentTranscript(
	messages: readonly LhMessage[],
	maxChars: number = ASIDE_CONTEXT_MAX_CHARS,
): { text: string; messageCount: number; truncated: boolean } {
	const lines: string[] = [];
	// Only REAL tool results render. toLlmMessages synthesizes an
	// INTERRUPTED result for a check left open (the provider needs one);
	// shown to the aside it read as "the check got cut off — resume it",
	// and the aside turned back into the teacher (owner report 2026-10-25).
	const realResults = new Set(
		messages.filter((m) => m.role === "toolResult").map((m) => (m as { toolCallId: string }).toolCallId),
	);
	for (const m of toLlmMessages(messages)) {
		if (m.role === "system") continue;
		if (m.role === "toolResult") {
			if (!realResults.has(m.toolCallId)) continue;
			const t = textOf(m.content).trim();
			if (t) lines.push(`(tool result — ${m.toolName}): ${t}`);
			continue;
		}
		const t = textOf(m.content).trim();
		if (!t) continue;
		lines.push(`${m.role === "assistant" ? "Teacher" : "Learner"}: ${t}`);
	}
	const messageCount = lines.length;
	let truncated = false;
	// Keep the TAIL: the question is about what was said most recently.
	while (lines.length > 1 && lines.join("\n\n").length > maxChars) {
		lines.shift();
		truncated = true;
	}
	if (truncated) lines.unshift(OMITTED);
	return { text: lines.join("\n\n"), messageCount, truncated };
}

/** The aside's title: the quote's first words, else the parent's title. */
export function asideTitle(origin: AsideOrigin): string {
	const q = (origin.quote ?? "").replace(/\s+/g, " ").trim();
	if (q) return `Aside: ${q.length > 48 ? `${q.slice(0, 47).trimEnd()}…` : q}`;
	return `Aside: ${origin.title}`;
}

/** Build message[0] of an aside: the forked parent transcript + quote.
 *  PREAMBLE LAW (native-messages.ts): markers flatten to USER-role text on
 *  the wire, so the bracket header marks it as injected context. */
export function newAsideContextMessage(
	origin: AsideOrigin,
	parentMessages: readonly LhMessage[],
	maxChars: number = ASIDE_CONTEXT_MAX_CHARS,
): LhMarkerMessage {
	const rendered = renderParentTranscript(parentMessages, maxChars);
	const lines = [
		`[Aside context] — a side question about the session "${origin.title}". Its transcript so far (read-only; you are NOT continuing that lesson):`,
		"",
		rendered.text || "(the session has no messages yet)",
		"",
		ASIDE_CONTEXT_TRAILER,
	];
	if (origin.quote?.trim()) {
		lines.push("", "The learner highlighted this passage — the question is about it:", "", `> ${origin.quote.trim().split("\n").join("\n> ")}`);
	}
	const details: AsideContextData = {
		parentChatId: origin.chatId,
		parentTitle: origin.title,
		...(origin.quote?.trim() ? { quote: origin.quote.trim() } : {}),
		messageCount: rendered.messageCount,
		truncated: rendered.truncated,
	};
	return {
		id: newMessageId(),
		role: "custom",
		customType: "aside-context",
		content: lines.join("\n"),
		display: true,
		details,
		timestamp: Date.now(),
	};
}
