export type RpcId = number | string;

export type RpcError = {
	code: number;
	message: string;
	data?: unknown;
};

export type RpcRequest = {
	id: RpcId;
	method: string;
	params?: unknown;
};

export type RpcNotification = {
	method: string;
	params?: unknown;
};

export type RpcResponse = {
	id: RpcId;
	result?: unknown;
	error?: RpcError;
};

export type RpcMessage = RpcRequest | RpcNotification | RpcResponse;

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isRpcMessage(value: unknown): value is RpcMessage {
	if (!isRecord(value)) {
		return false;
	}

	return "method" in value || "id" in value;
}

export function isRpcRequest(value: RpcMessage): value is RpcRequest {
	return "method" in value && "id" in value;
}

export function isRpcNotification(value: RpcMessage): value is RpcNotification {
	return "method" in value && !("id" in value);
}

export function isRpcResponse(value: RpcMessage): value is RpcResponse {
	return "id" in value && !("method" in value);
}
