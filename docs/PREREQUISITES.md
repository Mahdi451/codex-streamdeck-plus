# Prerequisites and design decisions

## Hardware and roles

- Windows 11 PC: interactive control plane and Stream Deck host.
- Stream Deck+ and USB-C cable.
- M4 Mac mini: optional always-on remote project host.
- Optional external microphone for future voice input.

## Native Windows software

- Windows 11 recommended.
- Stream Deck 7.1 or newer.
- Node.js 24 or newer, npm, and Git for building the native plugin.
- WSL2 and a supported Linux distribution; Ubuntu is the reference target.
- Windows OpenSSH client for the M4 lane.
- ChatGPT desktop app if using official WSL projects or SSH remote connections.

Verify in PowerShell:

```powershell
wsl --version
wsl --status
wsl --list --verbose
node --version
npm --version
ssh -V
```

The selected distribution must report version `2`. WSL1 is not supported by
this design.

## WSL2 software

- `bubblewrap` for Codex's Linux sandbox.
- Current Codex CLI installed and authenticated inside the distribution.
- Git and the language/toolchain dependencies used by local projects.
- Repositories stored under the Linux home directory.

Setup inside WSL:

```bash
sudo apt update
sudo apt install -y bubblewrap git
curl -fsSL https://chatgpt.com/codex/install.sh | sh
codex login
codex login status
codex --version
command -v codex
echo "$WSL_DISTRO_NAME"
```

Create a Linux-native project root:

```bash
mkdir -p ~/code
cd ~/code
```

Avoid `/mnt/c/...` for active repositories when practical. Linux-home storage
has better I/O behavior and fewer symlink and permission mismatches. Windows can
browse these files through `\\wsl$\<distribution>\home\<user>`.

## Separate runtime ownership

Two Node environments may exist and should not be conflated:

| Runtime | Purpose |
| --- | --- |
| Native Windows Node 24 | Builds and runs the Stream Deck plugin. |
| WSL project runtimes | Run repository tests, package managers, and tools invoked by Codex. |

The primary Codex executable is inside WSL. A native Windows Codex installation
is optional and should be treated as a separate backend with separate paths and
possibly separate authentication.

## Windows ChatGPT app setup

For local WSL projects:

1. Open app settings.
2. Switch the Codex agent environment from Windows native to WSL.
3. Restart the app; the change applies after restart.
4. Add projects from `\\wsl$\...`.

This configures the app's own sessions. It does not attach the app to the Stream
Deck plugin's app-server process.

## M4 remote-host software

- Remote Login enabled in macOS.
- Current Codex CLI installed and authenticated as the SSH user.
- `codex` on the user's login-shell `PATH`.
- Git and all project dependencies.
- SSH key authentication from Windows.
- Trusted LAN, VPN, or private overlay network.

Verify from PowerShell:

```powershell
ssh m4-codex 'codex --version && codex login status'
```

The Windows app can use this concrete SSH alias immediately. The Stream Deck
SSH backend remains out of the first WSL implementation slice.

## Authentication and secrets

- Authenticate Codex separately inside WSL and on the M4.
- Keep credentials in Codex's own storage for each environment.
- Keep SSH private keys in the Windows user's SSH configuration.
- Never place API keys, tokens, `auth.json`, or private keys in Stream Deck
  settings, source, slot assignments, or logs.

## Interactive WSL policy

Use `~/.codex/config.toml` inside WSL:

```toml
model_reasoning_effort = "medium"
approval_policy = "on-request"
approvals_reviewer = "user"
sandbox_mode = "workspace-write"
```

## Agentic M4 policy

Use `~/.codex/config.toml` on the M4:

```toml
model_reasoning_effort = "medium"
approval_policy = "on-request"
approvals_reviewer = "auto_review"
sandbox_mode = "workspace-write"
```

Auto-review changes the reviewer for eligible requests, not the sandbox. Each
remote repository should include `AGENTS.md` with setup commands, validation,
constraints, and definition of done.

## Persisted slot contract

Each slot stores:

```text
backend type + distro/host + Linux/remote workspace + thread ID + label
```

For a WSL slot:

- Backend type is `wsl`.
- Distribution exactly matches `wsl.exe --list --quiet` output.
- Workspace is an absolute Linux path.
- Thread ID belongs only to that backend identity.

## Transport requirements

The WSL transport must:

1. Discover distributions without a shell.
2. Locate Codex with one fixed login-shell preflight.
3. Validate the resolved absolute Linux executable path.
4. Launch `wsl.exe` with an argument array and no user-authored shell command.
5. Preserve stdin/stdout JSONL and stderr diagnostics.
6. Perform the app-server handshake exactly once per connection.
7. Associate every event and request with the originating distribution.
8. Reconnect after WSL shutdown and resume persisted thread IDs.

## Accepted MVP decisions

The v0.2 implementation follows these decisions:

- WSL2 is the default local backend.
- Ubuntu is a reference default, but installed distributions remain selectable.
- Repositories use `/home/...` Linux paths.
- One app-server is reused per distribution.
- Local WSL approvals remain human-reviewed.
- M4 policy is documented but is not connected to Stream Deck controls yet.
- No path translation or UI automation.
- M4 Stream Deck control and approval keys are separate later milestones.

## Implemented automated checks

- Parse CRLF output from `wsl.exe --list --quiet`.
- Reject unknown distribution names and malformed Codex paths.
- Verify exact process command and arguments.
- Verify initialize ordering and JSONL framing.
- Verify backend lifecycle, close, and explicit reconnect behavior.
- Prevent a thread ID from crossing backend identities.
- Verify Linux workspace validation.
- Verify normalized status markers and backend-bound approvals.

The Windows doctor, real WSL handshake, and physical Stream Deck interactions
remain target-machine checks because they require the user's installed WSL
distributions, Codex authentication, and Stream Deck hardware.
