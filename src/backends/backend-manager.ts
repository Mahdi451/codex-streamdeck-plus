import { EventEmitter } from "node:events";
import { win32 } from "node:path";

import { CodexAppServerClient, type CodexModel } from "../codex/client";
import { isRecord, type RpcNotification, type RpcRequest } from "../codex/protocol";
import { resolveCodexBinary } from "../codex/resolve-binary";
import { StdioCodexTransport, type CodexTransport } from "../codex/transport";
import {
	backendId,
	isAbsoluteLinuxPath,
	type BackendTarget,
	type NormalizedAgentSlot,
	workflowPreset,
} from "../domain";
import { WslService } from "./wsl";

export type BackendHealthState = "connecting" | "connected" | "offline" | "error";

export type BackendHealth = {
	backendId: string;
	target: BackendTarget;
	state: BackendHealthState;
	updatedAt: number;
	error?: string;
};

export type RiskLevel = "low" | "medium" | "high" | "critical" | "unknown";
export type PendingRequestKind = "approval" | "permission" | "user-input" | "elicitation";

export type PendingAgentRequest = {
	backendId: string;
	connectionId: string;
	target: BackendTarget;
	threadId: string;
	turnId?: string;
	requestId: number | string;
	method: string;
	kind: PendingRequestKind;
	risk: RiskLevel;
	summary: string;
	canApprove: boolean;
	createdAt: number;
	params: Record<string, unknown>;
};

export type BackendNotificationEvent = {
	backendId: string;
	target: BackendTarget;
	notification: RpcNotification;
};

type Connection = {
	id: string;
	target: BackendTarget;
	client: CodexAppServerClient;
};

export type BackendManagerOptions = {
	wslService?: Pick<WslService, "createTransport">;
	createWindowsTransport?: () => CodexTransport;
};

const APPROVAL_METHODS = new Set([
	"item/commandExecution/requestApproval",
	"item/fileChange/requestApproval",
	"item/permissions/requestApproval",
	"applyPatchApproval",
	"execCommandApproval",
]);

function requestKind(method: string): PendingRequestKind | undefined {
	if (APPROVAL_METHODS.has(method)) return method === "item/permissions/requestApproval" ? "permission" : "approval";
	if (method === "item/tool/requestUserInput") return "user-input";
	if (method === "mcpServer/elicitation/request") return "elicitation";
	return undefined;
}

function threadIdFrom(params: Record<string, unknown>): string | undefined {
	if (typeof params.threadId === "string") return params.threadId;
	if (isRecord(params.thread) && typeof params.thread.id === "string") return params.thread.id;
	if (isRecord(params.turn) && typeof params.turn.threadId === "string") return params.turn.threadId;
	return undefined;
}

function turnIdFrom(params: Record<string, unknown>): string | undefined {
	if (typeof params.turnId === "string") return params.turnId;
	if (isRecord(params.turn) && typeof params.turn.id === "string") return params.turn.id;
	return undefined;
}

function boundedRequestText(params: Record<string, unknown>): string {
	const candidates = [params.command, params.cmd, params.reason, params.path, params.cwd, params.permissions];
	for (const candidate of candidates) {
		if (typeof candidate === "string" && candidate.trim()) return candidate.trim().slice(0, 180);
		if (Array.isArray(candidate) && candidate.every((item) => typeof item === "string")) {
			return candidate.join(" ").slice(0, 180);
		}
		if (isRecord(candidate)) {
			try {
				return JSON.stringify(candidate).slice(0, 180);
			} catch {
				// Continue to the generic method label.
			}
		}
	}
	return "Codex is requesting additional authority";
}

export function classifyRequestRisk(method: string, params: Record<string, unknown>): RiskLevel {
	if (method === "item/permissions/requestApproval") return "high";
	if (method === "mcpServer/elicitation/request" || method === "item/tool/requestUserInput") return "medium";
	const text = boundedRequestText(params).toLowerCase();
	if (/rm\s+-rf|sudo\b|mkfs\b|diskpart\b|format\b|git\s+push\s+.*--force|curl.+\|\s*(?:sh|bash)|chmod\s+777/.test(text)) {
		return "critical";
	}
	if (/\brm\b|git\s+push|npm\s+(?:install|publish)|pip\s+install|apt(?:-get)?\s+install|Invoke-WebRequest|curl\b|wget\b/i.test(text)) {
		return "high";
	}
	if (method === "item/fileChange/requestApproval" || method === "applyPatchApproval") return "medium";
	if (method === "item/commandExecution/requestApproval" || method === "execCommandApproval") return "low";
	return "unknown";
}

export function approvalResult(request: PendingAgentRequest, approve: boolean): Record<string, unknown> {
	if (request.method === "item/commandExecution/requestApproval" || request.method === "item/fileChange/requestApproval") {
		return { decision: approve ? "accept" : "decline" };
	}
	if (request.method === "applyPatchApproval" || request.method === "execCommandApproval") {
		return { decision: approve ? "approved" : "denied" };
	}
	if (request.method === "item/permissions/requestApproval") {
		if (approve) throw new Error("Permission broadening cannot be approved from the MVP hardware surface");
		return { permissions: {}, scope: "turn" };
	}
	if (request.method === "mcpServer/elicitation/request") {
		if (approve) throw new Error("MCP elicitation requires the full Codex interface");
		return { action: "decline", content: null, _meta: null };
	}
	if (request.method === "item/tool/requestUserInput") {
		if (approve) throw new Error("User questions require the full Codex interface");
		return { answers: {} };
	}
	throw new Error(`Unsupported pending request ${request.method}`);
}

function validateSlot(slot: NormalizedAgentSlot): void {
	if (!slot.workspace) throw new Error("Configure a workspace for this agent slot");
	if (slot.target.type === "wsl" && !isAbsoluteLinuxPath(slot.workspace)) {
		throw new Error("WSL workspaces must be absolute Linux paths such as /home/user/code/project");
	}
	if (slot.target.type === "windows" && !win32.isAbsolute(slot.workspace)) {
		throw new Error("Windows workspaces must be absolute Windows paths");
	}
}

function sandboxPolicy(slot: NormalizedAgentSlot): Record<string, unknown> {
	if (workflowPreset(slot.workflowPreset).readOnly) return { type: "readOnly", networkAccess: false };
	return {
		type: "workspaceWrite",
		writableRoots: [slot.workspace],
		networkAccess: false,
		excludeTmpdirEnvVar: false,
		excludeSlashTmp: false,
	};
}

export class BackendManager extends EventEmitter {
	readonly #wsl: Pick<WslService, "createTransport">;
	readonly #createWindowsTransport: () => CodexTransport;
	readonly #connections = new Map<string, Connection>();
	readonly #connecting = new Map<string, Promise<Connection>>();
	readonly #health = new Map<string, BackendHealth>();
	readonly #pending = new Map<string, PendingAgentRequest[]>();
	#nextConnectionId = 1;

	constructor(options: BackendManagerOptions = {}) {
		super();
		this.#wsl = options.wslService ?? new WslService();
		this.#createWindowsTransport = options.createWindowsTransport ?? (() =>
			new StdioCodexTransport({ command: resolveCodexBinary() }));
	}

	health(target: BackendTarget): BackendHealth {
		return this.#health.get(backendId(target)) ?? {
			backendId: backendId(target),
			target,
			state: "offline",
			updatedAt: Date.now(),
		};
	}

	pendingFor(target: BackendTarget, threadId?: string): PendingAgentRequest | undefined {
		if (!threadId) return undefined;
		const queue = this.#pending.get(backendId(target)) ?? [];
		return queue.find((request) => request.threadId === threadId);
	}

	pendingAll(): PendingAgentRequest[] {
		return [...this.#pending.values()].flat().sort((left, right) => left.createdAt - right.createdAt);
	}

	async connect(target: BackendTarget): Promise<CodexAppServerClient> {
		return (await this.#connection(target)).client;
	}

	async ensureThread(slot: NormalizedAgentSlot): Promise<string> {
		validateSlot(slot);
		const client = await this.connect(slot.target);
		let threadId = slot.threadId;
		const sandbox = workflowPreset(slot.workflowPreset).readOnly ? "read-only" : "workspace-write";
		const approvalPolicy = workflowPreset(slot.workflowPreset).readOnly ? "never" : "on-request";
		if (threadId) {
			await client.resumeThread(threadId, { sandbox, approvalPolicy });
		} else {
			threadId = await client.startThread({
				cwd: slot.workspace,
				...(slot.model ? { model: slot.model } : {}),
				sandbox,
				approvalPolicy,
			});
		}
		await client.request("thread/settings/update", {
			threadId,
			...(slot.model ? { model: slot.model } : {}),
			effort: slot.reasoning,
		}).catch(() => undefined);
		return threadId;
	}

	async startTurn(slot: NormalizedAgentSlot, prompt: string): Promise<{ threadId: string; turnId?: string }> {
		const threadId = await this.ensureThread(slot);
		const readOnly = workflowPreset(slot.workflowPreset).readOnly;
		const result = await (await this.connect(slot.target)).startTurn({
			threadId,
			prompt,
			cwd: slot.workspace,
			...(slot.model ? { model: slot.model } : {}),
			additionalParams: {
				approvalPolicy: readOnly ? "never" : "on-request",
				sandboxPolicy: sandboxPolicy(slot),
				effort: slot.reasoning,
			},
		});
		const turnId = isRecord(result) && isRecord(result.turn) && typeof result.turn.id === "string"
			? result.turn.id
			: undefined;
		return { threadId, ...(turnId ? { turnId } : {}) };
	}

	async interrupt(slot: NormalizedAgentSlot, turnId: string): Promise<void> {
		if (!slot.threadId) throw new Error("This slot has no Codex thread");
		await (await this.connect(slot.target)).interruptTurn(slot.threadId, turnId);
	}

	async models(target: BackendTarget): Promise<CodexModel[]> {
		return (await this.connect(target)).listModels();
	}

	async applySettings(slot: NormalizedAgentSlot): Promise<void> {
		if (!slot.threadId) return;
		await (await this.connect(slot.target)).request("thread/settings/update", {
			threadId: slot.threadId,
			...(slot.model ? { model: slot.model } : {}),
			effort: slot.reasoning,
		});
	}

	async respond(request: PendingAgentRequest, approve: boolean): Promise<void> {
		if (approve && !request.canApprove) throw new Error("This request requires the full Codex interface");
		const connection = this.#connections.get(request.backendId);
		if (!connection || connection.id !== request.connectionId) {
			throw new Error("The originating approval connection is no longer active");
		}
		connection.client.respond(request.requestId, approvalResult(request, approve));
		const queue = this.#pending.get(request.backendId) ?? [];
		this.#pending.set(request.backendId, queue.filter((candidate) => candidate !== request));
		this.emit("pendingChanged", request);
	}

	async reconnect(target: BackendTarget): Promise<void> {
		const id = backendId(target);
		const connection = this.#connections.get(id);
		this.#connections.delete(id);
		this.#connecting.delete(id);
		if (connection) {
			this.#clearPending(id, connection.id);
			await connection.client.close().catch(() => undefined);
		}
		await this.connect(target);
	}

	async close(): Promise<void> {
		const connections = [...this.#connections.values()];
		this.#connections.clear();
		this.#connecting.clear();
		for (const connection of connections) this.#clearPending(backendId(connection.target), connection.id);
		await Promise.all(connections.map((connection) => connection.client.close().catch(() => undefined)));
	}

	async #connection(target: BackendTarget): Promise<Connection> {
		const id = backendId(target);
		const existing = this.#connections.get(id);
		if (existing?.client.connected) return existing;
		const active = this.#connecting.get(id);
		if (active) return active;
		const connecting = this.#createConnection(target).finally(() => this.#connecting.delete(id));
		this.#connecting.set(id, connecting);
		return connecting;
	}

	async #createConnection(target: BackendTarget): Promise<Connection> {
		const id = backendId(target);
		const connectionId = `${id}#${this.#nextConnectionId++}`;
		this.#setHealth(target, "connecting");
		try {
			const transport = target.type === "wsl"
				? await this.#wsl.createTransport(target.distribution)
				: this.#createWindowsTransport();
			const client = new CodexAppServerClient(transport, {
				clientName: "codex_stream_deck",
				clientTitle: "Codex Deck",
				clientVersion: "0.2.0",
				experimentalApi: true,
			});
			client.on("notification", (notification: RpcNotification) => {
				this.emit("notification", { backendId: id, target, notification } satisfies BackendNotificationEvent);
			});
			client.on("serverRequest", (request: RpcRequest) =>
				this.#handleServerRequest(target, connectionId, client, request));
			client.on("transportError", (error: Error) => {
				if (this.#connections.get(id)?.id === connectionId) this.#connections.delete(id);
				this.#clearPending(id, connectionId);
				this.#setHealth(target, "error", error.message);
			});
			await client.connect();
			const connection = { id: connectionId, target, client };
			this.#connections.set(id, connection);
			this.#setHealth(target, "connected");
			return connection;
		} catch (error) {
			const message = error instanceof Error ? error.message : "Unable to connect to Codex";
			this.#setHealth(target, "error", message);
			throw error;
		}
	}

	#handleServerRequest(
		target: BackendTarget,
		connectionId: string,
		client: CodexAppServerClient,
		request: RpcRequest,
	): void {
		const params = isRecord(request.params) ? request.params : {};
		const kind = requestKind(request.method);
		const threadId = threadIdFrom(params);
		if (!kind || !threadId) {
			client.respondError(request.id, { code: -32_601, message: "Unsupported server request" });
			return;
		}
		const risk = classifyRequestRisk(request.method, params);
		const pending: PendingAgentRequest = {
			backendId: backendId(target),
			connectionId,
			target,
			threadId,
			...(turnIdFrom(params) ? { turnId: turnIdFrom(params) } : {}),
			requestId: request.id,
			method: request.method,
			kind,
			risk,
			summary: boundedRequestText(params),
			canApprove: kind === "approval" && risk !== "critical",
			createdAt: Date.now(),
			params,
		};
		const queue = this.#pending.get(pending.backendId) ?? [];
		queue.push(pending);
		this.#pending.set(pending.backendId, queue.slice(-20));
		this.emit("serverRequest", pending);
		this.emit("pendingChanged", pending);
	}

	#clearPending(id: string, connectionId: string): void {
		const queue = this.#pending.get(id) ?? [];
		const invalidated = queue.filter((request) => request.connectionId === connectionId);
		if (!invalidated.length) return;
		const remaining = queue.filter((request) => request.connectionId !== connectionId);
		if (remaining.length) this.#pending.set(id, remaining);
		else this.#pending.delete(id);
		for (const request of invalidated) this.emit("pendingInvalidated", request);
		this.emit("pendingChanged");
	}

	#setHealth(target: BackendTarget, state: BackendHealthState, error?: string): void {
		const health: BackendHealth = {
			backendId: backendId(target),
			target,
			state,
			updatedAt: Date.now(),
			...(error ? { error: error.slice(0, 240) } : {}),
		};
		this.#health.set(health.backendId, health);
		this.emit("health", health);
	}
}
