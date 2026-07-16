import { CodexAppServerClient } from "../codex/client";
import { isRecord, type RpcNotification } from "../codex/protocol";
import { StdioCodexTransport } from "../codex/transport";

const prompt = process.argv.slice(2).join(" ").trim();
if (!prompt) {
	throw new Error('Usage: npm run dev:codex -- "Your prompt"');
}

const transport = new StdioCodexTransport({
	command: process.env.CODEX_BIN,
});
const client = new CodexAppServerClient(transport);

client.on("stderr", (line: string) => console.error(`[codex] ${line}`));
client.on("transportError", (error: Error) => console.error(error.message));
client.on("serverRequest", (request) => {
	console.error(`Codex requires input: ${request.method} (request ${request.id})`);
	console.error("The starter intentionally does not auto-approve server requests.");
});

function notificationThreadId(notification: RpcNotification): string | undefined {
	if (!isRecord(notification.params)) {
		return undefined;
	}
	if (typeof notification.params.threadId === "string") {
		return notification.params.threadId;
	}
	if (isRecord(notification.params.turn) && typeof notification.params.turn.threadId === "string") {
		return notification.params.turn.threadId;
	}
	return undefined;
}

function agentDelta(notification: RpcNotification): string | undefined {
	if (notification.method !== "item/agentMessage/delta" || !isRecord(notification.params)) {
		return undefined;
	}
	return typeof notification.params.delta === "string" ? notification.params.delta : undefined;
}

await client.connect();
const threadId = await client.startThread();
console.error(`Started Codex thread ${threadId}`);

const completion = new Promise<void>((resolve, reject) => {
	const timeout = setTimeout(() => reject(new Error("Timed out waiting for the Codex turn")), 30 * 60_000);
	timeout.unref();

	client.on("notification", (notification: RpcNotification) => {
		const delta = agentDelta(notification);
		if (delta) {
			process.stdout.write(delta);
		}

		if (notificationThreadId(notification) !== threadId) {
			return;
		}
		if (notification.method === "turn/completed") {
			clearTimeout(timeout);
			resolve();
		}
		if (notification.method === "turn/failed") {
			clearTimeout(timeout);
			reject(new Error("Codex turn failed"));
		}
	});
});

await client.startTurn({
	threadId,
	prompt,
	cwd: process.env.CODEX_DECK_CWD ?? process.cwd(),
});

try {
	await completion;
	process.stdout.write("\n");
} finally {
	await client.close();
}
