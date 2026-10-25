/**
 * TeX → readable Unicode (owner request 2026-10-25: copying math out of a
 * lesson pastes as notes, not KaTeX's doubled layers). Pins the converter
 * and the DOM walker the copy handler runs.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import katex from "katex";
import { parseHTML } from "linkedom";
import { texToPlain } from "../src/core/math-plain.ts";
import { hasMath, plainTextWithMath } from "../components/math-copy.tsx";

describe("texToPlain", () => {
	const cases: [string, string][] = [
		["\\frac{a}{b} \\le \\epsilon", "a/b ≤ ε"],
		["x^2 + y_1", "x² + y₁"],
		["x^{n+1}", "xⁿ⁺¹"],
		["e^{i\\pi} = -1", "e^(iπ) = −1"],
		["\\forall x \\in \\mathbb{R}", "∀ x ∈ ℝ"],
		["R=\\{(1,a),\\,(3,b)\\}", "R={(1,a), (3,b)}"],
		["\\sqrt{x+1}", "√(x+1)"],
		["\\sqrt[3]{8}", "∛8"],
		["0 < |x - a| < \\delta", "0 < |x − a| < δ"],
		["\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1", "lim_(x → 0) (sin x)/x = 1"],
		["A \\subseteq B \\cup C", "A ⊆ B ∪ C"],
		["\\text{for all } n \\geq 1", "for all n ≥ 1"],
		["\\left( \\frac{1}{2} \\right)", "(1/2)"],
		["a \\cdot b \\times c", "a · b × c"],
		["f\\colon A \\to B", "f: A → B"],
		["\\sum_{i=1}^{n} i", "∑ᵢ₌₁ⁿ i"],
		["\\ldots", "…"],
	];
	for (const [tex, plain] of cases) {
		it(`${tex} → ${plain}`, () => {
			assert.equal(texToPlain(tex), plain);
		});
	}
	it("unknown commands keep their name — nothing is lost, only de-TeXed", () => {
		assert.equal(texToPlain("\\foo{x}"), "foox");
	});
});

describe("plainTextWithMath (the copy handler's walker)", () => {
	it("replaces KaTeX's doubled layers with the converted annotation; display math gets its own line", () => {
		const inline = katex.renderToString("\\frac{a}{b} \\le \\epsilon", { throwOnError: false });
		const display = katex.renderToString("x^2 + y_1", { throwOnError: false, displayMode: true });
		const { document } = parseHTML(`<html><body><div id="r"><p>Let ${inline} hold.</p>${display}<p>Then done.</p></div></body></html>`);
		const root = document.getElementById("r")!;
		assert.ok(hasMath(root));
		assert.equal(plainTextWithMath(root), "Let a/b ≤ ε hold.\nx² + y₁\nThen done.");
	});
	it("no math → reported so the browser keeps its own copy", () => {
		const { document } = parseHTML(`<html><body><div id="r"><p>plain prose</p></div></body></html>`);
		assert.equal(hasMath(document.getElementById("r")!), false);
	});
});
