# Codex adapter contract v0.1

Status: feasibility contract; implementation deferred

Capture surface: `codex exec --json`

## Purpose

This contract defines the smallest honest adapter AgentReceipt can build from the feasibility spike. It does not change the current receipt schema or CLI. Those changes belong to the next approved milestone.

## Support boundary

The adapter supports only a Codex non-interactive run that AgentReceipt launches and wraps. It does not claim to capture:

- an unrelated Codex desktop, IDE, or interactive CLI session;
- host activity outside the wrapped process;
- hidden implementation state;
- every specialized or future Codex tool;
- proof that a stated user intent was satisfied.

The source identifier MUST be `codex_exec_jsonl`. The adapter MUST record the Codex CLI version collected from the executable outside the event stream. It SHOULD record the adapter version and operating-system family.

## Input

The adapter consumes newline-delimited JSON from `codex exec --json` as a live stream.

It MUST:

- parse one line at a time;
- sanitize before any persistence or diagnostic logging;
- use documented event and item types only;
- maintain receipt-local identifiers rather than persisting Codex IDs;
- count unknown, malformed, and discarded records;
- detect whether the expected terminal turn event was received.

It MUST NOT parse `transcript_path`, local session JSONL, or undocumented Codex storage.

## Event handling

| Source event/item | Receipt-safe treatment | Default content policy |
| --- | --- | --- |
| `thread.started` | Mark source lifecycle started | Discard source thread ID |
| `turn.started` | Mark turn started | No content |
| `turn.completed` | Mark turn completed; record numeric usage | Keep numeric usage only |
| `turn.failed` / `error` | Record failure category and sanitized code | Discard messages unless allowlisted |
| `command_execution` | Record receipt-local ID, lifecycle, status, exit code | Redact command; discard output; optional hashes only |
| `file_change` | Record validated repository-relative path and change kind | Diff digest only; no diff body |
| `mcp_tool_call` | Record server/tool name, lifecycle, status | Discard arguments/results; optional digests |
| `web_search` | Record occurrence and lifecycle | Discard query/results/URLs by default |
| `plan_update` | Record occurrence and non-content status if present | Discard plan text |
| `agent_message` | Count as discarded | Discard text |
| `reasoning` | Count as discarded | Discard all content |
| Unknown type | Count and add limitation | Persist no raw record |

Started events are provisional. A matching completed event is authoritative for final status. An unmatched started event makes the receipt incomplete.

## Time semantics

If source events lack timestamps, the adapter MAY add `observed_at` using its local clock when it receives each line. It MUST label that value as adapter observation time, not Codex event time.

The adapter MUST NOT invent command duration. It may measure wrapper-local elapsed time if labeled as such.

## Independent evidence

JSONL capture alone is insufficient. The wrapper MUST collect these separately when they are required by a receipt:

### Git

- Repository identity in a privacy-safe form
- Base commit before the run
- Head commit after the run
- Clean/dirty state before and after
- Diff digest or deterministic changed-file summary

All paths MUST be normalized to repository-relative paths and rejected if they escape the repository. Raw diff content is excluded by default.

### Verification

- Exact verification command only when the user has authorized storing it; otherwise a redacted command category/digest
- Wrapper-observed start/end time
- Exit code
- Bounded, sanitized output metadata or digest
- Whether the result was independently executed by AgentReceipt

An agent message saying tests passed MUST NOT become test evidence. A command item with exit code zero may become verification evidence only if the wrapper knows that the command is an authorized verification command and records that classification.

## Completeness model

Every receipt MUST include:

- `capture_surface`: `codex_exec_jsonl`
- `capture_status`: `complete_for_declared_surface`, `partial`, or `failed`
- `observed_capabilities`: an explicit list
- `unavailable_capabilities`: an explicit list
- `limitations`: an explicit list, possibly empty
- counters for parsed, discarded-sensitive, unknown, and malformed records
- terminal-event presence

`complete_for_declared_surface` means only that the documented records delivered by the wrapped JSONL stream were parsed through a normal terminal event and all contract-required independent evidence was collected. It MUST NOT be shortened to or displayed as “complete Codex capture.”

The adapter MUST use `partial` when any of these occur:

- an unknown event or item type appears;
- a line is malformed or cannot be parsed;
- a started item has no terminal event;
- a normal terminal turn event is missing;
- required Git or verification evidence is unavailable;
- sanitization cannot classify a sensitive field safely;
- the process is interrupted or the stream may be truncated.

It MUST use `failed` when the wrapped Codex run fails to start or the adapter cannot produce a structurally valid receipt. A failed run may still contain useful sanitized evidence.

## Minimum limitation statements

Unless stronger independent evidence exists, receipts MUST state that:

- capture is limited to the wrapped Codex process and documented JSONL stream;
- absence of an event is not host-level proof that an action did not occur;
- timestamps added by the adapter are observation times;
- message/reasoning content was intentionally discarded;
- the receipt is local structured evidence, not a tamper-proof audit record.

## Privacy invariants

The default adapter MUST NOT persist:

- user prompts;
- agent messages;
- reasoning content or summaries;
- raw command text or output;
- MCP arguments or results;
- web queries, results, or URLs;
- diff bodies or source content;
- credentials, environment variables, or personal absolute paths;
- raw Codex session, thread, turn, or item IDs.

Changing any default requires a separate, explicit privacy design review and user opt-in.

## Acceptance tests for a later implementation

A future adapter implementation is acceptable only when tests demonstrate:

1. The sanitized fixture produces the expected command lifecycle and usage without retaining sensitive placeholders as real content.
2. Unknown and malformed records force `partial` status without leaking the raw record.
3. A missing terminal event forces `partial` status.
4. Commands and outputs resembling secrets never reach receipt files or diagnostic logs.
5. Paths outside the repository are rejected.
6. Agent prose cannot create verification evidence.
7. Git and verification collection failures appear as limitations.
8. The display language says `complete for declared surface`, never `complete Codex capture`.

## Deferred surfaces

Hooks, App Server, OpenTelemetry, desktop/IDE sessions, schema evolution, and UI presentation are explicitly deferred. Each requires its own scope lock or later milestone.
