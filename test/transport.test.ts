import assert from "node:assert/strict";
import test from "node:test";

import { buildSpawnSpec } from "../src/codex/transport";

test("launches an npm .cmd Codex shim through cmd.exe on Windows", () => {
	assert.deepEqual(
		buildSpawnSpec(
			"C:\\Users\\Mahdi\\AppData\\Roaming\\npm\\codex.cmd",
			["app-server", "--listen", "stdio://"],
			"win32",
			{ ComSpec: "C:\\Windows\\System32\\cmd.exe" },
		),
		{
			command: "C:\\Windows\\System32\\cmd.exe",
			args: [
				"/d",
				"/s",
				"/c",
				'"C:\\Users\\Mahdi\\AppData\\Roaming\\npm\\codex.cmd" "app-server" "--listen" "stdio://"',
			],
		},
	);
});

test("launches a native executable directly", () => {
	assert.deepEqual(buildSpawnSpec("C:\\Tools\\codex.exe", ["app-server"], "win32", {}), {
		command: "C:\\Tools\\codex.exe",
		args: ["app-server"],
	});
});
