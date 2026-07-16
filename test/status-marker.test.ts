import assert from "node:assert/strict";
import test from "node:test";

import { finalAgentMessage, parseStatusMarker } from "../src/state/status-marker";

test("parses a bounded verification-aware status marker", () => {
	assert.deepEqual(parseStatusMarker(`Done.\n<!-- codex-deck-status\n{"workflowStatus":"done","headline":"MVP complete","verification":"passed","verificationSummary":"All tests passed"}\n-->`), {
		workflowStatus: "done",
		headline: "MVP complete",
		verification: "passed",
		verificationSummary: "All tests passed",
	});
});

test("fails closed for malformed status markers", () => {
	assert.equal(parseStatusMarker("<!-- codex-deck-status\nnot-json\n-->"), undefined);
	assert.equal(parseStatusMarker("No marker"), undefined);
});

test("extracts only the final agent message from a completed turn", () => {
	assert.equal(finalAgentMessage({
		turn: {
			items: [
				{ type: "agentMessage", text: "first" },
				{ type: "commandExecution", command: "npm test" },
				{ type: "agentMessage", text: "final" },
			],
		},
	}), "final");
});
