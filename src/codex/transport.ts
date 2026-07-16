import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";

import { isRpcMessage, type RpcMessage } from "./protocol";

type Unsubscribe = () => void;
type MessageListener = (message: RpcMessage) => void;
type ErrorListener = (error: Error) => void;
type StderrListener = (line: string) => void;

export interface CodexTransport {
	start(): Promise<void>;
	send(message: RpcMessage): void;
	close(): Promise<void>;
	onMessage(listener: MessageListener): Unsubscribe;
	onError(listener: ErrorListener): Unsubscribe;
	onStderr(listener: StderrListener): Unsubscribe;
}

export type StdioCodexTransportOptions = {
	command?: string;
	args?: string[];
	cwd?: string;
	env?: NodeJS.ProcessEnv;
	platform?: NodeJS.Platform;
};

export type SpawnSpec = {
	command: string;
	args: string[];
};

function quoteWindowsCmdToken(token: string): string {
	if (/["]|[\r\n]|[%!]/.test(token)) {
		throw new Error("Unsafe character in Windows command token");
	}
	return `"${token}"`;
}

/** Build a direct POSIX launch or a cmd.exe launch for npm-generated .cmd shims. */
export function buildSpawnSpec(
	command: string,
	args: string[],
	platform: NodeJS.Platform,
	env: NodeJS.ProcessEnv,
): SpawnSpec {
	if (platform !== "win32" || /\.(exe|com)$/i.test(command)) {
		return { command, args };
	}

	const commandLine = [command, ...args].map(quoteWindowsCmdToken).join(" ");
	return {
		command: env.ComSpec || env.COMSPEC || "cmd.exe",
		args: ["/d", "/s", "/c", commandLine],
	};
}

/**
 * Owns one local `codex app-server` child process and exchanges newline-delimited
 * JSON messages over stdio. stdout is protocol-only; diagnostics come from stderr.
 */
export class StdioCodexTransport implements CodexTransport {
	readonly #options: Required<Pick<StdioCodexTransportOptions, "command" | "args">> &
		Omit<StdioCodexTransportOptions, "command" | "args">;
	readonly #messageListeners = new Set<MessageListener>();
	readonly #errorListeners = new Set<ErrorListener>();
	readonly #stderrListeners = new Set<StderrListener>();
	#process?: ChildProcessWithoutNullStreams;
	#closing = false;

	constructor(options: StdioCodexTransportOptions = {}) {
		this.#options = {
			command: options.command ?? process.env.CODEX_BIN ?? "codex",
			args: options.args ?? ["app-server", "--listen", "stdio://"],
			cwd: options.cwd,
			env: options.env,
			platform: options.platform,
		};
	}

	async start(): Promise<void> {
		if (this.#process) {
			return;
		}

		this.#closing = false;
		const childEnv = { ...process.env, ...this.#options.env };
		const spawnSpec = buildSpawnSpec(
			this.#options.command,
			this.#options.args,
			this.#options.platform ?? process.platform,
			childEnv,
		);
		const child = spawn(spawnSpec.command, spawnSpec.args, {
			cwd: this.#options.cwd,
			env: childEnv,
			stdio: ["pipe", "pipe", "pipe"],
			windowsHide: true,
		});
		this.#process = child;

		child.on("error", (error) => this.#emitError(error));
		child.on("exit", (code, signal) => {
			const expected = this.#closing;
			this.#process = undefined;
			this.#closing = false;
			if (!expected) {
				const reason = code !== null ? `code ${code}` : `signal ${signal || "unknown"}`;
				this.#emitError(new Error(`codex app-server exited unexpectedly with ${reason}`));
			}
		});

		const stdout = createInterface({ input: child.stdout });
		stdout.on("line", (line) => {
			try {
				const parsed: unknown = JSON.parse(line);
				if (!isRpcMessage(parsed)) {
					throw new Error("received JSON that is not an app-server message");
				}
				for (const listener of this.#messageListeners) {
					listener(parsed);
				}
			} catch (error) {
				this.#emitError(
					error instanceof Error
						? new Error(`Invalid app-server stdout: ${error.message}`)
						: new Error("Invalid app-server stdout"),
				);
			}
		});

		const stderr = createInterface({ input: child.stderr });
		stderr.on("line", (line) => {
			for (const listener of this.#stderrListeners) {
				listener(line);
			}
		});

		await Promise.race([
			once(child, "spawn").then(() => undefined),
			once(child, "error").then(([error]) => Promise.reject(error)),
		]);
	}

	send(message: RpcMessage): void {
		if (!this.#process?.stdin.writable) {
			throw new Error("codex app-server transport is not running");
		}
		this.#process.stdin.write(`${JSON.stringify(message)}\n`);
	}

	async close(): Promise<void> {
		const child = this.#process;
		if (!child) {
			return;
		}

		this.#closing = true;
		child.kill("SIGTERM");
		await Promise.race([
			once(child, "exit").then(() => undefined),
			new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
		]);
		if (this.#process) {
			child.kill("SIGKILL");
		}
	}

	onMessage(listener: MessageListener): Unsubscribe {
		this.#messageListeners.add(listener);
		return () => this.#messageListeners.delete(listener);
	}

	onError(listener: ErrorListener): Unsubscribe {
		this.#errorListeners.add(listener);
		return () => this.#errorListeners.delete(listener);
	}

	onStderr(listener: StderrListener): Unsubscribe {
		this.#stderrListeners.add(listener);
		return () => this.#stderrListeners.delete(listener);
	}

	#emitError(error: Error): void {
		for (const listener of this.#errorListeners) {
			listener(error);
		}
	}
}
