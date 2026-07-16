# Stream Deck+ control map

This is the implemented Codex Deck v0.2 MVP surface. It is deliberately built
around six durable agent slots instead of a large collection of prompt macros.

## Home page

| Key 1 | Key 2 | Key 3 | Key 4 |
| --- | --- | --- | --- |
| Agent 1 | Agent 2 | Agent 3 | Agent 4 |
| **Key 5** | **Key 6** | **Key 7** | **Key 8** |
| Agent 5 | Agent 6 | Run / Continue / Approve | Decline / Stop |

| Dial 1 | Dial 2 | Dial 3 | Dial 4 |
| --- | --- | --- | --- |
| Agent | Reasoning / model | Workflow | Backend / health |

All six agent slots are independently configurable. The MVP supports WSL2 as
the primary backend and an optional native Windows Codex CLI backend. The M4
remote lane remains a later adapter and is not implied by a slot number.

## Keys 1–6: Agent Slots

Each key persists a slot number, label, backend, Linux workspace, workflow,
reasoning effort, optional model, reusable prompt, and backend-bound thread ID.

| Gesture | Implemented behavior |
| --- | --- |
| Tap | Select the agent. If **Run prompt on tap** is enabled, also start its turn. |
| Hold for 650 ms | Select the agent and start its configured prompt. |

Configure each key through its Stream Deck Property Inspector. A slot may point
at any validated WSL distribution; it is not hard-coded to Ubuntu.

### Agent key state

| Visual | Meaning |
| --- | --- |
| Dim | Ready or no thread yet. |
| Blue | Codex is working. |
| Green | Codex reported completion. |
| Amber | Approval or user input is pending. |
| Red | Turn error or backend offline. |

The selected slot has a bright border. Each key also shows `WSL`, `WIN`, or the
configured distribution abbreviation, plus a verification dot:

- Green: the agent reported that checks passed.
- Amber: verification is partial or needs review.
- Gray: verification has not been reported.

## Key 7: Run / Continue / Approve

The key changes with the selected agent.

| Context | Label | Gesture |
| --- | --- | --- |
| Ready or idle | `RUN` | Tap to start the configured prompt. |
| Completed | `CONTINUE` | Tap to submit the configured objective again as the next turn. |
| Supported approval pending | `APPROVE` | Hold for 900 ms to approve the previewed request. |
| Request needs richer interaction | `OPEN APP` | Inspect and answer it in the Codex UI; the hardware key fails closed. |

Approval previews show a bounded operation summary, backend badge, and risk
level. Requests are connection-bound, thread-bound, and never matched by an ID
alone. A short tap cannot approve anything.

## Key 8: Decline / Stop

| Context | Gesture |
| --- | --- |
| Request pending | Hold for 900 ms to decline that exact request. |
| Active turn | Hold for 900 ms to send `turn/interrupt` to that exact turn. |
| Idle | No action; the key reports an alert. |

## Dial 1: Agent

| Input | Implemented behavior |
| --- | --- |
| Rotate | Select among visible agent slots. |
| Press | Confirm the current selection. |
| Long touch | Start the selected agent's configured prompt. |

The touch strip displays slot label, status, and selection position.

## Dial 2: Reasoning / Model

| Input | Implemented behavior |
| --- | --- |
| Rotate | Change the selected agent's next-turn reasoning effort. |
| Press and rotate | Change model using the active backend's live `model/list`. |
| Press without rotating | Reset next-turn reasoning to High. |
| Long touch | Refresh the backend's model catalog. |

When a selected model exposes supported reasoning efforts, the wrapper keeps the
setting inside that supported set. These changes never mutate an already-running
turn.

## Dial 3: Workflow

| Input | Implemented behavior |
| --- | --- |
| Rotate | Select `Implement`, `Plan`, `Debug`, `Review`, `Validate`, or `Handoff`. |
| Long touch | Start the selected agent with the displayed workflow. |

Workflows are visible prompt contracts. They do not pretend to be native Codex
modes. Every contract asks the agent to emit a bounded status marker so the deck
can distinguish working, blocked, complete, and verification states.

## Dial 4: Backend / Health

| Input | Implemented behavior |
| --- | --- |
| Rotate | Jump between the first configured slot for each distinct backend. |
| Press | Reconnect the selected backend. |
| Long touch | Reconnect the selected backend. |

The strip displays backend health and the final component of the configured
workspace path. Changing a slot's backend invalidates its old thread binding;
the wrapper never resumes a WSL thread against a different distribution.

## Safety boundaries

The MVP intentionally excludes:

- one-tap blanket approval;
- full-access sandbox switching from hardware;
- one-tap commit, push, publish, PR creation, or message sending;
- arbitrary user text interpolated into a WSL shell command;
- Windows/WSL/macOS path guessing;
- mouse-coordinate or blind keyboard automation of the Codex desktop app;
- remote M4 execution before the local WSL slice is qualified.

## Next page candidates

A future command page can add New Task, Fork, Review Changes, Validate, and
Handoff shortcuts. Git writes and external side effects should remain behind a
target preview and hold-to-confirm interaction.

References:

- https://www.elgato.com/us/en/p/stream-deck-plus
- https://docs.elgato.com/streamdeck/sdk/guides/dials/
- https://learn.chatgpt.com/docs/features/codex-micro
- https://learn.chatgpt.com/docs/app-server
