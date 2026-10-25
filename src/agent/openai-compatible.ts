/**
 * The custom OpenAI-compatible provider (2026-10-24): ONE user-configured
 * endpoint registered in the pi-ai Models collection next to the builtins,
 * streaming through pi-ai's own `openai-completions` transport. Config
 * rides in process.env (the keys seam reflects the auth file there — the
 * agent layer may not import the store): OPENAI_COMPATIBLE_BASE_URL (the
 * presence gate), OPENAI_COMPATIBLE_API_KEY (optional — local servers
 * such as Ollama / LM Studio take none; the SDK still demands a token, so
 * a placeholder rides), OPENAI_COMPATIBLE_MODELS (manual ids).
 *
 * MODEL DISCOVERY: `scanOpenAICompatibleModels()` GETs `{baseUrl}/models`
 * and caches the normalised list per base URL; the provider's model list
 * is scanned ∪ manual (core/openai-compatible.ts mergeModelInfos). The
 * provider is REBUILT whenever its config signature changes
 * (`syncOpenAICompatibleProvider`, called from piModels()), so a save in
 * Settings → Keys takes effect without a restart, like every other key.
 */

import { createProvider, type Model, type MutableModels, type Provider } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import {
	OPENAI_COMPATIBLE_API_KEY_VAR,
	OPENAI_COMPATIBLE_BASE_URL_VAR,
	OPENAI_COMPATIBLE_LABEL,
	OPENAI_COMPATIBLE_MODELS_VAR,
	OPENAI_COMPATIBLE_PROVIDER_ID,
	mergeModelInfos,
	normalizeOpenAICompatibleBaseUrl,
	parseManualModelIds,
	parseModelsPayload,
	type OpenAICompatibleModelInfo,
} from "../core/openai-compatible.ts";
import type { OpenAICompatibleScanStatus } from "../core/contracts/models.ts";

/** Keyless local servers: the OpenAI SDK refuses an empty key, the server
 *  ignores whatever it gets. */
const PLACEHOLDER_KEY = "no-key";
const SCAN_TIMEOUT_MS = 15_000;

export interface OpenAICompatibleConfig {
	baseUrl: string;
	apiKey: string | undefined;
	manualIds: string[];
}

/** The live config, env-wins (process.env is the reflected store). NULL
 *  when no valid base URL is set — the provider is then absent. */
export function openAICompatibleConfig(env: Record<string, string | undefined> = process.env): OpenAICompatibleConfig | null {
	const raw = env[OPENAI_COMPATIBLE_BASE_URL_VAR];
	if (!raw) return null;
	const url = normalizeOpenAICompatibleBaseUrl(raw);
	if (!url.ok) return null;
	const key = env[OPENAI_COMPATIBLE_API_KEY_VAR]?.trim();
	return {
		baseUrl: url.value,
		apiKey: key ? key : undefined,
		manualIds: parseManualModelIds(env[OPENAI_COMPATIBLE_MODELS_VAR] ?? ""),
	};
}

interface ScanCache {
	baseUrl: string;
	models: OpenAICompatibleModelInfo[];
	status: OpenAICompatibleScanStatus;
}

// globalThis anchor: Next's dev HMR re-imports modules; the scan cache and
// the provider signature must survive that like the keys boot record does.
const anchor = globalThis as unknown as { __lhOpenAICompatible?: { scan?: ScanCache; signature?: string } };
function state() {
	return (anchor.__lhOpenAICompatible ??= {});
}

/** The last scan's outcome for the CURRENT base URL (a URL change
 *  invalidates the cache), or the "never scanned" status. */
export function openAICompatibleScanStatus(): OpenAICompatibleScanStatus {
	const cfg = openAICompatibleConfig();
	const scan = state().scan;
	if (!cfg) return { state: "unconfigured", baseUrl: null, count: 0, manualCount: 0, at: null, error: null };
	if (!scan || scan.baseUrl !== cfg.baseUrl) {
		return { state: "pending", baseUrl: cfg.baseUrl, count: 0, manualCount: cfg.manualIds.length, at: null, error: null };
	}
	return { ...scan.status, manualCount: cfg.manualIds.length };
}

/** Has the current base URL been scanned (ok or failed) in this process? */
export function openAICompatibleScanned(): boolean {
	const cfg = openAICompatibleConfig();
	return !!cfg && state().scan?.baseUrl === cfg.baseUrl;
}

function toModel(info: OpenAICompatibleModelInfo, baseUrl: string): Model<"openai-completions"> {
	return {
		id: info.id,
		name: info.name,
		api: "openai-completions",
		provider: OPENAI_COMPATIBLE_PROVIDER_ID,
		baseUrl,
		reasoning: info.reasoning,
		input: [...info.input],
		cost: { ...info.cost },
		contextWindow: info.contextWindow,
		maxTokens: info.maxTokens,
	};
}

/** Scanned ∪ manual for the current config (empty when unconfigured). */
export function openAICompatibleModelInfos(): OpenAICompatibleModelInfo[] {
	const cfg = openAICompatibleConfig();
	if (!cfg) return [];
	const scan = state().scan;
	const scanned = scan && scan.baseUrl === cfg.baseUrl ? scan.models : [];
	return mergeModelInfos(scanned, cfg.manualIds);
}

function signatureFor(cfg: OpenAICompatibleConfig | null): string {
	if (!cfg) return "";
	const scan = state().scan;
	const scanIds = scan && scan.baseUrl === cfg.baseUrl ? scan.models.map((m) => m.id).join(",") : "";
	return [cfg.baseUrl, cfg.apiKey ? "k" : "", cfg.manualIds.join(","), scanIds].join("\u0000");
}

function buildProvider(cfg: OpenAICompatibleConfig): Provider<"openai-completions"> {
	return createProvider<"openai-completions">({
		id: OPENAI_COMPATIBLE_PROVIDER_ID,
		name: OPENAI_COMPATIBLE_LABEL,
		baseUrl: cfg.baseUrl,
		auth: {
			apiKey: {
				name: `${OPENAI_COMPATIBLE_LABEL} API key`,
				// Env-wins per request, like envApiKeyAuth: the base URL and key
				// are re-read so a settings save lands on the very next turn.
				resolve: async ({ ctx, signal }) => {
					signal.throwIfAborted();
					const base = (await ctx.env(OPENAI_COMPATIBLE_BASE_URL_VAR)) ?? cfg.baseUrl;
					const url = normalizeOpenAICompatibleBaseUrl(base);
					const key = (await ctx.env(OPENAI_COMPATIBLE_API_KEY_VAR))?.trim();
					return {
						auth: { apiKey: key || PLACEHOLDER_KEY, baseUrl: url.ok ? url.value : cfg.baseUrl },
						source: key ? OPENAI_COMPATIBLE_API_KEY_VAR : "no key (local endpoint)",
					};
				},
			},
		},
		models: openAICompatibleModelInfos().map((m) => toModel(m, cfg.baseUrl)),
		api: openAICompletionsApi(),
	});
}

/** Register / replace / remove the provider in `models` to match the live
 *  config + scan cache. Cheap when nothing changed (signature compare). */
export function syncOpenAICompatibleProvider(models: MutableModels): void {
	const cfg = openAICompatibleConfig();
	const signature = signatureFor(cfg);
	const st = state();
	const registered = models.getProviders().some((p) => p.id === OPENAI_COMPATIBLE_PROVIDER_ID);
	if (st.signature === signature && registered === !!cfg) return;
	st.signature = signature;
	if (!cfg) {
		if (registered) models.deleteProvider(OPENAI_COMPATIBLE_PROVIDER_ID);
		return;
	}
	models.setProvider(buildProvider(cfg));
}

export interface ScanOptions {
	fetch?: typeof globalThis.fetch;
	signal?: AbortSignal;
}

/**
 * GET {baseUrl}/models, normalise, cache. Never throws: a failure is
 * recorded as the status the UI shows ("scan failed: …"), and the manual
 * ids keep the provider usable. The key never leaves this process except
 * as the Authorization header to the user's own endpoint.
 */
export async function scanOpenAICompatibleModels(options: ScanOptions = {}): Promise<OpenAICompatibleScanStatus> {
	const cfg = openAICompatibleConfig();
	if (!cfg) return openAICompatibleScanStatus();
	const doFetch = options.fetch ?? globalThis.fetch;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(new Error(`timed out after ${SCAN_TIMEOUT_MS / 1000}s`)), SCAN_TIMEOUT_MS);
	options.signal?.addEventListener("abort", () => controller.abort(options.signal?.reason), { once: true });
	const at = new Date().toISOString();
	let models: OpenAICompatibleModelInfo[] = [];
	let error: string | null = null;
	try {
		const headers: Record<string, string> = { accept: "application/json" };
		if (cfg.apiKey) headers.authorization = `Bearer ${cfg.apiKey}`;
		const res = await doFetch(`${cfg.baseUrl}/models`, { method: "GET", headers, signal: controller.signal });
		if (!res.ok) {
			error = `HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""} from ${cfg.baseUrl}/models`;
		} else {
			const body: unknown = await res.json();
			models = parseModelsPayload(body);
			if (models.length === 0) error = `${cfg.baseUrl}/models listed no models`;
		}
	} catch (err) {
		const reason = err instanceof Error ? (err.cause instanceof Error ? `${err.message}: ${err.cause.message}` : err.message) : String(err);
		error = `could not reach ${cfg.baseUrl}/models — ${reason}`;
	} finally {
		clearTimeout(timer);
	}
	const status: OpenAICompatibleScanStatus = {
		state: error ? "failed" : "ok",
		baseUrl: cfg.baseUrl,
		count: models.length,
		manualCount: cfg.manualIds.length,
		at,
		error,
	};
	state().scan = { baseUrl: cfg.baseUrl, models, status };
	return openAICompatibleScanStatus();
}

/** Tests: drop the cached scan + signature. */
export function resetOpenAICompatibleState(): void {
	delete anchor.__lhOpenAICompatible;
}
