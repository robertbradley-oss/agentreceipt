# Receipt finalization feasibility spike

Status: **CONDITIONAL GO**

Date: 2026-07-18

## Decision

AgentReceipt can bind a receipt to the resulting Git commit without weakening validation, but only if the canonical finalized receipt is generated **after** that commit and remains outside the commit it identifies. The finalized receipt is a workflow artifact, not a file whose final bytes are stored inside the bound commit.

Implementation must first preserve three distinct Git facts:

1. `capture_start_sha`: repository `HEAD` immediately before capture;
2. `capture_end_sha`: repository `HEAD` immediately after capture, before finalization; and
3. the review binding: GitHub review base plus resulting event head.

The current two-field model cannot represent all three without overwriting evidence. Therefore the implementation milestone is a conditional GO that requires additive schema evolution before a public `finalize` command.

## Why an in-commit final receipt is impossible

A Git commit identifies a tree plus its parent and commit metadata. Changing a receipt inside that tree changes the tree and therefore produces another commit identifier. Git's commit-object documentation describes the commit as being created from an existing tree and parent objects: [git-commit-tree](https://git-scm.com/docs/git-commit-tree.html).

That creates this loop:

1. create commit `X`;
2. write `X` into `receipt.json`;
3. commit the changed receipt;
4. obtain commit `Y`, so the receipt still points to `X`;
5. repeat indefinitely.

The safe boundary is post-checkout finalization:

```text
sanitized draft in commit X
          |
          v
GitHub checks out the event head
          |
          v
finalizer verifies draft + Git relationships
          |
          v
canonical finalized receipt at an ignored, untracked workspace path
          |
          v
validation, then later attestation/upload
```

The draft is transport input. The separate finalized artifact is the canonical event-bound receipt.

## GitHub event constraint

For `pull_request`, GitHub documents that `GITHUB_SHA` normally identifies the synthetic merge commit, while `github.event.pull_request.head.sha` identifies the pull-request head. The finalizer must use the event head and the workflow must explicitly check out that head before finalization. See [Events that trigger workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows).

For `push`, the resulting head is `GITHUB_SHA`; a meaningful nonzero `before` value is the review base for this narrow model. New-branch pushes have no usable previous commit and must leave review base absent.

## Harmless lifecycle experiment

The spike created a temporary Git repository using a synthetic identity and deterministic timestamps. It created:

- review base `a1debe0492c7be67c4286856312ca489e5b1047f`;
- pre-existing feature work at capture start `d9c79a806386f65ca663567657a56e9a4264c200`;
- result head `a7034eadbf649dabd942a41e669ddcb1cb8570ed`; and
- an in-commit rewrite at `f55d62815b5946a9f7ab2d4195b82ddba1943da2`.

Only metadata was retained in [the sanitized fixture](fixtures/receipt-finalization/manifest.json). The temporary repository was removed after the checks.

| Check | Result |
| --- | --- |
| Review base is an ancestor of result head | Pass |
| Capture start is an ancestor of result head | Pass |
| Draft digest changed when binding fields changed | Pass |
| Separate finalized artifact passed current Action validation | Pass |
| Finalized output was workspace-local, ignored, and untracked | Pass |
| Tampering after digest creation was rejected | Pass |
| Preserving draft `base_sha` failed PR review-base binding | Pass, expected failure |
| Writing the finalized receipt into the repository changed the bound SHA | Pass, trap demonstrated |
| In-commit receipt failed strict Action binding | Pass, expected failure |

## Base-SHA ambiguity

The current Codex adapter writes:

- `repository.base_sha` from `HEAD` before capture; and
- `repository.head_sha` from `HEAD` after capture.

The GitHub Action interprets those same fields as:

- pull-request or push review base; and
- event result head.

Those values happen to align on a new one-task branch where capture begins directly from the review base and no commit is created during capture. They diverge when a feature branch already contains commits or when the agent creates commits during capture.

The experiment included an existing feature commit. Keeping the draft's capture-start value in `base_sha` correctly failed the Action's review-base comparison. Replacing it with the review base passed, but would erase the capture-start fact unless new fields preserve it.

## Required trust wording

The finalized digest shows whether the finalized JSON changed after the digest was calculated. A future GitHub attestation can establish which workflow produced that artifact and the repository context associated with it. Neither establishes that every event or summary inside the receipt is factually true.

GitHub makes the same boundary explicit: artifact attestations provide provenance and integrity information, but are not a guarantee that an artifact is secure. See [Artifact attestations](https://docs.github.com/en/actions/concepts/security/artifact-attestations).

AgentReceipt must use these claims independently:

- **Schema validity:** the receipt follows the contract.
- **Internal consistency:** digest, Git relationships, and summarized file evidence agree with independently inspected state.
- **Integrity:** the finalized bytes have not changed since the digest or signature.
- **Provenance:** an attestation identifies the workflow and repository context that produced the artifact.
- **Truthfulness:** not cryptographically established; the local capture source can still omit or fabricate events.

## Failure cases and required behavior

| Condition | Required result |
| --- | --- |
| Draft is malformed, oversized, outside the workspace, or reached through a link escape | Fail before parsing or logging content |
| Draft schema or content digest is invalid | Fail; do not create output |
| Draft has no integrity digest | Fail |
| Repository identity differs from GitHub context | Fail |
| Checked-out `HEAD` differs from the event head | Fail |
| Capture start/end are missing, unavailable, or not ancestors of result head | Fail |
| Review base is stale, rebased away, unavailable, or not an ancestor | Fail |
| Receipt file set differs from the capture-start-to-result diff after the one transport path is excluded | Fail |
| Required before/after file digests are missing or differ from the bound Git trees | Fail |
| Known line counts differ | Fail |
| Output equals input, is tracked or staged, already exists, lies outside the workspace, or escapes through a link | Fail |
| Partial capture without explicit opt-in | Fail |
| Failed capture | Fail unconditionally |
| Any failure | Emit a fixed safe error; never print receipt strings or Git diff content |

Rebases invalidate the prior final artifact by design. The contributor must rerun capture or finalization against the new event topology; the tool must not silently retarget stale evidence.

## Scope decision

**CONDITIONAL GO** for a narrow implementation milestone that evolves the schema, updates producers, adds `agentreceipt finalize`, and makes the Action require finalized binding.

Conditions:

1. preserve capture-start and capture-end SHAs as immutable evidence;
2. reserve `base_sha` and `head_sha` for finalized GitHub event binding;
3. link the finalized receipt to the verified draft digest;
4. require a new ignored, untracked output inside the workspace but outside the bound commit;
5. verify exact Git ancestry and changed-file correspondence;
6. require file digests that detect same-path edits after capture;
7. keep the Action strict; and
8. continue to state that integrity and provenance do not prove truth.

Attestation, artifact upload, comments, viewer work, and publishing remain separate milestones.
