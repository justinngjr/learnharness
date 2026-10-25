/** JS matcher + config-policy regressions; native Turbopack needs the real payload gate. */
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, it } from "node:test";
import nextConfig from "../next.config.ts";

const require = createRequire(import.meta.url);
// Use Next's actual bundled matcher, not a different glob implementation.
const picomatch = require("next/dist/compiled/picomatch");
const { makeIgnoreFn } = require("next/dist/build/collect-build-traces");
const patterns = nextConfig.outputFileTracingExcludes!["*"];

describe("standalone JavaScript tracing exclusions and native workaround policy", () => {
	for (const windows of [false, true]) {
		const root = windows ? "C:\\build\\learnharness" : "/build/learnharness";
		const file = (relative: string) => root + (windows ? "\\" : "/") + (windows ? relative.replaceAll("/", "\\") : relative);
		const ignored = picomatch(patterns, { contains: true, dot: true, windows });
		it(`excludes genuine data directories and secrets (${windows ? "Windows" : "POSIX"})`, () => {
			for (const relative of ["data/canary.json", "nested/data/private.json", "auth.json", ".env", ".env.local"]) {
				assert.equal(ignored(file(relative)), true, relative);
			}
			// The explicit includes remain necessary: this raw ignore still matches SDK data.
			assert.equal(ignored(file("node_modules/@earendil-works/pi-ai/dist/providers/data/models.json")), true);
			assert.ok(nextConfig.outputFileTracingIncludes!["*"]!.includes("node_modules/@earendil-works/pi-ai/dist/providers/data/**/*"));
		});
		it(`does not confuse dependency suffixes with data directories (${windows ? "Windows" : "POSIX"})`, () => {
			for (const relative of ["node_modules/gcp-metadata/build/src/index.js", "node_modules/form-data/lib/form_data.js", "node_modules/@swc/helpers/_/_ts_metadata.js", "node_modules/@swc/helpers/_/_ts_metadata/index.js", "node_modules/somedata/runtime.js"]) {
				assert.equal(ignored(file(relative)), false, relative);
				assert.equal(picomatch("data/**/*", { contains: true, dot: true, windows })(file("node_modules/gcp-metadata/build/src/index.js")), true, "old pattern must reproduce the bug");
			}
		});
	}
	it("uses the installed Next JavaScript early-ignore function on the host platform", () => {
		const root = process.cwd();
		const ignore = makeIgnoreFn(root, patterns);
		assert.equal(ignore(`${root}/data/private.json`), true);
		assert.equal(ignore(`${root}/node_modules/gcp-metadata/build/src/index.js`), false);
	});
	it("preserves all secret exclusions exactly", () => {
		assert.deepEqual(patterns, ["**/data/**/*", "auth.json", ".env*"]);
	});
	it("retains exactly the narrow native-Turbopack closure workaround and existing runtime includes", () => {
		assert.deepEqual(nextConfig.outputFileTracingIncludes!["*"], [
			"node_modules/@puppeteer/browsers/lib/browser-data/**/*.js",
			"node_modules/pdfjs-dist/legacy/**/*",
			"node_modules/pdfjs-dist/standard_fonts/**/*",
			"node_modules/@napi-rs/canvas-*/**/*",
			"node_modules/@resvg/resvg-js-*/**/*",
			"node_modules/@earendil-works/pi-ai/dist/providers/data/**/*",
			"node_modules/@earendil-works/pi-ai/dist/auth/oauth/{load,github-copilot,xai,device-code,openai-codex,callback-server,pkce}.js",
			"node_modules/@earendil-works/pi-ai/dist/utils/{oauth-page,provider-env}.js",
			"node_modules/@earendil-works/pi-ai/dist/utils/sleep.js",
			"node_modules/@earendil-works/pi-agent-core/dist/**/*.json",
			"node_modules/gcp-metadata/**/*",
			"node_modules/json-bigint/**/*",
			"node_modules/bignumber.js/**/*",
		]);
	});
	it("limits the workaround to its three packages, never learner data or unrelated dependencies", () => {
		const closure = nextConfig.outputFileTracingIncludes!["*"]!.slice(-3);
		const included = picomatch(closure, { dot: true });
		for (const file of ["node_modules/gcp-metadata/build/src/index.js", "node_modules/json-bigint/lib/parse.js", "node_modules/bignumber.js/bignumber.js"]) assert.equal(included(file), true, file);
		for (const file of ["data/private.json", "nested/data/private.json", "auth.json", ".env.local", "node_modules/unrelated/runtime.js", "node_modules/gcp-metadata-lookalike/index.js"]) assert.equal(included(file), false, file);
	});
	it("ships the whole static import closure of every native OAuth flow the app offers", () => {
		// The flows are loaded through variable imports the tracer cannot follow,
		// so each one — and everything it statically imports — must be listed
		// explicitly. Missing openai-codex.js here is what made the packaged
		// app fail Codex sign-in before any URL existed.
		const includes = nextConfig.outputFileTracingIncludes!["*"]!;
		const included = picomatch(includes, { dot: true });
		const pkg = path.resolve("node_modules/@earendil-works/pi-ai");
		const seen = new Set<string>();
		const visit = (file: string) => {
			const relative = path.posix.join("node_modules/@earendil-works/pi-ai", path.relative(pkg, file).split(path.sep).join("/"));
			if (seen.has(relative)) return;
			seen.add(relative);
			// providers/ (and what it imports) is traced statically through the provider factories the server imports.
			if (relative.startsWith("node_modules/@earendil-works/pi-ai/dist/providers/")) return;
			assert.equal(included(relative), true, relative);
			for (const match of fs.readFileSync(file, "utf8").matchAll(/from\s+"(\.{1,2}\/[^"]+)"/g)) visit(path.resolve(path.dirname(file), match[1]!));
		};
		for (const flow of ["github-copilot", "xai", "openai-codex"]) visit(path.join(pkg, "dist", "auth", "oauth", `${flow}.js`));
		assert.equal(seen.has("node_modules/@earendil-works/pi-ai/dist/auth/oauth/callback-server.js"), true);
	});
});
