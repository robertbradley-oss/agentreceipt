# Phase 4 Measured Validation

Status: Incomplete; three separately approved measured-validation attempts failed during source capture. The July privacy-safe event-shape diagnostic narrowed that observed ineligibility to an embedded allowlisted command plus unsupported item material, while the August revalidation again returned only the bounded `capsule_ineligible` classification. Neither result authorizes a grammar change, replay, comparison retry, or benefit claim.

Observed: 2026-07-22, 2026-07-23, and 2026-08-07, America/New_York

## Bounded outcome

The official user-scoped Codex CLI was installed as an environment prerequisite, and its native executable reported `codex-cli 0.145.0`. The approved harness passed syntax validation, and the existing bounded loop and safety suites passed before the live run.

The exact live validation command then exited with status 1. Its safe aggregate result reported:

- stage: `live_capture`;
- code: `agentreceipt_command_failed`;
- live attempts: `1`;
- comparison available: `false`.

The approved allowance was one live attempt with no retry. No second model call was made. Because the source capture did not complete, the harness did not establish an eligible capsule, recipe, replay, digest chain, wall-time comparison, or token comparison. No speed, token, safety, correctness, or general-determinism claim is supported.

On 2026-07-23, the separately approved diagnostic ran once with `--max-live-runs=0` and exited 0. Its bounded aggregate evidence reported Codex CLI version `0.145.0`, successful version, local login-status, and `exec --help` checks, and support for the runner-required `--json`, `--ephemeral`, and `--sandbox` options. It reported `live_attempts: 0` and classification `unresolved`. This rules out only the three tested preflight categories at diagnostic time; it does not establish why the earlier capture failed or that a later capture would succeed.

The exact hermetic-capture repair was then approved on 2026-07-23. The owned runner now invokes Codex with `--ignore-user-config` and `--ignore-rules` in addition to the existing JSONL, ephemeral, and read-only sandbox controls. The Phase 4 harness classifies nested AgentReceipt standard error through an exact streaming allowlist and retains no raw error text. Its only public failure classifications are `capsule_ineligible` and `agentreceipt_failure_unclassified`.

All four approved local gates passed before the replacement attempt. The exact replacement command passed its isolation-option preflight, made one live AgentReceipt-owned Codex attempt, and exited 1 at `live_capture` with safe code `capsule_ineligible`. It did not reach learning, dry run, replay, verification, digest-chain validation, or measurement. The classification establishes only that the captured run did not satisfy capsule eligibility; it does not identify which private event shape or eligibility check failed and does not justify accepting shell wrappers or weakening fail-closed parsing. The sole replacement allowance is consumed, so no further live attempt was made.

The separately approved privacy-safe event-shape diagnostic then completed on 2026-07-23 after all four pre-live gates passed. It used the hermetic adapter runner directly, made exactly one live attempt in a disposable read-only repository, invoked no AgentReceipt CLI command, created no `.agentreceipt` artifact, and exited 0 with one bounded aggregate result:

- Codex CLI version: `0.145.0`;
- public capture status: `partial`;
- terminal event received: `true`;
- private structural eligibility: `false`;
- action count: `0`;
- command shapes: `allowlisted_command_embedded`;
- ineligibility reasons: `allowlisted_command_embedded`, `no_action`, `parameter_unused`, and `unsupported_item`;
- classification: `allowlisted_command_embedded`.

This directly establishes that the exact allowlisted command text appeared only inside a different command string and that at least one unsupported item category was observed. It does not reveal the wrapper, item contents, raw event, or whether either could be accepted safely. The unchanged grammar therefore rejected the command, produced no action, and left the declared parameter unused. The public capture's `partial` status is consistent with unsupported observed material, but the enum-only result is not sufficient to prescribe normalization or an ignore rule. No retry, learning, replay, measurement, or grammar change followed.

## August 2026 bounded revalidation

On 2026-08-07, one new live attempt was explicitly approved. The merged `main` branch first passed `pnpm check`, all 20 Codex-adapter tests, all 10 targeted Observe–Learn–Replay regression and security tests, and the Phase 4 harness syntax check. A zero-attempt diagnostic initially found the obsolete npm-global executable path unavailable; this consumed no live attempt. An isolated temporary installation of Codex CLI `0.147.0` then passed version, existing-login, JSON, ephemeral, sandbox, and hermetic isolation-option preflights without creating or copying an API key.

The unchanged repair harness made exactly one live AgentReceipt-owned Codex attempt and returned:

- stage: `live_capture`;
- code: `capsule_ineligible`;
- live attempts: `1`;
- comparison available: `false`.

The attempt did not reach learning, dry run, replay, verification, digest-chain validation, or measurement. The safe classification establishes only that the current observed run did not satisfy capsule eligibility; it does not establish that the July event-shape classification remained the cause. No retry or eligibility weakening followed. The harness removed its disposable repository on failure, the temporary CLI installation was removed, the real workspace gained no `.agentreceipt` artifacts, and tracked repository state remained unchanged.

## Completion criteria

| Criterion | Direct evidence | Outcome |
|---|---|---|
| Make the approved live AgentReceipt-owned Codex attempts and create an eligible capsule | Original command on 2026-07-22 returned `agentreceipt_command_failed`; separately approved attempts on 2026-07-23 and 2026-08-07 returned `capsule_ineligible`; each reported `live_attempts: 1` | Incomplete. None of the three attempts established eligible source capture or capsule creation. |
| Learn, dry-run, replay, verify, and emit a fresh receipt | All three live harness results stopped at `live_capture` | Not reached. |
| Validate the public source-to-recipe-to-replay digest chain | Every live harness result reported `comparison_available: false` | Not reached. |
| Report comparable wall time and directly observable source usage without inventing replay tokens | No completed source or replay measurement was available | Unavailable; no comparison or benefit claim. |
| Give a bounded decision about later capability | The declared read-only loop was not measured live | Stop at the Phase 4 boundary. No later capability is proposed or approved from this result. |
| Preserve existing behavior, protected artifacts, scope, and provenance | Approved syntax, targeted tests, formatting check, protected hashes, raw reads, and workspace-status inspection | Verified for the bounded local checks; Phase 4 still cannot close while the live criterion is incomplete. |

## Hermetic repair criteria

| Criterion | Direct evidence | Outcome |
|---|---|---|
| Invoke the owned Codex runner with exact isolation flags while keeping the prompt on standard input and standard error out of receipt construction | `pnpm --filter @agentreceipt/codex-adapter test` on 2026-07-23; the exact-argument and prompt test passed | Verified for the adapter implementation. |
| Preserve strict grammar and the public sanitizer | `node --test packages/codex-adapter/test/adapter-security.test.mjs` on 2026-07-23 | Verified; all 5 reported security tests passed, including shell-wrapper and unsafe-command rejection. |
| Preserve the existing bounded observe, learn, and replay behavior | Exact two-file CLI test command on 2026-07-23 | Verified; all 10 reported tests passed. |
| Retain only an approved safe nested failure classification | Exact replacement harness result on 2026-07-23 | Verified for the observed failure: only `capsule_ineligible` was emitted; no raw nested standard error appeared. |
| Make at most one attempt per explicit authorization and complete the comparison only on success | Exact harness results on 2026-07-23 and 2026-08-07; each exited 1 with `live_attempts: 1` | Attempt limits verified; comparison remains incomplete and no retry is authorized from either result. |

## Non-model diagnostic criteria

| Criterion | Direct evidence | Outcome |
|---|---|---|
| Make zero live/model attempts and perform no task, replay, login/configuration, installation, or external mutation | Exact diagnostic command on 2026-07-23; exit 0 with `live_attempts: 0` | Verified for the bounded diagnostic. |
| Record executable, login-readiness, and required `codex exec` surface checks without raw output | Safe aggregate reported version, login-status, and help exit codes 0; version and all required-option booleans were true | Verified without retaining raw subprocess output. |
| Assign exactly one bounded classification without inferring a deeper cause | Safe aggregate classification was `unresolved` | Verified; no root-cause, successful-capture, or replay-eligibility inference is made. |
| Preserve the active Phase 4 boundary and no-retry limit | No live attempt occurred during the diagnostic; report and footprint remained active | Verified for the diagnostic. A replacement was later separately approved, consumed once, and not retried. |

## Privacy-safe event-shape diagnostic criteria

| Criterion | Direct evidence | Outcome |
|---|---|---|
| Preserve capture eligibility and expose only bounded sorted enums in the transient private projection | Adapter and adapter-security tests on 2026-07-23 | Verified; 11 adapter tests and 6 security tests passed, including exact, embedded, unsupported, lifecycle, failure, secret, parameter, no-action, and source-material canaries. |
| Keep the diagnostic out of public and persisted artifacts | Adapter security tests plus the exact observe/learn/replay regression and security command | Verified; all 10 reported CLI tests passed, the public projection remained separate, and existing capsule/recipe/receipt behavior remained passing. |
| Make exactly one hermetic diagnostic attempt without AgentReceipt CLI, private artifacts, replay, or mutation | Exact event-shape command on 2026-07-23 | Verified; exit 0 with `live_attempts: 1`, the disposable repository stayed clean, no `.agentreceipt` directory was created, and cleanup completed. |
| Narrow the failure without accepting or exposing the observed material | Aggregate schema `agentreceipt-phase4-event-shape-diagnostic/v1` | Verified; classification was `allowlisted_command_embedded`, with an additional `unsupported_item` reason and no raw values. The result authorizes no grammar change. |

## Exact command evidence

| Exact approved command | Observed outcome |
|---|---|
| `node --check packages/cli/test/phase-4-measured-validation.mjs` | Exit 0 after the final pre-live harness change. |
| `node --test packages/cli/test/observe-learn-replay.test.mjs packages/cli/test/observe-learn-replay-security.test.mjs` | Exit 0; all 10 reported tests passed after the final pre-live harness change. |
| `node packages/cli/test/phase-4-measured-validation.mjs --live-codex --max-live-runs=1` | Exit 1; safe result stopped at `live_capture` after exactly one attempt and exposed no private artifact contents. |
| `git diff --check` | Exit 0; only line-ending warnings for protected pre-existing files were emitted. |
| Protected Phase 1 through Phase 3 hash command | Exit 0; all five locked Git blob hashes matched. |
| Raw reads of the plan, this report, and the active footprint | Exit 0; the plan and footprint remain active and accurately record the incomplete live result. |
| `git status --short --untracked-files=all` | Exit 0; the Phase 4 writes are exactly the four allowed paths, and every other dirty path was present in the protected baseline. |

Approved diagnostic command evidence on 2026-07-23:

| Exact approved command | Observed outcome |
|---|---|
| `node --check packages/cli/test/phase-4-measured-validation.mjs` | Exit 0. |
| `node packages/cli/test/phase-4-measured-validation.mjs --diagnose-capture --max-live-runs=0` | Exit 0; safe aggregate reported all three preflights available, `live_attempts: 0`, and classification `unresolved`. |
| `git diff --check` | Exit 0; only line-ending warnings for protected pre-existing files were emitted. |
| Protected Phase 1 through Phase 3 hash command | Exit 0; all five locked Git blob hashes matched. |
| Raw reads of the plan, this report, and the active footprint | Exit 0; all three accurately record the bounded diagnostic and continued active Phase 4 state. |
| `git status --short --untracked-files=all` | Exit 0; the Phase 4 writes remain the same four allowed paths, and every other dirty path was present in the protected baseline. |

Approved hermetic-repair command evidence on 2026-07-23:

| Exact approved command | Observed outcome |
|---|---|
| `pnpm --filter @agentreceipt/codex-adapter test` | Exit 0; all 10 reported adapter tests passed after building the approved adapter distribution. |
| `node --test packages/codex-adapter/test/adapter-security.test.mjs` | Exit 0; all 5 reported security tests passed. |
| `node --test packages/cli/test/observe-learn-replay.test.mjs packages/cli/test/observe-learn-replay-security.test.mjs` | Exit 0; all 10 reported loop and security tests passed. |
| `node --check packages/cli/test/phase-4-measured-validation.mjs` | Exit 0. |
| `node packages/cli/test/phase-4-measured-validation.mjs --repair-live-codex --max-live-runs=1` | Exit 1; safe aggregate stopped at `live_capture` with `capsule_ineligible`, `live_attempts: 1`, and `comparison_available: false`. The one replacement allowance is consumed. |
| `git diff --check` | Exit 0; only line-ending warnings for protected pre-existing files were emitted. |
| Protected Phase 1 through Phase 3 hash command | Exit 0; all five locked Git blob hashes matched. |
| Raw reads of the plan, this report, and the active footprint | Exit 0; all three recorded the incomplete result and no-retry boundary. |
| `git status --short --untracked-files=all` | Exit 0; every repair write was within the approved amendment paths, and every other dirty path was present in the protected baseline. |

Approved privacy-safe event-shape command evidence on 2026-07-23:

| Exact approved command | Observed outcome |
|---|---|
| `pnpm --filter @agentreceipt/codex-adapter test` | Exit 0; all 11 reported adapter tests passed after building the approved adapter distribution. |
| `node --test packages/codex-adapter/test/adapter-security.test.mjs` | Exit 0; all 6 reported security tests passed. |
| `node --test packages/cli/test/observe-learn-replay.test.mjs packages/cli/test/observe-learn-replay-security.test.mjs` | Exit 0; all 10 reported loop and security tests passed. |
| `node --check packages/cli/test/phase-4-measured-validation.mjs` | Exit 0. |
| `node packages/cli/test/phase-4-measured-validation.mjs --diagnose-event-shape --max-live-runs=1` | Exit 0 after exactly one live attempt; reported public status `partial`, terminal event received, no eligible action, command shape `allowlisted_command_embedded`, reasons `allowlisted_command_embedded`, `no_action`, `parameter_unused`, and `unsupported_item`, and classification `allowlisted_command_embedded`. |
| `git diff --check` | Exit 0; only line-ending warnings for protected pre-existing files were emitted. |
| Protected Phase 1 through Phase 3 hash command | Exit 0; all five locked Git blob hashes matched. |

Approved bounded revalidation evidence on 2026-08-07:

| Command or check | Observed outcome |
|---|---|
| `pnpm check` | Exit 0; all workspace type checks passed. |
| `pnpm --filter @agentreceipt/codex-adapter test` | Exit 0; all 20 reported adapter and privacy tests passed. |
| `node --test packages/cli/test/observe-learn-replay.test.mjs packages/cli/test/observe-learn-replay-security.test.mjs` | Exit 0; all 10 reported loop and security tests passed. |
| `node --check packages/cli/test/phase-4-measured-validation.mjs` | Exit 0. |
| `node packages/cli/test/phase-4-measured-validation.mjs --diagnose-capture --max-live-runs=0` with isolated Codex CLI `0.147.0` | Exit 0; version, existing login, JSON, ephemeral, and sandbox checks passed; `live_attempts: 0`. |
| `node packages/cli/test/phase-4-measured-validation.mjs --repair-live-codex --max-live-runs=1` with isolated Codex CLI `0.147.0` | Exit 1; safe aggregate stopped at `live_capture` with `capsule_ineligible`, `live_attempts: 1`, and `comparison_available: false`. |
| Post-run cleanup and workspace inspection | No Phase 4 disposable directory, temporary CLI, or workspace `.agentreceipt` artifact remained; tracked workspace state was unchanged. |

## Privacy and limitations

- The report contains no prompt, message, reasoning, command output, private capsule or recipe content, raw Codex identifier, environment value, or personal absolute path.
- The harness used one disposable local repository and was required to remove it on success or failure.
- The bounded diagnostic rules out only executable access, local login readiness, and absence of the three originally required `codex exec` options at the time observed. The replacement preflight additionally established the presence of both approved isolation options.
- The later enum-only diagnostic reveals only that the allowlisted text was embedded in a different command string and that unsupported item material existed. It does not reveal, retain, or establish the safety of the wrapper, item type contents, raw JSONL, or nested standard error.
- The July replacement, July event-shape diagnostic, and August revalidation allowances are consumed. No further live attempt or retry is authorized by these results.
- Public receipts remain evidence for their declared surface, not proof of complete observation, safety, correctness, truthfulness, or determinism.
