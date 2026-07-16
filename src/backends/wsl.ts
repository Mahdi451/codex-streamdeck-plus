import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { StdioCodexTransport, type CodexTransport, type SpawnSpec } from "../codex/transport";

const execFileAsync = promisify(execFile);

export type CommandResult = { stdout: string; stderr: string };
export type CommandRunner = (command: string, args: string[]) => Promise<CommandResult>;

const defaultRunner: CommandRunner = async (command, args) => {
	const result = await execFileAsync(command, args, {
		encoding: "utf8",
		timeout: 15_000,
		windowsHide: true,
		maxBuffer: 1024 * 1024,
	});
	return { stdout: result.stdout, stderr: result.stderr };
};

function normalizeWslOutput(value: string): string {
	return value.replace(/^\uFEFF/, "").replaceAll("\0", "").replaceAll("\r", "");
}

export function parseWslDistributions(stdout: string): string[] {
	const seen = new Set<string>();
	for (const raw of normalizeWslOutput(stdout).split("\n")) {
		const name = raw.trim().replace(/^\*\s*/, "");
		if (!name || name.length > 128 || name.startsWith("-") || /[\u0000-\u001F\\/]/.test(name)) continue;
		seen.add(name);
	}
	return [...seen];
}

export function parseResolvedCodexPath(stdout: string): string {
	const lines = normalizeWslOutput(stdout).split("\n").map((line) => line.trim()).filter(Boolean);
	if (lines.length !== 1) throw new Error("WSL Codex discovery returned an unexpected response");
	const resolved = lines[0]!;
	if (!resolved.startsWith("/") || resolved.length > 32_768 || /[\s\u0000-\u001F]/.test(resolved)) {
		throw new Error("WSL Codex path is not a safe absolute Linux path");
	}
	return resolved;
}

export function buildWslAppServerSpawnSpec(
	distribution: string,
	codexPath: string,
	wslCommand = "wsl.exe",
): SpawnSpec {
	return {
		command: wslCommand,
		args: [
			"--distribution",
			distribution,
			"--exec",
			codexPath,
			"app-server",
			"--listen",
			"stdio://",
		],
	};
}

export class WslService {
	constructor(
		private readonly runner: CommandRunner = defaultRunner,
		private readonly wslCommand = "wsl.exe",
	) {}

	async distributions(): Promise<string[]> {
		const { stdout } = await this.runner(this.wslCommand, ["--list", "--quiet"]);
		return parseWslDistributions(stdout);
	}

	async resolveCodex(distribution: string): Promise<string> {
		const installed = await this.distributions();
		if (!installed.includes(distribution)) {
			throw new Error(`WSL distribution ${distribution} is not installed`);
		}
		const { stdout } = await this.runner(this.wslCommand, [
			"--distribution",
			distribution,
			"--exec",
			"sh",
			"-lc",
			"command -v codex",
		]);
		return parseResolvedCodexPath(stdout);
	}

	async createTransport(distribution: string): Promise<CodexTransport> {
		const codexPath = await this.resolveCodex(distribution);
		const spec = buildWslAppServerSpawnSpec(distribution, codexPath, this.wslCommand);
		return new StdioCodexTransport({ command: spec.command, args: spec.args, platform: "win32" });
	}
}
