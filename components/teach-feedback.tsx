"use client";

/**
 * 👎 "TEACH THIS DIFFERENTLY" (2026-10-25). The one unobtrusive action a
 * teacher message carries in a teach chat: click → the chat's model
 * proposes ONE general preference rule (POST /api/preferences/propose)
 * → a small dialog shows it in an editable field → Confirm appends it to
 * the global learner preferences (POST /api/preferences, source
 * "feedback"); Cancel saves nothing. The transcript is never touched, and
 * nothing is stored without the learner's explicit Confirm.
 */
import { ThumbsDownIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useBackdropDismiss } from "@/components/backdrop-dismiss";
import { MessageAction, MessageActions } from "@/components/ai-elements/message";
import { LEARNER_PREFERENCE_MAX_CHARS } from "@/src/core";

export const TEACH_DIFFERENTLY_LABEL = "Teach this differently";

type Phase =
	| { kind: "idle" }
	| { kind: "proposing" }
	| { kind: "proposal"; text: string; error: string | null; saving: boolean }
	| { kind: "error"; message: string };

async function readError(res: Response): Promise<string> {
	const detail = (await res.json().catch(() => ({}))) as { error?: string };
	return detail.error ?? `Request failed (${res.status})`;
}

/** Rendered under an assistant message; owns the whole propose → confirm
 *  flow. `fetchImpl` is the test seam. */
export function TeachDifferentlyAction({
	chatId,
	messageId,
	fetchImpl = fetch,
}: {
	chatId: string;
	messageId: string;
	fetchImpl?: typeof fetch;
}) {
	const [phase, setPhase] = useState<Phase>({ kind: "idle" });

	const propose = useCallback(async () => {
		setPhase({ kind: "proposing" });
		try {
			const res = await fetchImpl("/api/preferences/propose", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ chatId, messageId }),
			});
			if (!res.ok) {
				setPhase({ kind: "error", message: await readError(res) });
				return;
			}
			const { proposal } = (await res.json()) as { proposal: string | null };
			setPhase({ kind: "proposal", text: proposal ?? "", error: null, saving: false });
		} catch (err) {
			setPhase({ kind: "error", message: err instanceof Error ? err.message : String(err) });
		}
	}, [chatId, messageId, fetchImpl]);

	const confirm = useCallback(
		async (text: string) => {
			const clean = text.trim();
			if (!clean) {
				setPhase({ kind: "proposal", text, error: "Write the rule first.", saving: false });
				return;
			}
			setPhase({ kind: "proposal", text, error: null, saving: true });
			try {
				const res = await fetchImpl("/api/preferences", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ text: clean, source: "feedback" }),
				});
				if (!res.ok) {
					setPhase({ kind: "proposal", text, error: await readError(res), saving: false });
					return;
				}
				setPhase({ kind: "idle" });
			} catch (err) {
				setPhase({ kind: "proposal", text, error: err instanceof Error ? err.message : String(err), saving: false });
			}
		},
		[fetchImpl],
	);

	const close = useCallback(() => setPhase({ kind: "idle" }), []);
	const busy = phase.kind === "proposing";

	return (
		<>
			<MessageActions className="mt-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 group-[.is-assistant]:justify-start">
				<MessageAction
					tooltip={TEACH_DIFFERENTLY_LABEL}
					label={TEACH_DIFFERENTLY_LABEL}
					data-testid="teach-differently"
					className="size-6 text-muted-foreground/60 hover:text-foreground"
					disabled={busy}
					onClick={() => void propose()}
				>
					<ThumbsDownIcon className={busy ? "size-3.5 animate-pulse" : "size-3.5"} />
				</MessageAction>
			</MessageActions>
			{phase.kind === "proposal" && (
				<PreferenceProposalDialog
					text={phase.text}
					error={phase.error}
					saving={phase.saving}
					onChange={(text) => setPhase({ kind: "proposal", text, error: null, saving: false })}
					onCancel={close}
					onConfirm={() => void confirm(phase.text)}
				/>
			)}
			{phase.kind === "error" && (
				<PreferenceProposalDialog
					text=""
					error={phase.message}
					saving={false}
					failed
					onChange={(text) => setPhase({ kind: "proposal", text, error: null, saving: false })}
					onCancel={close}
					onConfirm={close}
				/>
			)}
		</>
	);
}

export function PreferenceProposalBody({
	text,
	error,
	saving,
	failed = false,
	onChange,
	onCancel,
	onConfirm,
}: {
	text: string;
	error: string | null;
	saving: boolean;
	/** The proposal call itself failed — the field is empty, the learner
	 *  may still write a rule by hand. */
	failed?: boolean;
	onChange: (text: string) => void;
	onCancel: () => void;
	onConfirm: () => void;
}) {
	const backdropDismiss = useBackdropDismiss(onCancel);
	const canConfirm = text.trim().length > 0 && !saving;
	return (
		<div
			role="dialog"
			aria-modal="true"
			aria-label={TEACH_DIFFERENTLY_LABEL}
			data-testid="preference-proposal-dialog"
			className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
			{...backdropDismiss}
		>
			<div className="mx-4 w-full max-w-md rounded-xl border bg-card p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
				<h2 className="text-sm font-semibold text-card-foreground">{TEACH_DIFFERENTLY_LABEL}</h2>
				<p className="mt-1.5 text-xs text-muted-foreground">
					{failed
						? "The model could not propose a rule. You can still write one — it applies to every future lesson."
						: "A general rule for every future lesson, proposed from this message. Edit it, then confirm."}
				</p>
				<textarea
					value={text}
					onChange={(e) => onChange(e.target.value)}
					maxLength={LEARNER_PREFERENCE_MAX_CHARS}
					rows={3}
					autoFocus
					aria-label="Preference rule"
					data-testid="preference-proposal-text"
					className="mt-3 w-full resize-none rounded-sm border border-border bg-background px-2 py-1.5 font-prose text-sm text-foreground outline-none focus:border-foreground/40"
				/>
				{error && (
					<p className="mt-1.5 text-xs text-destructive" data-testid="preference-proposal-error">
						{error}
					</p>
				)}
				<div className="mt-4 flex justify-end gap-2">
					<button
						type="button"
						data-testid="preference-proposal-cancel"
						onClick={onCancel}
						className="rounded-sm px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
					>
						Cancel
					</button>
					<button
						type="button"
						data-testid="preference-proposal-confirm"
						onClick={onConfirm}
						disabled={!canConfirm}
						className="rounded-sm border border-border bg-foreground/5 px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-foreground/10 disabled:opacity-40"
					>
						{saving ? "Saving…" : "Confirm"}
					</button>
				</div>
			</div>
		</div>
	);
}

function PreferenceProposalDialog(props: Parameters<typeof PreferenceProposalBody>[0]) {
	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault();
				e.stopPropagation();
				props.onCancel();
			}
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, [props]);
	if (typeof document === "undefined") return null;
	return createPortal(<PreferenceProposalBody {...props} />, document.body);
}
