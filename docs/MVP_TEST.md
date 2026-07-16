# Codex Deck 0.2 MVP physical test

This procedure validates the Windows → Stream Deck+ → WSL2 → Codex path before
testing a real coding task.

## 1. Verify WSL and Codex

Run in native Windows PowerShell:

```powershell
wsl --list --verbose
npm run doctor:wsl -- Ubuntu
```

Expected result:

- The selected distribution is listed as WSL version 2.
- Codex resolves to one absolute Linux path.
- App-server handshake reports `OK`.
- The doctor prints a non-error model count.

If the doctor reports an authentication problem, enter the distribution and run:

```powershell
wsl --distribution Ubuntu
codex login
codex login status
```

## 2. Build and install

From the `codex-deck` directory in native Windows PowerShell:

```powershell
npm ci
npm run check
npm run pack
```

Double-click the generated `.streamDeckPlugin` package and approve installation.
Restart Stream Deck if **Codex Deck** does not appear in the action list.

For development, use:

```powershell
npx streamdeck link com.mahdi.codex-deck.sdPlugin
npm run watch
```

## 3. Build the profile

Create a Stream Deck+ profile named `Codex Deck MVP` and place:

```text
Top keys:    Agent Slot ×4
Bottom keys: Agent Slot ×2, Proceed / Approve, Decline / Stop
Dials:       Agent Selector, Reasoning / Model, Workflow Preset, Backend / Workspace
```

Configure the six Agent Slot actions with unique slot numbers. For the first
test, configure only Agent 1:

```text
Slot:          Agent 1
Label:         Smoke Test
Backend:       WSL2
WSL distro:    Ubuntu
Workspace:     /home/<your-user>/code/<a-disposable-repo>
Workflow:      Plan only
Reasoning:     Medium
Prompt:        Inspect this repository and propose three safe improvements.
Run on tap:    Off
```

Use a disposable Git repository for the first physical test.

## 4. Validate interaction without starting work

1. Tap Agent 1. It should gain a green selection outline without starting a turn.
2. Rotate Dial 1. Selection should move among configured slots.
3. Rotate Dial 3. The touch strip should cycle workflow names.
4. Rotate Dial 4. The strip should show the selected backend and workspace.
5. Push Dial 4. The backend should transition through connecting to connected.

An unconfigured agent remains dark. A backend failure becomes red/offline.

## 5. Start the first safe turn

1. Return Dial 3 to `Plan`.
2. Hold Agent 1 for approximately one second.
3. The key should turn blue and show `RUNNING`.
4. When Codex finishes, the key should turn green with an unread result.
5. Tap Agent 1 to acknowledge the result.

The first run stores both the Codex thread ID and `wsl:Ubuntu` backend identity
in the action settings.

## 6. Validate reasoning and model controls

1. Rotate Dial 2 to change reasoning effort for Agent 1.
2. Click Dial 2 to reset effort to High.
3. Hold Dial 2 while rotating to cycle the live model catalog.
4. Long-touch its strip segment to refresh the model list.

Reasoning values unsupported by the selected model are filtered after the live
catalog has been loaded.

## 7. Validate stop behavior

Start a harmless longer prompt such as a repository summary, then:

1. Quick-press Decline / Stop. It should show an alert and do nothing.
2. Hold Decline / Stop. The plugin should interrupt only the selected
   plugin-owned turn.

## 8. Validate approvals in a disposable repository

Change Agent 1 to the `Implement` preset and use a task likely to request one
ordinary file edit.

When an approval appears:

1. Agent 1 and Proceed should turn amber.
2. Proceed should show the backend and risk category.
3. Quick-press Proceed; it must not approve.
4. Hold Proceed to accept a supported command/file approval.
5. For a second request, hold Decline / Stop to reject it.

Permission broadening, MCP forms, and free-form user questions cannot be
approved from the MVP deck. Open the normal Codex interface for those.

## 9. Record the qualification result

Capture:

- Windows and Stream Deck software versions.
- WSL distribution and Codex CLI version.
- Whether each key and dial behaved as documented.
- Any key image that remained stale.
- The method name—not the payload—of an unhandled server request.

Do not include credentials, full prompts, repository contents, device serials,
or private workspace paths in a public issue.

## Known MVP limitations

- No automatic profile installation.
- No deep link into the WSL-owned thread.
- No shared live control of a task already open in the Windows Codex app.
- No M4/SSH Stream Deck backend yet.
- No rich question-answer UI on the touch strip.
- Physical hardware and Windows WSL behavior must be qualified on the target PC;
  container tests cannot replace that pass.
