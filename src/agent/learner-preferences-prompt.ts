/**
 * LEARNER PREFERENCES → SYSTEM PROMPT (2026-10-25). THE one injection
 * point: baseAgentOptions calls this for every agent kind, and this file
 * decides who gets the segment (teacher, practice, aside — the agents
 * that TEACH; the prober only asks) and how it reads. The segment text
 * itself is pure core (learnerPreferencesPromptSegment): newest first,
 * capped, omitted entirely when there are no confirmed rules.
 */
import { learnerPreferencesPromptSegment, type LearnerPreference } from "../core/learner-preferences.ts";
import type { AgentKind } from "./teacher-agent.ts";

const KINDS_WITH_PREFERENCES: ReadonlySet<AgentKind> = new Set<AgentKind>(["teacher", "practice", "aside"]);

/** Same separator composeInstructions uses between prompt segments. */
const SEGMENT_SEPARATOR = "\n\n---\n\n";

export function withLearnerPreferences(
	kind: AgentKind,
	systemPrompt: string,
	preferences: readonly LearnerPreference[] | undefined,
): string {
	if (!preferences || !KINDS_WITH_PREFERENCES.has(kind)) return systemPrompt;
	const segment = learnerPreferencesPromptSegment(preferences);
	if (!segment) return systemPrompt;
	return `${systemPrompt}${SEGMENT_SEPARATOR}${segment}`;
}
