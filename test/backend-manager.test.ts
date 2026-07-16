import assert from "node:assert/strict";
import test from "node:test";

import { BackendManager, approvalResult, classifyRequestRisk } from "../src/backends/backend-manager";
import { isRpcRequest, type RpcMessage } from "../src/codex/protocol";
import { normalizeSlotSettings } from "../src/domain";
import { FakeTransport } from "./fake-transport";

class AutoTransport extends FakeTransport {
	override send(message: RpcMessage): void {
		super.send(message);
		if (!isRpcRequest(message)) return;
		queueMicrotask(() => {
			switch (message.method) {
				case "initialize":
					this.emitMessage({ id: message.id, result: { platformOs: "linux" } });
					break;
				case "thread/start":
					this.emitMessage({ id: message.id, result: { thread: { id: "thr_wsl" } } });
					break;
				case "turn/start":
					this.emitMessage({ id: message.id, result: { turn: { id: "turn_wsl" } } });
					break;
				case "model/list":
					this.emitMessage({ id: message.id, result: { data: [], nextCursor: null } });
					break;
				default:
					this.emitMessage({ id: message.id, result: {} });
			}
		});
	}
}

test("owns a WSL thread and turn through one backend connection", async () => {
	const transport = new AutoTransport();
	const manager = new BackendManager({
		wslService: { createTransport: async () => transport },
	});
	const slot = normalizeSlotSettings({
		backendType: "wsl",
		distribution: "Ubuntu",
		workspace: "/home/user/code/project",
		prompt: "Implement it",
		reasoning: "high",
	});
	const result = await manager.startTurn(slot, "Implement it");
	assert.deepEqual(result, { threadId: "thr_wsl", turnId: "turn_wsl" });
	assert.equal(transport.sent.filter((message) => isRpcRequest(message) && message.method === "initialize").length, 1);
	assert.ok(transport.sent.some((message) => isRpcRequest(message) && message.method === "thread/settings/update"));
	const threadStart = transport.sent.find((message) => isRpcRequest(message) && message.method === "thread/start");
	assert.ok(threadStart && isRpcRequest(threadStart));
	assert.deepEqual(threadStart.params, {
		cwd: "/home/user/code/project",
		sandbox: "workspace-write",
		approvalPolicy: "on-request",
	});
	const turnStart = transport.sent.find((message) => isRpcRequest(message) && message.method === "turn/start");
	assert.ok(turnStart && isRpcRequest(turnStart));
	assert.deepEqual(turnStart.params, {
		approvalPolicy: "on-request",
		sandboxPolicy: {
			type: "workspaceWrite",
			writableRoots: ["/home/user/code/project"],
			networkAccess: false,
			excludeTmpdirEnvVar: false,
			excludeSlashTmp: false,
		},
		effort: "high",
		threadId: "thr_wsl",
		input: [{ type: "text", text: "Implement it" }],
		cwd: "/home/user/code/project",
	});
	await manager.close();
});

test("routes an approval response through its originating connection", async () => {
	const transport = new AutoTransport();
	const manager = new BackendManager({
		wslService: { createTransport: async () => transport },
	});
	await manager.connect({ type: "wsl", distribution: "Ubuntu" });
	transport.emitMessage({
		id: 77,
		method: "item/commandExecution/requestApproval",
		params: { threadId: "thr_wsl", command: ["npm", "test"] },
	});
	assert.equal(manager.pendingFor({ type: "wsl", distribution: "Ubuntu" }), undefined);
	const pending = manager.pendingAll()[0];
	assert.ok(pending);
	assert.equal(pending.backendId, "wsl:Ubuntu");
	assert.equal(pending.risk, "low");
	await manager.respond(pending, true);
	assert.deepEqual(transport.sent.at(-1), { id: 77, result: { decision: "accept" } });
	await manager.close();
});

test("invalidates approvals when their originating connection is replaced", async () => {
	const first = new AutoTransport();
	const second = new AutoTransport();
	const transports = [first, second];
	let next = 0;
	const manager = new BackendManager({
		wslService: { createTransport: async () => transports[next++]! },
	});
	const target = { type: "wsl", distribution: "Ubuntu" } as const;
	await manager.connect(target);
	first.emitMessage({
		id: 91,
		method: "item/commandExecution/requestApproval",
		params: { threadId: "thr_wsl", command: ["npm", "test"] },
	});
	const stale = manager.pendingAll()[0];
	assert.ok(stale);
	await manager.reconnect(target);
	assert.deepEqual(manager.pendingAll(), []);
	await assert.rejects(manager.respond(stale, true), /no longer active/);
	assert.equal(second.sent.some((message) => "id" in message && message.id === 91), false);
	await manager.close();
});

test("requires the full Codex interface for critical approvals", async () => {
	const transport = new AutoTransport();
	const manager = new BackendManager({
		wslService: { createTransport: async () => transport },
	});
	await manager.connect({ type: "wsl", distribution: "Ubuntu" });
	transport.emitMessage({
		id: 92,
		method: "item/commandExecution/requestApproval",
		params: { threadId: "thr_wsl", command: "sudo rm -rf /tmp/project" },
	});
	const pending = manager.pendingAll()[0];
	assert.ok(pending);
	assert.equal(pending.risk, "critical");
	assert.equal(pending.canApprove, false);
	await assert.rejects(manager.respond(pending, true), /full Codex interface/);
	await manager.respond(pending, false);
	await manager.close();
});

test("classifies dangerous commands and refuses hardware permission broadening", () => {
	assert.equal(classifyRequestRisk("item/commandExecution/requestApproval", { command: "sudo rm -rf /tmp/project" }), "critical");
	const request = {
		backendId: "wsl:Ubuntu",
		connectionId: "wsl:Ubuntu#1",
		target: { type: "wsl", distribution: "Ubuntu" } as const,
		threadId: "thr_1",
		requestId: 5,
		method: "item/permissions/requestApproval",
		kind: "permission" as const,
		risk: "high" as const,
		summary: "network",
		canApprove: false,
		createdAt: Date.now(),
		params: { permissions: { network: true } },
	};
	assert.throws(() => approvalResult(request, true), /cannot be approved/);
	assert.deepEqual(approvalResult(request, false), { permissions: {}, scope: "turn" });
});
