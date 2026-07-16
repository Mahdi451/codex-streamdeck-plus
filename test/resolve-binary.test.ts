import assert from "node:assert/strict";
import test from "node:test";

import { resolveCodexBinary } from "../src/codex/resolve-binary";

test("uses an explicit CODEX_BIN first", () => {
	assert.equal(
		resolveCodexBinary({ env: { CODEX_BIN: "/custom/codex" }, exists: () => false }),
		"/custom/codex",
	);
});

test("finds Codex inside an nvm installation for GUI launches", () => {
	const existing = new Set(["/Users/mahdi/.nvm/versions/node/v24.1.0/bin/codex"]);
	assert.equal(
		resolveCodexBinary({
			env: {},
			home: "/Users/mahdi",
			exists: (path) => existing.has(path),
			listDirectories: () => ["v22.1.0", "v24.1.0"],
		}),
		"/Users/mahdi/.nvm/versions/node/v24.1.0/bin/codex",
	);
});

test("falls back to PATH lookup", () => {
	assert.equal(
		resolveCodexBinary({ env: {}, exists: () => false, listDirectories: () => [] }),
		"codex",
	);
});

test("finds the npm Codex shim on Windows", () => {
	const expected = "C:\\Users\\Mahdi\\AppData\\Roaming\\npm\\codex.cmd";
	assert.equal(
		resolveCodexBinary({
			env: { APPDATA: "C:\\Users\\Mahdi\\AppData\\Roaming" },
			home: "C:\\Users\\Mahdi",
			platform: "win32",
			exists: (path) => path === expected,
		}),
		expected,
	);
});
