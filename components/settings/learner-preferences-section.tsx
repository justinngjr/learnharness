"use client";

/**
 * SETTINGS → LEARNER PREFERENCES (2026-10-25): the global rules, listed
 * newest first, each with inline edit and delete, plus an Add field for a
 * manual rule. The whole list is the unit of write — the dialog PUTs it
 * to /api/settings/learnerPreferences (replace-whole, like every section).
 */
import { CheckIcon, PencilIcon, Trash2Icon, XIcon } from "lucide-react";
import { useState } from "react";
import {
	addLearnerPreference,
	newestLearnerPreferences,
	removeLearnerPreference,
	updateLearnerPreference,
	LEARNER_PREFERENCE_MAX_CHARS,
	type LearnerPreference,
} from "@/src/core";
import { SettingsGroup } from "./controls.tsx";

const SOURCE_LABEL: Record<LearnerPreference["source"], string> = {
	feedback: "from 👎 feedback",
	manual: "added manually",
};

const ICON_BUTTON =
	"inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground/70 transition-colors hover:text-foreground disabled:opacity-40";

export function LearnerPreferencesSection({
	preferences,
	onSectionChange,
}: {
	preferences: readonly LearnerPreference[] | undefined;
	onSectionChange: (next: LearnerPreference[]) => void;
}) {
	const list = preferences ?? [];
	const [draft, setDraft] = useState("");
	const [editingId, setEditingId] = useState<string | null>(null);
	const [editDraft, setEditDraft] = useState("");

	const add = () => {
		const next = addLearnerPreference(list, draft, "manual");
		if (next.length === list.length) return;
		onSectionChange(next);
		setDraft("");
	};
	const commitEdit = (id: string) => {
		const next = updateLearnerPreference(list, id, editDraft);
		setEditingId(null);
		if (next.some((p, i) => p.text !== list[i]?.text)) onSectionChange(next);
	};

	return (
		<>
			<SettingsGroup label="Add a rule" testid="preferences-add">
				<div className="flex items-center gap-2">
					<input
						type="text"
						value={draft}
						placeholder='e.g. "Show the formal definition before the intuition"'
						aria-label="New preference"
						data-testid="preference-add-input"
						maxLength={LEARNER_PREFERENCE_MAX_CHARS}
						onChange={(e) => setDraft(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") add();
						}}
						className="h-7 min-w-0 flex-1 rounded-sm border border-border bg-background px-2 font-ui text-xs text-foreground outline-none placeholder:text-muted-foreground/60"
					/>
					<button
						type="button"
						data-testid="preference-add"
						disabled={!draft.trim()}
						onClick={add}
						className="h-7 rounded-sm border border-border px-3 font-ui text-xs text-foreground transition-colors hover:bg-foreground/5 disabled:opacity-40"
					>
						Add
					</button>
				</div>
			</SettingsGroup>
			<SettingsGroup label={`Rules (${list.length})`} testid="preferences-list">
				{list.length === 0 && (
					<p className="text-xs text-muted-foreground/70" data-testid="preferences-empty">
						No rules yet. Add one above, or click 👎 on a teacher message to have the model propose one.
					</p>
				)}
				{newestLearnerPreferences(list, Number.POSITIVE_INFINITY).map((p) => {
					const editing = editingId === p.id;
					return (
						<div key={p.id} data-testid="preference-row" className="flex items-start justify-between gap-3 py-1">
							{editing ? (
								<input
									type="text"
									value={editDraft}
									aria-label="Edit preference"
									data-testid="preference-edit-input"
									maxLength={LEARNER_PREFERENCE_MAX_CHARS}
									autoFocus
									onChange={(e) => setEditDraft(e.target.value)}
									onKeyDown={(e) => {
										if (e.key === "Enter") commitEdit(p.id);
										if (e.key === "Escape") setEditingId(null);
									}}
									className="h-7 min-w-0 flex-1 rounded-sm border border-border bg-background px-2 font-ui text-xs text-foreground outline-none"
								/>
							) : (
								<span className="min-w-0 flex-1">
									<span className="block font-prose text-(length:--lh-prose-size)" data-testid="preference-text">
										{p.text}
									</span>
									<span className="block text-xs text-muted-foreground/70">{SOURCE_LABEL[p.source]}</span>
								</span>
							)}
							<span className="flex items-center gap-1">
								{editing ? (
									<>
										<button type="button" aria-label="Save" data-testid="preference-edit-save" className={ICON_BUTTON} onClick={() => commitEdit(p.id)}>
											<CheckIcon className="size-3.5" />
										</button>
										<button type="button" aria-label="Discard edit" className={ICON_BUTTON} onClick={() => setEditingId(null)}>
											<XIcon className="size-3.5" />
										</button>
									</>
								) : (
									<>
										<button
											type="button"
											aria-label="Edit"
											data-testid="preference-edit"
											className={ICON_BUTTON}
											onClick={() => {
												setEditingId(p.id);
												setEditDraft(p.text);
											}}
										>
											<PencilIcon className="size-3.5" />
										</button>
										<button
											type="button"
											aria-label="Delete"
											data-testid="preference-delete"
											className={ICON_BUTTON}
											onClick={() => onSectionChange(removeLearnerPreference(list, p.id))}
										>
											<Trash2Icon className="size-3.5" />
										</button>
									</>
								)}
							</span>
						</div>
					);
				})}
			</SettingsGroup>
		</>
	);
}
