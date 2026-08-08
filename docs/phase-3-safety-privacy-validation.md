# Phase 3 Safety and Privacy Validation

Observed: 2026-07-22 (America/New_York)

## Scope

This report records bounded adversarial validation of the local Codex read-only observe, learn, and replay slice. It uses synthetic canaries, pure validators, controlled process stubs, and disposable local Git repositories. It does not invoke a model, the installed Codex CLI, a shell wrapper, a network-capable process, or an external service.

## Evidence

The first exact Phase 3 adversarial run exited 1 with two missing fail-closed rejections while the other 11 tests passed. Those failures directly demonstrated that the generic private-artifact writer could publish a credential-shaped value and that a credential-shaped public replay parameter could pass into preflight. No external system, model, live Codex process, network-capable process, or repository-root private directory was involved.

The bounded repairs add the existing credential-pattern screen to private-artifact publication and reject credential-shaped public parameters before tracked-file or hashing preflight. No command grammar, write behavior, schema, package, workflow, or public receipt field changed.

The final direct observations were made on 2026-07-22 in America/New_York:

| Area | Exact evidence | Exit or observation | Result |
|---|---|---|---|
| Existing type and package boundaries | `pnpm check` after the repairs | Exit 0 | Adapter, schema, CLI, and GitHub Action type checks passed. |
| Existing behavior and Action privacy/integrity | `pnpm test` after the repairs | Exit 0 | All existing package tests passed, including replay schema/finalization, credential screening, path/link rejection, and digest-only Action validation. |
| Phase 2 continuity plus Phase 3 adversarial coverage | `node --test packages/codex-adapter/test/adapter-security.test.mjs packages/cli/test/observe-learn-replay-security.test.mjs` after the repairs | Exit 0 | All 13 tests passed, including the imported complete Phase 2 loop. |
| Patch formatting | `git diff --check` | Exit 0 | No whitespace error; Git emitted only line-ending notices. |
| Protected Phase 1/2 artifacts | Exact approved three-path Git blob hash command | Exit 0 | The Phase 1 contract and the finalized Phase 1 and Phase 2 footprints retain their locked hashes. |
| Workspace scope | `git status --short --untracked-files=all` | Exit 0 | New Phase 3 paths and the two approved overlapping CLI sources are in scope; all other listed changes are protected pre-existing Phase 1/2 work. |

## Adversarial coverage

| Category | Direct tests | Observed outcome |
|---|---|---|
| Credential and private-data screening | Adapter discarded-field and owned-runner tests; CLI validator, private-writer, replay-parameter, and fresh-receipt tests; existing GitHub Action credential test | Credential-shaped command material is ineligible; discarded prompt/message/reasoning/output data is absent; persistence and public-parameter preflight fail before publication or subprocess arguments; public reports and receipts contain no canary value. |
| Unsafe paths and private-artifact publication | CLI private-artifact security test plus the imported Phase 2 traversal/unignored/tracked/oversize test and existing Action path/link tests | Traversal, absolute or wrong-kind paths, backslashes, linked parents, hard-linked files, overwrites, malformed data, unignored paths, tracked artifacts, and oversized content fail closed. |
| Command reclassification and parameter injection | Adapter command/lifecycle tests and CLI recipe/parameter tests | Shell wrappers, alternate spellings, unsupported executables/flags, write/network-shaped commands, reserved paths, unknown fields, duplicate/extra/missing parameters, injection-shaped values, and secret targets execute no replay action and write no replay receipt. |
| State, linkage, and integrity | CLI stale-state/integrity/repository/source-linkage test plus the imported Phase 2 stale-file, digest-tamper, and mutation checks | Dirty or stale state, file/digest mismatch, recipe tampering, repository mismatch, missing source linkage, and post-execution mutation fail closed; preflight failures write no receipt. |
| Fresh receipt and claims boundary | CLI post-execution mutation test plus existing replay schema/finalization/Action tests | Execution-started mutation emits one schema-valid failed receipt with digest-only binding, honest limitations, no private/runtime values, and no rollback claim. Finalization and Action validation preserve the binding. |

## Findings and repairs

| Finding | Direct failing evidence | Repair | Final evidence |
|---|---|---|---|
| Credential-shaped data could be written through the generic private-artifact publisher. | Initial exact Phase 3 adversarial command: private-artifact test reported a missing expected rejection. | `packages/cli/src/private-artifacts.ts` screens bounded serialized content with the established credential patterns before destination creation. | Final exact Phase 3 adversarial command exited 0; the test also confirms no destination was created. |
| A credential-shaped public recipe parameter could reach tracked-file preflight. | Initial exact Phase 3 adversarial command: replay-parameter test reported a missing expected rejection. | `packages/cli/src/replay.ts` rejects credential-shaped supplied public values before executable/version/file preflight and retains a defense at path resolution. | Final exact Phase 3 adversarial command exited 0; tracked-file probes, recipe actions, and receipt writes remain zero. |

## Completion-criterion mapping

| Criterion | Direct evidence and observed outcome |
|---|---|
| Credential material is ineligible or absent from persisted/public artifacts and safe output. | Final adapter and CLI security suites exited 0; existing Action privacy test passed under `pnpm test`. |
| Unsafe path and publication cases fail closed. | Final CLI security suite and imported Phase 2 storage test exited 0; existing Action link/path tests passed. |
| Unsupported commands and parameters execute nothing. | Final adapter and CLI security suites exited 0 and directly asserted zero execution and zero receipt writes for rejected replay cases. |
| Stale state, integrity/linkage mismatch, failed verification, and mutation fail closed. | Final CLI security suite and imported Phase 2 loop exited 0; execution-started mutation produced a fresh failed receipt. |
| Public replay receipts retain privacy, digest-only binding, and honest claims. | Final CLI security suite validated the fresh receipt; existing schema, finalization, and Action tests passed under `pnpm test`. |
| Evidence is reviewable and bounded. | This report names the exact tests, initial failures, repairs, final outcomes, and residual limitations without private artifact contents or canary values. |
| Existing behavior, protected artifacts, and file scope remain intact. | Final `pnpm check`, `pnpm test`, formatting, protected-hash, and status inspections exited 0. |

## Limitations

- These tests cover only the declared Codex CLI, local repository, direct `git hash-object --no-filters`, and file-assertion surface.
- Credential screening is pattern-based and fail-closed for the tested classes; it is not a general secret-classification proof.
- Passing results do not prove complete observation, safety, correctness, or general determinism.
- No write replay, rollback behavior, live Codex behavior, speed comparison, or token-benefit claim is evaluated.
