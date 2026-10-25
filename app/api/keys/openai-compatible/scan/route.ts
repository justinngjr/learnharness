/**
 * POST /api/keys/openai-compatible/scan — re-scan the custom
 * OpenAI-compatible endpoint's `GET {baseUrl}/models` (2026-10-24) and
 * report what it found. The keys page fires it after a base URL / key
 * save and on its "Rescan" button; GET /api/models also scans lazily once
 * per base URL. Never 5xx on an unreachable endpoint — the failure is the
 * status payload (the manual model list keeps the provider usable).
 * 409 when no base URL is set.
 */
import { openAICompatibleConfig, scanOpenAICompatibleModels } from "@/src/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
	if (!openAICompatibleConfig()) {
		return Response.json({ error: "OPENAI_COMPATIBLE_BASE_URL is not set" }, { status: 409 });
	}
	const status = await scanOpenAICompatibleModels({ signal: req.signal });
	return Response.json(status, { headers: { "Cache-Control": "no-store" } });
}
