import assert from "node:assert/strict";
import test from "node:test";

import { AgentStateStore } from "../src/state/agent-state";

test("maps Codex lifecycle notifications to Micro-style states", () => {
	const store = new AgentStateStore();

	store.applyNotification({
		method: "turn/started",
		params: { threadId: "thr_1", turn: { id: "turn_1" } },
	});
	assert.equal(store.get("thr_1").status, "thinking");

	store.applyNotification({
		method: "turn/completed",
		params: { threadId: "thr_1", turn: { id: "turn_1", status: "completed" } },
	});
	assert.equal(store.get("thr_1").status, "complete");
	assert.equal(store.get("thr_1").unread, true);

	store.markRead("thr_1");
	assert.equal(store.get("thr_1").status, "idle");
	assert.equal(store.get("thr_1").unread, false);
});

test("marks approval requests as requiring input", () => {
	const store = new AgentStateStore();
	store.applyServerRequest({
		id: 41,
		method: "item/commandExecution/requestApproval",
		params: { threadId: "thr_2" },
	});

	assert.equal(store.get("thr_2").status, "requires-input");
	assert.equal(store.get("thr_2").pendingRequestId, 41);
});

test("marks explicit user-input requests as requiring input", () => {
	const store = new AgentStateStore();
	store.applyServerRequest({
		id: 42,
		method: "item/tool/requestUserInput",
		params: { threadId: "thr_3", questions: [] },
	});

	assert.equal(store.get("thr_3").status, "requires-input");
});

test("uses the final streamed agent message when turn completion omits items", () => {
	const store = new AgentStateStore();
	store.applyNotification({
		method: "turn/started",
		params: { threadId: "thr_4", turn: { id: "turn_4" } },
	});
	store.applyNotification({
		method: "item/completed",
		params: {
			threadId: "thr_4",
			turnId: "turn_4",
			item: {
				type: "agentMessage",
				text: "Work complete.\n<!-- codex-deck-status\n{\"workflowStatus\":\"done\",\"verification\":\"passed\",\"headline\":\"Tests pass\"}\n-->",
			},
		},
	});
	store.applyNotification({
		method: "turn/completed",
		params: { threadId: "thr_4", turn: { id: "turn_4", status: "completed" } },
	});

	const state = store.get("thr_4");
	assert.equal(state.status, "complete");
	assert.equal(state.workflowStatus, "done");
	assert.equal(state.verification, "passed");
	assert.equal(state.headline, "Tests pass");
});
