# Game Plan

Status: Locked on 2026-07-22. Phase 4 remains active and incomplete. The exact offline event-shape safety investigation completed on 2026-07-23 and found no locally documented safe basis for a production grammar change; no live retry, grammar expansion, or later capability is approved.

## Outcome

AgentReceipt expands from privacy-safe evidence into a privacy-preserving observe, learn, and replay loop. A successful wrapped local Codex run can be converted into one reviewable, parameterized deterministic recipe; a guarded replay of supported actions verifies its result and emits a fresh privacy-safe AgentReceipt. The public receipt may bind to the recipe by digest without exposing the private capsule or recipe contents. Any speed or token benefit is demonstrated by a measured baseline and replay comparison, not asserted.

## Strategy

The strategy preserves the existing public receipt, trust model, capture limitations, finalization lifecycle, and metadata-only privacy boundary. A separate private local capsule will retain only the structured execution data needed for learning under a strict allowlist and will never become public receipt content.

One `learn` command will convert an eligible successful capsule into one versioned canonical JSON recipe. One guarded `replay` command will validate the recipe and repository context, resolve parameters without persisting secret values, provide a non-executing dry run, refuse unsupported or nondeterministic actions, verify the result, and produce a fresh receipt for an actual replay. The plan advances through separately approved phases and broadens only after the bounded read-only loop is safe, useful, and measured.

## Guardrails

- Public receipts remain evidence, not proof. Replay or recipe binding must not claim complete observation, safety, correctness, truthfulness, or determinism beyond the declared supported surface.
- The current public receipt exclusions remain intact: no prompts, messages, reasoning, source content, raw command output, tool arguments/results, environment values, credentials, personal absolute paths, or raw Codex identifiers.
- Private capsules are a distinct local artifact, not an extension of the public receipt. They must be stored only at a verified ignored and untracked local path, must never be committed, finalized, uploaded, logged, or published, and must have a documented safe deletion path.
- "Private" is not permission to retain secrets. Secret values must be replaced with runtime parameters before persistence or the capsule/learning operation must fail closed. Unknown sensitive fields and unclassifiable command material are not learnable.
- Capsule fields must be a minimal allowlist for recipe derivation. Full transcripts, reasoning, broad command output, and speculative future data are excluded.
- The read-only implementation phase is Codex CLI only, local repositories only, shell and file workflows only, one recipe format, one learn command, one replay command, and one harmless end-to-end fixture.
- The read-only implementation phase must reject write-capable, network-dependent, interactive, random, clock-dependent, or otherwise nondeterministic actions. Write replay is a later decision and must add explicit confirmation and write guards before it can be approved.
- A dry run performs validation, parameter/precondition checks, and a safely redacted preview without executing steps. It must not be represented as an executed replay. Every actual replay attempt emits a fresh receipt with its outcome and limitations.
- Use the existing namespaced `extensions` area for a recipe digest or replay metadata only if schema, integrity, privacy-screen, finalization, and validation behavior all support the exact proposed fields. Do not lock field names prematurely; use the smallest additive schema change if extensions cannot represent replay honestly.
- Recipe contents are local by default. Publication, discovery, automatic recall/search, registries, sharing, and synchronization are outside the locked phases.
- No full parity with rote by modiqo and no general adapter or workflow-engine architecture. Its trace, crystallize, fingerprint, write-guard, and replay ideas are inspiration only; no private implementation or parity checklist is adopted.
- No hosted service, account, dashboard, marketplace, team feature, vault synchronization, analytics warehouse, browser automation, multi-agent orchestration, or broad API adapter platform.
- No speed or token claim is permitted without a comparable observed baseline, replay measurement, stated measurement boundaries, and explicit handling of missing or non-comparable data.
- Each phase requires explicit user approval. Completing one phase does not approve the next phase, change strategy, or expand file scope.
- Preserve all pre-existing repository work. Each later implementation task requires its own explicitly approved execution slice and task footprint under the GamePlan rules.
- Track the canonical root `GAMEPLAN.md` in `robertbradley-oss/agentreceipt`; keep `.gameplan/` reports, footprints, task-temporary artifacts, ignored private capsules and recipes, and other local evidence out of the public repository unless separately approved.

## Approved Execution Slice

None approved. The completed Phase 4 slices and amendments below are retained as historical execution provenance. All authorized live attempts are consumed, and the offline investigation supports no production change. Phase 4 remains active as an incomplete plan state, not as implementation or validation authority. Phase 3 remains closed with detailed evidence in `docs/phase-3-safety-privacy-validation.md` and finalized provenance in `.gameplan/footprints/2026-07-22-phase-3-safety-privacy-validation.md`.

### Approved Phase 4 execution slice: Measured validation and decision

Objective: Run one harmless AgentReceipt-owned live Codex baseline in a disposable local repository, learn and replay its eligible read-only capsule, validate the public digest chain and fresh receipt, and report only directly observed wall-clock and Codex-emitted usage evidence. Conclude only what this one bounded comparison supports and decide whether any later capability merits a new proposal.

Allowed files:

- `GAMEPLAN.md`
- `.gameplan/footprints/2026-07-22-phase-4-measured-validation.md`
- `docs/phase-4-measured-validation.md`
- `packages/cli/test/phase-4-measured-validation.mjs`

Constraints:

- Use one new measurement harness and one test-created disposable local Git repository. The harness may make at most one live `codex exec --json` model attempt through the existing AgentReceipt-owned capture path; no retry or second live model run is authorized if it fails or is ineligible.
- The fixed live task may perform only `git hash-object --no-filters input.txt` in read-only sandbox mode over one harmless tracked file. The prompt must forbid every other command, file read, network action, and write.
- Keep all runtime receipts, capsules, and recipes under the disposable repository's verified ignored and untracked `.agentreceipt/` path. Remove the temporary repository on success or failure. Do not inspect, modify, or delete the workspace-root `.agentreceipt/`, `.agents/`, or `.codex-scope/` directories.
- Use synthetic harmless fixture content only. Do not read, request, retain, hash, print, or transmit credentials, environment values, user content, prompts, messages, reasoning, command output, private artifact contents, raw identifiers, or personal absolute paths.
- The harness may emit only a bounded aggregate JSON result containing declared tool versions, success booleans, public digests, directly measured durations, numeric source usage when Codex emits it, and explicit missing/non-comparable markers. It must not emit private paths or content.
- Measure the complete source `agentreceipt codex` command and complete actual `agentreceipt replay` command with the same monotonic-clock boundary in the same disposable repository. Record task order, repository preconditions, tool versions, and uncontrolled cache effects. Do not estimate missing usage or represent replay tokens as a measured zero.
- Validate the source-receipt-to-capsule-to-recipe-to-replay-receipt digest chain without publishing the capsule or recipe. Confirm dry run executes nothing and writes no receipt before the actual replay.
- Do not change production source, schemas, generated distributions, package or lock files, workspace configuration, workflows, fixtures, README, existing contracts, completed reports or footprints, or external systems other than the single authorized live Codex call. Treat every unlisted workspace path as out of scope.
- If the Codex executable is unavailable, the live run is ineligible, usage is absent, measurements are non-comparable, or any integrity/privacy check fails, report the exact bounded limitation and make no benefit claim. The slice remains incomplete rather than widening scope or retrying the model call.
- Do not propose or implement write replay, automatic recall/search, another executable grammar, another agent surface, hosted behavior, or a general measurement subsystem.

Completion criteria:

- The harness makes exactly one live AgentReceipt-owned Codex attempt in a disposable clean local repository and, when eligible, creates one private capsule while preserving the existing sanitized public receipt boundary.
- The eligible capsule learns into one canonical parameterized recipe; full dry-run preflight executes no action and emits no receipt; actual replay executes the single read-only action, verifies the file, detects no repository mutation, and emits one fresh schema-valid public receipt.
- Direct checks establish the public binding chain: the capsule binds to the source receipt digest, the recipe binds to that same source digest, and the replay receipt exposes only the recipe and source-receipt digests through the approved extension.
- The report states the exact source and replay timing boundaries, order, repository preconditions, tool versions, cache limitations, source usage only when emitted, and direct evidence that replay used no live Codex/model path. Missing or non-comparable evidence is labeled unavailable and supports no claim.
- The report gives one bounded conclusion about this harmless read-only workflow, preserves the evidence-not-proof language, and records a decision to stop or propose one later capability without approving it.
- The existing bounded loop and safety tests remain passing; every task write stays within the four allowed files; protected Phase 1 through Phase 3 artifacts retain their locked hashes; the footprint is finalized; and every exact approved validation command passes before closure.

Exact validation commands approved on 2026-07-22:

```powershell
node --check packages/cli/test/phase-4-measured-validation.mjs
node --test packages/cli/test/observe-learn-replay.test.mjs packages/cli/test/observe-learn-replay-security.test.mjs
node packages/cli/test/phase-4-measured-validation.mjs --live-codex --max-live-runs=1
git diff --check
$protectedHashes = @{ 'docs/observe-learn-replay-contract-v0.1.md' = '7e92f95dd2fff5e680ebdb84af1db771abc21129'; '.gameplan/footprints/2026-07-22-phase-1-contracts.md' = 'ab39f68c144781e1f005050f0216212fcd8ab93c'; '.gameplan/footprints/2026-07-22-phase-2-read-only-vertical-slice.md' = '8d5d880663711d3b84b8d87e16e6d29307bffad7'; '.gameplan/footprints/2026-07-22-phase-3-safety-privacy-validation.md' = '9d4458ce0589506dffc942f5c5b6d6098dea2ae4'; 'docs/phase-3-safety-privacy-validation.md' = 'd919a27abb0fe6e15e1aad6ea011f0a7de3a11a2' }; foreach ($protectedPath in $protectedHashes.Keys) { if ((git hash-object -- $protectedPath) -ne $protectedHashes[$protectedPath]) { Write-Error "Protected artifact changed: $protectedPath"; exit 1 } }
Get-Content -Raw -LiteralPath 'GAMEPLAN.md'
Get-Content -Raw -LiteralPath 'docs/phase-4-measured-validation.md'
Get-Content -Raw -LiteralPath '.gameplan/footprints/2026-07-22-phase-4-measured-validation.md'
git status --short --untracked-files=all
```

Validation authorization: Granted by the user's explicit 2026-07-22 approval for only the exact commands above. The third command authorizes at most one live Codex model attempt in the disposable repository; it does not authorize a retry, network use by the recipe, a live call from the workspace repository, changed commands, or any other external mutation.

Evidence state: Incomplete. The standalone `codex-cli 0.145.0` cleared the executable preflight, and all approved local checks passed, including protected hashes and scope inspection. The exact live harness command exited 1 at safe stage `live_capture` with `agentreceipt_command_failed` after `live_attempts: 1`; no comparison was available. The one-attempt allowance is consumed, no retry is authorized, and detailed evidence is in `docs/phase-4-measured-validation.md`.

### Approved authority amendment: Narrow non-model capture diagnostic

Approval context: On 2026-07-22, the user explicitly approved the exact amendment and validation commands below. This authorizes the bounded harness, report, and active-footprint updates plus one execution of the exact non-model diagnostic command. It does not authorize a live capture retry.

Objective: Run one local, non-model diagnostic command that determines only whether the consumed `live_capture` failure is explained by native Codex executable access, local login readiness, or absence of the `codex exec` command-line surface required by the existing AgentReceipt runner. If those checks pass, classify the cause as unresolved rather than inferring a root cause.

Allowed files:

- `GAMEPLAN.md`
- `.gameplan/footprints/2026-07-22-phase-4-measured-validation.md`
- `docs/phase-4-measured-validation.md`
- `packages/cli/test/phase-4-measured-validation.mjs`

Constraints:

- Add only a `--diagnose-capture` mode to the existing Phase 4 harness and require `--max-live-runs=0`. Do not add a new harness, production behavior, dependency, abstraction, or workspace path.
- The diagnostic may invoke only the already selected native Codex executable with `--version`, `login status`, and `exec --help`. It must supply no prompt or task input, invoke no model, execute no repository action, initiate no login or configuration change, and make no live capture or replay attempt.
- Treat the three subprocesses as one bounded harness diagnostic. Do not retry a subprocess or fall back to another executable, wrapper, package download, or installation path.
- Emit only one fixed aggregate JSON result containing the diagnostic schema/status, declared Codex version when available, numeric exit codes, booleans for local login readiness and required `codex exec` options, `live_attempts: 0`, and one bounded classification: `executable_unavailable`, `login_not_ready`, `exec_surface_incompatible`, or `unresolved`.
- Do not emit or persist raw standard output/error, authentication method or material, identifiers, environment values, prompts, messages, reasoning, source content, command output, private-artifact contents, personal paths, or credentials. The report may record only the bounded aggregate result.
- Preserve the active Phase 4 footprint. Do not authorize or perform a replacement live attempt, change the measured-validation completion criteria, make a speed or token claim, or approve any later capability.
- Preserve all completed artifacts and existing work. Every unlisted path remains out of scope.

Completion criteria:

- The exact diagnostic command makes zero live/model attempts and reports `live_attempts: 0`; it performs no task execution, replay, write outside the four allowed files, login/configuration mutation, installation, or external-system mutation.
- Direct aggregate evidence records whether the native executable version check, local login-status check, and required `codex exec` help-surface checks completed successfully without exposing their raw output.
- The diagnostic assigns exactly one bounded classification. Passing preflights produce `unresolved` and do not become evidence of a deeper root cause, successful capture, or replay eligibility.
- The Phase 4 report records the classification, observed limitations, and the continued prohibition on retry. The active footprint records only the approved amendment and diagnostic provenance; it is not finalized.
- Every task write stays within the four allowed files, protected Phase 1 through Phase 3 artifacts retain their locked hashes, and every exact approved validation command passes.

Exact validation commands approved on 2026-07-22:

```powershell
node --check packages/cli/test/phase-4-measured-validation.mjs
node packages/cli/test/phase-4-measured-validation.mjs --diagnose-capture --max-live-runs=0
git diff --check
$protectedHashes = @{ 'docs/observe-learn-replay-contract-v0.1.md' = '7e92f95dd2fff5e680ebdb84af1db771abc21129'; '.gameplan/footprints/2026-07-22-phase-1-contracts.md' = 'ab39f68c144781e1f005050f0216212fcd8ab93c'; '.gameplan/footprints/2026-07-22-phase-2-read-only-vertical-slice.md' = '8d5d880663711d3b84b8d87e16e6d29307bffad7'; '.gameplan/footprints/2026-07-22-phase-3-safety-privacy-validation.md' = '9d4458ce0589506dffc942f5c5b6d6098dea2ae4'; 'docs/phase-3-safety-privacy-validation.md' = 'd919a27abb0fe6e15e1aad6ea011f0a7de3a11a2' }; foreach ($protectedPath in $protectedHashes.Keys) { if ((git hash-object -- $protectedPath) -ne $protectedHashes[$protectedPath]) { Write-Error "Protected artifact changed: $protectedPath"; exit 1 } }
Get-Content -Raw -LiteralPath 'GAMEPLAN.md'
Get-Content -Raw -LiteralPath 'docs/phase-4-measured-validation.md'
Get-Content -Raw -LiteralPath '.gameplan/footprints/2026-07-22-phase-4-measured-validation.md'
git status --short --untracked-files=all
```

Validation authorization: Granted by the user's explicit 2026-07-22 approval for only the exact project-local commands above. The diagnostic command must use `--max-live-runs=0`, authorizes no model or live capture attempt, and grants no standing authority for changed commands, subprocess retries, installation, login/configuration mutation, or external-system mutation.

Evidence state: Completed on 2026-07-23 for this amendment. The exact diagnostic command exited 0, reported Codex CLI `0.145.0`, successful executable, local login-readiness, and required `codex exec` option checks, `live_attempts: 0`, and classification `unresolved`. All exact approved diagnostic validation commands passed, all five protected hashes matched, and every Phase 4 write remained within the four allowed paths. No live attempt or retry occurred; detailed bounded evidence is in `docs/phase-4-measured-validation.md`.

### Approved authority amendment: Hermetic capture repair and one replacement live attempt

Approval context: On 2026-07-23, the user explicitly approved this exact amendment and its exact validation commands. This activates only the files, repair mechanics, replacement-attempt limit, completion criteria, and commands below.

Objective: Remove avoidable user-configuration and repository-rule variability from the AgentReceipt-owned Codex subprocess, preserve the strict read-only recipe grammar and public privacy boundary, retain one bounded safe classification when the nested AgentReceipt command fails, and make at most one replacement live attempt to complete the existing Phase 4 comparison.

Allowed files and directory prefixes:

- `GAMEPLAN.md`
- `.gameplan/footprints/2026-07-22-phase-4-measured-validation.md`
- `docs/phase-4-measured-validation.md`
- `packages/cli/test/phase-4-measured-validation.mjs`
- `packages/codex-adapter/src/runner.ts`
- `packages/codex-adapter/test/adapter.test.mjs`
- `packages/codex-adapter/test/adapter-security.test.mjs`
- `packages/codex-adapter/dist/`

Constraints:

- Add `--ignore-user-config` and `--ignore-rules` to the existing owned `codex exec --json --ephemeral --sandbox read-only -` invocation. Keep the prompt on standard input, keep standard error out of receipts and public output, and do not add configuration, authentication, network, shell, or general runner abstractions.
- This is a controlled-capture isolation repair, not a claim that local configuration or repository rules caused the consumed failure. Current official Codex documentation identifies both flags for controlled automation and states that required MCP configuration can make `codex exec` fail; the completed diagnostic did not inspect or prove either condition.
- Do not broaden the private projection's exact `git hash-object --no-filters <safe-relative-path>` grammar, accept shell wrappers, parse quoting, add another executable, or weaken unknown-event, malformed-stream, secret, path, write, network, or nondeterminism rejection. Current Codex documentation shows shell-wrapped command examples, but the failed run retained no raw event evidence proving a safely recognizable wrapper shape.
- Add a `--repair-live-codex` mode to the existing Phase 4 harness. Before the one live attempt, require the existing executable, login, and `codex exec` surface checks plus support for both isolation flags; a failed preflight consumes zero live attempts and stops safely.
- For the nested AgentReceipt subprocess only, classify standard error through a bounded in-memory exact allowlist of AgentReceipt's existing fixed safe failure lines. Emit only `capsule_ineligible` or `agentreceipt_failure_unclassified`; discard unmatched bytes immediately and never emit, persist, hash, or include raw standard error, command text, output, prompts, messages, reasoning, identifiers, paths, environment values, or private-artifact contents.
- The repair harness may make at most one replacement live model attempt through the AgentReceipt-owned capture path, using the same harmless task, disposable repository, ignored private-artifact storage, timing boundaries, and privacy restrictions as the approved Phase 4 slice. There is no fallback executable, changed prompt, second task, or retry after subprocess, capture, learning, replay, verification, privacy, integrity, or measurement failure.
- If the replacement capture succeeds, continue the already approved learn, dry-run, replay, verification, digest-chain, and measured-comparison flow. If it fails, record only the safe aggregate classification and direct limitation, finalize no success claim, keep Phase 4 incomplete, and stop. Missing or non-comparable usage remains unavailable and supports no token claim.
- Preserve every pre-existing workspace change and protected Phase 1 through Phase 3 artifact. Modify only the listed paths, update the active Phase 4 footprint rather than creating another footprint, and do not change schemas, contracts, CLI production source, package or lock files, workflows, fixtures, completed reports or footprints, or external systems other than the single replacement Codex call.

Completion criteria:

- Adapter tests prove that the owned runner supplies exactly one prompt through standard input and invokes `codex exec` with JSONL, ephemeral, read-only sandbox, user-configuration isolation, and rules isolation enabled while continuing to discard standard error from receipt construction.
- Security tests prove that the isolation repair does not widen the accepted command grammar or public sanitizer and that shell wrappers, unknown events, malformed streams, secret material, unsafe paths, writes, network behavior, and nondeterministic actions remain rejected as before.
- The harness proves that preflight failure makes zero live attempts, raw nested standard error is never exposed or persisted, and a nonzero nested command produces only one approved safe classification.
- The replacement mode makes at most one live AgentReceipt-owned Codex attempt. Success must satisfy every existing Phase 4 capsule, recipe, dry-run, replay, verification, fresh-receipt, digest-chain, privacy, and measured-report criterion; failure must stop with Phase 4 explicitly incomplete and no further retry authority.
- Any speed statement remains bounded to directly comparable wall-clock measurements from the successful replacement flow. Any token statement uses only numeric usage emitted by Codex for the source run and labels absent or non-comparable data unavailable.
- All task writes remain within the listed paths, all five protected hashes remain locked, the active footprint records exact provenance, and every exact approved validation command passes before Phase 4 may close.

Exact validation commands approved on 2026-07-23:

```powershell
pnpm --filter @agentreceipt/codex-adapter test
node --test packages/codex-adapter/test/adapter-security.test.mjs
node --test packages/cli/test/observe-learn-replay.test.mjs packages/cli/test/observe-learn-replay-security.test.mjs
node --check packages/cli/test/phase-4-measured-validation.mjs
node packages/cli/test/phase-4-measured-validation.mjs --repair-live-codex --max-live-runs=1
git diff --check
$protectedHashes = @{ 'docs/observe-learn-replay-contract-v0.1.md' = '7e92f95dd2fff5e680ebdb84af1db771abc21129'; '.gameplan/footprints/2026-07-22-phase-1-contracts.md' = 'ab39f68c144781e1f005050f0216212fcd8ab93c'; '.gameplan/footprints/2026-07-22-phase-2-read-only-vertical-slice.md' = '8d5d880663711d3b84b8d87e16e6d29307bffad7'; '.gameplan/footprints/2026-07-22-phase-3-safety-privacy-validation.md' = '9d4458ce0589506dffc942f5c5b6d6098dea2ae4'; 'docs/phase-3-safety-privacy-validation.md' = 'd919a27abb0fe6e15e1aad6ea011f0a7de3a11a2' }; foreach ($protectedPath in $protectedHashes.Keys) { if ((git hash-object -- $protectedPath) -ne $protectedHashes[$protectedPath]) { Write-Error "Protected artifact changed: $protectedPath"; exit 1 } }
Get-Content -Raw -LiteralPath 'GAMEPLAN.md'
Get-Content -Raw -LiteralPath 'docs/phase-4-measured-validation.md'
Get-Content -Raw -LiteralPath '.gameplan/footprints/2026-07-22-phase-4-measured-validation.md'
git status --short --untracked-files=all
```

Validation authorization: Granted by the user's explicit 2026-07-23 approval for only the exact commands above. The fifth command may make at most one replacement live model attempt. This does not authorize a second attempt, changed command, shell-wrapper support, package installation, login/configuration mutation, unrelated file change, later capability, or other external action.

Evidence state: Incomplete. The owned runner now uses both approved isolation flags, the adapter and existing safety tests passed, and the harness emitted only the approved safe failure classification. The exact replacement command then exited 1 at `live_capture` with `capsule_ineligible`, `live_attempts: 1`, and no comparison. All remaining non-model evidence commands passed, every repair write stayed in scope, and all five protected hashes matched. The classification proves ineligibility but not its private event-shape cause. The replacement allowance is consumed; detailed evidence is in `docs/phase-4-measured-validation.md`.

### Approved authority amendment: Privacy-safe event-shape diagnostic

Approval context: On 2026-07-23, the user explicitly approved this exact amendment and its exact validation commands. This activates only the safe enums, paths, implementation boundary, one-live-attempt limit, completion criteria, and commands below.

Objective: Determine why the harmless live Codex run is structurally ineligible by adding non-persisted, enum-only diagnostics to the existing private projection and running one bounded adapter-owned live diagnostic in a disposable repository. Preserve the public receipt boundary and strict recipe grammar; do not create a capsule, recipe, or receipt and do not attempt replay.

Allowed files and directory prefixes:

- `GAMEPLAN.md`
- `.gameplan/footprints/2026-07-22-phase-4-measured-validation.md`
- `docs/phase-4-measured-validation.md`
- `packages/cli/test/phase-4-measured-validation.mjs`
- `packages/codex-adapter/src/capsule.ts`
- `packages/codex-adapter/src/types.ts`
- `packages/codex-adapter/test/adapter.test.mjs`
- `packages/codex-adapter/test/adapter-security.test.mjs`
- `packages/codex-adapter/dist/`

Constraints:

- Extend only the separate private projection result with one safe diagnostic object. It may contain sorted unique command-shape enums, sorted unique ineligibility-reason enums, and a nonnegative action count. It must never become part of the public capture result, persisted capsule, recipe, receipt, CLI output, error text, digest input, or finalization surface.
- The only command-shape enums are `direct_allowlisted`, `allowlisted_command_embedded`, and `unsupported`. `allowlisted_command_embedded` means the exact allowlisted command text appeared only as a substring of a different command string; it does not assert a particular shell, quoting model, or safe wrapper.
- The only ineligibility-reason enums are `malformed_record`, `lifecycle_incomplete`, `turn_failed`, `unknown_event`, `unsupported_item`, `unsupported_command_shape`, `allowlisted_command_embedded`, `secret_material`, `parameter_unused`, `command_failed`, and `no_action`. Multiple observed reasons may be returned in sorted order; no raw field, value, identifier, path, command, argument, output, message, prompt, reasoning, environment value, credential, timestamp, or personal data may be retained in the diagnostic object.
- Keep the existing `git hash-object --no-filters <safe-relative-path>` acceptance rule unchanged. Diagnostic classification must not normalize, parse, unwrap, execute, accept, or persist an embedded or unsupported command, and must not weaken any unknown-event, malformed-stream, lifecycle, secret, parameter, path, write, network, or nondeterminism rejection.
- Add only a `--diagnose-event-shape --max-live-runs=1` mode to the existing Phase 4 harness. It must use the existing hermetic adapter runner, the same fixed harmless prompt and tracked `input.txt`, read-only sandbox mode, and one disposable clean local Git repository. It must not invoke the AgentReceipt CLI, create `.agentreceipt` artifacts, learn, replay, measure a benefit, or inspect workspace-root private/control directories.
- Before the live diagnostic, require the existing executable, login, JSONL, ephemeral, sandbox, user-config-isolation, and rules-isolation preflights. A failed preflight makes zero live attempts and stops safely. After preflight, the mode may make at most one live Codex model attempt, with no fallback executable, changed prompt, retry, second task, or continuation into the Phase 4 comparison.
- Emit exactly one bounded aggregate JSON result with schema `agentreceipt-phase4-event-shape-diagnostic/v1`, status `completed`, the declared Codex CLI version or `unavailable`, `live_attempts`, public capture status, terminal-event boolean, private structural-eligibility boolean, nonnegative action count, sorted command-shape enums, sorted ineligibility-reason enums, and one classification: `eligible_direct`, `allowlisted_command_embedded`, `unsupported_command_shape`, `unsupported_event_shape`, `lifecycle_ineligible`, `capture_failed`, or `other_ineligible`.
- A completed diagnostic may exit 0 even when it classifies the run as ineligible; command failure is reserved for harness, preflight, cleanup, privacy, or enum-validation failure. The report must distinguish the enum evidence from any inference and must not claim that an embedded command is safely replayable.
- Use synthetic harmless test canaries to prove diagnostic output contains no source material. Preserve all pre-existing work and protected artifacts. Do not modify runner behavior, CLI production source, schemas, contracts, packages, lockfiles, workflows, fixtures, completed reports or footprints, or external systems other than the single authorized diagnostic Codex call. Every unlisted path remains out of scope.

Completion criteria:

- Adapter tests directly prove that an exact allowlisted command, an allowlisted command embedded in a different string, unsupported command material, unsupported item types, malformed or incomplete lifecycle records, failed turns, failed commands, secret material, unused parameters, and no-action streams produce only the approved sorted enums while preserving the existing eligibility result.
- Security tests prove that raw commands, paths, arguments, identifiers, prompts, messages, reasoning, outputs, credential canaries, and environment values are absent from both the safe diagnostic object and public capture, and that embedded or unsupported commands remain structurally ineligible.
- Existing observe, learn, replay, private-artifact, and public-receipt tests remain passing, establishing that the additional private in-memory diagnostics are not persisted or published and do not widen executable grammar.
- The exact live diagnostic makes zero attempts on preflight failure or exactly one attempt after successful preflight, removes its disposable repository, creates no capsule, recipe, receipt, or workspace-root artifact, and emits only the approved bounded aggregate result.
- The report records the observed enums and one classification, states whether the result narrows the failure to command shape, event/item shape, lifecycle, capture failure, or another ineligibility category, and authorizes no grammar change, retry, comparison, benefit claim, or later capability.
- Every task write stays within the listed paths, all five protected hashes remain locked, the active footprint records exact provenance, and every exact approved validation command passes. The diagnostic amendment may complete without closing Phase 4; Phase 4 remains incomplete unless the original capsule-through-replay criteria are separately satisfied under later authority.

Exact validation commands approved on 2026-07-23:

```powershell
pnpm --filter @agentreceipt/codex-adapter test
node --test packages/codex-adapter/test/adapter-security.test.mjs
node --test packages/cli/test/observe-learn-replay.test.mjs packages/cli/test/observe-learn-replay-security.test.mjs
node --check packages/cli/test/phase-4-measured-validation.mjs
node packages/cli/test/phase-4-measured-validation.mjs --diagnose-event-shape --max-live-runs=1
git diff --check
$protectedHashes = @{ 'docs/observe-learn-replay-contract-v0.1.md' = '7e92f95dd2fff5e680ebdb84af1db771abc21129'; '.gameplan/footprints/2026-07-22-phase-1-contracts.md' = 'ab39f68c144781e1f005050f0216212fcd8ab93c'; '.gameplan/footprints/2026-07-22-phase-2-read-only-vertical-slice.md' = '8d5d880663711d3b84b8d87e16e6d29307bffad7'; '.gameplan/footprints/2026-07-22-phase-3-safety-privacy-validation.md' = '9d4458ce0589506dffc942f5c5b6d6098dea2ae4'; 'docs/phase-3-safety-privacy-validation.md' = 'd919a27abb0fe6e15e1aad6ea011f0a7de3a11a2' }; foreach ($protectedPath in $protectedHashes.Keys) { if ((git hash-object -- $protectedPath) -ne $protectedHashes[$protectedPath]) { Write-Error "Protected artifact changed: $protectedPath"; exit 1 } }
Get-Content -Raw -LiteralPath 'GAMEPLAN.md'
Get-Content -Raw -LiteralPath 'docs/phase-4-measured-validation.md'
Get-Content -Raw -LiteralPath '.gameplan/footprints/2026-07-22-phase-4-measured-validation.md'
git status --short --untracked-files=all
```

Validation authorization: Granted by the user's explicit 2026-07-23 approval for only the exact commands above. The fifth command may make at most one live diagnostic model attempt. This does not authorize a measurement retry, changed command, raw event retention, grammar expansion, package installation, login/configuration mutation, unrelated file change, later capability, or other external action.

Evidence state: Completed on 2026-07-23 for this amendment. The transient private diagnostic reports only approved sorted enums and an action count, while the public capture and persisted capsule, recipe, receipt, CLI, digest, and finalization surfaces remain unchanged. All four pre-live gates passed. The exact diagnostic command then exited 0 after one live attempt with Codex CLI `0.145.0`, public status `partial`, a terminal event, structural ineligibility, zero actions, command shape `allowlisted_command_embedded`, reasons `allowlisted_command_embedded`, `no_action`, `parameter_unused`, and `unsupported_item`, and classification `allowlisted_command_embedded`. This narrows the failure but does not establish a safe wrapper or ignorable item and authorizes no grammar change or retry. Detailed bounded evidence is in `docs/phase-4-measured-validation.md`.

### Approved authority amendment: Offline event-shape safety investigation

Approval context: On 2026-07-23, the user explicitly approved this exact slice and its exact validation commands. This activates only the four listed write paths, local documentation reads, inert synthetic matrix, completion criteria, and commands below.

Objective: Determine whether the observed embedded-command and unsupported-item categories contain enough locally documented structure to support a future safe, deterministic rule. Use only installed documentation, checked-in contracts and fixtures, current implementation inspection, and inert synthetic JSONL records. Produce a bounded recommendation without changing production behavior or making another live Codex attempt.

Allowed files:

- `GAMEPLAN.md`
- `.gameplan/footprints/2026-07-22-phase-4-measured-validation.md`
- `docs/phase-4-event-shape-offline-investigation.md`
- `packages/codex-adapter/test/event-shape-offline-investigation.test.mjs`

Constraints:

- Treat all repository and installed Codex material as read-only evidence. The documentation surface is limited to the installed `@openai/codex` README, native `codex exec --help`, `docs/codex-adapter-contract-v0.1.md`, the existing sanitized JSONL fixtures, and current adapter and persistence-boundary source. Do not browse the web, install or update anything, invoke a model, run a capture, invoke AgentReceipt CLI behavior, access authentication details, or inspect raw live events.
- Add one test-only synthetic investigation file and one report. Synthetic command strings and item records are inert data passed only to `CodexPrivateProjectionCapture`; they must never be executed or spawned. Do not change adapter, CLI, schema, contract, fixture, generated distribution, package, lockfile, workflow, or existing test source.
- The command matrix must include the direct allowlisted control; common shell-envelope forms; quoting variants; command prefixes and suffixes; and chaining, pipe, redirection, and substitution-shaped near misses. The test must show whether the available event string and current enum can distinguish a safely bounded envelope from additional executable behavior. It must not implement or recommend generic substring acceptance.
- The item matrix must include the known ignored message and reasoning controls plus the documented `file_change`, `mcp_tool_call`, `web_search`, and `plan_update` categories. It must show whether the current `unsupported_item` enum can distinguish inert metadata from write-, tool-, or network-capable material. It must not implement or recommend generic unsupported-item ignoring.
- The report must separate direct documentation, synthetic observations, and inference. For embedded commands and unsupported items independently, conclude exactly one of: safe rule supported, unsafe to generalize, or insufficient evidence. A safe-rule conclusion requires an exact locally documented semantic boundary plus adversarial synthetic evidence; absence of either requires fail-closed behavior and a precise prerequisite for reconsideration.
- Preserve public capture, private persistence, recipe grammar, and all existing privacy and evidence-not-proof claims. Do not expose or reconstruct the earlier live command wrapper or item contents. Authorize no production fix, grammar expansion, live retry, learning, replay, comparison, benefit claim, or later capability.
- Preserve all pre-existing work. Update the existing active Phase 4 footprint rather than creating another footprint, and keep Phase 4 active and incomplete regardless of the investigation conclusion. Every unlisted path is out of scope.

Completion criteria:

- The report records what the installed and checked-in documentation does and does not guarantee about JSONL command representation and documented item categories, without relying on network or live-event evidence.
- The synthetic test passes and demonstrates whether benign-looking envelopes are distinguishable from injection-shaped near misses and whether harmless item controls are distinguishable from write-, tool-, and network-capable item categories using only the currently available shapes.
- The report gives one bounded conclusion for embedded commands and one for unsupported items, names the exact missing prerequisite where safety is not established, and recommends no production change unsupported by both documentation and adversarial evidence.
- Exact hashes prove that adapter and CLI production source, existing adapter tests, locked Phase 1 through Phase 3 artifacts, schemas, contracts, fixtures, packages, lockfiles, workflows, and generated distributions were not changed by the investigation.
- The active footprint records only the two investigation deliverables and the GamePlan/report updates, every write stays within the four allowed paths, and every exact approved validation command passes.

Exact validation commands approved on 2026-07-23:

```powershell
$codexPackageRoot = Join-Path $env:APPDATA 'npm\node_modules\@openai\codex'; Get-Content -Raw -LiteralPath (Join-Path $codexPackageRoot 'README.md')
$codexNative = Join-Path $env:APPDATA 'npm\node_modules\@openai\codex\node_modules\@openai\codex-win32-x64\vendor\x86_64-pc-windows-msvc\bin\codex.exe'; & $codexNative exec --help
Get-Content -Raw -LiteralPath 'docs/codex-adapter-contract-v0.1.md'; Get-Content -Raw -LiteralPath 'docs/fixtures/observe-learn-replay/codex-exec-read-only.jsonl'; Get-Content -Raw -LiteralPath 'docs/fixtures/codex-capture/exec-jsonl-safe-marker.jsonl'
node --check packages/codex-adapter/test/event-shape-offline-investigation.test.mjs
node --test packages/codex-adapter/test/adapter.test.mjs packages/codex-adapter/test/adapter-security.test.mjs packages/codex-adapter/test/event-shape-offline-investigation.test.mjs
git diff --check
$protectedHashes = @{ 'docs/observe-learn-replay-contract-v0.1.md' = '7e92f95dd2fff5e680ebdb84af1db771abc21129'; '.gameplan/footprints/2026-07-22-phase-1-contracts.md' = 'ab39f68c144781e1f005050f0216212fcd8ab93c'; '.gameplan/footprints/2026-07-22-phase-2-read-only-vertical-slice.md' = '8d5d880663711d3b84b8d87e16e6d29307bffad7'; '.gameplan/footprints/2026-07-22-phase-3-safety-privacy-validation.md' = '9d4458ce0589506dffc942f5c5b6d6098dea2ae4'; 'docs/phase-3-safety-privacy-validation.md' = 'd919a27abb0fe6e15e1aad6ea011f0a7de3a11a2'; 'packages/codex-adapter/src/capsule.ts' = '8da227f263ce3d2a013ae4b811f39cd117b0dc0c'; 'packages/codex-adapter/src/types.ts' = '67ae311912a7167bfa8a2e63e7b1046e5a2c0ae9'; 'packages/codex-adapter/src/parser.ts' = '8a857ee7bfcf3c00b7874b1ac4d529abcc649634'; 'packages/codex-adapter/src/runner.ts' = '42a156c85354bcbba4942561f17030795a9922ff'; 'packages/codex-adapter/test/adapter.test.mjs' = '8ceb37294d96549ad5efa875c6ebc74255f7f42e'; 'packages/codex-adapter/test/adapter-security.test.mjs' = '876392b2b450f97af625c292ec1553978327d966'; 'packages/cli/src/index.ts' = 'e84f5b83dbc35c282083c9bc1d49eaa29ffa9267'; 'packages/cli/src/recipe.ts' = 'e3bbfddc6e914f53c28db5653a791748651079b7' }; foreach ($protectedPath in $protectedHashes.Keys) { if ((git hash-object -- $protectedPath) -ne $protectedHashes[$protectedPath]) { Write-Error "Protected artifact changed: $protectedPath"; exit 1 } }
Get-Content -Raw -LiteralPath 'GAMEPLAN.md'
Get-Content -Raw -LiteralPath 'docs/phase-4-event-shape-offline-investigation.md'
Get-Content -Raw -LiteralPath '.gameplan/footprints/2026-07-22-phase-4-measured-validation.md'
git status --short --untracked-files=all
```

Validation authorization: Granted by the user's explicit 2026-07-23 approval for only the exact local, read-only, non-model commands above. It grants no authority for a missing-path substitute, web access, install or update, live capture, changed command, production mutation, grammar change, replay, or external-system action.

Evidence state: Completed on 2026-07-23. All exact approved commands passed. Local documentation exposed no structured executable/argument boundary. The inert synthetic matrix showed that benign-looking envelopes and injection-shaped near misses produce the same embedded-command diagnostic, while plan, write, tool, and network item categories produce the same `unsupported_item` reason. Both categories are unsafe to generalize from current evidence, all 13 protected hashes matched, and no production behavior changed. Detailed evidence is in `docs/phase-4-event-shape-offline-investigation.md`.

### Proposed execution slice: Public README status clarity

Approval context: On 2026-07-23, the user requested an update to the GitHub README. The exact wording, file boundary, completion criteria, footprint, and validation commands below were inferred afterward, so this slice remains proposed and inactive until explicitly approved.

Objective: Make the public README clearly distinguish AgentReceipt's working privacy-safe capture, finalization, and validation product from the experimental observe, learn, and replay work. Explain the current limitation in ordinary language without exposing internal diagnostic history or proposing another architecture.

Allowed files:

- `GAMEPLAN.md`
- `.gameplan/footprints/2026-07-23-readme-status.md`
- `README.md`

Constraints:

- Add one short status section near the top and align the existing project-status section. Preserve the public demo, installation, capture, finalization, validation, simulator, links, and commands unless a minimal wording correction is required for consistency.
- State plainly that privacy-safe receipts, capture, finalization, and validation work today. State separately that learn and replay work in bounded tests but are not reliable for current real Codex runs because the available command/event data is too ambiguous for safe recipe creation.
- Preserve the existing evidence-not-proof, privacy, partial-capture, pre-alpha, and no-overclaim language. Make no speed, token, determinism, safety, correctness, or production-readiness claim for replay.
- Do not mention hooks, MCP, internal approval history, enum names, consumed attempts, personal paths, or private diagnostic details. Do not add new product architecture, roadmap commitments, badges, screenshots, dependencies, generated files, or external changes.
- Modify no source, test, schema, contract, fixture, package, lockfile, workflow, or existing report/footprint. Preserve all pre-existing work; every unlisted path is out of scope.

Completion criteria:

- A new reader can identify in one short section what works today, what is experimental, and why live recipe creation is not currently presented as working.
- Existing public instructions, safety caveats, commands, and links remain intact and internally consistent.
- The README contains no unsupported replay benefit or readiness claim and no internal/private diagnostic detail.
- The task footprint protects every pre-existing dirty path, the only task writes are the three allowed files, and every exact approved validation command passes.

Exact validation commands proposed on 2026-07-23:

```powershell
git diff --check
Get-Content -Raw -LiteralPath 'README.md'
git diff -- README.md
Get-Content -Raw -LiteralPath 'GAMEPLAN.md'
Get-Content -Raw -LiteralPath '.gameplan/footprints/2026-07-23-readme-status.md'
git status --short --untracked-files=all
```

Validation authorization: Not yet granted. If explicitly approved, it applies only to the exact local, non-destructive commands above and authorizes no changed command, build, test, network action, or external mutation.

Evidence state: Proposed. Direct README inspection shows strong public documentation for privacy-safe capture, finalization, and validation, but no current explanation of the implemented experimental learn/replay work or its live-Codex limitation.

### Closed Phase 3 authority record: Safety and privacy validation

Historical approval date and authority: 2026-07-22, explicitly approved by the user as the exact Phase 3 execution slice and validation commands recorded below. The objective, paths, constraints, completion criteria, and validation authorization are retained as the closed authority record and grant no further implementation authority.

Objective: Adversarially validate the Phase 2 read-only observe, learn, and replay loop against credential canaries, unsafe paths, private-artifact publication, command reclassification, parameter injection, stale state, digest mismatch, partial capture, misleading claims, and attempted writes. Repair only safety or privacy defects directly demonstrated by this bounded validation, and preserve direct evidence without adding write replay or broadening the architecture.

Allowed files and directory prefixes:

- `GAMEPLAN.md`
- `.gameplan/footprints/2026-07-22-phase-3-safety-privacy-validation.md`
- `docs/phase-3-safety-privacy-validation.md`
- `packages/codex-adapter/src/capsule.ts`
- `packages/codex-adapter/src/runner.ts`
- `packages/codex-adapter/test/adapter-security.test.mjs`
- `packages/codex-adapter/dist/`
- `packages/cli/src/args.ts`
- `packages/cli/src/git.ts`
- `packages/cli/src/index.ts`
- `packages/cli/src/private-artifacts.ts`
- `packages/cli/src/recipe.ts`
- `packages/cli/src/replay.ts`
- `packages/cli/test/observe-learn-replay-security.test.mjs`
- `packages/cli/dist/`
- `packages/github-action/src/validate.ts`
- `packages/github-action/test/validation.test.mjs`
- `packages/github-action/dist/`
- `packages/github-action/bundle/`

Constraints:

- Treat the Phase 1 contract and completed Phase 2 implementation as the normative boundary. Preserve the public sanitizer, evidence-not-proof trust model, digest-only replay binding, and separate private-artifact boundary.
- Use synthetic credential canaries only. Do not read, request, store, hash, print, or transmit real credentials, environment values, prompts, messages, reasoning, source content, or personal absolute paths.
- Run adversarial cases only through pure validators, controlled stubs, or test-created temporary local Git repositories. Do not invoke a live model, the installed Codex CLI, a shell wrapper, a network-capable process, or any external service.
- Do not inspect, modify, or delete the repository-root `.agentreceipt/`, `.agents/`, or `.codex-scope/` directories. Test artifacts must stay in disposable temporary repositories and be removed by their harnesses.
- Production replay remains deterministic and read-only. Do not add write confirmation, write guards, rollback, new executable grammar, network behavior, automatic recall/search, or any Phase 4 measurement capability.
- Modify production source only when a new adversarial test directly demonstrates a safety or privacy defect. Keep repairs local, fail closed, and avoid refactors or new abstractions.
- Preserve Phase 1 artifacts, the finalized Phase 2 footprint, Phase 2 fixtures, the receipt schema, package and lock files, workspace configuration, workflows, README, contracts, demos, and unrelated documentation. Treat every unlisted path as out of scope.
- The validation report must distinguish direct observation from inference, state limitations, avoid claims of complete observation, safety, correctness, or general determinism, and contain no private artifact contents or credential canary values.

Completion criteria:

- Direct adversarial tests show that credential-like material in capture fields, command material, parameters, environment declarations, private artifacts, and child-process output either makes the operation ineligible or is absent from public receipts, persisted capsules/recipes, CLI output, safe errors, and validation evidence.
- Path and publication tests fail closed for traversal, absolute and drive-qualified paths, reserved private/control paths, links or linked parents, wrong artifact directories, unignored storage, tracked artifacts, overwrite attempts, oversized content, and repository-identity mismatch without touching repository-root private directories.
- Command and parameter tests fail closed for shell wrappers, write-capable or network-shaped commands, unsupported executables and flags, alternate command spellings, partial or ambiguous lifecycle records, missing or duplicate parameters, undeclared environment targets, argument-visible secrets, and injection-shaped values; rejected cases execute no recipe action and write no replay receipt.
- State and integrity tests fail closed for stale Git state, changed file digests, capsule/recipe digest mismatch, source-receipt mismatch, unknown fields, malformed canonical data, failed verification, and post-execution mutation. When execution has begun, the fresh public receipt reports failure without exposing private data or claiming rollback.
- Public replay receipts and GitHub Action validation preserve digest-only binding, privacy screening, honest limitations, and evidence-not-proof language. No capsule/recipe contents, runtime values, credential canaries, personal paths, or stronger safety/correctness/determinism claims appear.
- The evidence report maps every adversarial category and completion criterion to exact tests and directly observed outcomes, records any repaired defect and residual limitation, and makes no speed or token claim.
- Existing Phase 2 behavior remains passing, every task write stays inside the approved paths, protected artifacts retain their locked hashes, the footprint is finalized, and every exact approved validation command passes before closure.

Exact validation commands approved on 2026-07-22:

```powershell
pnpm check
pnpm test
node --test packages/codex-adapter/test/adapter-security.test.mjs packages/cli/test/observe-learn-replay-security.test.mjs
git diff --check
$protectedHashes = @{ 'docs/observe-learn-replay-contract-v0.1.md' = '7e92f95dd2fff5e680ebdb84af1db771abc21129'; '.gameplan/footprints/2026-07-22-phase-1-contracts.md' = 'ab39f68c144781e1f005050f0216212fcd8ab93c'; '.gameplan/footprints/2026-07-22-phase-2-read-only-vertical-slice.md' = '8d5d880663711d3b84b8d87e16e6d29307bffad7' }; foreach ($protectedPath in $protectedHashes.Keys) { if ((git hash-object -- $protectedPath) -ne $protectedHashes[$protectedPath]) { Write-Error "Protected artifact changed: $protectedPath"; exit 1 } }
Get-Content -Raw -LiteralPath 'GAMEPLAN.md'
Get-Content -Raw -LiteralPath 'docs/phase-3-safety-privacy-validation.md'
Get-Content -Raw -LiteralPath '.gameplan/footprints/2026-07-22-phase-3-safety-privacy-validation.md'
git status --short --untracked-files=all
```

Validation authorization: Exercised and closed on 2026-07-22 for only the exact project-local, non-destructive commands above. It grants no standing authority after Phase 3 closure.

Evidence state: Completed on 2026-07-22. Direct adversarial findings, repairs, criterion mapping, command outcomes, and residual limitations are recorded in `docs/phase-3-safety-privacy-validation.md`; task provenance is finalized in `.gameplan/footprints/2026-07-22-phase-3-safety-privacy-validation.md`.

### Closed Phase 2 authority record: Read-only vertical slice

Historical approval date and authority: 2026-07-22, explicitly approved by the user as the exact Phase 2 slice drafted for review. The objective, allowed paths, constraints, completion criteria, and exact validation commands below are retained as the closed authority record and grant no further implementation authority.

Objective: Implement the Phase 1 contract for the owned local `codex exec --json` path so an explicitly enabled eligible capture can produce a private capsule, `learn` can create one canonical parameterized recipe, and guarded `replay` can dry-run or execute the deterministic read-only recipe, verify it, detect repository mutation, and emit a fresh public receipt bound to the recipe digest. Prove the loop with one harmless fixture-driven local test; do not make speed or token claims.

Allowed files and directory prefixes:

- `GAMEPLAN.md`
- `.gameplan/footprints/2026-07-22-phase-2-read-only-vertical-slice.md`
- `docs/fixtures/observe-learn-replay/codex-exec-read-only.jsonl`
- `docs/fixtures/observe-learn-replay/input.txt`
- `docs/fixtures/observe-learn-replay/manifest.json`
- `packages/codex-adapter/src/capsule.ts`
- `packages/codex-adapter/src/index.ts`
- `packages/codex-adapter/src/runner.ts`
- `packages/codex-adapter/src/types.ts`
- `packages/codex-adapter/test/adapter.test.mjs`
- `packages/codex-adapter/dist/`
- `packages/cli/src/args.ts`
- `packages/cli/src/format.ts`
- `packages/cli/src/git.ts`
- `packages/cli/src/index.ts`
- `packages/cli/src/json.ts`
- `packages/cli/src/private-artifacts.ts`
- `packages/cli/src/recipe.ts`
- `packages/cli/src/replay.ts`
- `packages/cli/src/types.ts`
- `packages/cli/test/cli.test.mjs`
- `packages/cli/test/git-verification.test.mjs`
- `packages/cli/test/observe-learn-replay.test.mjs`
- `packages/cli/dist/`
- `packages/schema/schemas/receipt.v0.1.schema.json`
- `packages/schema/examples/valid/replay.json`
- `packages/schema/test/schema.test.mjs`
- `packages/schema/dist/`
- `packages/github-action/test/validation.test.mjs`
- `packages/github-action/dist/`
- `packages/github-action/bundle/`

Constraints:

- Treat `docs/observe-learn-replay-contract-v0.1.md` as the normative, read-only implementation contract. Do not modify it or the finalized Phase 1 footprint.
- Preserve the existing public Codex sanitizer and metadata-only receipt projection. The private projection must be separately and explicitly enabled, derived in memory from the owned live stream, and never added to the public capture result.
- Keep the implementation to the exact fixture-required direct-process and file-assertion grammar. Do not add a general shell parser, command framework, adapter platform, workflow engine, automatic recall/search, or speculative format abstraction.
- Replay must use direct process execution with no shell, network, interaction, randomness, clock-dependent behavior, or write-capable action. Unknown executables, flags, command forms, paths, recipe fields, and event forms fail closed.
- Dry run executes no recipe action, resolves no secret value, and writes no receipt. Once actual replay execution begins, attempt a fresh receipt for success or failure; a preflight failure writes none.
- Private capsules and local recipes must stay beneath verified ignored and untracked `.agentreceipt` paths, use bounded and exclusive atomic I/O, reject links and traversal, and never enter fixtures, logs, public receipts, or command output.
- Do not inspect, modify, or delete the pre-existing repository-root `.agentreceipt/`, `.agents/`, or `.codex-scope/` directories. Every runtime artifact created by tests must live in a test-created temporary Git repository and be removed by the test harness.
- Secret values may enter replay only from the environment into a reviewed child environment. They may not enter AgentReceipt arguments, executable arguments, persisted artifacts, hashes, logs, output, or receipts. Ambiguous or command-visible secret material fails closed.
- The source public receipt remains immutable. A recipe binds backward to its source-receipt digest; an executed replay receipt binds forward through `extensions.dev.agentreceipt.recipe-replay` and uses `capture.surface: agentreceipt_recipe_replay`.
- Make only the additive replay-surface schema change. Existing v0.1 receipts, integrity behavior, finalization allowlist, privacy screening, and GitHub Action validation must remain compatible.
- Use only existing dependencies and toolchain. Do not modify `package.json` files, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, TypeScript configuration, workflows, `README.md`, product/privacy/capture/finalization contracts, demos, or unrelated documentation.
- The fixture must use harmless fixed data and a deterministic local test executable that transparently emulates the documented Codex JSONL stream. It must not invoke a model, make a network request, claim to be a live Codex measurement, or persist a capsule or recipe in the repository.
- Phase 3 adversarial validation, Phase 4 measured comparison, write replay, and every later capability remain unapproved. Treat every unlisted path as out of scope.

Completion criteria:

- An explicitly enabled owned capture produces the unchanged sanitized public receipt plus a separate minimal capsule only when the source run, independent Git state, safe file verification, structured actions, parameters, secret screen, and eligibility checks all pass. Ineligible or ambiguous captures produce no capsule and only fixed safe errors.
- Capsule and recipe validators enforce the Phase 1 field allowlists, 1 MiB bounds, RFC 8785/SHA-256 integrity, repository identity, ignored/untracked containment, link and traversal rejection, create-exclusive atomic publication, and absence of prompts, messages, reasoning, outputs, source content, personal absolute paths, and secret values.
- `learn` validates one capsule and writes one new reviewable canonical JSON recipe without mutating the capsule or source receipt, calling a model, retrieving external context, overwriting an artifact, or broadening unsupported actions.
- `replay --dry-run` completes the same recipe, repository, executable/version, file-digest, parameter, secret-name, and read-only policy preflight as execution while running no step and writing no replay receipt.
- Actual `replay` directly executes only the fixture allowlist, drains output without retaining it, injects declared secrets only through the child environment, stops on failure, runs independent verification, compares repository state before and after, reports a read-only violation without rollback, and emits a fresh schema-valid public receipt after execution begins.
- The replay receipt uses the additive `agentreceipt_recipe_replay` surface and the exact digest-only `dev.agentreceipt.recipe-replay` extension, contains no capsule/recipe contents or runtime values, passes shared schema and privacy validation, and preserves the extension and digest binding through existing finalization behavior.
- One harmless fixture-driven test demonstrates the complete owned-runner path from JSONL capture through private capsule, parameterized recipe creation, dry run, actual read-only replay, independent verification, mutation check, and fresh receipt. The test explicitly identifies its local Codex-stream emulation and makes no live-model, speed, token, safety, correctness, or general-determinism claim.
- Core negative tests show that malformed or partial capture, unsupported or shell-wrapped commands, writes, network-capable actions, unsafe paths, stale repository/file state, digest mismatch, missing parameters, secret leakage, dry-run execution, and replay mutation fail closed. Broader adversarial coverage remains Phase 3.
- Existing schema, adapter, CLI, finalization, and GitHub Action tests remain passing; the generated Action bundle includes the additive schema behavior; no dependency, package, lockfile, workflow, contract, or unrelated file changes.
- Direct inspection verifies that every task write stayed within the allowed files and prefixes, both protected Phase 1 artifacts retain their pre-Phase-2 Git blob hashes, the task footprint is finalized, and all exact approved validation commands pass before closure.

Exact validation commands approved on 2026-07-22:

```powershell
pnpm check
pnpm test
node --test packages/cli/test/observe-learn-replay.test.mjs
git diff --check
$protectedHashes = @{ 'docs/observe-learn-replay-contract-v0.1.md' = '7e92f95dd2fff5e680ebdb84af1db771abc21129'; '.gameplan/footprints/2026-07-22-phase-1-contracts.md' = 'ab39f68c144781e1f005050f0216212fcd8ab93c' }; foreach ($protectedPath in $protectedHashes.Keys) { if ((git hash-object -- $protectedPath) -ne $protectedHashes[$protectedPath]) { Write-Error "Protected Phase 1 artifact changed: $protectedPath"; exit 1 } }
Get-Content -Raw -LiteralPath 'GAMEPLAN.md'
Get-Content -Raw -LiteralPath '.gameplan/footprints/2026-07-22-phase-2-read-only-vertical-slice.md'
git status --short --untracked-files=all
```

Validation authorization: Exercised and closed on 2026-07-22 for the exact project-local commands above. It grants no standing authority after Phase 2 closure.

Evidence state: Completed on 2026-07-22. The direct evidence is summarized under Current State, and exact task provenance is finalized in `.gameplan/footprints/2026-07-22-phase-2-read-only-vertical-slice.md`.

## Workstreams

The locked plan has four top-level phases. They execute in order, and each phase requires separate approval. There are no sub-phases.

### Phase 1: Contracts and boundaries

Define the private capsule, canonical JSON recipe, learning, replay, and public receipt-binding contracts. This phase resolves eligibility, minimal fields, secret parameterization, repository-relative paths, integrity, ignored and untracked storage, retention, deterministic preconditions, dry-run semantics, verification, safe failure behavior, and the smallest honest public replay representation. It completes when the contracts are reviewable, mutually consistent, preserve the v0.1 public privacy and trust boundaries, and answer the decision-relevant open questions without changing implementation.

### Phase 2: Read-only vertical slice

Implement the contracts for the owned `codex exec --json` path, one `learn` command, one guarded `replay` command, and one harmless local fixture. The existing sanitized public capture remains intact; the separate capsule supports recipe learning; dry run executes nothing; actual replay permits only deterministic read-only shell and file behavior; verification produces a fresh receipt bound to the recipe digest. It completes when the entire bounded loop works locally and unsupported, nondeterministic, or write-capable behavior fails closed.

### Phase 3: Safety and privacy validation

Adversarially validate the new private boundary and replay guardrails against credential canaries, unsafe paths, capsule publication, command reclassification, stale repository state, parameter injection, digest mismatch, partial capture, misleading claims, and attempted writes. It completes when direct evidence shows that private material stays out of public receipts and safe logs, capsules remain ignored and untracked, and every tested unsafe condition fails closed. This phase does not authorize write replay.

### Phase 4: Measured validation and decision

Run the harmless original Codex baseline and replay under stated comparable conditions, validate the capsule-to-recipe digest chain and fresh-receipt compatibility, and report wall-clock and token evidence only where directly observable. It completes with a bounded evidence-backed conclusion about the read-only loop and a decision on whether any later capability deserves a new proposal. One passing fixture demonstrates only the declared slice, not general deterministic replay.

## Current State

### Completed

- The v0.1 product, privacy, capture, finalization, schema, CLI, and GitHub Action contracts are present and implemented. The README and contracts explicitly limit receipts to structured evidence and reject claims of complete observation, safety, correctness, or truth.
- The current Codex adapter owns `codex exec --json`, sanitizes each JSONL record in memory, replaces source IDs with receipt-local IDs, and deliberately discards command text/output, prompts, messages, reasoning, source content, and tool arguments. Unknown, malformed, truncated, or failed streams remain visibly partial or failed (`packages/codex-adapter/src/parser.ts`, `packages/codex-adapter/src/runner.ts`).
- The CLI combines sanitized adapter events with independently collected Git and verification evidence to create metadata-only draft receipts (`packages/cli/src/codex.ts`). The current output is intentionally insufficient for recipe generation because replay-essential command/file structure has already been discarded.
- The v0.1 JSON Schema has a reverse-DNS namespaced `extensions` object, and receipt integrity covers extensions because only `integrity` and `attestation` are omitted from the content digest (`packages/schema/schemas/receipt.v0.1.schema.json`, `packages/schema/src/integrity.ts`). The current capture-surface enum does not identify recipe replay; Phase 1 validated digest-only extension binding and requires one additive replay surface in any approved Phase 2.
- Phase 1 is complete. `docs/observe-learn-replay-contract-v0.1.md` defines the separate private capsule, one canonical JSON recipe, eligibility and parameter rules, learning and guarded read-only replay, verification, safe failure behavior, measurement boundaries, and digest-only public receipt binding. It preserves the existing public sanitizer and v0.1 trust, privacy, capture, integrity, and finalization semantics.
- Phase 2 is complete. The owned Codex runner can separately and explicitly project an eligible private capsule without changing the public sanitizer; `learn` produces one bounded canonical recipe; and guarded read-only `replay` performs preflight, dry run, direct execution, independent verification, mutation detection, and fresh public receipt creation with digest-only recipe binding.
- Phase 3 is complete. Bounded adversarial validation found and repaired two fail-closed gaps: credential-shaped data is now rejected before private-artifact publication, and credential-shaped public replay parameters are rejected before preflight subprocess arguments. The final suites preserve the Phase 2 loop, public receipt boundary, digest-only binding, and evidence-not-proof claims; detailed evidence and limitations are in `docs/phase-3-safety-privacy-validation.md`.
- The Phase 4 offline event-shape safety investigation is complete. Local documentation and inert adversarial tests show that the current embedded-command and unsupported-item categories are too coarse to justify safe normalization or ignoring. Production behavior remains fail-closed; detailed evidence and prerequisites are in `docs/phase-4-event-shape-offline-investigation.md`.

Phase 1 closure evidence, observed on 2026-07-22 in America/New_York:

| Completion criterion | Direct evidence | Outcome |
|---|---|---|
| Normative contract covers the approved boundary | Exact raw read of `docs/observe-learn-replay-contract-v0.1.md` | Exit 0; the contract defines capsule, recipe, learn, replay, secrets, storage, eligibility, verification, and public binding. |
| Both open questions are resolved without weakening v0.1 | Exact raw read of the contract and its preserved-existing-contract, parameter, and public-receipt sections | Exit 0; environment-only secret injection fails closed, and digest-only extension metadata is paired with one additive honest replay surface. |
| Phase 2 has an implementable bounded contract but no authority | Exact raw read of the contract's product boundary and Phase 2 acceptance boundary | Exit 0; the future slice is limited to the owned Codex path, deterministic read-only actions, and one harmless fixture. |
| All task writes stayed within the approved files | Exact `git status --short --untracked-files=all` | Exit 0; only `GAMEPLAN.md`, the contract, and the Phase 1 footprint are present as task changes. No implementation file is changed. |
| Approved validation passed and provenance is finalized | Exact raw reads of all three files, the approved trailing-whitespace check, and Git status | All commands exited 0; the footprint state is `finalized` with no cleanup obligations. |

Phase 2 closure evidence, observed on 2026-07-22 in America/New_York:

| Completion criterion | Direct evidence | Outcome |
|---|---|---|
| Source and generated outputs compile across the adapter, schema, CLI, and Action | Exact `pnpm check` after one in-slice TypeScript narrowing correction | Exit 0. |
| Existing behavior and additive replay compatibility remain passing | Exact `pnpm test` | Exit 0; all 63 tests passed across adapter, schema, Action, and CLI. |
| The bounded local loop and private storage boundary work end to end | Exact `node --test packages/cli/test/observe-learn-replay.test.mjs` | Exit 0; both the full fixture loop and private-artifact rejection test passed. |
| Patch formatting is clean | Exact `git diff --check` | Exit 0; only Git line-ending notices were emitted. |
| Phase 1 artifacts remain immutable | Exact protected-hash command from the closed slice | Exit 0 for both locked Git blob hashes. |
| Plan, footprint, and workspace scope are directly inspectable | Exact raw reads and `git status --short --untracked-files=all` | Exit 0; every task change is a protected Phase 1 artifact or an approved Phase 2 path, and no package, lockfile, workflow, or unrelated file changed. |

### Active

- Phase 4 remains active under the exact previously approved slice. The narrow non-model diagnostic and all of its exact validation commands completed with zero live attempts and classification `unresolved` after its three bounded preflights passed. The earlier source capture, capsule, recipe, replay, digest-chain, and measurement criteria remain incomplete. The footprint remains active at `.gameplan/footprints/2026-07-22-phase-4-measured-validation.md`.
- The exact hermetic-capture repair is implemented, and its four pre-live local commands passed. The single permitted replacement attempt stopped at `live_capture` with `capsule_ineligible`; source capture, capsule creation, learning, replay, digest-chain validation, and measurement remain incomplete. Detailed evidence is in `docs/phase-4-measured-validation.md`.
- The exact privacy-safe event-shape diagnostic amendment is complete. Its local gates passed, and its single permitted live attempt safely classified an embedded allowlisted command plus unsupported item material without persisting or publishing raw event data. The diagnostic attempt is consumed.
- The public README status update is requested, but its inferred exact documentation-only slice and commands remain proposed and inactive pending explicit approval.

### Blocked

- The measured comparison remains blocked because the only approved replacement attempt returned `capsule_ineligible`. The later diagnostic narrowed the observed causes to an embedded allowlisted command and unsupported item material, but did not establish that either can be normalized or ignored safely. The approved authority forbids grammar expansion, raw event retention, and another retry.
- Every capability after Phase 4 remains unapproved.

## Task Footprint

Active: `.gameplan/footprints/2026-07-22-phase-4-measured-validation.md`. The finalized Phase 1 through Phase 3 footprints remain protected and retained.

## Next Move

Approve or revise the exact proposed public README status-clarity slice and validation commands. If approved, update only the README, GamePlan, and one task footprint; make no product or code change.

## Open Questions

None currently. Phase 1 resolved the earlier public-binding question with the existing namespaced extension plus one additive replay capture-surface value, and resolved the secret-input question with environment-only runtime injection and fail-closed rejection of argument-visible or ambiguous secret material.

## Decisions

- 2026-07-24 - Publish and retain the canonical root `GAMEPLAN.md` in `robertbradley-oss/agentreceipt` as durable project context. Keep `.gameplan/` evidence, ignored private artifacts, and unrelated work outside the public repository by default.
- 2026-07-22 - Superseded: the earlier draft described the observe, learn, and replay direction as locked. The user clarified that the GamePlan is not approved, so it is now explicitly a proposal awaiting approval.
- 2026-07-22 - Approved by this Lock: separate the public receipt from a private local capsule so recipe-essential structured execution data has a distinct non-publishable boundary.
- 2026-07-22 - Approved by this Lock: use one versioned canonical JSON recipe format because it fits the existing schema and canonical-digest tooling without introducing a format abstraction.
- 2026-07-22 - Approved by this Lock: limit initial implementation to Codex CLI, local repositories, deterministic read-only shell and file behavior, and one harmless fixture.
- 2026-07-22 - Approved by this Lock: treat dry run as non-executing preflight and require every actual replay attempt to emit a fresh receipt.
- 2026-07-22 - Approved by this Lock: defer exact public recipe and replay fields until extension, integrity, privacy, finalization, and validation behavior are checked together.
- 2026-07-22 - Approved by this Lock: require measured baseline-versus-replay evidence before making speed or token claims.
- 2026-07-22 - Approved by this Lock: use rote concepts only as product inspiration and avoid parity or architectural imitation.
- 2026-07-22 - Approved by this Lock: organize the GamePlan into four top-level phases with no steps or sub-phases. Each phase requires separate explicit approval, and completing one phase does not approve the next.
- 2026-07-22 - Lock the phased observe, learn, and replay plan as the canonical strategic authority. No execution slice or phase implementation is approved; Phase 1 remains the next proposal.
- 2026-07-22 - Approve the exact Phase 1 Contracts and boundaries execution slice, including its three allowed files, documentation-only constraints, completion criteria, exact validation commands, and standing validation authority. Phase 2 remains unapproved.
- 2026-07-22 - Resolve public replay binding with `extensions.dev.agentreceipt.recipe-replay` carrying only the recipe and source-receipt digests, plus the additive `agentreceipt_recipe_replay` capture surface. The source receipt remains immutable because back-patching would invalidate its existing digest and lifecycle.
- 2026-07-22 - Resolve secret inputs with environment-only runtime injection into a reviewed direct child process. Secret values are forbidden from AgentReceipt CLI arguments, recipe arguments, persistence, hashing, logs, and receipts; missing, exposed, or ambiguous material fails closed.
- 2026-07-22 - Complete and close Phase 1 after all approved validation commands passed and the task footprint was finalized. Clear the Approved Execution Slice to `None approved`; Phase 2 remains a proposal requiring separate approval.
- 2026-07-22 - Approve the exact Phase 2 read-only vertical slice as drafted, including its objective, allowed paths, constraints, and completion criteria. Its exact validation commands remain separately unapproved, and Phase 3 remains unapproved.
- 2026-07-22 - Keep the Phase 2 executable grammar to direct `git hash-object --no-filters` over tracked safe repository files. Secret-bearing actions remain unsupported until an approved direct executable genuinely consumes a declared environment parameter; unused or ambiguous secret declarations fail closed.
- 2026-07-22 - Approve the exact Phase 2 validation commands listed in this slice with standing authority limited to those project-local commands. Changed, added, destructive, external, live-Codex, or networked validation remains unauthorized.
- 2026-07-22 - Complete and close Phase 2 after the exact approved validation commands passed, the protected Phase 1 hashes matched, all observed writes stayed in scope, and the Phase 2 footprint was finalized. Clear implementation authority to `None approved`; Phase 3 remains a proposal.
- 2026-07-22 - Approve the Phase 3 safety and privacy validation objective. Because exact paths, detailed criteria, commands, and validation authority were inferred afterward, retain the complete slice as proposed until one explicit approval activates it.
- 2026-07-22 - Approve the exact Phase 3 safety and privacy validation slice and its exact project-local validation commands. Phase 4 remains unapproved.
- 2026-07-22 - Harden the existing boundary only where Phase 3 produced direct failing evidence: screen credential-shaped private-artifact content before publication and credential-shaped public replay parameters before preflight subprocess arguments. Keep the screen pattern-based and retain the explicit limitation that it is not general secret-classification proof.
- 2026-07-22 - Complete and close Phase 3 after the repaired adversarial suite, existing package tests, formatting check, protected hashes, raw evidence reads, and workspace-scope inspection all passed. Clear implementation authority to `None approved`; Phase 4 remains a proposal.
- 2026-07-22 - Approve the Phase 4 measured-validation objective. Because the exact paths, single live-model limit, completion criteria, commands, and validation authority were inferred afterward, retain the complete slice as proposed until one explicit approval activates it.
- 2026-07-22 - Bound the proposed live comparison to one harmless Codex attempt with no retry. This controls model spend and prevents a failed or ineligible capture from silently broadening the evidence base.
- 2026-07-22 - Approve the exact Phase 4 measured-validation slice and its exact validation commands. The authority is limited to four workspace files, one disposable repository, and at most one live Codex attempt with no retry; every later capability remains unapproved.
- 2026-07-22 - Approve one narrow, non-model diagnostic objective for the Phase 4 capture failure. Because the exact harness behavior, paths, criteria, and commands were inferred afterward, keep the complete amendment proposed and inactive until explicit approval. This does not authorize a live retry.
- 2026-07-22 - Approve the exact Phase 4 non-model diagnostic amendment and its exact validation commands. Authority is limited to the existing four Phase 4 files, one zero-live-run diagnostic execution, and the listed local checks; no live retry is authorized.
- 2026-07-23 - Record the user's request to fix the Phase 4 capture failure. The exact repair mechanics, files, one-replacement-attempt boundary, criteria, and commands were inferred afterward, so retain the complete amendment as proposed and inactive until explicit approval.
- 2026-07-23 - Preserve the strict recipe grammar while proposing a hermetic owned Codex invocation with documented user-config and rules isolation. The consumed run did not retain raw event evidence sufficient to justify accepting shell wrappers or weakening fail-closed parsing.
- 2026-07-23 - Approve the exact hermetic-capture repair amendment and its exact validation commands. Authority is limited to the listed adapter, harness, report, footprint, generated adapter distribution, and GamePlan paths plus at most one replacement live Codex attempt; no shell-wrapper support or further retry is authorized.
- 2026-07-23 - Complete the hermetic runner and safe failure-classification repair, but keep Phase 4 active and incomplete after the single replacement attempt returned `capsule_ineligible`. Do not infer a private event-shape cause, accept shell wrappers, weaken fail-closed parsing, or make another live attempt from this bounded result.
- 2026-07-23 - Approve the privacy-safe event-shape diagnostic objective. Because the exact enum surface, paths, one-live-attempt limit, criteria, and commands were inferred afterward, retain the complete amendment as proposed and inactive until explicit approval.
- 2026-07-23 - Approve the exact privacy-safe event-shape diagnostic amendment and exact validation commands. Authority is limited to the listed private-projection, test, harness, report, footprint, generated adapter distribution, and GamePlan paths plus at most one diagnostic live Codex attempt; no measurement retry or grammar change is authorized.
- 2026-07-23 - Complete the privacy-safe event-shape diagnostic after all pre-live gates passed and its single attempt classified `allowlisted_command_embedded` with additional `unsupported_item`, `no_action`, and `parameter_unused` reasons. Preserve fail-closed rejection: the enum evidence does not identify or prove safe any wrapper or unsupported item, and it authorizes no normalization, retry, replay, comparison, or benefit claim.
- 2026-07-23 - Approve the narrow offline event-shape safety investigation objective. Because its exact paths, synthetic matrix, criteria, and commands were inferred afterward, retain the complete amendment as proposed and inactive until explicit approval; authorize no production change or live retry from the objective alone.
- 2026-07-23 - Approve the exact offline event-shape safety investigation slice and exact validation commands. Authority is limited to four write paths, installed and checked-in local documentation, inert synthetic JSONL records, and the listed non-model commands; no production mutation, web access, live retry, or grammar expansion is authorized.
- 2026-07-23 - Complete the offline event-shape safety investigation with no production change. Keep both observed categories fail-closed because current documentation lacks a structured argument boundary, embedded wrappers are indistinguishable from injection-shaped strings, and `unsupported_item` conflates plan, write, tool, and network categories. Reconsider only on the documented refresh prerequisites.
- 2026-07-23 - Record the user's request to update the GitHub README. Because the exact wording, paths, footprint, criteria, and commands were inferred afterward, retain the documentation-only slice as proposed and inactive until explicit approval.

## Refresh Triggers

- Codex adds, removes, or changes documented JSONL event capabilities relevant to structured commands, file operations, timestamps, model/version identity, verification, or replay determinism.
- A privacy review, secret canary, path test, or real capture shows that capsule data can expose credentials, source content, personal data, or publishable private state.
- Direct fixture evidence shows that the read-only vertical slice cannot be replayed safely, deterministically, or verifiably under the declared preconditions.
- The existing schema extension, digest, finalization, or Action validation behavior cannot bind replay metadata without weakening the public contract.
- Baseline and replay measurements are not comparable enough to support a bounded benefit claim.
- Product demand requires write replay, nondeterministic steps, automatic recall/search, another agent surface, remote execution, or sharing; each requires an explicit strategy review rather than silent expansion.

## Last Refreshed

2026-07-24 - The user approved publishing the canonical root `GAMEPLAN.md` in the public AgentReceipt repository while retaining `.gameplan/` evidence, ignored private artifacts, and unrelated work outside the repository. The README status slice remains proposed and inactive.
