import { appendLearnerPreference, listLearnerPreferences } from "@/src/server";
import { LEARNER_PREFERENCE_MAX_CHARS } from "@/src/core";

/** GET /api/preferences → { preferences } (the global list). */
export async function GET() {
	return Response.json({ preferences: listLearnerPreferences() });
}

/** POST /api/preferences { text, source? } → { preference, preferences }.
 *  Appends ONE confirmed rule (the 👎 dialog's Confirm; source defaults to
 *  "feedback"). Settings edits the whole list via PUT /api/settings/learnerPreferences. */
export async function POST(req: Request) {
	let body: unknown;
	try {
		body = await req.json();
	} catch {
		return Response.json({ error: "Invalid JSON body" }, { status: 400 });
	}
	const r = body !== null && typeof body === "object" ? (body as Record<string, unknown>) : null;
	if (!r || typeof r.text !== "string") return Response.json({ error: "text must be a string" }, { status: 400 });
	if (r.text.length > LEARNER_PREFERENCE_MAX_CHARS) {
		return Response.json({ error: `text must be at most ${LEARNER_PREFERENCE_MAX_CHARS} characters` }, { status: 400 });
	}
	const source = r.source === "manual" ? "manual" : "feedback";
	const preference = appendLearnerPreference(r.text, source);
	if (!preference) return Response.json({ error: "text must not be empty" }, { status: 400 });
	return Response.json({ preference, preferences: listLearnerPreferences() });
}
