import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, win32 } from "node:path";

export type BinaryResolverOptions = {
	env?: NodeJS.ProcessEnv;
	home?: string;
	platform?: NodeJS.Platform;
	exists?: (path: string) => boolean;
	listDirectories?: (path: string) => string[];
};

function defaultListDirectories(path: string): string[] {
	try {
		return readdirSync(path, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name);
	} catch {
		return [];
	}
}

/**
 * GUI apps often do not inherit the same PATH as a terminal. Resolve common
 * Windows, Homebrew, local npm, and nvm locations before normal PATH lookup.
 */
export function resolveCodexBinary(options: BinaryResolverOptions = {}): string {
	const env = options.env ?? process.env;
	if (env.CODEX_BIN?.trim()) {
		return env.CODEX_BIN.trim();
	}

	const home = options.home ?? homedir();
	const platform = options.platform ?? process.platform;
	const exists = options.exists ?? existsSync;

	if (platform === "win32") {
		const appData = env.APPDATA ?? win32.join(home, "AppData", "Roaming");
		const programFiles = env.ProgramFiles ?? "C:\\Program Files";
		const windowsCandidates = [
			win32.join(appData, "npm", "codex.cmd"),
			win32.join(appData, "npm", "codex.exe"),
			env.NVM_SYMLINK ? win32.join(env.NVM_SYMLINK, "codex.cmd") : undefined,
			env.NVM_SYMLINK ? win32.join(env.NVM_SYMLINK, "codex.exe") : undefined,
			win32.join(programFiles, "nodejs", "codex.cmd"),
			win32.join(programFiles, "nodejs", "codex.exe"),
			win32.join(home, "scoop", "shims", "codex.cmd"),
		].filter((candidate): candidate is string => Boolean(candidate));

		for (const candidate of windowsCandidates) {
			if (exists(candidate)) {
				return candidate;
			}
		}

		return "codex";
	}

	const candidates = [
		"/opt/homebrew/bin/codex",
		"/usr/local/bin/codex",
		join(home, ".local", "bin", "codex"),
		join(home, ".npm-global", "bin", "codex"),
	];

	for (const candidate of candidates) {
		if (exists(candidate)) {
			return candidate;
		}
	}

	const nvmVersions = join(home, ".nvm", "versions", "node");
	const listDirectories = options.listDirectories ?? defaultListDirectories;
	for (const version of listDirectories(nvmVersions).sort().reverse()) {
		const candidate = join(nvmVersions, version, "bin", "codex");
		if (exists(candidate)) {
			return candidate;
		}
	}

	return "codex";
}
