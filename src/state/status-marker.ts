import { isRecord } from "../codex/protocol";

export type WorkflowStatus = "working" | "needs_input" | "blocked" | "ready_for_review" | "done" | "failed" | "unknown";
export type VerificationStatus = "not_run" | "running" | "passed" | "failed" | "unknown";

export type StructuredStatus = {
	workflowStatus: WorkflowStatus;
	headline: string;
	verification: VerificationStatus;
	verificationSummary: string;
};

const WORKFLOW = new Set<WorkflowStatus>([
	"working",
	"needs_input",
	"blocked",
	"ready_for_review",
	"done",
	"failed",
	"unknown",
]);
const VERIFICATION = new Set<VerificationStatus>(["not_run", "running", "passed", "failed", "unknown"]);

export function parseStatusMarker(text: string): StructuredStatus | undefined {
	const match = text.match(/<!--\s*codex-deck-status\s*\n([\s\S]{1,2000}?)\n\s*-->/i);
	if (!match?.[1]) return undefined;
	let value: unknown;
	try {
		value = JSON.parse(match[1]);
	} catch {
		return undefined;
	}
	if (!isRecord(value)) return undefined;
	const workflowStatus = typeof value.workflowStatus === "string" && WORKFLOW.has(value.workflowStatus as WorkflowStatus)
		? (value.workflowStatus as WorkflowStatus)
		: "unknown";
	const verification = typeof value.verification === "string" && VERIFICATION.has(value.verification as VerificationStatus)
		? (value.verification as VerificationStatus)
		: "unknown";
	return {
		workflowStatus,
		headline: typeof value.headline === "string" ? value.headline.replace(/[\u0000-\u001F\u007F]/g, " ").slice(0, 80) : "",
		verification,
		verificationSummary: typeof value.verificationSummary === "string"
			? value.verificationSummary.replace(/[\u0000-\u001F\u007F]/g, " ").slice(0, 180)
			: "",
	};
}

export function finalAgentMessage(params: unknown): string | undefined {
	if (!isRecord(params) || !isRecord(params.turn) || !Array.isArray(params.turn.items)) return undefined;
	const messages = params.turn.items.filter((item) => isRecord(item) && item.type === "agentMessage" && typeof item.text === "string");
	const last = messages.at(-1);
	return isRecord(last) && typeof last.text === "string" ? last.text : undefined;
}
