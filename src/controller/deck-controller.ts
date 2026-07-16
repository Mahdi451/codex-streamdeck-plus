import { EventEmitter } from "node:events";

import type { KeyAction } from "@elgato/streamdeck";

import {
	BackendManager,
	type BackendHealth,
	type BackendNotificationEvent,
	type PendingAgentRequest,
} from "../backends/backend-manager";
import type { CodexModel } from "../codex/client";
import {
	backendBadge,
	backendId,
	buildAgentPrompt,
	normalizeSlotSettings,
	REASONING_OPTIONS,
	type AgentSlotSettings,
	type NormalizedAgentSlot,
	WORKFLOW_PRESETS,
} from "../domain";
import { AgentStateStore, type AgentState } from "../state/agent-state";

type SlotRegistration = {
	action: KeyAction<AgentSlotSettings>;
	raw: AgentSlotSettings;
	slot: NormalizedAgentSlot;
};

function wrapIndex(current: number, ticks: number, length: number): number {
	if (!length) return 0;
	return ((current + ticks) % length + length) % length;
}

function modelLabel(model: CodexModel): string {
	return (model.displayName || model.id).replace(/^gpt-/i, "").slice(0, 22);
}

export class DeckController extends EventEmitter {
	readonly #registrations = new Map<number, SlotRegistration>();
	readonly #actionSlots = new Map<string, number>();
	readonly #models = new Map<string, CodexModel[]>();
	#selectedSlot = 1;

	constructor(
		readonly backends: BackendManager,
		readonly states: AgentStateStore,
	) {
		super();
		this.states.on("change", () => this.emit("change"));
		this.backends.on("notification", (event: BackendNotificationEvent) => {
			this.states.applyNotification(event.notification, event.backendId);
		});
		this.backends.on("serverRequest", (request: PendingAgentRequest) => {
			this.states.applyPending(request);
		});
		this.backends.on("pendingInvalidated", (request: PendingAgentRequest) => {
			this.states.invalidatePending(request);
		});
		this.backends.on("health", (health: BackendHealth) => this.#applyHealth(health));
		this.backends.on("pendingChanged", () => this.emit("change"));
	}

	get selectedSlotNumber(): number {
		return this.#selectedSlot;
	}

	register(action: KeyAction<AgentSlotSettings>, settings: AgentSlotSettings, fallbackSlot?: number): NormalizedAgentSlot {
		const previous = this.#actionSlots.get(action.id);
		if (previous) this.#registrations.delete(previous);
		const raw = { ...settings };
		const parsedSlot = typeof raw.slotNumber === "number"
			? raw.slotNumber
			: Number.parseInt(String(raw.slotNumber ?? ""), 10);
		if (Number.isInteger(parsedSlot)) raw.slotNumber = parsedSlot;
		else if (fallbackSlot) raw.slotNumber = fallbackSlot;
		let slot = normalizeSlotSettings(raw);
		if (raw.threadId?.trim() && !slot.threadId) {
			delete raw.threadId;
			delete raw.threadBackendId;
			slot = normalizeSlotSettings(raw);
			void action.setSettings(raw).catch(() => undefined);
		}
		this.#actionSlots.set(action.id, slot.slotNumber);
		this.#registrations.set(slot.slotNumber, { action, raw, slot });
		this.emit("change");
		return slot;
	}

	unregister(actionId: string): void {
		const slotNumber = this.#actionSlots.get(actionId);
		if (slotNumber) this.#registrations.delete(slotNumber);
		this.#actionSlots.delete(actionId);
		this.emit("change");
	}

	slot(number: number): NormalizedAgentSlot | undefined {
		return this.#registrations.get(number)?.slot;
	}

	slotForAction(actionId: string): NormalizedAgentSlot | undefined {
		const slotNumber = this.#actionSlots.get(actionId);
		return slotNumber ? this.slot(slotNumber) : undefined;
	}

	selectedSlot(): NormalizedAgentSlot | undefined {
		return this.slot(this.#selectedSlot);
	}

	stateFor(slot: NormalizedAgentSlot): AgentState | undefined {
		return slot.threadId ? this.states.get(slot.threadId, backendId(slot.target)) : undefined;
	}

	selectedState(): AgentState | undefined {
		const slot = this.selectedSlot();
		return slot ? this.stateFor(slot) : undefined;
	}

	select(number: number): void {
		this.#selectedSlot = Math.max(1, Math.min(6, number));
		const state = this.selectedState();
		const slot = this.selectedSlot();
		if (slot?.threadId && state?.unread) this.states.markRead(slot.threadId, backendId(slot.target));
		this.emit("change");
	}

	stepSlot(ticks: number): void {
		const available = [...this.#registrations.keys()].sort((left, right) => left - right);
		if (!available.length) return;
		const current = Math.max(0, available.indexOf(this.#selectedSlot));
		this.select(available[wrapIndex(current, ticks, available.length)]!);
	}

	async activate(slotNumber: number, runPrompt: boolean): Promise<void> {
		this.select(slotNumber);
		const registration = this.#registrations.get(slotNumber);
		if (!registration || !runPrompt) return;
		await this.#run(registration);
	}

	async runSelected(): Promise<void> {
		const registration = this.#registrations.get(this.#selectedSlot);
		if (!registration) throw new Error("No agent slot is selected");
		await this.#run(registration);
	}

	async proceed(confirmed: boolean): Promise<void> {
		const slot = this.selectedSlot();
		if (!slot) throw new Error("No agent slot is selected");
		const pending = this.backends.pendingFor(slot.target, slot.threadId);
		if (pending) {
			if (!confirmed) throw new Error(`Hold to approve ${pending.risk.toUpperCase()} request`);
			await this.backends.respond(pending, true);
			this.states.resolvePending(pending);
			return;
		}
		await this.runSelected();
	}

	async declineOrStop(confirmed: boolean): Promise<void> {
		if (!confirmed) throw new Error("Hold to decline or stop");
		const slot = this.selectedSlot();
		if (!slot) throw new Error("No agent slot is selected");
		const pending = this.backends.pendingFor(slot.target, slot.threadId);
		if (pending) {
			await this.backends.respond(pending, false);
			this.states.resolvePending(pending);
			return;
		}
		const state = this.stateFor(slot);
		if (!state?.turnId || state.status !== "thinking") throw new Error("The selected agent has no active turn");
		await this.backends.interrupt(slot, state.turnId);
	}

	async stepReasoning(ticks: number): Promise<void> {
		const registration = this.#selectedRegistration();
		const options = this.#reasoningOptions(registration.slot);
		const current = Math.max(0, options.findIndex((option) => option.value === registration.slot.reasoning));
		await this.#updateSelected({ reasoning: options[wrapIndex(current, ticks, options.length)]!.value });
	}

	async resetReasoning(): Promise<void> {
		await this.#updateSelected({ reasoning: "high" });
	}

	async stepModel(ticks: number): Promise<void> {
		const registration = this.#selectedRegistration();
		const models = await this.#loadModels(registration.slot);
		if (!models.length) throw new Error("Codex returned no selectable models");
		const current = Math.max(0, models.findIndex((model) => model.id === registration.slot.model));
		const selected = models[wrapIndex(current, ticks, models.length)]!;
		const supported = selected.supportedReasoningEfforts?.map((item) => item.reasoningEffort).filter(Boolean) ?? [];
		const reasoning = supported.length && !supported.includes(registration.slot.reasoning)
			? (selected.defaultReasoningEffort ?? registration.slot.reasoning)
			: registration.slot.reasoning;
		await this.#updateSelected({ model: selected.id, reasoning: reasoning as AgentSlotSettings["reasoning"] });
	}

	async refreshModels(): Promise<void> {
		const slot = this.#selectedRegistration().slot;
		this.#models.delete(backendId(slot.target));
		await this.#loadModels(slot);
		this.emit("change");
	}

	async stepWorkflow(ticks: number): Promise<void> {
		const registration = this.#selectedRegistration();
		const current = Math.max(0, WORKFLOW_PRESETS.findIndex((preset) => preset.id === registration.slot.workflowPreset));
		await this.#updateSelected({ workflowPreset: WORKFLOW_PRESETS[wrapIndex(current, ticks, WORKFLOW_PRESETS.length)]!.id });
	}

	stepBackend(ticks: number): void {
		const byBackend = new Map<string, number>();
		for (const [number, registration] of this.#registrations) {
			if (!byBackend.has(backendId(registration.slot.target))) byBackend.set(backendId(registration.slot.target), number);
		}
		const slots = [...byBackend.values()];
		if (!slots.length) return;
		const currentBackend = this.selectedSlot() ? backendId(this.selectedSlot()!.target) : "";
		const ids = [...byBackend.keys()];
		const current = Math.max(0, ids.indexOf(currentBackend));
		this.select(slots[wrapIndex(current, ticks, slots.length)]!);
	}

	async reconnectSelected(): Promise<void> {
		const slot = this.#selectedRegistration().slot;
		await this.backends.reconnect(slot.target);
	}

	modelDisplay(slot = this.selectedSlot()): string {
		if (!slot?.model) return "Auto model";
		const model = this.#models.get(backendId(slot.target))?.find((candidate) => candidate.id === slot.model);
		return model ? modelLabel(model) : slot.model.replace(/^gpt-/i, "").slice(0, 22);
	}

	backendDisplay(slot = this.selectedSlot()): string {
		if (!slot) return "No backend";
		const health = this.backends.health(slot.target);
		return `${backendBadge(slot.target)} · ${health.state.toUpperCase()}`;
	}

	proceedLabel(): { title: string; detail: string; risk?: string } {
		const slot = this.selectedSlot();
		if (!slot) return { title: "SELECT", detail: "Choose agent" };
		const pending = this.backends.pendingFor(slot.target, slot.threadId);
		if (pending) return {
			title: pending.canApprove ? "APPROVE" : "OPEN APP",
			detail: pending.summary,
			risk: pending.risk,
		};
		const state = this.stateFor(slot);
		if (state?.status === "complete") return { title: "CONTINUE", detail: state.headline || "Next logical step" };
		return { title: "RUN", detail: slot.prompt || "Continue objective" };
	}

	stopLabel(): { title: string; detail: string } {
		const slot = this.selectedSlot();
		if (!slot) return { title: "STOP", detail: "Choose agent" };
		const pending = this.backends.pendingFor(slot.target, slot.threadId);
		if (pending) return { title: "DECLINE", detail: pending.risk.toUpperCase() };
		return { title: "STOP", detail: this.stateFor(slot)?.status === "thinking" ? "Hold to interrupt" : "No active turn" };
	}

	async close(): Promise<void> {
		await this.backends.close();
	}

	async #run(registration: SlotRegistration): Promise<void> {
		const before = registration.slot;
		const result = await this.backends.startTurn(before, buildAgentPrompt(before));
		if (result.threadId !== before.threadId) {
			await this.#updateRegistration(registration, {
				threadId: result.threadId,
				threadBackendId: backendId(before.target),
			});
		}
		this.states.setStatus(result.threadId, "thinking", {
			workflowStatus: "working",
			verification: "unknown",
			...(result.turnId ? { turnId: result.turnId } : {}),
			unread: false,
		}, backendId(before.target));
	}

	#selectedRegistration(): SlotRegistration {
		const registration = this.#registrations.get(this.#selectedSlot);
		if (!registration) throw new Error("No agent slot is selected");
		return registration;
	}

	async #updateSelected(patch: AgentSlotSettings): Promise<void> {
		const registration = this.#selectedRegistration();
		await this.#updateRegistration(registration, patch);
		await this.backends.applySettings(registration.slot).catch(() => undefined);
	}

	async #updateRegistration(registration: SlotRegistration, patch: AgentSlotSettings): Promise<void> {
		registration.raw = { ...registration.raw, ...patch };
		registration.slot = normalizeSlotSettings(registration.raw);
		this.#registrations.set(registration.slot.slotNumber, registration);
		await registration.action.setSettings(registration.raw);
		this.emit("change");
	}

	async #loadModels(slot: NormalizedAgentSlot): Promise<CodexModel[]> {
		const id = backendId(slot.target);
		const existing = this.#models.get(id);
		if (existing) return existing;
		const models = await this.backends.models(slot.target);
		this.#models.set(id, models);
		return models;
	}

	#reasoningOptions(slot: NormalizedAgentSlot): typeof REASONING_OPTIONS {
		const selected = this.#models.get(backendId(slot.target))?.find((model) => model.id === slot.model);
		const supported = new Set(selected?.supportedReasoningEfforts?.map((item) => item.reasoningEffort).filter(Boolean));
		if (!supported.size) return REASONING_OPTIONS;
		return REASONING_OPTIONS.filter((option) => supported.has(option.value));
	}

	#applyHealth(health: BackendHealth): void {
		for (const registration of this.#registrations.values()) {
			if (backendId(registration.slot.target) !== health.backendId || !registration.slot.threadId) continue;
			if (health.state === "error" || health.state === "offline") {
				this.states.setStatus(registration.slot.threadId, "offline", {
					error: health.error || "Backend offline",
				}, health.backendId);
			} else if (health.state === "connected" && this.states.get(
				registration.slot.threadId,
				health.backendId,
			).status === "offline") {
				this.states.setStatus(registration.slot.threadId, "idle", {
					workflowStatus: "unknown",
					verification: "unknown",
					unread: false,
				}, health.backendId);
			}
		}
		this.emit("change");
	}
}
