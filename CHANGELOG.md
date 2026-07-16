# Changelog

## 0.2.0 — WSL2-first Stream Deck+ MVP

- Added shell-free WSL distribution discovery, Codex preflight, and app-server transport.
- Added one backend connection per WSL distribution and optional native Windows fallback.
- Added six persistent backend-bound Agent Slots.
- Added Proceed/Approve and hold-to-confirm Decline/Stop actions.
- Added Agent, Reasoning/Model, Workflow, and Backend encoder actions with touch feedback.
- Added live model discovery and per-agent model/reasoning/workflow settings.
- Added verification-aware structured completion status.
- Added connection-bound approval routing, risk classification, and fail-closed permission handling.
- Critical-risk requests now require the full Codex interface, and approvals are invalidated on reconnect.
- Final structured status is recovered from streamed agent messages when turn completion omits item history.
- Added WSL doctor, expanded unit coverage, physical test guide, and packaged-plugin workflow.
- Added project mockups, an exact control-surface visual, and automated Markdown/Mermaid validation.

## 0.1.0 — Starter

- Added Codex app-server stdio transport and initialization handshake.
- Added one configurable Agent Slot with dynamic status artwork.
- Added initial lifecycle and transport tests.
