"use client";

/**
 * The ASIDE panel (2026-10-24 — pi's `/btw` in LearnHarness): a side chat
 * docked right of the lesson. An aside is its own session (kind "aside",
 * message[0] = the forked parent transcript + the highlighted passage), so
 * the panel is a small transcript + composer over useChatSession on the
 * aside's id. Nothing here writes to the parent — the aside's turns go to
 * /api/chat under the aside's own chatId.
 *
 * NOTHING PERSISTS UNTIL A QUESTION IS ASKED (owner 2026-10-25): the panel
 * opens as a DRAFT (quote + composer, no record); the first send creates
 * the aside and asks. Closing a draft is just closing it, and closing an
 * aside that never got an answer deletes it — changing your mind leaves
 * no session behind.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CornerDownRightIcon, ExternalLinkIcon, XIcon } from "lucide-react";
import { Composer } from "@/components/composer";
import { MessageResponse } from "@/components/ai-elements/message";
import { useChatSession } from "@/components/session";
import type { AsideContextData, AsideOrigin, LhMessage } from "@/src/core";

/** What opens the panel: an existing aside (`id`), or a draft over the
 *  parent — the highlighted passage and/or the `/btw` question. */
export interface AsideRequest {
	id?: string;
	quote?: string;
	messageId?: string;
	/** `/btw <question>` — asked as the first turn as soon as the aside exists. */
	question?: string;
}

interface AsideRecord {
	id: string;
	title: string;
	aside?: AsideOrigin;
	messages: LhMessage[];
	turnInFlight?: boolean;
}

/** True when closing should keep the aside: an answer exists (assistant
 *  text, not the optimistic empty shell a send appends) or is streaming.
 *  Bare (context only) or refused asides are discarded. */
export function asideWorthKeeping(
	messages: readonly { role: string; parts?: readonly { type: string; text?: string }[] }[],
	busy: boolean,
): boolean {
	return (
		busy ||
		messages.some(
			(m) => m.role === "assistant" && (m.parts ?? []).some((p) => p.type === "text" && (p.text ?? "").trim().length > 0),
		)
	);
}

export function AsidePanel({
	parentChatId,
	parentTitle,
	request,
	onClose,
}: {
	parentChatId: string;
	parentTitle: string;
	request: AsideRequest;
	onClose: () => void;
}) {
	const [id, setId] = useState<string | undefined>(request.id);
	const [question, setQuestion] = useState<string | undefined>(request.question);
	const [failed, setFailed] = useState<string | null>(null);
	const creating = useRef(false);
	const create = useCallback(
		async (firstQuestion: string) => {
			if (creating.current) return;
			creating.current = true;
			try {
				const r = await fetch("/api/chats", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						kind: "aside",
						aside: { chatId: parentChatId, quote: request.quote, messageId: request.messageId },
					}),
				});
				if (!r.ok) throw new Error(String(r.status));
				const created = (await r.json()) as { id: string };
				setQuestion(firstQuestion);
				setId(created.id);
			} catch {
				setFailed("The aside could not be created.");
			} finally {
				creating.current = false;
			}
		},
		[parentChatId, request.quote, request.messageId],
	);
	// `/btw <question>`: the question is already typed — create at once.
	useEffect(() => {
		if (!id && request.question) void create(request.question);
	}, [id, request.question, create]);

	return (
		<aside
			data-testid="aside-panel"
			className="flex h-full w-[26rem] max-w-[45vw] shrink-0 flex-col border-l border-border bg-background"
		>
			{failed ? (
				<>
					<AsideHeader parentTitle={parentTitle} onClose={onClose} />
					<div className="p-4 text-xs text-destructive">{failed}</div>
				</>
			) : id ? (
				<AsideLoader asideId={id} initialQuestion={question} parentTitle={parentTitle} onClose={onClose} />
			) : (
				<AsideDraft request={request} parentTitle={parentTitle} onAsk={create} onClose={onClose} />
			)}
		</aside>
	);
}

function AsideHeader({
	parentTitle,
	onClose,
	openId,
}: {
	parentTitle: string;
	onClose: () => void;
	/** Present once the aside is a record — the "open as its own session" lane. */
	openId?: string;
}) {
	const router = useRouter();
	return (
		<div className="flex items-center gap-2 border-b border-border px-3 py-2">
			<CornerDownRightIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
			<div className="min-w-0 flex-1">
				<div className="truncate text-xs font-medium">Aside</div>
				<div className="truncate text-[11px] text-muted-foreground" title={parentTitle}>
					{parentTitle}
				</div>
			</div>
			{openId && (
				<button
					type="button"
					title="Open as its own session"
					aria-label="Open aside as its own session"
					onClick={() => router.push(`/chat/${openId}`)}
					className="rounded p-1 text-muted-foreground hover:text-foreground"
				>
					<ExternalLinkIcon className="size-3.5" aria-hidden />
				</button>
			)}
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
	);
}

/** Esc closes the panel (the composer's own Esc only stops dictation). */
function useEscapeCloses(close: () => void) {
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape" && !e.defaultPrevented) close();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [close]);
}

/** The draft: the passage (if any) and a composer. No record exists yet. */
function AsideDraft({
	request,
	parentTitle,
	onAsk,
	onClose,
}: {
	request: AsideRequest;
	parentTitle: string;
	onAsk: (question: string) => void;
	onClose: () => void;
}) {
	const [text, setText] = useState("");
	const [sent, setSent] = useState(false);
	useEscapeCloses(onClose);
	const doSend = () => {
		const t = text.trim();
		if (!t || sent) return;
		setSent(true);
		onAsk(t);
	};
	return (
		<>
			<AsideHeader parentTitle={parentTitle} onClose={onClose} />
			<div className="flex-1 overflow-y-auto px-3 py-3">
				{request.quote && (
					<blockquote
						data-testid="aside-quote"
						className="mb-3 border-l-2 border-primary/50 pl-3 text-xs italic text-muted-foreground"
					>
						{request.quote}
					</blockquote>
				)}
				<div className="text-[11px] text-muted-foreground">
					{request.quote ? "Ask about this passage" : "Ask a side question"} — the aside sees the whole lesson so far;
					nothing is written back to it. Close without asking and nothing is kept.
				</div>
				{sent && <div className="mt-3 text-xs text-muted-foreground">Opening aside…</div>}
			</div>
			<div className="border-t border-border p-2">
				<Composer
					busy={sent}
					value={text}
					onChange={setText}
					onSend={doSend}
					onStop={() => {}}
					canSend={text.trim().length > 0 && !sent}
					autoFocus
					placeholder={request.quote ? "What about this passage?" : "Ask a side question…"}
				/>
			</div>
		</>
	);
}

function AsideLoader({
	asideId,
	initialQuestion,
	parentTitle,
	onClose,
}: {
	asideId: string;
	initialQuestion?: string;
	parentTitle: string;
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
	if (failed) {
		return (
			<>
				<AsideHeader parentTitle={parentTitle} onClose={onClose} />
				<div className="p-4 text-xs text-muted-foreground">This aside could not be loaded.</div>
			</>
		);
	}
	if (!record) {
		return (
			<>
				<AsideHeader parentTitle={parentTitle} onClose={onClose} />
				<div className="p-4 text-xs text-muted-foreground">Opening aside…</div>
			</>
		);
	}
	return <AsideSession key={record.id} record={record} initialQuestion={initialQuestion} onClose={onClose} />;
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
	const { messages, status, send, stop, error } = useChatSession({
		chatId: record.id,
		initialMessages: record.messages,
		initiallyInFlight: record.turnInFlight ?? false,
	});
	const busy = status === "submitted" || status === "streaming";
	const [text, setText] = useState("");
	const inputRef = useRef<HTMLTextAreaElement | null>(null);
	const scrollRef = useRef<HTMLDivElement | null>(null);

	// The first question: ONE send on mount, only when the aside is still
	// bare (reopening a persisted aside never resends).
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

	// Closing an aside that never got an answer deletes it (owner
	// 2026-10-25): the learner changed their mind — no session is kept.
	// The sidebar hears the server's chats-changed event.
	const messagesRef = useRef(messages);
	messagesRef.current = messages;
	const busyRef = useRef(busy);
	busyRef.current = busy;
	const close = useCallback(() => {
		if (!asideWorthKeeping(messagesRef.current, busyRef.current)) {
			void fetch(`/api/chats/${record.id}?mode=preserve-graph`, { method: "DELETE" }).catch(() => {});
		}
		onClose();
	}, [record.id, onClose]);
	useEscapeCloses(close);

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
			<AsideHeader parentTitle={parentTitle} onClose={close} openId={record.id} />
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
	let raw: string;
	if (error instanceof Error) raw = error.message;
	else if (typeof error === "string") raw = error;
	else {
		const o = (error ?? {}) as { error?: unknown; message?: unknown };
		raw = typeof o.error === "string" ? o.error : typeof o.message === "string" ? o.message : String(error);
	}
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
