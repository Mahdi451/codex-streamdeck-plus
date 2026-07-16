import { EventEmitter } from "node:events";

import {
	isRecord,
	isRpcNotification,
	isRpcRequest,
	isRpcResponse,
	type RpcError,
	type RpcId,
	type RpcMessage,
	type RpcNotification,
	type RpcRequest,
} from "./protocol";
import type { CodexTransport } from "./transport";

type PendingRequest = {
	resolve: (value: unknown) => void;
	reject: (reason: Error) => void;
	timer: NodeJS.Timeout;
};

export type CodexClientOptions = {
	clientName?: string;
	clientTitle?: string;
	clientVersion?: string;
	requestTimeoutMs?: number;
	experimentalApi?: boolean;
};

export type StartTurnOptions = {
	threadId: string;
	prompt: string;
	cwd?: string;
	model?: string;
	additionalParams?: Record<string, unknown>;
};

export type CodexModel = {
	id: string;
	displayName?: string;
	description?: string;
	hidden?: boolean;
	defaultReasoningEffort?: string;
	supportedReasoningEfforts?: Array<{ reasoningEffort?: string }>;
};

export class CodexRpcError extends Error {
	constructor(readonly rpcError: RpcError) {
		super(`Codex RPC ${rpcError.code}: ${rpcError.message}`);
		this.name = "CodexRpcError";
	}
}

/** A small typed shell around the versioned Codex app-server JSON-RPC protocol. */
export class CodexAppServerClient extends EventEmitter {
	readonly #transport: CodexTransport;
	readonly #options: Required<CodexClientOptions>;
	readonly #pending = new Map<RpcId, PendingRequest>();
	readonly #unsubscribe: Array<() => void> = [];
	#nextId = 1;
	#transportReady = false;
	#initialized = false;

	constructor(transport: CodexTransport, options: CodexClientOptions = {}) {
		super();
		this.#transport = transport;
		this.#options = {
			clientName: options.clientName ?? "codex_stream_deck",
			clientTitle: options.clientTitle ?? "Codex Deck",
			clientVersion: options.clientVersion ?? "0.1.0",
			requestTimeoutMs: options.requestTimeoutMs ?? 30_000,
			experimentalApi: options.experimentalApi ?? false,
		};
	}

	get initialized(): boolean {
		return this.#initialized;
	}

	get connected(): boolean {
		return this.#transportReady && this.#initialized;
	}

	async connect(): Promise<void> {
		if (this.#initialized) {
			return;
		}

		this.#unsubscribe.push(
			this.#transport.onMessage((message) => this.#handleMessage(message)),
			this.#transport.onError((error) => this.emit("transportError", error)),
			this.#transport.onStderr((line) => this.emit("stderr", line)),
		);
		await this.#transport.start();
		this.#transportReady = true;

		try {
			await this.request("initialize", {
				clientInfo: {
					name: this.#options.clientName,
					title: this.#options.clientTitle,
					version: this.#options.clientVersion,
				},
				capabilities: {
					experimentalApi: this.#options.experimentalApi,
				},
			});
			this.notify("initialized", {});
			this.#initialized = true;
			this.emit("connected");
		} catch (error) {
			await this.close().catch(() => undefined);
			throw error;
		}
	}

	request<TResult = unknown>(method: string, params: unknown = {}): Promise<TResult> {
		if (!this.#transportReady) {
			return Promise.reject(new Error("Codex client is not connected"));
		}

		const id = this.#nextId++;
		const request: RpcRequest = { id, method, params };
		return new Promise<TResult>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.#pending.delete(id);
				reject(new Error(`Timed out waiting for Codex method ${method}`));
			}, this.#options.requestTimeoutMs);
			timer.unref();

			this.#pending.set(id, {
				resolve: (value) => resolve(value as TResult),
				reject,
				timer,
			});
			this.#transport.send(request);
		});
	}

	notify(method: string, params: unknown = {}): void {
		if (!this.#transportReady) {
			throw new Error("Codex client is not connected");
		}
		this.#transport.send({ method, params });
	}

	respond(id: RpcId, result: unknown): void {
		this.#transport.send({ id, result });
	}

	respondError(id: RpcId, error: RpcError): void {
		this.#transport.send({ id, error });
	}

	async startThread(params: Record<string, unknown> = {}): Promise<string> {
		const result = await this.request("thread/start", params);
		if (!isRecord(result) || !isRecord(result.thread) || typeof result.thread.id !== "string") {
			throw new Error("thread/start returned no thread id");
		}
		return result.thread.id;
	}

	async resumeThread(threadId: string, params: Record<string, unknown> = {}): Promise<void> {
		await this.request("thread/resume", { ...params, threadId });
	}

	async startTurn(options: StartTurnOptions): Promise<unknown> {
		const params: Record<string, unknown> = {
			...options.additionalParams,
			threadId: options.threadId,
			input: [{ type: "text", text: options.prompt }],
		};
		if (options.cwd) {
			params.cwd = options.cwd;
		}
		if (options.model) {
			params.model = options.model;
		}
		return this.request("turn/start", params);
	}

	async interruptTurn(threadId: string, turnId: string): Promise<void> {
		await this.request("turn/interrupt", { threadId, turnId });
	}

	async forkThread(threadId: string, params: Record<string, unknown> = {}): Promise<string> {
		const result = await this.request("thread/fork", { ...params, threadId });
		if (!isRecord(result) || !isRecord(result.thread) || typeof result.thread.id !== "string") {
			throw new Error("thread/fork returned no thread id");
		}
		return result.thread.id;
	}

	async listModels(): Promise<CodexModel[]> {
		const models: CodexModel[] = [];
		let cursor: string | null = null;
		do {
			const result: unknown = await this.request("model/list", {
				cursor,
				limit: 100,
				includeHidden: false,
			});
			if (!isRecord(result)) throw new Error("model/list returned an invalid response");
			const data = Array.isArray(result.data) ? result.data : [];
			for (const candidate of data) {
				if (!isRecord(candidate) || typeof candidate.id !== "string") continue;
				models.push(candidate as CodexModel);
			}
			cursor = typeof result.nextCursor === "string" ? result.nextCursor : null;
		} while (cursor);
		return models.filter((model) => !model.hidden);
	}

	async close(): Promise<void> {
		this.#initialized = false;
		this.#transportReady = false;
		for (const unsubscribe of this.#unsubscribe.splice(0)) {
			unsubscribe();
		}
		for (const pending of this.#pending.values()) {
			clearTimeout(pending.timer);
			pending.reject(new Error("Codex client closed"));
		}
		this.#pending.clear();
		await this.#transport.close();
	}

	#handleMessage(message: RpcMessage): void {
		if (isRpcResponse(message)) {
			const pending = this.#pending.get(message.id);
			if (!pending) {
				this.emit("orphanResponse", message);
				return;
			}
			this.#pending.delete(message.id);
			clearTimeout(pending.timer);
			if (message.error) {
				pending.reject(new CodexRpcError(message.error));
			} else {
				pending.resolve(message.result);
			}
			return;
		}

		if (isRpcRequest(message)) {
			this.emit("serverRequest", message);
			return;
		}

		if (isRpcNotification(message)) {
			this.emit("notification", message as RpcNotification);
			this.emit(`notification:${message.method}`, message.params);
		}
	}
}
