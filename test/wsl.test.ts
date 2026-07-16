import assert from "node:assert/strict";
import test from "node:test";

import {
	buildWslAppServerSpawnSpec,
	parseResolvedCodexPath,
	parseWslDistributions,
	WslService,
} from "../src/backends/wsl";

test("parses CRLF and UTF-16-like WSL distribution output", () => {
	assert.deepEqual(
		parseWslDistributions("U\0b\0u\0n\0t\0u\0\r\0\n\0D\0e\0b\0i\0a\0n\0\r\0\n\0"),
		["Ubuntu", "Debian"],
	);
	assert.deepEqual(parseWslDistributions("* Ubuntu\r\nUbuntu\r\n"), ["Ubuntu"]);
});

test("accepts one safe absolute Codex path and rejects malformed output", () => {
	assert.equal(parseResolvedCodexPath("/home/user/.local/bin/codex\r\n"), "/home/user/.local/bin/codex");
	assert.throws(() => parseResolvedCodexPath("codex\n"), /safe absolute Linux path/);
	assert.throws(() => parseResolvedCodexPath("/one/codex\n/two/codex\n"), /unexpected response/);
});

test("builds the exact shell-free WSL app-server process", () => {
	assert.deepEqual(buildWslAppServerSpawnSpec("Ubuntu", "/home/user/.local/bin/codex"), {
		command: "wsl.exe",
		args: [
			"--distribution",
			"Ubuntu",
			"--exec",
			"/home/user/.local/bin/codex",
			"app-server",
			"--listen",
			"stdio://",
		],
	});
});

test("discovers Codex only after validating the installed distribution", async () => {
	const calls: Array<{ command: string; args: string[] }> = [];
	const service = new WslService(async (command, args) => {
		calls.push({ command, args });
		if (args.includes("--list")) return { stdout: "Ubuntu\r\n", stderr: "" };
		return { stdout: "/home/user/.local/bin/codex\n", stderr: "" };
	});

	assert.equal(await service.resolveCodex("Ubuntu"), "/home/user/.local/bin/codex");
	assert.deepEqual(calls, [
		{ command: "wsl.exe", args: ["--list", "--quiet"] },
		{
			command: "wsl.exe",
			args: ["--distribution", "Ubuntu", "--exec", "sh", "-lc", "command -v codex"],
		},
	]);
	await assert.rejects(service.resolveCodex("Missing"), /is not installed/);
});
