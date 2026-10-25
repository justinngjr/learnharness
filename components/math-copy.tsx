"use client";

/**
 * MATH COPIES AS READABLE TEXT (owner request 2026-10-25). Selecting
 * rendered KaTeX and copying hands the clipboard BOTH of KaTeX's layers
 * (the hidden MathML and the visual HTML) — doubled symbols, stray
 * "−1" exponents on their own lines. This document-level copy handler
 * rebuilds the selection's text with every `.katex` node replaced by its
 * TeX source (the <annotation> KaTeX embeds) converted to Unicode
 * (src/core/math-plain.ts), block boundaries as newlines. Selections
 * without math are left to the browser untouched.
 */
import { useEffect } from "react";
import { texToPlain } from "@/src/core";

const BLOCKS = new Set(["P", "DIV", "LI", "UL", "OL", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE", "PRE", "TR", "TABLE", "SECTION", "ARTICLE", "BR", "HR"]);

/** The plain text of a DOM fragment with math de-TeXed. Pure over the
 *  DOM API (linkedom in tests). Display equations get their own line. */
export function plainTextWithMath(root: Node): string {
	let out = "";
	const walk = (node: Node): void => {
		if (node.nodeType === 3) {
			out += node.nodeValue ?? "";
			return;
		}
		if (node.nodeType !== 1) return;
		const el = node as Element;
		if (el.classList.contains("katex")) {
			const tex = el.querySelector("annotation")?.textContent ?? "";
			const display = el.closest(".katex-display") !== null;
			const text = tex ? texToPlain(tex) : el.textContent ?? "";
			if (display) out += `${out.length > 0 && !out.endsWith("\n") ? "\n" : ""}${text}\n`;
			else out += text;
			return;
		}
		if (el.tagName === "BR") {
			out += "\n";
			return;
		}
		if (el.tagName === "SCRIPT" || el.tagName === "STYLE") return;
		const block = BLOCKS.has(el.tagName);
		if (block && out.length > 0 && !out.endsWith("\n")) out += "\n";
		for (const child of Array.from(el.childNodes)) walk(child);
		if (block && !out.endsWith("\n")) out += "\n";
	};
	walk(root);
	return out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** True when the fragment carries any rendered math. */
export function hasMath(root: Node): boolean {
	return root.nodeType === 1 && ((root as Element).classList.contains("katex") || (root as Element).querySelector(".katex") !== null);
}

export function MathCopy() {
	useEffect(() => {
		const onCopy = (e: ClipboardEvent) => {
			const sel = window.getSelection();
			if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !e.clipboardData) return;
			const anchor = sel.anchorNode;
			const host = anchor && (anchor.nodeType === 1 ? (anchor as Element) : anchor.parentElement);
			// Inputs own their own copy; only the rendered page is rewritten.
			if (host?.closest("textarea, input, [contenteditable=true]")) return;
			const wrapper = document.createElement("div");
			for (let i = 0; i < sel.rangeCount; i++) wrapper.appendChild(sel.getRangeAt(i).cloneContents());
			// A selection that starts INSIDE a formula clones only its interior;
			// widen to the whole formula so the annotation comes along.
			const inside = host?.closest(".katex");
			if (!hasMath(wrapper) && !inside) return;
			if (inside && !hasMath(wrapper)) {
				wrapper.replaceChildren(inside.cloneNode(true));
			}
			const text = plainTextWithMath(wrapper);
			if (!text) return;
			e.preventDefault();
			e.clipboardData.setData("text/plain", text);
		};
		document.addEventListener("copy", onCopy);
		return () => document.removeEventListener("copy", onCopy);
	}, []);
	return null;
}
