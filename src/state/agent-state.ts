import { EventEmitter } from "node:events";

import type { PendingAgentRequest } from "../backends/backend-manager";
import { isRecord, type RpcNotification, type RpcRequest } from "../codex/protocol";
import {
	finalAgentMessage,
	parseStatusMarker,
	type VerificationStatus,
	type WorkflowStatus,
} from "./status-marker";

export type AgentStatus =
	| "unassigned"
	| "idle"
	| "thinking"
	| "complete"
	| "requires-input"
	| "error"
	| "offline";

export type AgentState = {
	backendId: string;
	threadId: string;
	status: AgentStatus;
	updatedAt: number;
	unread: boolean;
	workflowStatus: WorkflowStatus;
	verification: VerificationStatus;
	headline?: string;
	verificationSummary?: string;
	error?: string;
	turnId?: string;
	pendingRequestId?: number | string;
	pendingRequest?: PendingAgentRequest;
};

export const STATUS_COLORS: Record<AgentStatus, string> = {
	unassigned: "#111827",
	idle: "#F8FAFC",
	thinking: "#2388FF",
	complete: "#20C878",
	"requires-input": "#F4A62A",
	error: "#EF4444",
	offline: "#991B1B",
};

function threadIdFrom(params: unknown): string | undefined {
	if (!isRecord(params)) return undefined;
	if (typeof params.threadId === "string") return params.threadId;
	if (isRecord(params.thread) && typeof params.thread.id === "string") return params.thread.id;
	if (isRecord(params.turn) && typeof params.turn.threadId === "string") return params.turn.threadId;
	return undefined;
}

function turnIdFrom(params: unknown): string | undefined {
	if (!isRecord(params)) return undefined;
	if (typeof params.turnId === "string") return params.turnId;
	if (isRecord(params.turn) && typeof params.turn.id === "string") return params.turn.id;
	return undefined;
}

function stateKey(backendId: string, threadId: string): string {
	return `${backendId}\0${threadId}`;
}

export class AgentStateStore extends EventEmitter {
	readonly #states = new Map<string, AgentState>();
	readonly #agentMessages = new Map<string, string>();

	get(threadId: string, backendId = "windows"): AgentState {
		return (
			this.#states.get(stateKey(backendId, threadId)) ?? {
				backendId,
				threadId,
				status: "idle",
				updatedAt: Date.now(),
				unread: false,
				workflowStatus: "unknown",
				verification: "unknown",
			}
		);
	}

	setStatus(
		threadId: string,
		status: AgentStatus,
		extra: Partial<Omit<AgentState, "backendId" | "threadId" | "status" | "updatedAt">> = {},
		backendId = "windows",
	): AgentState {
		const previous = this.get(threadId, backendId);
		const next: AgentState = {
			...previous,
			...extra,
			backendId,
			threadId,
			status,
			updatedAt: Date.now(),
			unread: extra.unread ?? (status === "complete" || status === "requires-input" || status === "error" || status === "offline"),
		};
		if (status !== "error" && status !== "offline") delete next.error;
		if (status !== "requires-input") {
			delete next.pendingRequestId;
			delete next.pendingRequest;
		}
		this.#states.set(stateKey(backendId, threadId), next);
		this.emit("change", next);
		return next;
	}

	markRead(threadId: string, backendId = "windows"): AgentState {
		const previous = this.get(threadId, backendId);
		const next: AgentState = {
			...previous,
			status: previous.status === "complete" ? "idle" : previous.status,
			unread: false,
			updatedAt: Date.now(),
		};
		this.#states.set(stateKey(backendId, threadId), next);
		this.emit("change", next);
		return next;
	}

	applyNotification(notification: RpcNotification, backendId = "windows"): void {
		const threadId = threadIdFrom(notification.params);
		if (!threadId) return;

		switch (notification.method) {
			case "thread/started":
			case "thread/resumed":
				this.setStatus(threadId, "idle", {}, backendId);
				break;
		case "turn/started":
				this.#agentMessages.delete(stateKey(backendId, threadId));
				this.setStatus(threadId, "thinking", {
					workflowStatus: "working",
					verification: "unknown",
					...(turnIdFrom(notification.params) ? { turnId: turnIdFrom(notification.params) } : {}),
				}, backendId);
				break;
			case "turn/completed": {
				const status = isRecord(notification.params) && isRecord(notification.params.turn)
					? notification.params.turn.status
					: undefined;
				if (status === "failed") {
					this.setStatus(threadId, "error", { workflowStatus: "failed", verification: "failed" }, backendId);
				} else if (status === "interrupted") {
					this.setStatus(threadId, "idle", { workflowStatus: "unknown", verification: "unknown" }, backendId);
				} else {
					const message = finalAgentMessage(notification.params)
						?? this.#agentMessages.get(stateKey(backendId, threadId))
						?? "";
					this.#agentMessages.delete(stateKey(backendId, threadId));
					const marker = parseStatusMarker(message);
					this.setStatus(threadId, "complete", {
						workflowStatus: marker?.workflowStatus ?? "unknown",
						verification: marker?.verification ?? "unknown",
						...(marker?.headline ? { headline: marker.headline } : {}),
						...(marker?.verificationSummary ? { verificationSummary: marker.verificationSummary } : {}),
					}, backendId);
				}
				break;
			}
			case "item/completed": {
				const item = isRecord(notification.params) && isRecord(notification.params.item)
					? notification.params.item
					: undefined;
				if (item?.type === "agentMessage" && typeof item.text === "string") {
					this.#agentMessages.set(stateKey(backendId, threadId), item.text);
				}
				break;
			}
			case "turn/failed":
			case "error":
				this.#agentMessages.delete(stateKey(backendId, threadId));
				this.setStatus(threadId, "error", {
					error: notification.method,
					workflowStatus: "failed",
					verification: "failed",
				}, backendId);
				break;
			default:
				break;
		}
	}

	applyServerRequest(request: RpcRequest, backendId = "windows"): void {
		if (!/(approval|elicitation|requestUserInput)/i.test(request.method)) return;
		const threadId = threadIdFrom(request.params);
		if (threadId) {
			this.setStatus(threadId, "requires-input", {
				pendingRequestId: request.id,
				workflowStatus: "needs_input",
			}, backendId);
		}
	}

	applyPending(request: PendingAgentRequest): void {
		this.setStatus(request.threadId, "requires-input", {
			pendingRequestId: request.requestId,
			pendingRequest: request,
			workflowStatus: "needs_input",
		}, request.backendId);
	}

	resolvePending(request: PendingAgentRequest): void {
		const state = this.get(request.threadId, request.backendId);
		if (state.pendingRequestId !== request.requestId) return;
		this.setStatus(request.threadId, "thinking", {
			workflowStatus: "working",
			unread: false,
		}, request.backendId);
	}

	invalidatePending(request: PendingAgentRequest): void {
		const state = this.get(request.threadId, request.backendId);
		if (state.pendingRequest?.connectionId !== request.connectionId) return;
		this.setStatus(request.threadId, "idle", {
			workflowStatus: "unknown",
			verification: "unknown",
			unread: false,
		}, request.backendId);
	}
}
