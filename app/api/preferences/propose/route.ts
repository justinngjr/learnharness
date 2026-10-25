import { ModelsNotConfiguredError } from "@/src/core";
import { ProposalTargetError, proposeLearnerPreference } from "@/src/server";

/** POST /api/preferences/propose { chatId, messageId } → { proposal }.
 *  The 👎 side call: asks the chat's model for one general rule. Nothing
 *  is persisted here — the learner confirms via POST /api/preferences. */
export async function POST(req: Request) {
	let body: unknown;
	try {
		body = await req.json();
	} catch {
		return Response.json({ error: "Invalid JSON body" }, { status: 400 });
	}
	const r = body !== null && typeof body === "object" ? (body as Record<string, unknown>) : null;
	if (!r || typeof r.chatId !== "string" || typeof r.messageId !== "string") {
		return Response.json({ error: "chatId and messageId must be strings" }, { status: 400 });
	}
	try {
		const { proposal } = await proposeLearnerPreference(r.chatId, r.messageId);
		return Response.json({ proposal });
	} catch (err) {
		if (err instanceof ProposalTargetError) return Response.json({ error: err.message }, { status: 404 });
		if (err instanceof ModelsNotConfiguredError) return Response.json(err.envelope, { status: 503 });
		const message = err instanceof Error ? err.message : String(err);
		console.error(`[preferences] proposal failed — ${message}`);
		return Response.json({ error: message }, { status: 502 });
	}
}
