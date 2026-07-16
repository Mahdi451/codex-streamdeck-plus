import {
	action,
	type DidReceiveSettingsEvent,
	type KeyDownEvent,
	type KeyUpEvent,
	SingletonAction,
	type WillAppearEvent,
	type WillDisappearEvent,
} from "@elgato/streamdeck";

import type { DeckController } from "../controller/deck-controller";
import { backendBadge, type AgentSlotSettings } from "../domain";
import { renderStatusImage } from "../ui/status-image";

const HOLD_MS = 650;

export { type AgentSlotSettings } from "../domain";

export class AgentSlotAction extends SingletonAction<AgentSlotSettings> {
	override readonly manifestId = "com.mahdi.codex-deck.agent-slot";
	readonly #pressedAt = new Map<string, number>();

	constructor(private readonly controller: DeckController) {
		super();
		this.controller.on("change", () => void this.#refreshAll());
	}

	override async onWillAppear(ev: WillAppearEvent<AgentSlotSettings>): Promise<void> {
		if (!ev.action.isKey()) return;
		const coordinates = ev.action.coordinates;
		const fallback = coordinates ? coordinates.row * 4 + coordinates.column + 1 : 1;
		this.controller.register(ev.action, ev.payload.settings, fallback);
		await this.#render(ev.action, ev.payload.settings);
	}

	override async onWillDisappear(ev: WillDisappearEvent<AgentSlotSettings>): Promise<void> {
		this.controller.unregister(ev.action.id);
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<AgentSlotSettings>): Promise<void> {
		if (!ev.action.isKey()) return;
		const coordinates = ev.action.coordinates;
		const fallback = coordinates ? coordinates.row * 4 + coordinates.column + 1 : 1;
		this.controller.register(ev.action, ev.payload.settings, fallback);
		await this.#render(ev.action, ev.payload.settings);
	}

	override onKeyDown(ev: KeyDownEvent<AgentSlotSettings>): void {
		this.#pressedAt.set(ev.action.id, Date.now());
		const slot = this.controller.slotForAction(ev.action.id) ?? this.controller.register(ev.action, ev.payload.settings);
		this.controller.select(slot.slotNumber);
	}

	override async onKeyUp(ev: KeyUpEvent<AgentSlotSettings>): Promise<void> {
		const started = this.#pressedAt.get(ev.action.id) ?? Date.now();
		this.#pressedAt.delete(ev.action.id);
		const slot = this.controller.slotForAction(ev.action.id) ?? this.controller.register(ev.action, ev.payload.settings);
		const held = Date.now() - started >= HOLD_MS;
		try {
			await this.controller.activate(slot.slotNumber, held || slot.runPromptOnTap);
			if (!held && !slot.runPromptOnTap) await ev.action.showOk();
		} catch {
			await ev.action.showAlert();
		}
		await this.#render(ev.action, ev.payload.settings);
	}

	async #refreshAll(): Promise<void> {
		await Promise.all(
			this.actions
				.map(async (visibleAction) => {
					if (!visibleAction.isKey()) return;
					const settings = await visibleAction.getSettings<AgentSlotSettings>();
					await this.#render(visibleAction, settings);
				})
				.toArray(),
		);
	}

	async #render(
		actionInstance: KeyDownEvent<AgentSlotSettings>["action"],
		settings: AgentSlotSettings,
	): Promise<void> {
		const slot = this.controller.slotForAction(actionInstance.id);
		if (!slot) return;
		const state = this.controller.stateFor(slot);
		await actionInstance.setTitle("");
		await actionInstance.setImage(renderStatusImage(
			state,
			slot.label,
			backendBadge(slot.target),
			this.controller.selectedSlotNumber === slot.slotNumber,
			slot.slotNumber,
		));
	}
}
