"use client";

/**
 * DRAFT PERSISTENCE (owner report 2026-10-25: "whatever I write down gets
 * lost" when leaving a chat). Every draft field — the composer, the
 * question dock's thinking/answer/Other, the reading-thinking box, the
 * practice thinking box — is plain React state inside the chat view, and
 * the view unmounts on every chat switch. This store keeps the typed text
 * in localStorage, keyed by what the draft belongs to (the chat for the
 * composer, the question/problem tool call for the dock fields), so a
 * field remounts with what the learner had written. Submitting, sending,
 * or dismissing clears the entry; an emptied field removes it.
 *
 * Text only: option picks and the confidence slider are not drafts.
 * Pure helpers (no React) sit above the hook so they stay testable.
 */
import { useEffect, useRef } from "react";

const PREFIX = "lh:draft:";

export function draftKey(...parts: string[]): string {
	return PREFIX + parts.join(":");
}

export function composerDraftKey(chatId: string): string {
	return draftKey("composer", chatId);
}

/** The dock fields of one question (quiz/ask/explain and the reading box
 *  that rides its answer) share the tool call's prefix so clearing the
 *  question clears all of them at once. */
export function questionDraftKey(toolCallId: string, field: "thinking" | "answer" | "other" | "reading"): string {
	return draftKey("question", toolCallId, field);
}

export function practiceDraftKey(problemCallId: string): string {
	return draftKey("practice", problemCallId, "thinking");
}

function storage(): Storage | null {
	try {
		return typeof window === "undefined" ? null : window.localStorage;
	} catch {
		return null;
	}
}

export function readDraft(key: string): string {
	try {
		return storage()?.getItem(key) ?? "";
	} catch {
		return "";
	}
}

/** Writes the text, or removes the entry when the text is empty. */
export function writeDraft(key: string, value: string): void {
	try {
		const s = storage();
		if (!s) return;
		if (value.length === 0) s.removeItem(key);
		else s.setItem(key, value);
	} catch {
		// Quota or privacy mode: the draft simply stays in memory.
	}
}

export function clearDraft(key: string): void {
	writeDraft(key, "");
}

/** Drops every draft of one question's dock (thinking/answer/Other and the
 *  reading box) — the answer or dismissal consumed them. */
export function clearQuestionDrafts(toolCallId: string): void {
	const s = storage();
	if (!s) return;
	const prefix = draftKey("question", toolCallId) + ":";
	const doomed: string[] = [];
	for (let i = 0; i < s.length; i++) {
		const k = s.key(i);
		if (k && k.startsWith(prefix)) doomed.push(k);
	}
	for (const k of doomed) s.removeItem(k);
}

/**
 * Binds a controlled text field to its stored draft. `apply` is the
 * field's own setter (it must keep any ref mirror current — the dictation
 * discipline). On mount and whenever `key` changes, the field takes the
 * stored text for that key (empty when none, so a draft never leaks from
 * one question into the next); afterwards every edit is written through.
 */
export function usePersistedDraft(key: string, value: string, apply: (v: string) => void): void {
	const hydratedKey = useRef<string | null>(null);
	useEffect(() => {
		if (hydratedKey.current !== key) {
			hydratedKey.current = key;
			const stored = readDraft(key);
			if (stored !== value) {
				apply(stored);
				return;
			}
		}
		writeDraft(key, value);
	}, [key, value, apply]);
}
