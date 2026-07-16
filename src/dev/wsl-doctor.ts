import { WslService } from "../backends/wsl";
import { CodexAppServerClient } from "../codex/client";

if (process.platform !== "win32") {
	throw new Error("The WSL doctor must run from native Windows PowerShell, not from inside WSL");
}

const service = new WslService();
const distributions = await service.distributions();
if (!distributions.length) throw new Error("No WSL distributions were found");

const requested = process.argv[2]?.trim();
const distribution = requested || distributions[0]!;
if (!distributions.includes(distribution)) {
	throw new Error(`Distribution ${distribution} was not found. Installed: ${distributions.join(", ")}`);
}

console.log(`Installed WSL distributions: ${distributions.join(", ")}`);
console.log(`Testing distribution: ${distribution}`);
console.log(`Codex executable: ${await service.resolveCodex(distribution)}`);

const client = new CodexAppServerClient(await service.createTransport(distribution), {
	clientName: "codex_stream_deck_doctor",
	clientTitle: "Codex Deck Doctor",
	clientVersion: "0.2.0",
	experimentalApi: true,
});

try {
	await client.connect();
	const models = await client.listModels();
	console.log(`App-server handshake: OK`);
	console.log(`Visible model count: ${models.length}`);
	console.log("WSL Codex Deck preflight passed.");
} finally {
	await client.close();
}
