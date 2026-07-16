import type { RpcMessage } from "../src/codex/protocol";
import type { CodexTransport } from "../src/codex/transport";

type Unsubscribe = () => void;

export class FakeTransport implements CodexTransport {
	readonly sent: RpcMessage[] = [];
	readonly #messages = new Set<(message: RpcMessage) => void>();
	readonly #errors = new Set<(error: Error) => void>();
	readonly #stderr = new Set<(line: string) => void>();
	started = false;

	async start(): Promise<void> {
		this.started = true;
	}

	send(message: RpcMessage): void {
		this.sent.push(message);
	}

	async close(): Promise<void> {
		this.started = false;
	}

	onMessage(listener: (message: RpcMessage) => void): Unsubscribe {
		this.#messages.add(listener);
		return () => this.#messages.delete(listener);
	}

	onError(listener: (error: Error) => void): Unsubscribe {
		this.#errors.add(listener);
		return () => this.#errors.delete(listener);
	}

	onStderr(listener: (line: string) => void): Unsubscribe {
		this.#stderr.add(listener);
		return () => this.#stderr.delete(listener);
	}

	emitMessage(message: RpcMessage): void {
		for (const listener of this.#messages) {
			listener(message);
		}
	}

	emitError(error: Error): void {
		for (const listener of this.#errors) listener(error);
	}
}
