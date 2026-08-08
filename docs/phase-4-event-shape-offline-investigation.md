# Phase 4 Offline Event-Shape Safety Investigation

Status: Completed on 2026-07-23. The available local documentation and inert synthetic evidence do not support a safe production grammar change.

## Question

Can the live diagnostic categories `allowlisted_command_embedded` and `unsupported_item` be handled safely and deterministically without weakening AgentReceipt's strict read-only recipe boundary?

## Evidence boundary

This investigation used only:

- the installed `@openai/codex` README;
- native `codex exec --help`;
- `docs/codex-adapter-contract-v0.1.md`;
- the two existing sanitized JSONL fixtures;
- the current adapter and private-projection behavior; and
- inert synthetic JSONL records in `packages/codex-adapter/test/event-shape-offline-investigation.test.mjs`.

The installed README describes Codex CLI and points to online documentation, but it does not define JSONL event semantics. The links were not followed. Native help documents that `--json` prints events as JSONL, but it does not define a structured executable/argument representation, a command-envelope grammar, or item-level replay semantics. The checked-in adapter contract treats `command_execution.command` as sensitive raw text and documents `file_change`, `mcp_tool_call`, `web_search`, and `plan_update` as distinct categories with materially different effects. The checked-in read-only fixture contains only an exact direct `git hash-object --no-filters input.txt` command.

No web request, model invocation, live capture, AgentReceipt CLI action, authentication inspection, raw live-event inspection, command execution from the synthetic matrix, replay, or external mutation occurred.

## Synthetic observations

The direct allowlisted command remained the only eligible control and produced one action.

Six benign-looking command envelopes—including common shell launchers, quoting, and prefix or suffix text—and six executable near misses—including chaining, pipe, redirection, substitution, and newline forms—produced the identical result:

- command shape `allowlisted_command_embedded`;
- reasons `allowlisted_command_embedded` and `no_action`;
- zero actions; and
- structural ineligibility.

The available command string and enum therefore do not distinguish a harmless-looking envelope from additional executable behavior. Accepting the category or extracting the allowlisted substring generically would also accept tested injection-shaped material.

Message and reasoning items remained ignored controls and did not make an otherwise direct command ineligible. In contrast, the documented `file_change`, `mcp_tool_call`, `web_search`, and `plan_update` synthetic records all produced the identical private diagnostic reason `unsupported_item`. The enum therefore does not identify which observed category occurred. Ignoring it generically would erase the distinction between plan-shaped metadata and write-, tool-, or network-capable material.

All synthetic strings and records were data passed to the in-memory classifier. The test imports no subprocess API and executes none of the candidate commands.

## Conclusions

| Category | Conclusion | Direct reason | Prerequisite for reconsideration |
|---|---|---|---|
| Embedded commands | Unsafe to generalize | Local documentation provides no structured argument boundary, and benign-looking envelopes are indistinguishable from executable near misses using the current string and enum. | A stable documented Codex event field that separates executable and argument vector from display or shell text, plus exact platform semantics and adversarial tests proving that extra execution cannot be smuggled through. |
| Unsupported items | Unsafe to generalize | The current enum collapses plan, write, tool, and network categories, and the privacy-safe live diagnostic did not retain the specific observed item type. | A privacy-reviewed type-specific enum for the observed item, a documented guarantee for that exact type's execution semantics, and adversarial tests proving it can be ignored or modeled without hiding an action. |

The supported recommendation is to keep the current fail-closed behavior unchanged. This is not evidence that no safe future rule can exist; it is evidence that the current locally documented and privacy-safe shapes are insufficient to justify one. No production fix, wrapper normalization, generic item-ignore rule, live retry, replay, comparison, speed claim, or token claim follows from this investigation.

## Validation evidence

Observed on 2026-07-23 in America/New_York:

| Evidence | Outcome |
|---|---|
| Installed README raw read | Exit 0; no JSONL shape contract was present. |
| Native `codex exec --help` | Exit 0; `--json` was documented, but no structured argv or command-envelope contract was present. |
| Checked-in contract and fixture raw reads | Exit 0; item categories and privacy behavior were documented, and the learnable fixture used only a direct command. |
| `node --check packages/codex-adapter/test/event-shape-offline-investigation.test.mjs` | Exit 0. |
| Exact three-file Node test command | Exit 0; all 20 reported adapter, security, and investigation tests passed. |
| `git diff --check` | Exit 0; only pre-existing line-ending warnings were emitted. |
| Exact protected-hash command | Exit 0; all 13 locked contract, footprint, report, adapter, test, and CLI source hashes matched. |
| Exact raw reads and workspace-status inspection | Exit 0; the report, GamePlan, and active footprint were readable, both investigation deliverables were in scope, and every other dirty path was present in the protected baseline. |

Every approved investigation command passed. Phase 4 remains active and incomplete because no eligible live capsule-through-replay comparison was established.
