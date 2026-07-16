import streamDeck from "@elgato/streamdeck";

import { AgentSlotAction } from "./actions/agent-slot";
import { ProceedAction, DeclineStopAction } from "./actions/context-keys";
import {
	AgentDialAction,
	BackendDialAction,
	ReasoningDialAction,
	WorkflowDialAction,
} from "./actions/dials";
import { BackendManager, type BackendHealth, type PendingAgentRequest } from "./backends/backend-manager";
import { DeckController } from "./controller/deck-controller";
import { AgentStateStore } from "./state/agent-state";

// App-server payloads can contain prompts, paths, and tool data. Log only bounded health metadata.
streamDeck.logger.setLevel("info");

const backends = new BackendManager();
const states = new AgentStateStore();
const controller = new DeckController(backends, states);

backends.on("health", (health: BackendHealth) => {
	const suffix = health.error ? `: ${health.error}` : "";
	streamDeck.logger.info(`${health.backendId} ${health.state}${suffix}`);
});
backends.on("serverRequest", (request: PendingAgentRequest) => {
	streamDeck.logger.warn(`${request.backendId} requires ${request.kind} input (${request.risk} risk)`);
});

streamDeck.actions.registerAction(new AgentSlotAction(controller));
streamDeck.actions.registerAction(new ProceedAction(controller));
streamDeck.actions.registerAction(new DeclineStopAction(controller));
streamDeck.actions.registerAction(new AgentDialAction(controller));
streamDeck.actions.registerAction(new ReasoningDialAction(controller));
streamDeck.actions.registerAction(new WorkflowDialAction(controller));
streamDeck.actions.registerAction(new BackendDialAction(controller));

await streamDeck.connect();

const shutdown = async (): Promise<void> => {
	await controller.close();
};
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
