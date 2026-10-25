/**
 * LEARNER PREFERENCES — server access (2026-10-25). The settings record
 * is THE store (core/learner-preferences.ts explains the shape); this
 * file is the read-modify-write around it plus the 👎 proposal side call.
 *
 * Proposal = one tool-less, single-turn call on the CHAT's configured
 * conversation model (same resolution the turn uses: chat override →
 * strong slot), fed the disliked teacher message and a little surrounding
 * transcript. The result is only ever SHOWN — persistence happens solely
 * through appendLearnerPreference after the learner confirms.
 */
import { piEngineForSpec, type PiEngine } from "../agent/models.ts";
import { runSubagent } from "../agent/subagents/pi-run.ts";
import { renderParentTranscript } from "../core/aside.ts";
import {
	addLearnerPreference,
	buildProposalPrompt,
	learnerPreferencesOf,
	parseProposal,
	PROPOSAL_SYSTEM_PROMPT,
	type LearnerPreference,
	type LearnerPreferenceSource,
} from "../core/learner-preferences.ts";
import type { LhMessage } from "../core/native-messages.ts";
import type { ChatStore, SettingsStore } from "../core/ports.ts";
import { CURRENT_SETTINGS_VERSION, ModelsNotConfiguredError } from "../core/settings.ts";
import { resolveConversationSpec } from "../core/settings-resolution.ts";
import { effectiveSettings, stores } from "./stores.ts";

/** How much transcript precedes the disliked message in the side call. */
const PROPOSAL_CONTEXT_MESSAGES = 6;
const PROPOSAL_CONTEXT_MAX_CHARS = 8_000;

export function listLearnerPreferences(settingsStore: SettingsStore = stores.settingsStore): LearnerPreference[] {
	return learnerPreferencesOf(settingsStore.readSettings());
}

/** Replace the whole list (Settings UI edits a copy and PUTs it back). */
export function writeLearnerPreferences(
	next: readonly LearnerPreference[],
	settingsStore: SettingsStore = stores.settingsStore,
): LearnerPreference[] {
	const record = settingsStore.readSettings() ?? { version: CURRENT_SETTINGS_VERSION };
	settingsStore.writeSettings({ ...record, learnerPreferences: [...next] });
	return listLearnerPreferences(settingsStore);
}

/** Append one confirmed rule. Returns the stored rule, or null when the
 *  text normalises to nothing (the caller reports a 400). */
export function appendLearnerPreference(
	text: string,
	source: LearnerPreferenceSource,
	settingsStore: SettingsStore = stores.settingsStore,
): LearnerPreference | null {
	const before = listLearnerPreferences(settingsStore);
	const after = addLearnerPreference(before, text, source);
	if (after.length === before.length) return null;
	writeLearnerPreferences(after, settingsStore);
	return after[after.length - 1]!;
}

export function assistantMessageText(message: LhMessage): string {
	if (message.role !== "assistant" || !Array.isArray(message.content)) return "";
	return message.content
		.filter((c): c is { type: "text"; text: string } => c.type === "text" && typeof (c as { text?: unknown }).text === "string")
		.map((c) => c.text)
		.join("\n")
		.trim();
}

export class ProposalTargetError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ProposalTargetError";
	}
}

export interface ProposeDeps {
	chatStore?: ChatStore;
	settingsStore?: SettingsStore;
	/** Tests inject a scripted engine; production resolves the chat's model. */
	engine?: PiEngine;
	/** Tests may bypass pi entirely: (systemPrompt, prompt) → reply text. */
	complete?: (systemPrompt: string, prompt: string) => Promise<string>;
}

export interface ProposalResult {
	/** The proposed rule, or null when the model returned nothing usable. */
	proposal: string | null;
	/** The prompt sent (surfaced for tests / debugging). */
	prompt: string;
}

/** Ask the chat's model for ONE general preference rule from a disliked
 *  teacher message. Throws ProposalTargetError for an unknown chat /
 *  message, ModelsNotConfiguredError when no conversation model resolves. */
export async function proposeLearnerPreference(
	chatId: string,
	messageId: string,
	deps: ProposeDeps = {},
): Promise<ProposalResult> {
	const chatStore = deps.chatStore ?? stores.chatStore;
	const settingsStore = deps.settingsStore ?? stores.settingsStore;
	const record = chatStore.getChat(chatId);
	if (!record) throw new ProposalTargetError(`Unknown chat ${chatId}`);
	const index = record.messages.findIndex((m) => m.id === messageId);
	const target = index >= 0 ? record.messages[index] : undefined;
	if (!target || target.role !== "assistant") throw new ProposalTargetError(`No teacher message ${messageId} in chat ${chatId}`);
	const message = assistantMessageText(target);
	if (!message) throw new ProposalTargetError(`Teacher message ${messageId} has no text`);

	const context = renderParentTranscript(
		record.messages.slice(Math.max(0, index - PROPOSAL_CONTEXT_MESSAGES), index),
		PROPOSAL_CONTEXT_MAX_CHARS,
	).text;
	const prompt = buildProposalPrompt({ message, context, existing: listLearnerPreferences(settingsStore) });

	let text: string;
	if (deps.complete) {
		text = await deps.complete(PROPOSAL_SYSTEM_PROMPT, prompt);
	} else {
		let engine = deps.engine;
		if (!engine) {
			const spec = resolveConversationSpec(record.settings, effectiveSettings().models.strong);
			if (!spec) throw new ModelsNotConfiguredError(["strong"]);
			engine = piEngineForSpec(spec, true);
		}
		const result = await runSubagent([], {
			role: "researcher" as never,
			prompt,
			engine,
			systemPrompt: PROPOSAL_SYSTEM_PROMPT,
			maxTurns: 1,
		});
		text = result.text;
	}
	return { proposal: parseProposal(text), prompt };
}
