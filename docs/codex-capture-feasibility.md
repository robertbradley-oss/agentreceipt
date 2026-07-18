# Codex capture feasibility spike

Status: complete research spike; not a polished adapter

Date: 2026-07-17

## Decision

**Conditional GO** for an AgentReceipt adapter that *wraps and owns* a `codex exec --json` run.

**NO-GO** for claiming complete passive capture of every Codex session. Documented hooks omit hosted tools such as web search, specialized tool paths may opt out, and transcript files are not a stable API. App Server is richer but experimental and is appropriate for sessions an integration owns, not passive observation of an unrelated Codex UI session.

Every receipt must identify its capture surface and state its completeness and limitations. “Complete Codex receipt” is not a supportable v0.1 claim.

## Question tested

Can AgentReceipt use documented Codex interfaces to capture enough trustworthy evidence for a useful, privacy-preserving receipt, and can it say exactly what it did not observe?

The spike evaluated four documented surfaces and recorded one real, harmless run through the strongest stable candidate.

## Documented capture surfaces

### 1. `codex exec --json` — recommended v0.1 surface

The documented [non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode) emits JSONL events on stdout. Its lifecycle includes thread, turn, and item events. Documented item types include agent messages, reasoning, command executions, file changes, MCP calls, web searches, and plan updates.

Strengths:

- A machine-readable stream intended for automation.
- Command lifecycle, completion status, exit code, and token usage are observable.
- The wrapper can select a sandbox and collect independent Git and verification evidence before and after the run.
- The adapter can sanitize each line before persistence.

Limits observed in the spike:

- The sample supplied no event timestamp, command duration, model identifier, or Codex version.
- It supplied no Git base/head/diff binding.
- A command exit code does not establish the semantic claim “tests passed” unless AgentReceipt independently recognizes and records an authorized verification command.
- Commands, outputs, user messages, agent messages, and reasoning can contain secrets or source content.
- A terminated or malformed stream can only produce an explicitly incomplete receipt.

### 2. Hooks — useful but partial for interactive sessions

The documented [Codex hooks](https://learn.chatgpt.com/docs/hooks) include session, prompt, tool, permission, compaction, subagent, and stop events. Tool hooks cover shell commands, unified execution, patches, MCP calls, and other local function tools.

Material limitations:

- Hosted tools such as web search are not covered.
- Specialized tool paths can opt out, so hooks are not a complete enforcement or observation boundary.
- `UserPromptSubmit`, tool inputs/responses, and the final assistant message can expose sensitive content.
- `transcript_path` is explicitly not a stable format and must not be parsed as an adapter API.
- A project hook runs only in a trusted project, and hook configuration itself requires a trust review.

Hooks may later support a receipt labeled `partial`, with exact capabilities listed. They are not the v0.1 completeness anchor.

### 3. App Server — rich future integration, experimental

The documented [Codex App Server](https://learn.chatgpt.com/docs/app-server) exposes thread, turn, item, diff, plan, and hook lifecycle events. Its item model carries richer command, file-change, MCP, collaboration, web-search, image-view, and compaction data.

It is experimental. The integration also owns the App Server session; it is not a documented passive tap into an already-running, unrelated UI session. It is a promising future adapter only if AgentReceipt intentionally becomes the session host.

### 4. OpenTelemetry — observability, not the primary receipt

Codex's opt-in [observability and telemetry configuration](https://learn.chatgpt.com/docs/config-file/config-advanced#observability-and-telemetry) can export structured conversation, API, prompt, tool-decision, and tool-result events. Prompt content is redacted by default unless explicitly enabled.

OTel is useful operational telemetry, but it requires a collector/exporter and does not by itself provide the portable Git, diff, plan, and verification evidence AgentReceipt needs. It should not be the primary v0.1 source.

### Rejected: local transcript parsing

Local Codex history and session files are implementation data, not a stable receipt interface. The documented warning that transcript format may change makes direct parsing unsuitable. The spike inspected local capabilities read-only and did not persist raw local session data.

## Harmless real-session experiment

### Setup

- Codex CLI: `0.145.0-alpha.18`
- Command surface: `codex exec --json`
- Ephemeral session
- Read-only sandbox
- Approval policy: never
- User and project configuration/rules ignored for isolation
- Scenario: request exactly one shell command that prints a fixed marker, then a brief confirmation
- Expected side effects: no file reads, file writes, or requested network access

The stream was sanitized before it touched the fixture. Raw prompts, messages, reasoning, IDs, commands, outputs, and personal paths were not persisted.

Sanitized evidence:

- [`exec-jsonl-safe-marker.jsonl`](./fixtures/codex-capture/exec-jsonl-safe-marker.jsonl)
- [`manifest.json`](./fixtures/codex-capture/manifest.json)

### Expected versus observed

| Evidence | Expected | Observed | Assessment |
| --- | --- | --- | --- |
| Thread lifecycle | Start | `thread.started` | Captured |
| Turn lifecycle | Start and completion | `turn.started`, `turn.completed` | Captured |
| Shell invocations | Exactly one | One command item started and completed | Captured |
| Command result | Successful marker command | `status: completed`, `exit_code: 0` | Captured after redaction |
| File changes | None | No file-change event | Consistent, but absence is not independent proof |
| Network activity | None requested | No web-search/MCP network event | Consistent, but not host-level network proof |
| Token usage | Available if emitted | Input/cache/output totals present | Captured |
| Event timestamps | Desirable | Not present | Missing |
| Command duration | Desirable | Not present | Missing |
| Model/version provenance | Desirable | Not present in stream | CLI version recorded externally; model missing |
| Git base/head/diff | Needed for repository receipt | Not present | Must be collected independently |
| Tests passed | Not applicable | No semantic test evidence | Must be independently verified |

### Evidence conclusion

The JSONL accurately described the visible command lifecycle of this simple run. It did **not** independently prove that no other host activity occurred, and it did not supply enough repository or verification evidence for a complete AgentReceipt by itself.

This experiment therefore demonstrates **useful partial event capture**, not universal or forensically complete capture.

## Privacy and trust findings

- Sanitize in memory before persistence; never write raw streams to a temporary file.
- Drop user prompts, agent messages, and reasoning by default.
- Store command category/status and an optional digest, not raw command text.
- Store output digests and bounded metadata, not command output.
- Store repository-relative file paths only after verifying they remain inside the repository; store diff hashes rather than diff bodies by default.
- Discard raw Codex thread/session/item IDs or replace them with receipt-local identifiers.
- Record CLI version externally because the sampled JSONL did not include it.
- Treat unknown events, parse failures, missing terminal events, adapter crashes, and stream truncation as explicit completeness limitations.
- Collect Git state and verification results directly instead of trusting agent prose.
- Never present a receipt as tamper-proof. It is structured evidence produced by a local process operating within the user's trust boundary.

## Recommendation

Build the next implementation milestone around a narrow `codex exec --json` wrapper:

1. Capture and sanitize the documented JSONL stream in memory.
2. Independently snapshot Git state before and after the run.
3. Independently execute and record authorized verification commands.
4. Emit capability and limitation fields that distinguish observed, independently verified, inferred, and unavailable evidence.
5. Refuse a `complete` label on parse failures, unknown event types, missing terminal events, or unavailable required evidence.

Keep hooks, App Server, and OTel out of that implementation milestone. They deserve separate spikes after the wrapped CLI path produces honest receipts end to end.
