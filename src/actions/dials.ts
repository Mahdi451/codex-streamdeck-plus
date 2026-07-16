import {
	type DialAction,
	type DialDownEvent,
	type DialRotateEvent,
	type DialUpEvent,
	SingletonAction,
	type TouchTapEvent,
	type WillAppearEvent,
} from "@elgato/streamdeck";

import type { DeckController } from "../controller/deck-controller";
import { REASONING_OPTIONS, WORKFLOW_PRESETS } from "../domain";

type DialSettings = Record<string, never>;

async function alertOnError(action: DialAction<DialSettings>, operation: () => Promise<void> | void): Promise<void> {
	try {
		await operation();
	} catch {
		await action.showAlert();
	}
}

abstract class ControllerDial extends SingletonAction<DialSettings> {
	constructor(protected readonly controller: DeckController) {
		super();
		this.controller.on("change", () => void this.refreshAll());
	}

	override async onWillAppear(ev: WillAppearEvent<DialSettings>): Promise<void> {
		if (ev.action.isDial()) await this.render(ev.action);
	}

	async refreshAll(): Promise<void> {
		await Promise.all(this.actions.map(async (visible) => {
			if (visible.isDial()) await this.render(visible);
		}).toArray());
	}

	abstract render(action: DialAction<DialSettings>): Promise<void>;
}

export class AgentDialAction extends ControllerDial {
	override readonly manifestId = "com.mahdi.codex-deck.agent-dial";

	override async onDialRotate(ev: DialRotateEvent<DialSettings>): Promise<void> {
		this.controller.stepSlot(ev.payload.ticks);
		await this.render(ev.action);
	}

	override async onDialDown(ev: DialDownEvent<DialSettings>): Promise<void> {
		await alertOnError(ev.action, () => this.controller.activate(this.controller.selectedSlotNumber, false));
	}

	override async onTouchTap(ev: TouchTapEvent<DialSettings>): Promise<void> {
		if (ev.payload.hold) await alertOnError(ev.action, () => this.controller.runSelected());
	}

	override async render(action: DialAction<DialSettings>): Promise<void> {
		const slot = this.controller.selectedSlot();
		const state = this.controller.selectedState();
		await action.setFeedback({
			title: slot ? `Agent ${slot.slotNumber}` : "Agent",
			value: slot ? `${slot.label} · ${(state?.status || "ready").toUpperCase()}` : "No slot",
			indicator: slot ? Math.round(((slot.slotNumber - 1) * 100) / 5) : 0,
		});
	}
}

export class ReasoningDialAction extends ControllerDial {
	override readonly manifestId = "com.mahdi.codex-deck.reasoning-dial";
	readonly #rotatedWhilePressed = new Set<string>();

	override onDialDown(ev: DialDownEvent<DialSettings>): void {
		this.#rotatedWhilePressed.delete(ev.action.id);
	}

	override async onDialRotate(ev: DialRotateEvent<DialSettings>): Promise<void> {
		if (ev.payload.pressed) this.#rotatedWhilePressed.add(ev.action.id);
		await alertOnError(ev.action, () => ev.payload.pressed
			? this.controller.stepModel(ev.payload.ticks)
			: this.controller.stepReasoning(ev.payload.ticks));
		await this.render(ev.action);
	}

	override async onDialUp(ev: DialUpEvent<DialSettings>): Promise<void> {
		if (!this.#rotatedWhilePressed.delete(ev.action.id)) {
			await alertOnError(ev.action, () => this.controller.resetReasoning());
		}
		await this.render(ev.action);
	}

	override async onTouchTap(ev: TouchTapEvent<DialSettings>): Promise<void> {
		if (ev.payload.hold) await alertOnError(ev.action, () => this.controller.refreshModels());
		await this.render(ev.action);
	}

	override async render(action: DialAction<DialSettings>): Promise<void> {
		const slot = this.controller.selectedSlot();
		const index = Math.max(0, REASONING_OPTIONS.findIndex((option) => option.value === slot?.reasoning));
		const effort = REASONING_OPTIONS[index]?.label || "Medium";
		await action.setFeedback({
			title: `Reasoning · ${this.controller.modelDisplay(slot)}`,
			value: effort,
			indicator: Math.round((index * 100) / (REASONING_OPTIONS.length - 1)),
		});
	}
}

export class WorkflowDialAction extends ControllerDial {
	override readonly manifestId = "com.mahdi.codex-deck.workflow-dial";

	override async onDialRotate(ev: DialRotateEvent<DialSettings>): Promise<void> {
		await alertOnError(ev.action, () => this.controller.stepWorkflow(ev.payload.ticks));
		await this.render(ev.action);
	}

	override async onTouchTap(ev: TouchTapEvent<DialSettings>): Promise<void> {
		if (ev.payload.hold) await alertOnError(ev.action, () => this.controller.runSelected());
	}

	override async render(action: DialAction<DialSettings>): Promise<void> {
		const slot = this.controller.selectedSlot();
		const index = Math.max(0, WORKFLOW_PRESETS.findIndex((preset) => preset.id === slot?.workflowPreset));
		await action.setFeedback({
			title: "Workflow",
			value: WORKFLOW_PRESETS[index]?.label || "Implement",
			indicator: Math.round((index * 100) / (WORKFLOW_PRESETS.length - 1)),
		});
	}
}

export class BackendDialAction extends ControllerDial {
	override readonly manifestId = "com.mahdi.codex-deck.backend-dial";

	override async onDialRotate(ev: DialRotateEvent<DialSettings>): Promise<void> {
		this.controller.stepBackend(ev.payload.ticks);
		await this.render(ev.action);
	}

	override async onDialDown(ev: DialDownEvent<DialSettings>): Promise<void> {
		await alertOnError(ev.action, () => this.controller.reconnectSelected());
		await this.render(ev.action);
	}

	override async onTouchTap(ev: TouchTapEvent<DialSettings>): Promise<void> {
		if (ev.payload.hold) await alertOnError(ev.action, () => this.controller.reconnectSelected());
		await this.render(ev.action);
	}

	override async render(action: DialAction<DialSettings>): Promise<void> {
		const slot = this.controller.selectedSlot();
		const workspace = slot?.workspace.split("/").filter(Boolean).at(-1) || "Configure slot";
		await action.setFeedback({
			title: this.controller.backendDisplay(slot),
			value: workspace.slice(0, 24),
			indicator: this.controller.backends.health(slot?.target ?? { type: "windows" }).state === "connected" ? 100 : 15,
		});
	}
}
