/**
 * The OpenAI-compatible custom provider's PURE half (browser-safe, no fs,
 * no env): the var names the keys store holds for it, the validation of
 * those vars, and the normaliser that turns a `GET {baseUrl}/models`
 * payload (OpenAI's `{data: [{id}]}` shape — Ollama, LM Studio, vLLM,
 * LiteLLM, OpenRouter and most gateways speak it, with their own optional
 * metadata) into model descriptors the agent layer lifts into pi-ai models.
 *
 * One provider, user-configured: a base URL (required) + an API key
 * (optional — local servers take none). Model ids come from the live scan,
 * and from a manual list for endpoints that do not implement /models or
 * omit a model the user knows is there.
 */

export const OPENAI_COMPATIBLE_PROVIDER_ID = "openai-compatible";
export const OPENAI_COMPATIBLE_LABEL = "OpenAI-compatible";

/** The three vars the keys store holds for this provider. */
export const OPENAI_COMPATIBLE_BASE_URL_VAR = "OPENAI_COMPATIBLE_BASE_URL";
export const OPENAI_COMPATIBLE_API_KEY_VAR = "OPENAI_COMPATIBLE_API_KEY";
export const OPENAI_COMPATIBLE_MODELS_VAR = "OPENAI_COMPATIBLE_MODELS";

/** Vars that are NOT secrets — the status view shows them in the clear. */
export const OPENAI_COMPATIBLE_PLAIN_VARS: ReadonlySet<string> = new Set([
	OPENAI_COMPATIBLE_BASE_URL_VAR,
	OPENAI_COMPATIBLE_MODELS_VAR,
]);

export const OPENAI_COMPATIBLE_VARS: readonly string[] = [
	OPENAI_COMPATIBLE_BASE_URL_VAR,
	OPENAI_COMPATIBLE_API_KEY_VAR,
	OPENAI_COMPATIBLE_MODELS_VAR,
];

/** Defaults for metadata a /models payload does not carry. */
export const OPENAI_COMPATIBLE_DEFAULT_CONTEXT_WINDOW = 128_000;
export const OPENAI_COMPATIBLE_DEFAULT_MAX_TOKENS = 8_192;

/** `https://host/v1` — trailing slash dropped; http(s) only. */
export function normalizeOpenAICompatibleBaseUrl(raw: string): { ok: true; value: string } | { ok: false; error: string } {
	const value = raw.trim().replace(/\/+$/, "");
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return { ok: false, error: `${OPENAI_COMPATIBLE_BASE_URL_VAR} must be a full URL, e.g. https://api.example.com/v1` };
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		return { ok: false, error: `${OPENAI_COMPATIBLE_BASE_URL_VAR} must start with http:// or https://` };
	}
	return { ok: true, value };
}

/** Comma/whitespace/newline-separated ids → deduped list (order kept). */
export function parseManualModelIds(raw: string): string[] {
	const out: string[] = [];
	for (const part of raw.split(/[\s,]+/)) {
		const id = part.trim();
		if (id && !out.includes(id)) out.push(id);
	}
	return out;
}

/** What one scanned (or manual) model is known to be. */
export interface OpenAICompatibleModelInfo {
	id: string;
	name: string;
	reasoning: boolean;
	input: ("text" | "image")[];
	contextWindow: number;
	maxTokens: number;
	/** USD per 1M tokens; 0 when the endpoint publishes no pricing. */
	cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
}

/** The minimal descriptor for an id nothing else is known about. */
export function manualModelInfo(id: string): OpenAICompatibleModelInfo {
	return {
		id,
		name: id,
		reasoning: false,
		input: ["text", "image"],
		contextWindow: OPENAI_COMPATIBLE_DEFAULT_CONTEXT_WINDOW,
		maxTokens: OPENAI_COMPATIBLE_DEFAULT_MAX_TOKENS,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	};
}

function num(v: unknown): number | undefined {
	if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
	if (typeof v === "string" && v.trim() !== "") {
		const n = Number(v);
		if (Number.isFinite(n) && n > 0) return n;
	}
	return undefined;
}

/**
 * Normalise a `/models` response body. Accepts `{data: [...]}` (OpenAI),
 * `{models: [...]}` and a bare array. Reads the optional metadata the
 * common gateways attach (OpenRouter's context_length / pricing /
 * architecture.input_modalities / supported_parameters, vLLM's
 * max_model_len, LiteLLM's max_input_tokens). Unknown fields default.
 * Entries without a string id are dropped; duplicates keep the first.
 */
export function parseModelsPayload(body: unknown): OpenAICompatibleModelInfo[] {
	const list: unknown = Array.isArray(body)
		? body
		: body && typeof body === "object" && Array.isArray((body as { data?: unknown }).data)
			? (body as { data: unknown[] }).data
			: body && typeof body === "object" && Array.isArray((body as { models?: unknown }).models)
				? (body as { models: unknown[] }).models
				: [];
	const out: OpenAICompatibleModelInfo[] = [];
	const seen = new Set<string>();
	for (const entry of list as unknown[]) {
		if (!entry || typeof entry !== "object") continue;
		const e = entry as Record<string, unknown>;
		const id = typeof e.id === "string" ? e.id.trim() : typeof e.name === "string" && !e.id ? e.name.trim() : "";
		if (!id || seen.has(id)) continue;
		seen.add(id);
		const base = manualModelInfo(id);
		const name = typeof e.name === "string" && e.name.trim() ? e.name.trim() : id;
		const top = e.top_provider && typeof e.top_provider === "object" ? (e.top_provider as Record<string, unknown>) : undefined;
		const contextWindow =
			num(e.context_length) ?? num(e.context_window) ?? num(e.max_model_len) ?? num(e.max_input_tokens) ?? num(top?.context_length) ?? base.contextWindow;
		const maxTokens = num(top?.max_completion_tokens) ?? num(e.max_output_tokens) ?? num(e.max_completion_tokens) ?? num(e.max_tokens) ?? base.maxTokens;
		const arch = e.architecture && typeof e.architecture === "object" ? (e.architecture as Record<string, unknown>) : undefined;
		const modalities = Array.isArray(arch?.input_modalities) ? (arch!.input_modalities as unknown[]) : undefined;
		const input: ("text" | "image")[] = modalities ? (modalities.includes("image") ? ["text", "image"] : ["text"]) : base.input;
		const supported = Array.isArray(e.supported_parameters) ? (e.supported_parameters as unknown[]) : [];
		const reasoning = supported.includes("reasoning") || supported.includes("include_reasoning") || e.reasoning === true;
		const pricing = e.pricing && typeof e.pricing === "object" ? (e.pricing as Record<string, unknown>) : undefined;
		const perToken = (v: unknown) => {
			const n = num(v);
			return n === undefined ? 0 : n * 1_000_000;
		};
		out.push({
			id,
			name,
			reasoning,
			input,
			contextWindow: Math.floor(contextWindow),
			maxTokens: Math.floor(maxTokens),
			cost: pricing
				? { input: perToken(pricing.prompt), output: perToken(pricing.completion), cacheRead: perToken(pricing.input_cache_read), cacheWrite: perToken(pricing.input_cache_write) }
				: base.cost,
		});
	}
	return out;
}

/** Scanned ∪ manual, scanned metadata winning on shared ids; manual ids
 *  the scan missed append in list order. */
export function mergeModelInfos(scanned: readonly OpenAICompatibleModelInfo[], manualIds: readonly string[]): OpenAICompatibleModelInfo[] {
	const out = [...scanned];
	for (const id of manualIds) {
		if (!out.some((m) => m.id === id)) out.push(manualModelInfo(id));
	}
	return out;
}
