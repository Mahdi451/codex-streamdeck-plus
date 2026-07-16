import assert from "node:assert/strict";
import test from "node:test";

import { backendId, buildAgentPrompt, normalizeSlotSettings } from "../src/domain";

test("normalizes a WSL slot without translating its Linux path", () => {
	const slot = normalizeSlotSettings({
		slotNumber: 3,
		label: "Validator",
		backendType: "wsl",
		distribution: "Ubuntu-24.04",
		workspace: "/home/mahdi/code/lab-tools",
		reasoning: "high",
		workflowPreset: "test",
	});
	assert.equal(slot.workspace, "/home/mahdi/code/lab-tools");
	assert.equal(backendId(slot.target), "wsl:Ubuntu-24.04");
	assert.equal(slot.slotNumber, 3);
});

test("builds a per-turn workflow and status contract", () => {
	const slot = normalizeSlotSettings({
		prompt: "Implement the parser",
		workspace: "/home/user/code/project",
		workflowPreset: "implement",
	});
	const prompt = buildAgentPrompt(slot);
	assert.match(prompt, /Implement the parser/);
	assert.match(prompt, /Workflow preset:/);
	assert.match(prompt, /codex-deck-status/);
});

test("never reuses a thread id across backend identities", () => {
	const changedTarget = normalizeSlotSettings({
		backendType: "wsl",
		distribution: "Debian",
		workspace: "/home/user/code/project",
		threadId: "thr_from_ubuntu",
		threadBackendId: "wsl:Ubuntu",
	});
	assert.equal(changedTarget.threadId, undefined);

	const matchingTarget = normalizeSlotSettings({
		backendType: "wsl",
		distribution: "Ubuntu",
		workspace: "/home/user/code/project",
		threadId: "thr_from_ubuntu",
		threadBackendId: "wsl:Ubuntu",
	});
	assert.equal(matchingTarget.threadId, "thr_from_ubuntu");
});
