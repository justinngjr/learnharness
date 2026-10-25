/**
 * The custom OpenAI-compatible provider (2026-10-24): base URL + optional
 * key + manual model ids, with `GET {baseUrl}/models` discovery. Pins:
 *  - the pure /models normaliser (OpenAI / OpenRouter / bare-array shapes,
 *    dedupe, metadata defaults);
 *  - the manual id parser and the scanned ∪ manual merge;
 *  - the base URL shape gate on the keys write path and plain (unmasked)
 *    status rows for the non-secret vars;
 *  - presence = base URL (no key needed), the provider in the catalog with
 *    its scanned + manual models, gone when the base URL is deleted;
 *  - a failed scan is a status, not a throw, and manual ids keep working.
 * LH_AUTH_FILE redirects BEFORE the imports (module-load bound).
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, afterEach, describe, it } from "node:test";

for (const name of Object.keys(process.env)) {
	if (name.startsWith("OPENAI_COMPATIBLE_")) delete process.env[name];
}
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "lh-openai-compatible-"));
process.env.LH_AUTH_FILE = path.join(TMP, "auth.json");
process.env.LH_SETTINGS_FILE = path.join(TMP, "settings.json");
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

const {
	OPENAI_COMPATIBLE_API_KEY_VAR,
	OPENAI_COMPATIBLE_BASE_URL_VAR,
	OPENAI_COMPATIBLE_MODELS_VAR,
	OPENAI_COMPATIBLE_PROVIDER_ID,
	ALL_PROVIDER_KEYS,
	AUTH_PROVIDER_KEYS,
	genericProviderKeyGuard,
	mergeModelInfos,
	normalizeOpenAICompatibleBaseUrl,
	parseManualModelIds,
	parseModelsPayload,
	providerLabel,
} = await import("../src/core/index.ts");
const { deleteKey, keyStatuses, providerKeyList, providerKeyPresent, saveKey } = await import("../src/server/keys.ts");
const { catalogProviders, modelCatalog, validateModelsSettings } = await import("../src/server/model-catalog.ts");
const { piModels, piEngineForSpec } = await import("../src/agent/models.ts");
const { openAICompatibleConfig, openAICompatibleScanStatus, resetOpenAICompatibleState, scanOpenAICompatibleModels } = await import("../src/agent/openai-compatible.ts");

const BASE = "https://gateway.example/v1";

function fakeFetch(body: unknown, status = 200): typeof fetch {
	return (async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })) as typeof fetch;
}

function clear() {
	for (const id of [OPENAI_COMPATIBLE_BASE_URL_VAR, OPENAI_COMPATIBLE_API_KEY_VAR, OPENAI_COMPATIBLE_MODELS_VAR]) deleteKey(id);
	resetOpenAICompatibleState();
}

describe("core/openai-compatible — pure", () => {
	it("normalises base URLs: trims, drops trailing slashes, http(s) only", () => {
		assert.deepEqual(normalizeOpenAICompatibleBaseUrl(" https://h/v1// "), { ok: true, value: "https://h/v1" });
		assert.equal(normalizeOpenAICompatibleBaseUrl("h/v1").ok, false);
		assert.equal(normalizeOpenAICompatibleBaseUrl("ftp://h/v1").ok, false);
		assert.equal(normalizeOpenAICompatibleBaseUrl("http://localhost:11434/v1").ok, true);
	});

	it("parses manual ids: commas / whitespace / newlines, deduped, ordered", () => {
		assert.deepEqual(parseManualModelIds(" a, b\nc  a ,, "), ["a", "b", "c"]);
		assert.deepEqual(parseManualModelIds(""), []);
	});

	it("normalises an OpenAI-shaped /models payload with defaults", () => {
		const out = parseModelsPayload({ object: "list", data: [{ id: "x-test-2", object: "model" }, { id: "x-test-2" }, { nope: 1 }] });
		assert.equal(out.length, 1);
		assert.equal(out[0]!.id, "x-test-2");
		assert.equal(out[0]!.name, "x-test-2");
		assert.equal(out[0]!.reasoning, false);
		assert.deepEqual(out[0]!.input, ["text", "image"]);
		assert.equal(out[0]!.contextWindow, 128_000);
		assert.equal(out[0]!.cost.input, 0);
	});

	it("reads OpenRouter-style metadata and accepts bare arrays / {models}", () => {
		const [m] = parseModelsPayload([
			{
				id: "r1",
				name: "R One",
				context_length: 32000,
				top_provider: { max_completion_tokens: 4096 },
				architecture: { input_modalities: ["text"] },
				supported_parameters: ["reasoning"],
				pricing: { prompt: "0.000001", completion: "0.000002" },
			},
		]);
		assert.equal(m!.name, "R One");
		assert.equal(m!.contextWindow, 32000);
		assert.equal(m!.maxTokens, 4096);
		assert.deepEqual(m!.input, ["text"]);
		assert.equal(m!.reasoning, true);
		assert.ok(Math.abs(m!.cost.input - 1) < 1e-9 && Math.abs(m!.cost.output - 2) < 1e-9);
		assert.equal(parseModelsPayload({ models: [{ name: "llama3" }] })[0]!.id, "llama3");
		assert.deepEqual(parseModelsPayload("garbage"), []);
	});

	it("merges scanned ∪ manual — scanned metadata wins, manual appends", () => {
		const scanned = parseModelsPayload({ data: [{ id: "a", context_length: 1000 }] });
		const out = mergeModelInfos(scanned, ["b", "a"]);
		assert.deepEqual(out.map((m) => m.id), ["a", "b"]);
		assert.equal(out[0]!.contextWindow, 1000);
	});

	it("is in the roster but NOT in the pi-ai-pinned table", () => {
		assert.ok(ALL_PROVIDER_KEYS.some((p) => p.id === OPENAI_COMPATIBLE_PROVIDER_ID));
		assert.ok(!AUTH_PROVIDER_KEYS.some((p) => p.id === OPENAI_COMPATIBLE_PROVIDER_ID));
		assert.equal(providerLabel(OPENAI_COMPATIBLE_PROVIDER_ID), "OpenAI-compatible");
	});

	it("shape-gates the three vars", () => {
		assert.equal(genericProviderKeyGuard(OPENAI_COMPATIBLE_BASE_URL_VAR, "not a url").ok, false);
		assert.equal(genericProviderKeyGuard(OPENAI_COMPATIBLE_BASE_URL_VAR, BASE).ok, true);
		assert.equal(genericProviderKeyGuard(OPENAI_COMPATIBLE_MODELS_VAR, " , ").ok, false);
		assert.equal(genericProviderKeyGuard(OPENAI_COMPATIBLE_MODELS_VAR, "a,b").ok, true);
		assert.equal(genericProviderKeyGuard(OPENAI_COMPATIBLE_API_KEY_VAR, "has space").ok, false);
		assert.equal(genericProviderKeyGuard(OPENAI_COMPATIBLE_API_KEY_VAR, "sk-anything").ok, true);
	});
});

describe("server + agent — the provider follows the keys", () => {
	afterEach(clear);

	it("is listed in the Add-provider roster, absent from the catalog until a base URL lands", () => {
		assert.ok(providerKeyList().some((p) => p.id === OPENAI_COMPATIBLE_PROVIDER_ID));
		assert.equal(openAICompatibleConfig(), null);
		assert.equal(openAICompatibleScanStatus().state, "unconfigured");
		assert.ok(!piModels().getProviders().some((p) => p.id === OPENAI_COMPATIBLE_PROVIDER_ID));
		assert.equal(catalogProviders().find((p) => p.id === OPENAI_COMPATIBLE_PROVIDER_ID)?.keyPresent, false);
		assert.equal(providerKeyPresent(OPENAI_COMPATIBLE_PROVIDER_ID), false);
	});

	it("rejects a bad base URL; a good one (no key) makes the provider present with manual models", () => {
		const bad = saveKey(OPENAI_COMPATIBLE_BASE_URL_VAR, "nope");
		assert.equal(bad.ok, false);
		assert.ok(saveKey(OPENAI_COMPATIBLE_BASE_URL_VAR, `${BASE}/`).ok);
		assert.ok(saveKey(OPENAI_COMPATIBLE_MODELS_VAR, "manual-a, manual-b").ok);
		assert.equal(providerKeyPresent(OPENAI_COMPATIBLE_PROVIDER_ID), true);
		assert.deepEqual(openAICompatibleConfig(), { baseUrl: BASE, apiKey: undefined, manualIds: ["manual-a", "manual-b"] });
		// Plain vars show in the clear; no "(N chars)" suffix.
		const row = keyStatuses().find((s) => s.id === OPENAI_COMPATIBLE_BASE_URL_VAR)!;
		assert.equal(row.masked, BASE);
		assert.equal(openAICompatibleScanStatus().state, "pending");
		const mine = modelCatalog().models.filter((m) => m.provider === OPENAI_COMPATIBLE_PROVIDER_ID);
		assert.deepEqual(mine.map((m) => m.id), ["manual-a", "manual-b"]);
		assert.deepEqual(mine[0]!.supportedLevels, ["off"]);
		// The engine resolves it like any catalog model.
		const engine = piEngineForSpec({ provider: OPENAI_COMPATIBLE_PROVIDER_ID, id: "manual-a" });
		assert.equal(engine.model.baseUrl, BASE);
		assert.equal(engine.model.api, "openai-completions");
		assert.equal(validateModelsSettings({ strong: { model: { provider: OPENAI_COMPATIBLE_PROVIDER_ID, id: "manual-a" } } }).ok, true);
		assert.equal(validateModelsSettings({ strong: { model: { provider: OPENAI_COMPATIBLE_PROVIDER_ID, id: "ghost" } } }).ok, false);
	});

	it("scans /models with the key as Bearer and publishes scanned ∪ manual", async () => {
		saveKey(OPENAI_COMPATIBLE_BASE_URL_VAR, BASE);
		saveKey(OPENAI_COMPATIBLE_API_KEY_VAR, "sk-test-123");
		saveKey(OPENAI_COMPATIBLE_MODELS_VAR, "manual-only, scanned-b");
		let seen: { url: string; auth: string | undefined } | undefined;
		const fetchSpy: typeof fetch = async (input, init) => {
			seen = { url: String(input), auth: (init?.headers as Record<string, string>)?.authorization };
			return new Response(JSON.stringify({ data: [{ id: "scanned-a" }, { id: "scanned-b", context_length: 4000 }] }), { status: 200 });
		};
		const status = await scanOpenAICompatibleModels({ fetch: fetchSpy });
		assert.deepEqual(seen, { url: `${BASE}/models`, auth: "Bearer sk-test-123" });
		assert.equal(status.state, "ok");
		assert.equal(status.count, 2);
		assert.equal(status.manualCount, 2);
		const mine = modelCatalog().models.filter((m) => m.provider === OPENAI_COMPATIBLE_PROVIDER_ID);
		assert.deepEqual(mine.map((m) => m.id), ["manual-only", "scanned-a", "scanned-b"]);
		assert.equal(mine.find((m) => m.id === "scanned-b")!.contextWindow, 4000);
		// Secret stays masked.
		assert.match(keyStatuses().find((s) => s.id === OPENAI_COMPATIBLE_API_KEY_VAR)!.masked!, /chars\)$/);
		assert.ok(!keyStatuses().find((s) => s.id === OPENAI_COMPATIBLE_API_KEY_VAR)!.masked!.includes("sk-test-123"));
	});

	it("a failed scan is a status, manual ids still serve; a URL change invalidates the scan", async () => {
		saveKey(OPENAI_COMPATIBLE_BASE_URL_VAR, BASE);
		saveKey(OPENAI_COMPATIBLE_MODELS_VAR, "fallback");
		const failed = await scanOpenAICompatibleModels({ fetch: fakeFetch({ error: "nope" }, 404) });
		assert.equal(failed.state, "failed");
		assert.match(failed.error!, /HTTP 404/);
		const thrown = await scanOpenAICompatibleModels({
			fetch: (async () => {
				throw new Error("ECONNREFUSED");
			}) as typeof fetch,
		});
		assert.match(thrown.error!, /could not reach .*ECONNREFUSED/);
		assert.deepEqual(modelCatalog().models.filter((m) => m.provider === OPENAI_COMPATIBLE_PROVIDER_ID).map((m) => m.id), ["fallback"]);
		const ok = await scanOpenAICompatibleModels({ fetch: fakeFetch({ data: [{ id: "live" }] }) });
		assert.equal(ok.state, "ok");
		saveKey(OPENAI_COMPATIBLE_BASE_URL_VAR, "https://other.example/v1");
		assert.equal(openAICompatibleScanStatus().state, "pending");
		assert.deepEqual(modelCatalog().models.filter((m) => m.provider === OPENAI_COMPATIBLE_PROVIDER_ID).map((m) => m.id), ["fallback"]);
	});

	it("deleting the base URL removes the provider from the catalog", async () => {
		saveKey(OPENAI_COMPATIBLE_BASE_URL_VAR, BASE);
		await scanOpenAICompatibleModels({ fetch: fakeFetch({ data: [{ id: "m" }] }) });
		assert.ok(piModels().getProviders().some((p) => p.id === OPENAI_COMPATIBLE_PROVIDER_ID));
		deleteKey(OPENAI_COMPATIBLE_BASE_URL_VAR);
		assert.ok(!piModels().getProviders().some((p) => p.id === OPENAI_COMPATIBLE_PROVIDER_ID));
		assert.equal(modelCatalog().models.filter((m) => m.provider === OPENAI_COMPATIBLE_PROVIDER_ID).length, 0);
	});
});
