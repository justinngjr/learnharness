"use client";

/**
 * The ASIDE panel (2026-10-24 — pi's `/btw` in LearnHarness): a side chat
 * docked right of the lesson. An aside is its own session (kind "aside",
 * message[0] = the forked parent transcript + the highlighted passage), so
 * the panel is a small transcript + composer over useChatSession on the
 * aside's id. Nothing here writes to the parent — the aside's turns go to
 * /api/chat under the aside's own chatId.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CornerDownRightIcon, ExternalLinkIcon, XIcon } from "lucide-react";
import { Composer } from "@/components/composer";
import { MessageResponse } from "@/components/ai-elements/message";
import { useChatSession } from "@/components/session";
import type { AsideContextData, AsideOrigin, LhMessage } from "@/src/core";

interface AsideRecord {
	id: string;
	title: string;
	aside?: AsideOrigin;
	messages: LhMessage[];
	turnInFlight?: boolean;
}

export function AsidePanel({
	asideId,
	initialQuestion,
	onClose,
}: {
	asideId: string;
	/** `/btw <question>` — sent as the aside's first turn on mount. */
	initialQuestion?: string;
	onClose: () => void;
}) {
	const [record, setRecord] = useState<AsideRecord | null>(null);
	const [failed, setFailed] = useState(false);
	useEffect(() => {
		let cancelled = false;
		setRecord(null);
		setFailed(false);
		void fetch(`/api/chats/${asideId}`)
			.then((r) => (r.ok ? (r.json() as Promise<AsideRecord>) : Promise.reject(new Error(String(r.status)))))
			.then((r) => {
				if (!cancelled) setRecord(r);
			})
			.catch(() => {
				if (!cancelled) setFailed(true);
			});
		return () => {
			cancelled = true;
		};
	}, [asideId]);
	// Esc closes the panel (the composer's own Esc only stops dictation).
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape" && !e.defaultPrevented) onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onClose]);
	return (
		<aside
			data-testid="aside-panel"
			className="flex h-full w-[26rem] max-w-[45vw] shrink-0 flex-col border-l border-border bg-background"
		>
			{failed ? (
				<div className="p-4 text-xs text-muted-foreground">This aside could not be loaded.</div>
			) : record ? (
				<AsideSession key={record.id} record={record} initialQuestion={initialQuestion} onClose={onClose} />
			) : (
				<div className="p-4 text-xs text-muted-foreground">Opening aside…</div>
			)}
		</aside>
	);
}

function AsideSession({
	record,
	initialQuestion,
	onClose,
}: {
	record: AsideRecord;
	initialQuestion?: string;
	onClose: () => void;
}) {
	const router = useRouter();
	const { messages, status, send, stop, error } = useChatSession({
		chatId: record.id,
		initialMessages: record.messages,
		initiallyInFlight: record.turnInFlight ?? false,
	});
	const busy = status === "submitted" || status === "streaming";
	const [text, setText] = useState("");
	const inputRef = useRef<HTMLTextAreaElement | null>(null);
	const scrollRef = useRef<HTMLDivElement | null>(null);

	// /btw's question: ONE send on mount, only when the aside is still bare
	// (reopening a persisted aside never resends).
	const fired = useRef(false);
	useEffect(() => {
		if (fired.current) return;
		fired.current = true;
		const asked = record.messages.some((m) => m.role === "user");
		if (initialQuestion && !asked) void send({ type: "text", text: initialQuestion });
	}, [initialQuestion, record.messages, send]);

	useEffect(() => {
		const el = scrollRef.current;
		if (el) el.scrollTop = el.scrollHeight;
	}, [messages]);

	const doSend = useCallback(() => {
		const t = text.trim();
		if (!t || busy) return;
		setText("");
		void send({ type: "text", text: t });
	}, [text, busy, send]);

	const context = record.messages.find((m) => m.role === "custom" && m.customType === "aside-context");
	const ctx = (context && context.role === "custom" ? (context.details as AsideContextData) : null) ?? null;
	const quote = record.aside?.quote ?? ctx?.quote;
	const parentId = record.aside?.chatId ?? ctx?.parentChatId;
	const parentTitle = record.aside?.title ?? ctx?.parentTitle ?? "the lesson";

	return (
		<>
			<div className="flex items-center gap-2 border-b border-border px-3 py-2">
				<CornerDownRightIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
				<div className="min-w-0 flex-1">
					<div className="truncate text-xs font-medium">Aside</div>
					<div className="truncate text-[11px] text-muted-foreground" title={parentTitle}>
						{parentTitle}
					</div>
				</div>
				<button
					type="button"
					title="Open as its own session"
					aria-label="Open aside as its own session"
					onClick={() => router.push(`/chat/${record.id}`)}
					className="rounded p-1 text-muted-foreground hover:text-foreground"
				>
					<ExternalLinkIcon className="size-3.5" aria-hidden />
				</button>
				<button
					type="button"
					aria-label="Close aside"
					data-testid="aside-close"
					onClick={onClose}
					className="rounded p-1 text-muted-foreground hover:text-foreground"
				>
					<XIcon className="size-4" aria-hidden />
				</button>
			</div>
			<div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3">
				{quote && (
					<blockquote
						data-testid="aside-quote"
						className="mb-3 border-l-2 border-primary/50 pl-3 text-xs italic text-muted-foreground"
					>
						{quote}
					</blockquote>
				)}
				{ctx && (
					<div className="mb-3 text-[11px] text-muted-foreground">
						Context: {ctx.messageCount} message{ctx.messageCount === 1 ? "" : "s"} from{" "}
						{parentId ? (
							<a href={`/chat/${parentId}`} className="underline-offset-2 hover:underline">
								{parentTitle}
							</a>
						) : (
							parentTitle
						)}
						{ctx.truncated ? " (earlier turns omitted)" : ""} · nothing here is written back to it.
					</div>
				)}
				<div className="flex flex-col gap-3">
					{messages.map((m) => {
						const texts = m.parts.filter((p) => p.type === "text").map((p) => (p as { text: string }).text);
						if (texts.length === 0) return null;
						return m.role === "user" ? (
							<div key={m.id} className="self-end max-w-[90%] rounded-xl bg-muted px-3 py-2 text-sm whitespace-pre-wrap">
								{texts.join("\n")}
							</div>
						) : (
							<div key={m.id} className="text-sm">
								<MessageResponse>{texts.join("\n")}</MessageResponse>
							</div>
						);
					})}
					{busy && messages.at(-1)?.role !== "assistant" && (
						<div className="text-xs text-muted-foreground">Thinking…</div>
					)}
					{error && <div className="text-xs text-destructive">{errorText(error)}</div>}
				</div>
			</div>
			<div className="border-t border-border p-2">
				<Composer
					busy={busy}
					value={text}
					onChange={setText}
					onSend={doSend}
					onStop={() => void stop()}
					canSend={text.trim().length > 0}
					autoFocus
					inputRef={inputRef}
					placeholder="Ask a side question…"
				/>
			</div>
		</>
	);
}

/** The transport throws the refusal body verbatim (a JSON envelope for
 *  the BYOK 503); show its `error` line, else the message. */
function errorText(error: unknown): string {
	const raw = error instanceof Error ? error.message : String(error);
	try {
		const parsed = JSON.parse(raw) as { error?: unknown };
		if (typeof parsed.error === "string") return parsed.error;
	} catch {
		/* plain text */
	}
	return raw;
}

/** The aside-context card — message[0] of an aside opened as a full page
 *  (the sidebar route): the quote + where the context came from. */
export function AsideContextCard({ data }: { data: AsideContextData }) {
	return (
		<div data-testid="aside-context-card" className="my-1 rounded-lg border border-dashed border-border/70 px-3 py-2 text-xs text-muted-foreground">
			<div className="flex items-center gap-2">
				<CornerDownRightIcon aria-hidden="true" className="size-3.5 shrink-0" />
				<span className="font-medium">Aside</span>
				<span className="min-w-0 flex-1 truncate">
					of{" "}
					<a href={`/chat/${data.parentChatId}`} className="underline-offset-2 hover:underline">
						{data.parentTitle}
					</a>{" "}
					· {data.messageCount} message{data.messageCount === 1 ? "" : "s"} of context
					{data.truncated ? " (earlier turns omitted)" : ""}
				</span>
			</div>
			{data.quote && (
				<blockquote data-testid="aside-quote" className="mt-2 border-l-2 border-primary/50 pl-3 italic">
					{data.quote}
				</blockquote>
			)}
		</div>
	);
}
