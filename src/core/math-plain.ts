/**
 * TeX → readable plain text (owner request 2026-10-25): copying rendered
 * math out of a lesson should paste as notes-friendly Unicode — `a/b ≤ ε`,
 * `x² + y₁`, `∀x ∈ ℝ` — not KaTeX's doubled MathML+HTML text and not TeX
 * source. KaTeX keeps the source in <annotation encoding="application/x-tex">;
 * this is the pure converter the copy handler (components/math-copy.tsx)
 * runs on it. Best effort by design: anything unknown keeps its name without
 * the backslash, so nothing is ever lost — only de-TeXed.
 */

const SYMBOLS: Record<string, string> = {
	// Greek
	alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε", zeta: "ζ", eta: "η", theta: "θ", vartheta: "ϑ",
	iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π", rho: "ρ", sigma: "σ", tau: "τ", upsilon: "υ",
	phi: "φ", varphi: "φ", chi: "χ", psi: "ψ", omega: "ω",
	Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π", Sigma: "Σ", Upsilon: "Υ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
	// relations
	le: "≤", leq: "≤", leqslant: "≤", ge: "≥", geq: "≥", geqslant: "≥", ne: "≠", neq: "≠", approx: "≈", equiv: "≡", sim: "∼", simeq: "≃",
	cong: "≅", propto: "∝", ll: "≪", gg: "≫", prec: "≺", succ: "≻",
	// arrows
	to: "→", rightarrow: "→", Rightarrow: "⇒", implies: "⇒", leftarrow: "←", Leftarrow: "⇐", leftrightarrow: "↔", Leftrightarrow: "⇔", iff: "⇔",
	mapsto: "↦", longrightarrow: "⟶", uparrow: "↑", downarrow: "↓",
	// sets & logic
	in: "∈", notin: "∉", ni: "∋", subset: "⊂", subseteq: "⊆", supset: "⊃", supseteq: "⊇", subsetneq: "⊊", cup: "∪", cap: "∩", setminus: "∖",
	emptyset: "∅", varnothing: "∅", forall: "∀", exists: "∃", nexists: "∄", neg: "¬", lnot: "¬", land: "∧", wedge: "∧", lor: "∨", vee: "∨",
	top: "⊤", bot: "⊥", vdash: "⊢", models: "⊨", therefore: "∴", because: "∵",
	// operators
	times: "×", cdot: "·", div: "÷", pm: "±", mp: "∓", ast: "∗", star: "⋆", circ: "∘", bullet: "•", oplus: "⊕", otimes: "⊗",
	sum: "∑", prod: "∏", coprod: "∐", int: "∫", iint: "∬", oint: "∮", partial: "∂", nabla: "∇", infty: "∞", sqrt: "√",
	// dots & misc
	ldots: "…", cdots: "⋯", dots: "…", vdots: "⋮", ddots: "⋱", prime: "′", angle: "∠", degree: "°", hbar: "ℏ", ell: "ℓ", aleph: "ℵ",
	langle: "⟨", rangle: "⟩", lfloor: "⌊", rfloor: "⌋", lceil: "⌈", rceil: "⌉", lvert: "|", rvert: "|", vert: "|", Vert: "‖", lVert: "‖", rVert: "‖",
	mid: "|", parallel: "∥", perp: "⊥", backslash: "\\", colon: ": ", quad: " ", qquad: "  ",
	// text-ish
	min: "min", max: "max", sup: "sup", inf: "inf", lim: "lim", log: "log", ln: "ln", exp: "exp", sin: "sin", cos: "cos", tan: "tan",
	det: "det", dim: "dim", ker: "ker", gcd: "gcd", deg: "deg", arg: "arg", mod: " mod ", bmod: " mod ", pmod: " mod ",
	Re: "Re", Im: "Im",
};

/** Relations and binary operators read with a space each side. */
const PADDED = new Set([
	"le", "leq", "leqslant", "ge", "geq", "geqslant", "ne", "neq", "approx", "equiv", "sim", "simeq", "cong", "propto", "ll", "gg", "prec", "succ",
	"to", "rightarrow", "Rightarrow", "implies", "leftarrow", "Leftarrow", "leftrightarrow", "Leftrightarrow", "iff", "mapsto", "longrightarrow",
	"in", "notin", "ni", "subset", "subseteq", "supset", "supseteq", "subsetneq", "cup", "cap", "setminus", "land", "wedge", "lor", "vee", "vdash", "models",
	"times", "cdot", "div", "pm", "mp", "circ", "oplus", "otimes", "mid", "parallel", "perp",
]);

const BLACKBOARD: Record<string, string> = { R: "ℝ", N: "ℕ", Z: "ℤ", Q: "ℚ", C: "ℂ", P: "ℙ", H: "ℍ", E: "𝔼" };

const SUPERSCRIPT: Record<string, string> = {
	"0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
	"+": "⁺", "-": "⁻", "−": "⁻", "=": "⁼", "(": "⁽", ")": "⁾", n: "ⁿ", i: "ⁱ", T: "ᵀ",
};
const SUBSCRIPT: Record<string, string> = {
	"0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
	"+": "₊", "-": "₋", "−": "₋", "=": "₌", "(": "₍", ")": "₎", a: "ₐ", e: "ₑ", i: "ᵢ", j: "ⱼ", k: "ₖ", n: "ₙ", m: "ₘ", x: "ₓ", t: "ₜ", s: "ₛ", r: "ᵣ", u: "ᵤ", v: "ᵥ", o: "ₒ", h: "ₕ", l: "ₗ", p: "ₚ",
};

/** Map every character or none: a half-converted exponent reads worse than ^(…). */
function script(text: string, table: Record<string, string>): string | null {
	let out = "";
	for (const ch of text) {
		const m = table[ch];
		if (!m) return null;
		out += m;
	}
	return out;
}

/** Read one TeX argument at `i`: a {group}, a \command, or a single char.
 *  Returns the argument's source and the index after it. */
function readArg(s: string, i: number): { arg: string; next: number } {
	while (i < s.length && s[i] === " ") i++;
	if (i >= s.length) return { arg: "", next: i };
	if (s[i] === "{") {
		let depth = 0;
		for (let j = i; j < s.length; j++) {
			if (s[j] === "\\") {
				j++;
				continue;
			}
			if (s[j] === "{") depth++;
			else if (s[j] === "}") {
				depth--;
				if (depth === 0) return { arg: s.slice(i + 1, j), next: j + 1 };
			}
		}
		return { arg: s.slice(i + 1), next: s.length };
	}
	if (s[i] === "\\") {
		const m = /^\\([A-Za-z]+|.)/.exec(s.slice(i));
		const len = m ? m[0].length : 1;
		return { arg: s.slice(i, i + len), next: i + len };
	}
	return { arg: s[i]!, next: i + 1 };
}

/** Wrap a converted operand in parentheses unless it is a single token
 *  (a word, a number, or one already parenthesized). */
function group(text: string): string {
	const t = text.trim();
	if (t.length <= 1) return t;
	if (/^[\p{L}\p{N}.]+$/u.test(t)) return t;
	if (t.startsWith("(") && t.endsWith(")")) return t;
	return `(${t})`;
}

/** Scripts that could not map to Unicode: one character rides bare
 *  (x^n → x^n), anything longer is parenthesized (e^(iπ)). */
function groupScript(text: string): string {
	const t = text.trim();
	return [...t].length <= 1 ? t : `(${t})`;
}

function wrapText(kind: "mathbb" | "mathbf" | "mathrm" | "mathit" | "mathcal" | "text" | "textbf" | "textit" | "operatorname" | "mathsf" | "mathtt" | "boldsymbol" | "vec" | "hat" | "bar" | "tilde" | "overline" | "underline", inner: string): string {
	switch (kind) {
		case "mathbb":
			return inner.length === 1 && BLACKBOARD[inner] ? BLACKBOARD[inner]! : inner;
		case "vec":
			return `${inner}\u20D7`;
		case "hat":
			return `${inner}\u0302`;
		case "bar":
		case "overline":
			return `${inner}\u0305`;
		case "tilde":
			return `${inner}\u0303`;
		default:
			return inner;
	}
}

const WRAPPERS = new Set(["mathbb", "mathbf", "mathrm", "mathit", "mathcal", "text", "textbf", "textit", "operatorname", "mathsf", "mathtt", "boldsymbol", "vec", "hat", "bar", "tilde", "overline", "underline"]);
const DROPPED = new Set(["left", "right", "big", "Big", "bigg", "Bigg", "bigl", "bigr", "Bigl", "Bigr", "displaystyle", "textstyle", "scriptstyle", "limits", "nolimits", "mathstrut", "strut", "phantom", "hphantom", "vphantom", "label", "tag", "nonumber", "notag", "allowbreak"]);

/** The converter. Linear scan; braces group, `^`/`_` become scripts,
 *  `\frac`/`\sqrt`/`\binom` become their reading forms, commands map by
 *  the table above, `\text{…}`-style wrappers keep their content. */
export function texToPlain(tex: string): string {
	return convert(tex)
		.replace(/[ \t]+/g, " ")
		.replace(/ ([,;)\]}])/g, "$1")
		.replace(/([(\[{]) /g, "$1")
		.replace(/ ?\n ?/g, "\n")
		.trim();
}

function convert(s: string): string {
	let out = "";
	let i = 0;
	while (i < s.length) {
		const ch = s[i]!;
		if (ch === "\\") {
			const m = /^\\([A-Za-z]+)|^\\(.)/.exec(s.slice(i));
			if (!m) {
				i++;
				continue;
			}
			const name = m[1] ?? m[2]!;
			i += m[0].length;
			if (m[2] !== undefined) {
				// Escaped punctuation and spacing: \{ \} \, \; \! \: \\ \_ \% \& \# \$
				if (name === "\\") out += "\n";
				else if (name === "," || name === ";" || name === ":" || name === " ") out += " ";
				else if (name === "!") out += "";
				else out += name;
				continue;
			}
			if (name === "frac" || name === "dfrac" || name === "tfrac" || name === "binom") {
				const a = readArg(s, i);
				const b = readArg(s, a.next);
				i = b.next;
				const top = convert(a.arg);
				const bottom = convert(b.arg);
				out += name === "binom" ? `C(${top}, ${bottom})` : `${group(top)}/${group(bottom)}`;
				continue;
			}
			if (name === "sqrt") {
				let index = "";
				if (s[i] === "[") {
					const close = s.indexOf("]", i);
					if (close !== -1) {
						index = convert(s.slice(i + 1, close));
						i = close + 1;
					}
				}
				const a = readArg(s, i);
				i = a.next;
				const body = convert(a.arg);
				out += index ? `${index === "3" ? "∛" : index === "4" ? "∜" : `${index}√`}${group(body)}` : `√${group(body)}`;
				continue;
			}
			if (WRAPPERS.has(name)) {
				const a = readArg(s, i);
				i = a.next;
				const inner = name.startsWith("text") || name === "operatorname" || name === "mathrm" ? a.arg : convert(a.arg);
				out += wrapText(name as Parameters<typeof wrapText>[0], inner);
				continue;
			}
			if (name === "begin" || name === "end") {
				const a = readArg(s, i);
				i = a.next;
				if (name === "begin" && /matrix|cases|array|aligned|gathered/.test(a.arg)) out += name === "begin" && /matrix/.test(a.arg) ? "[" : "";
				if (name === "end" && /matrix/.test(a.arg)) out += "]";
				continue;
			}
			if (DROPPED.has(name)) {
				// \left( … \right) keep their delimiter; the size command itself goes.
				if (name === "left" || name === "right") {
					if (s[i] === ".") i++;
				}
				continue;
			}
			if (name === "not") {
				const a = readArg(s, i);
				i = a.next;
				const inner = convert(a.arg);
				const negated: Record<string, string> = { "=": "≠", "∈": "∉", "⊂": "⊄", "⊆": "⊈", "<": "≮", ">": "≯", "≤": "≰", "≥": "≱", "≡": "≢", "∼": "≁" };
				out += negated[inner] ?? `¬${inner}`;
				continue;
			}
			const sym = SYMBOLS[name] ?? name;
			out += PADDED.has(name) ? ` ${sym} ` : sym;
			continue;
		}
		if (ch === "^" || ch === "_") {
			const a = readArg(s, i + 1);
			i = a.next;
			const inner = convert(a.arg);
			const mapped = script(inner, ch === "^" ? SUPERSCRIPT : SUBSCRIPT);
			out += mapped ?? `${ch}${groupScript(inner)}`;
			continue;
		}
		if (ch === "{" || ch === "}") {
			i++;
			continue;
		}
		if (ch === "&") {
			out += "  ";
			i++;
			continue;
		}
		if (ch === "~") {
			out += " ";
			i++;
			continue;
		}
		if (ch === "-") {
			out += "−";
			i++;
			continue;
		}
		if (ch === "*") {
			out += "·";
			i++;
			continue;
		}
		out += ch;
		i++;
	}
	return out;
}
