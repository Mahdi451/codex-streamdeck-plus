import assert from "node:assert/strict";
import test from "node:test";

import { CodexAppServerClient } from "../src/codex/client";
import { isRpcRequest } from "../src/codex/protocol";
import { FakeTransport } from "./fake-transport";

async function settle(): Promise<void> {
	await new Promise((resolve) => setImmediate(resolve));
}

test("performs the required initialize handshake", async () => {
	const transport = new FakeTransport();
	const client = new CodexAppServerClient(transport);
	const connecting = client.connect();

	await settle();
	const initialize = transport.sent[0];
	assert.ok(initialize && isRpcRequest(initialize));
	assert.equal(initialize.method, "initialize");

	transport.emitMessage({ id: initialize.id, result: { platformOs: "macos" } });
	await connecting;
	assert.equal(client.initialized, true);
	assert.deepEqual(transport.sent[1], { method: "initialized", params: {} });

	await client.close();
});

test("closes the transport when initialization fails", async () => {
	const transport = new FakeTransport();
	const client = new CodexAppServerClient(transport);
	const connecting = client.connect();

	await settle();
	const initialize = transport.sent[0];
	assert.ok(initialize && isRpcRequest(initialize));
	transport.emitMessage({
		id: initialize.id,
		error: { code: -32_600, message: "Unsupported protocol" },
	});
	await assert.rejects(connecting, /Unsupported protocol/);
	assert.equal(transport.started, false);
	assert.equal(client.connected, false);
});

test("starts a thread and sends a text turn", async () => {
	const transport = new FakeTransport();
	const client = new CodexAppServerClient(transport);
	const connecting = client.connect();
	await settle();
	const initialize = transport.sent[0];
	assert.ok(initialize && isRpcRequest(initialize));
	transport.emitMessage({ id: initialize.id, result: {} });
	await connecting;

	const startingThread = client.startThread();
	await settle();
	const threadStart = transport.sent.at(-1);
	assert.ok(threadStart && isRpcRequest(threadStart));
	assert.equal(threadStart.method, "thread/start");
	transport.emitMessage({ id: threadStart.id, result: { thread: { id: "thr_test" } } });
	assert.equal(await startingThread, "thr_test");

	const startingTurn = client.startTurn({
		threadId: "thr_test",
		prompt: "Summarize this repository.",
		cwd: "/tmp/project",
	});
	await settle();
	const turnStart = transport.sent.at(-1);
	assert.ok(turnStart && isRpcRequest(turnStart));
	assert.equal(turnStart.method, "turn/start");
	assert.deepEqual(turnStart.params, {
		threadId: "thr_test",
		input: [{ type: "text", text: "Summarize this repository." }],
		cwd: "/tmp/project",
	});
	transport.emitMessage({ id: turnStart.id, result: { turn: { id: "turn_test" } } });
	await startingTurn;

	await client.close();
});
