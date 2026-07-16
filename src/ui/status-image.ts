import type { RiskLevel } from "../backends/backend-manager";
import { STATUS_COLORS, type AgentState, type AgentStatus } from "../state/agent-state";

const STATUS_LABELS: Record<AgentStatus, string> = {
	unassigned: "UNASSIGNED",
	idle: "IDLE",
	thinking: "RUNNING",
	complete: "COMPLETE",
	"requires-input": "INPUT",
	error: "FAILED",
	offline: "OFFLINE",
};

const RISK_COLORS: Record<RiskLevel, string> = {
	low: "#20C878",
	medium: "#F4A62A",
	high: "#F97316",
	critical: "#EF4444",
	unknown: "#64748B",
};

function escapeXml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&apos;");
}

function statusLabel(state: AgentState | undefined): string {
	if (!state) return "UNASSIGNED";
	if (state.status === "complete" && state.verification === "passed") return "VERIFIED";
	if (state.status === "complete" && state.workflowStatus === "ready_for_review") return "REVIEW";
	if (state.status === "complete" && state.workflowStatus === "done") return "DONE";
	return STATUS_LABELS[state.status];
}

/** Returns an SVG string accepted directly by Stream Deck's setImage API. */
export function renderStatusImage(
	state: AgentState | undefined,
	label: string,
	badge = "WSL",
	selected = false,
	slotNumber?: number,
): string {
	const status = state?.status ?? "unassigned";
	const color = STATUS_COLORS[status];
	const foreground = status === "idle" || status === "requires-input" ? "#111827" : "#F8FAFC";
	const safeLabel = escapeXml(label.slice(0, 18));
	const safeBadge = escapeXml(badge.slice(0, 6));
	const labelText = statusLabel(state);
	const verifyColor = state?.verification === "passed"
		? "#20C878"
		: state?.verification === "failed" ? "#EF4444" : "#64748B";

	return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
  <rect width="144" height="144" rx="24" fill="#090E18"/>
  <rect x="3" y="3" width="138" height="138" rx="21" fill="none" stroke="${selected ? "#10A37F" : "#1E293B"}" stroke-width="${selected ? 6 : 2}"/>
  <rect x="13" y="12" width="42" height="18" rx="9" fill="#172033"/>
  <text x="34" y="25" text-anchor="middle" fill="#CBD5E1" font-family="Arial,sans-serif" font-size="9" font-weight="800">${safeBadge}</text>
  ${slotNumber ? `<text x="126" y="26" text-anchor="end" fill="#64748B" font-family="Arial,sans-serif" font-size="12" font-weight="800">${slotNumber}</text>` : ""}
  <circle cx="72" cy="61" r="27" fill="${color}"/>
  <circle cx="72" cy="61" r="11" fill="#090E18" opacity="0.28"/>
  <circle cx="101" cy="43" r="6" fill="${verifyColor}"/>
  <text x="72" y="103" text-anchor="middle" fill="#F8FAFC" font-family="Arial,sans-serif" font-size="15" font-weight="700">${safeLabel}</text>
  <rect x="27" y="113" width="90" height="20" rx="10" fill="${color}"/>
  <text x="72" y="127" text-anchor="middle" fill="${foreground}" font-family="Arial,sans-serif" font-size="9" font-weight="800">${labelText}</text>
</svg>`;
}

export function renderCommandImage(
	title: string,
	detail: string,
	color: string,
	badge?: string,
	risk?: RiskLevel,
): string {
	const safeTitle = escapeXml(title.slice(0, 14));
	const safeDetail = escapeXml(detail.replace(/\s+/g, " ").slice(0, 28));
	const safeBadge = escapeXml((badge || "CODEX").slice(0, 8));
	const riskChip = risk
		? `<rect x="84" y="13" width="46" height="18" rx="9" fill="${RISK_COLORS[risk]}"/><text x="107" y="26" text-anchor="middle" fill="#0B1020" font-family="Arial,sans-serif" font-size="8" font-weight="900">${risk.toUpperCase()}</text>`
		: "";
	return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
  <rect width="144" height="144" rx="24" fill="#090E18"/>
  <rect x="4" y="4" width="136" height="136" rx="20" fill="none" stroke="${color}" stroke-width="4"/>
  <rect x="14" y="13" width="56" height="18" rx="9" fill="#172033"/>
  <text x="42" y="26" text-anchor="middle" fill="#CBD5E1" font-family="Arial,sans-serif" font-size="8" font-weight="800">${safeBadge}</text>
  ${riskChip}
  <circle cx="72" cy="65" r="27" fill="${color}" opacity="0.95"/>
  <text x="72" y="70" text-anchor="middle" fill="#08111F" font-family="Arial,sans-serif" font-size="14" font-weight="900">${safeTitle}</text>
  <text x="72" y="108" text-anchor="middle" fill="#F8FAFC" font-family="Arial,sans-serif" font-size="10" font-weight="700">${safeDetail}</text>
  <text x="72" y="128" text-anchor="middle" fill="#64748B" font-family="Arial,sans-serif" font-size="8" font-weight="700">HOLD WHEN PROMPTED</text>
</svg>`;
}
