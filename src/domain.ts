export type BackendTarget =
	| { type: "wsl"; distribution: string }
	| { type: "windows" };

export type BackendType = BackendTarget["type"];

export type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra";

export const REASONING_OPTIONS: ReadonlyArray<{ value: ReasoningEffort; label: string }> = [
	{ value: "none", label: "None" },
	{ value: "low", label: "Light" },
	{ value: "medium", label: "Medium" },
	{ value: "high", label: "High" },
	{ value: "xhigh", label: "Extra High" },
	{ value: "max", label: "Max" },
	{ value: "ultra", label: "Ultra" },
];

export type WorkflowPresetId = "implement" | "plan" | "debug" | "review" | "test" | "handoff";

export type WorkflowPreset = {
	id: WorkflowPresetId;
	label: string;
	instruction: string;
	readOnly: boolean;
};

export const WORKFLOW_PRESETS: ReadonlyArray<WorkflowPreset> = [
	{
		id: "implement",
		label: "Implement",
		instruction: "Implement the next useful step, follow repository guidance, and verify the result proportionally.",
		readOnly: false,
	},
	{
		id: "plan",
		label: "Plan",
		instruction: "Inspect the project and produce or update a concrete implementation plan. Do not edit project files.",
		readOnly: true,
	},
	{
		id: "debug",
		label: "Debug",
		instruction: "Reproduce and isolate the problem before editing, then implement and verify the narrowest correct fix.",
		readOnly: false,
	},
	{
		id: "review",
		label: "Review",
		instruction: "Review the current project changes for correctness, regressions, security, and missing verification. Do not edit files.",
		readOnly: true,
	},
	{
		id: "test",
		label: "Validate",
		instruction: "Run the repository's documented validation workflow and explain any failures. Do not modify source files.",
		readOnly: true,
	},
	{
		id: "handoff",
		label: "Handoff",
		instruction: "Summarize the objective, completed work, verification, blockers, and exact next steps. Do not edit files.",
		readOnly: true,
	},
];

export type AgentSlotSettings = {
	slotNumber?: number;
	label?: string;
	backendType?: BackendType;
	distribution?: string;
	workspace?: string;
	threadId?: string;
	threadBackendId?: string;
	prompt?: string;
	model?: string;
	reasoning?: ReasoningEffort;
	workflowPreset?: WorkflowPresetId;
	runPromptOnTap?: boolean;
};

export type NormalizedAgentSlot = {
	slotNumber: number;
	label: string;
	target: BackendTarget;
	workspace: string;
	threadId?: string;
	threadBackendId?: string;
	prompt: string;
	model?: string;
	reasoning: ReasoningEffort;
	workflowPreset: WorkflowPresetId;
	runPromptOnTap: boolean;
};

export function backendId(target: BackendTarget): string {
	return target.type === "wsl" ? `wsl:${target.distribution}` : "windows";
}

export function backendBadge(target: BackendTarget): string {
	if (target.type === "windows") return "WIN";
	const compact = target.distribution.replace(/[^A-Za-z0-9]/g, "").slice(0, 5).toUpperCase();
	return compact || "WSL";
}

export function isAbsoluteLinuxPath(value: string): boolean {
	return value.startsWith("/") && !value.includes("\0") && !/[\r\n]/.test(value);
}

export function normalizeSlotSettings(settings: AgentSlotSettings): NormalizedAgentSlot {
	const parsedSlot = typeof settings.slotNumber === "number"
		? settings.slotNumber
		: Number.parseInt(String(settings.slotNumber ?? ""), 10);
	const slotNumber = Number.isInteger(parsedSlot) ? Math.max(1, Math.min(6, parsedSlot)) : 1;
	const backendType = settings.backendType === "windows" ? "windows" : "wsl";
	const distribution = (settings.distribution?.trim() || "Ubuntu").slice(0, 128);
	const target: BackendTarget = backendType === "windows" ? { type: "windows" } : { type: "wsl", distribution };
	const reasoning = REASONING_OPTIONS.some((option) => option.value === settings.reasoning)
		? (settings.reasoning as ReasoningEffort)
		: "medium";
	const workflowPreset = WORKFLOW_PRESETS.some((preset) => preset.id === settings.workflowPreset)
		? (settings.workflowPreset as WorkflowPresetId)
		: "implement";
	const targetId = backendId(target);
	const persistedThread = settings.threadId?.trim() && settings.threadBackendId === targetId
		? settings.threadId.trim().slice(0, 200)
		: undefined;
	return {
		slotNumber,
		label: (settings.label?.trim() || `Agent ${slotNumber}`).slice(0, 32),
		target,
		workspace: (settings.workspace?.trim() || "").slice(0, 32_768),
		...(persistedThread ? { threadId: persistedThread, threadBackendId: targetId } : {}),
		prompt: (settings.prompt?.trim() || "").slice(0, 16_000),
		...(settings.model?.trim() ? { model: settings.model.trim().slice(0, 200) } : {}),
		reasoning,
		workflowPreset,
		runPromptOnTap: settings.runPromptOnTap === true,
	};
}

export function workflowPreset(id: WorkflowPresetId): WorkflowPreset {
	return WORKFLOW_PRESETS.find((preset) => preset.id === id) ?? WORKFLOW_PRESETS[0]!;
}

export const STATUS_MARKER_INSTRUCTION = `At the end of your final response, append this marker with truthful compact JSON values:
<!-- codex-deck-status
{"workflowStatus":"done","headline":"Short status","verification":"not_run","verificationSummary":"What was or was not checked"}
-->
workflowStatus must be working, needs_input, blocked, ready_for_review, done, or failed. verification must be not_run, running, passed, failed, or unknown. Do not claim passed unless checks actually ran.`;

export function buildAgentPrompt(slot: NormalizedAgentSlot, explicitPrompt?: string): string {
	const requested = explicitPrompt?.trim() || slot.prompt || "Continue with the next logical step toward the current objective.";
	return `${requested}\n\nWorkflow preset: ${workflowPreset(slot.workflowPreset).instruction}\n\n${STATUS_MARKER_INSTRUCTION}`;
}
