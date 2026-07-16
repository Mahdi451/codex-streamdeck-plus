import {
	action,
	type KeyDownEvent,
	type KeyUpEvent,
	SingletonAction,
	type WillAppearEvent,
} from "@elgato/streamdeck";

import type { DeckController } from "../controller/deck-controller";
import { backendBadge } from "../domain";
import { renderCommandImage } from "../ui/status-image";

type ContextSettings = Record<string, never>;
const HOLD_MS = 900;

export class ProceedAction extends SingletonAction<ContextSettings> {
	override readonly manifestId = "com.mahdi.codex-deck.proceed";
	readonly #pressedAt = new Map<string, number>();

	constructor(private readonly controller: DeckController) {
		super();
		this.controller.on("change", () => void this.#refreshAll());
	}

	override async onWillAppear(ev: WillAppearEvent<ContextSettings>): Promise<void> {
		if (ev.action.isKey()) await this.#render(ev.action);
	}

	override onKeyDown(ev: KeyDownEvent<ContextSettings>): void {
		this.#pressedAt.set(ev.action.id, Date.now());
	}

	override async onKeyUp(ev: KeyUpEvent<ContextSettings>): Promise<void> {
		const held = Date.now() - (this.#pressedAt.get(ev.action.id) ?? Date.now()) >= HOLD_MS;
		this.#pressedAt.delete(ev.action.id);
		try {
			await this.controller.proceed(held);
			await ev.action.showOk();
		} catch {
			await ev.action.showAlert();
		}
		await this.#render(ev.action);
	}

	async #refreshAll(): Promise<void> {
		await Promise.all(this.actions.map(async (visible) => {
			if (visible.isKey()) await this.#render(visible);
		}).toArray());
	}

	async #render(actionInstance: KeyDownEvent<ContextSettings>["action"]): Promise<void> {
		const label = this.controller.proceedLabel();
		const slot = this.controller.selectedSlot();
		const color = label.title === "APPROVE" ? "#20C878" : label.title === "OPEN APP" ? "#F4A62A" : "#8B5CF6";
		await actionInstance.setTitle("");
		await actionInstance.setImage(renderCommandImage(
			label.title,
			label.detail,
			color,
			slot ? backendBadge(slot.target) : "CODEX",
			label.risk as Parameters<typeof renderCommandImage>[4],
		));
	}
}

export class DeclineStopAction extends SingletonAction<ContextSettings> {
	override readonly manifestId = "com.mahdi.codex-deck.decline-stop";
	readonly #pressedAt = new Map<string, number>();

	constructor(private readonly controller: DeckController) {
		super();
		this.controller.on("change", () => void this.#refreshAll());
	}

	override async onWillAppear(ev: WillAppearEvent<ContextSettings>): Promise<void> {
		if (ev.action.isKey()) await this.#render(ev.action);
	}

	override onKeyDown(ev: KeyDownEvent<ContextSettings>): void {
		this.#pressedAt.set(ev.action.id, Date.now());
	}

	override async onKeyUp(ev: KeyUpEvent<ContextSettings>): Promise<void> {
		const held = Date.now() - (this.#pressedAt.get(ev.action.id) ?? Date.now()) >= HOLD_MS;
		this.#pressedAt.delete(ev.action.id);
		try {
			await this.controller.declineOrStop(held);
			await ev.action.showOk();
		} catch {
			await ev.action.showAlert();
		}
		await this.#render(ev.action);
	}

	async #refreshAll(): Promise<void> {
		await Promise.all(this.actions.map(async (visible) => {
			if (visible.isKey()) await this.#render(visible);
		}).toArray());
	}

	async #render(actionInstance: KeyDownEvent<ContextSettings>["action"]): Promise<void> {
		const label = this.controller.stopLabel();
		const slot = this.controller.selectedSlot();
		await actionInstance.setTitle("");
		await actionInstance.setImage(renderCommandImage(
			label.title,
			label.detail,
			"#EF4444",
			slot ? backendBadge(slot.target) : "CODEX",
		));
	}
}
