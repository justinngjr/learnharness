/**
 * LEARNER PREFERENCES (2026-10-25): global, per-user rules about HOW the
 * learner wants to be taught ("show the formal definition before the
 * intuition", "fewer analogies"). They live in THE user settings record
 * (core/settings.ts, key `learnerPreferences` — a pure addition, no
 * schema bump: an older record simply lacks the key and reads as none)
 * and are injected into the teacher, practice and aside system prompts
 * (src/agent/learner-preferences-prompt.ts).
 *
 * Two sources: "feedback" (the 👎 "Teach this differently" action — the
 * model PROPOSES one rule from the disliked message, the learner edits
 * and CONFIRMS; nothing is ever saved without that confirmation) and
 * "manual" (typed into Settings → Learner preferences).
 *
 * Browser-safe: pure logic + types only.
 */

export type LearnerPreferenceSource = "feedback" | "manual";

export interface LearnerPreference {
	id: string;
	text: string;
	/** ISO timestamp. */
	createdAt: string;
	source: LearnerPreferenceSource;
}

/** One rule's size cap — a preference is a sentence, not an essay. */
export const LEARNER_PREFERENCE_MAX_CHARS = 300;

/** How many rules the prompt segment carries (newest first). */
export const LEARNER_PREFERENCES_PROMPT_LIMIT = 30;

export const LEARNER_PREFERENCES_HEADING = "Learner preferences (confirmed by the learner; follow them):";

const SOURCES: readonly LearnerPreferenceSource[] = ["feedback", "manual"];

/** Normalise free text into rule text: one line, trimmed, capped. */
export function normalizePreferenceText(raw: string): string {
	return raw.replace(/\s+/g, " ").trim().slice(0, LEARNER_PREFERENCE_MAX_CHARS);
}

function sanitizeOne(raw: unknown): LearnerPreference | null {
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
	const r = raw as Record<string, unknown>;
	if (typeof r.id !== "string" || !r.id.trim()) return null;
	if (typeof r.text !== "string") return null;
	const text = normalizePreferenceText(r.text);
	if (!text) return null;
	const source = SOURCES.includes(r.source as LearnerPreferenceSource) ? (r.source as LearnerPreferenceSource) : "manual";
	const createdAt =
		typeof r.createdAt === "string" && !Number.isNaN(Date.parse(r.createdAt)) ? r.createdAt : new Date(0).toISOString();
	return { id: r.id, text, createdAt, source };
}

/** Coerce arbitrary JSON into a clean list: malformed entries DROP, a
 *  duplicate id keeps its first occurrence, non-arrays read as empty.
 *  Never throws (the settings sanitizer's discipline). */
export function sanitizeLearnerPreferences(raw: unknown): LearnerPreference[] {
	if (!Array.isArray(raw)) return [];
	const out: LearnerPreference[] = [];
	const seen = new Set<string>();
	for (const entry of raw) {
		const cleaned = sanitizeOne(entry);
		if (!cleaned || seen.has(cleaned.id)) continue;
		seen.add(cleaned.id);
		out.push(cleaned);
	}
	return out;
}

/** The list carried by a settings record (absent key / no record = none). */
export function learnerPreferencesOf(record: { learnerPreferences?: unknown; [key: string]: unknown } | null | undefined): LearnerPreference[] {
	return sanitizeLearnerPreferences(record?.learnerPreferences);
}

export function newLearnerPreferenceId(): string {
	const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
	if (c?.randomUUID) return `lp_${c.randomUUID().replace(/-/g, "").slice(0, 16)}`;
	return `lp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** Append one rule (pure). Empty text → the list unchanged. */
export function addLearnerPreference(
	list: readonly LearnerPreference[],
	text: string,
	source: LearnerPreferenceSource,
	now: Date = new Date(),
): LearnerPreference[] {
	const clean = normalizePreferenceText(text);
	if (!clean) return [...list];
	return [...list, { id: newLearnerPreferenceId(), text: clean, createdAt: now.toISOString(), source }];
}

/** Rewrite one rule's text (pure). Empty text or unknown id → unchanged. */
export function updateLearnerPreference(list: readonly LearnerPreference[], id: string, text: string): LearnerPreference[] {
	const clean = normalizePreferenceText(text);
	if (!clean) return [...list];
	return list.map((p) => (p.id === id ? { ...p, text: clean } : p));
}

export function removeLearnerPreference(list: readonly LearnerPreference[], id: string): LearnerPreference[] {
	return list.filter((p) => p.id !== id);
}

/** Newest first, capped for the prompt. */
export function newestLearnerPreferences(
	list: readonly LearnerPreference[],
	limit: number = LEARNER_PREFERENCES_PROMPT_LIMIT,
): LearnerPreference[] {
	return [...list]
		.map((p, i) => ({ p, i }))
		.sort((a, b) => Date.parse(b.p.createdAt) - Date.parse(a.p.createdAt) || b.i - a.i)
		.slice(0, limit)
		.map((x) => x.p);
}

/** The system-prompt segment, or null when there is nothing to say — the
 *  caller omits the segment entirely (never an empty heading). */
export function learnerPreferencesPromptSegment(list: readonly LearnerPreference[]): string | null {
	const shown = newestLearnerPreferences(list);
	if (shown.length === 0) return null;
	return [LEARNER_PREFERENCES_HEADING, ...shown.map((p) => `- ${p.text}`)].join("\n");
}

// ─── The 👎 proposal (the model's side call) ─────────────────────────────────

export const PROPOSAL_MAX_WORDS = 25;

export const PROPOSAL_SYSTEM_PROMPT =
	"You turn a learner's dislike of one tutoring message into ONE reusable teaching preference. Output the rule only — no preamble, no quotes, no bullet, no explanation.";

/** The user-turn text for the side call: the disliked message plus a
 *  little surrounding transcript, and the shape of rule wanted. */
export function buildProposalPrompt(input: {
	/** The disliked teacher message (text only). */
	message: string;
	/** Rendered surrounding transcript (may be ""). */
	context: string;
	/** Rules already confirmed (the proposal should not repeat one). */
	existing?: readonly LearnerPreference[];
}): string {
	const existing = newestLearnerPreferences(input.existing ?? [], 10);
	return [
		"The learner clicked 'Teach this differently' on the TEACHER MESSAGE below. Infer what about this message the learner most likely dislikes (its style, structure, pacing, level of detail, tone, or framing) and write ONE preference rule the teacher should follow in every future lesson.",
		"",
		"Rule requirements:",
		`- at most ${PROPOSAL_MAX_WORDS} words, imperative mood (\"Show …\", \"Avoid …\", \"Don't …\")`,
		"- GENERAL: about how to teach, not about this particular topic or example",
		"- one rule only, plain text, no quotes or bullets",
		...(existing.length
			? ["- different from these already-confirmed rules:", ...existing.map((p) => `  - ${p.text}`)]
			: []),
		"",
		...(input.context.trim() ? ["Surrounding transcript (for context only):", input.context.trim(), ""] : []),
		"TEACHER MESSAGE (the one the learner disliked):",
		input.message.trim(),
	].join("\n");
}

/** Clean the model's reply into rule text: first non-empty line, bullet /
 *  quote / label debris stripped, capped. Empty → null (the UI says so). */
export function parseProposal(text: string): string | null {
	const line = text
		.split(/\r?\n/)
		.map((l) => l.trim())
		.find((l) => l.length > 0);
	if (!line) return null;
	const cleaned = line
		.replace(/^(?:[-*•]|\d+[.)])\s+/, "")
		.replace(/^(?:rule|preference)\s*:\s*/i, "")
		.replace(/^["'“‘]+|["'”’]+$/g, "")
		.trim();
	const normalized = normalizePreferenceText(cleaned);
	return normalized || null;
}
