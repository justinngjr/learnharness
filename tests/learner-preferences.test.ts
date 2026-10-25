/**
 * Learner preferences (2026-10-25): the pure core (sanitize / CRUD / prompt
 * segment / proposal parsing), the settings-record store round-trip
 * (older record without the key, fossil entries), the one shared prompt
 * injection, the propose flow with the model call mocked, and the route
 * handlers' contracts.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, afterEach, describe, it } from "node:test";
import { SETTINGS_FILE } from "../config.ts";
import {
	addLearnerPreference,
	buildProposalPrompt,
	LEARNER_PREFERENCES_HEADING,
	learnerPreferencesOf,
	learnerPreferencesPromptSegment,
	newestLearnerPreferences,
	parseProposal,
	removeLearnerPreference,
	sanitizeLearnerPreferences,
	updateLearnerPreference,
	type LearnerPreference,
} from "../src/core/learner-preferences.ts";
import { sanitizeUserSettings, type UserSettings } from "../src/core/settings.ts";
import type { ChatStore, SettingsStore } from "../src/core/ports.ts";
import type { LhMessage } from "../src/core/native-messages.ts";
import { composeInstructions } from "../src/agent/teacher-agent.ts";
import { withLearnerPreferences } from "../src/agent/learner-preferences-prompt.ts";
import { parseLearnerPreferencesSettingsBody } from "../src/server/settings-body.ts";
import {
	appendLearnerPreference,
	listLearnerPreferences,
	ProposalTargetError,
	proposeLearnerPreference,
	writeLearnerPreferences,
} from "../src/server/learner-preferences.ts";
import { readSettings, writeSettings } from "../src/store/settings.ts";
import { POST as postPreference } from "../app/api/preferences/route.ts";

let hadSettings = false;
let savedSettings = "";
try {
	savedSettings = fs.readFileSync(SETTINGS_FILE, "utf-8");
	hadSettings = true;
} catch {
	/* first boot */
}
after(() => {
	if (hadSettings) fs.writeFileSync(SETTINGS_FILE, savedSettings, "utf-8");
	else fs.rmSync(SETTINGS_FILE, { force: true });
});
afterEach(() => {
	fs.rmSync(SETTINGS_FILE, { force: true });
});

function pref(id: string, text: string, createdAt: string, source: LearnerPreference["source"] = "manual"): LearnerPreference {
	return { id, text, createdAt, source };
}

function memorySettingsStore(initial: UserSettings | null = null): SettingsStore {
	let record = initial;
	return {
		readSettings: () => (record ? (sanitizeUserSettings(record) ?? null) : null),
		writeSettings: (next) => {
			record = next;
		},
	};
}

describe("learner preferences — pure core", () => {
	it("sanitizes: drops malformed entries, dedupes ids, normalises text", () => {
		const out = sanitizeLearnerPreferences([
			pref("a", "  Use   fewer analogies  ", "2026-01-01T00:00:00.000Z", "feedback"),
			{ id: "b", text: "", createdAt: "x" },
			{ id: "c", text: "Show the formal definition first", createdAt: "not a date", source: "weird" },
			pref("a", "duplicate id", "2026-01-02T00:00:00.000Z"),
			"junk",
			null,
		]);
		assert.deepEqual(
			out.map((p) => [p.id, p.text, p.source]),
			[
				["a", "Use fewer analogies", "feedback"],
				["c", "Show the formal definition first", "manual"],
			],
		);
		assert.equal(sanitizeLearnerPreferences("nope").length, 0);
		assert.equal(learnerPreferencesOf(null).length, 0);
		assert.equal(learnerPreferencesOf({ version: 1 }).length, 0);
	});

	it("CRUD helpers are pure and ignore empty text", () => {
		const t0 = new Date("2026-02-01T00:00:00.000Z");
		const one = addLearnerPreference([], "Don't annotate trivial steps", "feedback", t0);
		assert.equal(one.length, 1);
		assert.equal(one[0]!.source, "feedback");
		assert.equal(one[0]!.createdAt, t0.toISOString());
		assert.equal(addLearnerPreference(one, "   ", "manual").length, 1);
		const edited = updateLearnerPreference(one, one[0]!.id, "Skip 'this follows for free' annotations");
		assert.equal(edited[0]!.text, "Skip 'this follows for free' annotations");
		assert.equal(one[0]!.text, "Don't annotate trivial steps", "input untouched");
		assert.deepEqual(updateLearnerPreference(one, one[0]!.id, ""), one);
		assert.equal(removeLearnerPreference(edited, edited[0]!.id).length, 0);
		assert.equal(removeLearnerPreference(edited, "missing").length, 1);
	});

	it("renders the prompt segment newest first, capped at 30; null when empty", () => {
		assert.equal(learnerPreferencesPromptSegment([]), null);
		const seg = learnerPreferencesPromptSegment([
			pref("old", "Old rule", "2026-01-01T00:00:00.000Z"),
			pref("new", "New rule", "2026-03-01T00:00:00.000Z"),
		]);
		assert.equal(seg, `${LEARNER_PREFERENCES_HEADING}\n- New rule\n- Old rule`);
		const many = Array.from({ length: 40 }, (_, i) => pref(`p${i}`, `Rule ${i}`, new Date(Date.UTC(2026, 0, 1 + i)).toISOString()));
		const shown = newestLearnerPreferences(many);
		assert.equal(shown.length, 30);
		assert.equal(shown[0]!.id, "p39");
		assert.equal(shown[29]!.id, "p10");
	});

	it("builds the proposal prompt (≤25 words, imperative, general) and parses the reply", () => {
		const prompt = buildProposalPrompt({
			message: "Trivially, this follows for free.",
			context: "User: why?\nTeacher: because.",
			existing: [pref("a", "Use fewer analogies", "2026-01-01T00:00:00.000Z")],
		});
		assert.match(prompt, /at most 25 words, imperative mood/);
		assert.match(prompt, /GENERAL/);
		assert.match(prompt, /Use fewer analogies/);
		assert.match(prompt, /TEACHER MESSAGE[\s\S]*this follows for free/);
		assert.equal(parseProposal('Rule: "Don\'t label steps as trivial."\nMore text.'), "Don't label steps as trivial.");
		assert.equal(parseProposal("- Avoid analogies when stating definitions"), "Avoid analogies when stating definitions");
		assert.equal(parseProposal("   \n"), null);
	});
});

describe("learner preferences — the settings record store", () => {
	it("an older record without the key reads as none and survives a write (no schema bump)", () => {
		fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
		fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ version: 1, general: { autoUpdate: false } }), "utf-8");
		assert.deepEqual(listLearnerPreferences(), []);
		const stored = appendLearnerPreference("Use fewer analogies", "manual");
		assert.ok(stored);
		const record = readSettings()!;
		assert.equal(record.general?.autoUpdate, false, "sibling sections untouched");
		assert.equal(record.learnerPreferences?.length, 1);
		assert.equal(record.learnerPreferences?.[0]?.text, "Use fewer analogies");
	});

	it("round-trips the list, drops fossil entries on read, and replaces whole", () => {
		writeSettings({
			version: 1,
			learnerPreferences: [pref("a", "Keep it short", "2026-01-01T00:00:00.000Z", "feedback"), { id: 7, text: "bad" }],
		});
		const read = listLearnerPreferences();
		assert.deepEqual(read.map((p) => p.id), ["a"]);
		assert.equal(read[0]!.source, "feedback");
		const next = writeLearnerPreferences(updateLearnerPreference(read, "a", "Keep explanations short"));
		assert.equal(next[0]!.text, "Keep explanations short");
		assert.deepEqual(writeLearnerPreferences([]), []);
		assert.deepEqual(readSettings()!.learnerPreferences, []);
	});

	it("appendLearnerPreference refuses empty text and persists nothing", () => {
		assert.equal(appendLearnerPreference("   ", "feedback"), null);
		assert.equal(fs.existsSync(SETTINGS_FILE), false);
	});

	it("first boot: no record → append creates one", () => {
		const stored = appendLearnerPreference("Show the formal definition before the intuition", "feedback");
		assert.equal(stored?.source, "feedback");
		assert.equal(readSettings()!.learnerPreferences?.length, 1);
	});
});

describe("learner preferences — prompt injection", () => {
	const prefs = [pref("a", "Use fewer analogies", "2026-01-01T00:00:00.000Z")];
	it("appends the segment for teacher, practice and aside only; omitted when empty", () => {
		for (const kind of ["teacher", "practice", "aside"] as const) {
			const base = composeInstructions(kind);
			const out = withLearnerPreferences(kind, base, prefs);
			assert.ok(out.startsWith(base));
			assert.ok(out.endsWith(`\n\n---\n\n${LEARNER_PREFERENCES_HEADING}\n- Use fewer analogies`), kind);
			assert.equal(withLearnerPreferences(kind, base, []), base);
			assert.equal(withLearnerPreferences(kind, base, undefined), base);
		}
		const prober = composeInstructions("prober");
		assert.equal(withLearnerPreferences("prober", prober, prefs), prober);
	});
});

describe("learner preferences — the 👎 propose flow (model mocked)", () => {
	const messages: LhMessage[] = [
		{ id: "u1", role: "user", content: "Why is the kernel a subgroup?", timestamp: 1 } as unknown as LhMessage,
		{
			id: "a1",
			role: "assistant",
			content: [{ type: "text", text: "Trivially, closure follows for free from the homomorphism property." }],
			timestamp: 2,
		} as unknown as LhMessage,
	];
	const chatStore = {
		getChat: (id: string) => (id === "c1" ? { id: "c1", messages, settings: {} } : null),
	} as unknown as ChatStore;

	it("sends the disliked message + context to the model and returns the cleaned proposal", async () => {
		const settingsStore = memorySettingsStore({ version: 1, learnerPreferences: [pref("x", "Use fewer analogies", "2026-01-01T00:00:00.000Z")] });
		const calls: Array<{ system: string; prompt: string }> = [];
		const { proposal } = await proposeLearnerPreference("c1", "a1", {
			chatStore,
			settingsStore,
			complete: async (system, prompt) => {
				calls.push({ system, prompt });
				return '"Don\'t dismiss steps as trivial; justify each one briefly."';
			},
		});
		assert.equal(proposal, "Don't dismiss steps as trivial; justify each one briefly.");
		assert.equal(calls.length, 1);
		assert.match(calls[0]!.prompt, /closure follows for free/);
		assert.match(calls[0]!.prompt, /kernel a subgroup/, "surrounding transcript is included");
		assert.match(calls[0]!.prompt, /Use fewer analogies/, "existing rules are listed");
		assert.deepEqual(listLearnerPreferences(settingsStore).map((p) => p.id), ["x"], "proposing never persists");
	});

	it("rejects unknown chats / non-assistant messages", async () => {
		await assert.rejects(proposeLearnerPreference("nope", "a1", { chatStore, complete: async () => "x" }), ProposalTargetError);
		await assert.rejects(proposeLearnerPreference("c1", "u1", { chatStore, complete: async () => "x" }), ProposalTargetError);
	});

	it("an unusable reply yields a null proposal (the dialog still lets the learner type one)", async () => {
		const { proposal } = await proposeLearnerPreference("c1", "a1", { chatStore, settingsStore: memorySettingsStore(), complete: async () => "\n" });
		assert.equal(proposal, null);
	});
});

describe("learner preferences — route contracts", () => {
	it("PUT /api/settings/learnerPreferences body parser: array of {id,text} only", () => {
		assert.equal(parseLearnerPreferencesSettingsBody({ not: "array" }).ok, false);
		assert.equal(parseLearnerPreferencesSettingsBody([{ id: "a" }]).ok, false);
		assert.equal(parseLearnerPreferencesSettingsBody([{ id: "a", text: "x".repeat(301) }]).ok, false);
		const ok = parseLearnerPreferencesSettingsBody([pref("a", " Keep it short ", "2026-01-01T00:00:00.000Z", "feedback")]);
		assert.ok(ok.ok);
		assert.equal(ok.settings[0]!.text, "Keep it short");
	});

	it("POST /api/preferences appends one feedback rule; empty text is a 400", async () => {
		const bad = await postPreference(new Request("http://x/api/preferences", { method: "POST", body: JSON.stringify({ text: "  " }) }));
		assert.equal(bad.status, 400);
		const res = await postPreference(
			new Request("http://x/api/preferences", { method: "POST", body: JSON.stringify({ text: "Show the formal definition first" }) }),
		);
		assert.equal(res.status, 200);
		const body = (await res.json()) as { preference: LearnerPreference; preferences: LearnerPreference[] };
		assert.equal(body.preference.source, "feedback");
		assert.equal(body.preferences.length, 1);
		assert.equal(readSettings()!.learnerPreferences?.[0]?.text, "Show the formal definition first");
	});
});
