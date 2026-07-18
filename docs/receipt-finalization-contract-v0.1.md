# Receipt finalization implementation contract v0.1

Status: implementation contract; implementation deferred

Decision source: [receipt finalization feasibility spike](receipt-finalization-feasibility.md)

## Objective

Implement the smallest safe vertical slice that converts a schema-valid, integrity-valid draft receipt committed with a change into a separate finalized receipt bound to the checked-out GitHub event head.

Finalization establishes internal consistency and GitHub event binding. It does not attest the artifact, publish it, or prove that the captured statements are true.

## State model

The next implementation must make repository state explicit rather than infer meaning from lifecycle position.

### Draft receipt

A producer writes a draft after capture and before the result commit exists:

```json
{
  "repository": {
    "provider": "github",
    "owner": "example",
    "name": "project",
    "branch": "feature/task",
    "binding_status": "draft",
    "capture_start_sha": "<HEAD before capture>",
    "capture_end_sha": "<HEAD after capture>"
  }
}
```

Draft rules:

- `capture_start_sha` and `capture_end_sha` are required and immutable.
- `capture_start_sha` must be an ancestor of or equal to `capture_end_sha`.
- `base_sha` and `head_sha` are absent because the GitHub review binding does not exist yet.
- `finalization` is absent.
- `integrity.content_digest` is required.
- A draft is inspectable but must fail GitHub Action repository binding.

### Finalized receipt

The finalizer creates a new receipt after GitHub checks out the event head:

```json
{
  "repository": {
    "provider": "github",
    "owner": "example",
    "name": "project",
    "branch": "feature/task",
    "binding_status": "finalized",
    "capture_start_sha": "<unchanged>",
    "capture_end_sha": "<unchanged>",
    "base_sha": "<GitHub review base when meaningful>",
    "head_sha": "<GitHub event head>"
  },
  "finalization": {
    "method": "github_event",
    "event": "pull_request",
    "draft_content_digest": "sha256:<verified draft digest>",
    "finalized_at": "<RFC 3339 timestamp>"
  }
}
```

Finalized rules:

- `binding_status` is `finalized`.
- `capture_start_sha` and `capture_end_sha` exactly equal the draft values.
- `head_sha` is required.
- `base_sha` is required for pull requests and ordinary pushes; it is absent for a new-branch push or `workflow_dispatch` when no meaningful base exists.
- `finalization` is required and included in the finalized content digest.
- `draft_content_digest` exactly equals the digest that was independently recomputed for the input draft.
- `attestation` remains absent in this milestone.

The schema should use conditional requirements so invalid state combinations fail structurally.

## Permitted transition

Finalization may make only these semantic changes:

1. change `repository.binding_status` from `draft` to `finalized`;
2. add `repository.base_sha` when the event supplies a meaningful base;
3. add `repository.head_sha` from the GitHub event;
4. add the top-level `finalization` object; and
5. replace `integrity` with a digest over the finalized content.

Every other field—including receipt and session IDs, task metadata, agent metadata, capture claims, redactions, events, evidence digests, file summaries, and verification results—must be canonically identical to the draft.

The implementation must compare an allowlisted transformation, not mutate an arbitrary object and assume nothing else changed.

## CLI contract

```text
agentreceipt finalize \
  --input draft-receipt.json \
  --output .agentreceipt/finalized/receipt.json
```

Environment requirements:

- `GITHUB_ACTIONS=true`
- `GITHUB_WORKSPACE`
- `GITHUB_EVENT_NAME`
- `GITHUB_EVENT_PATH`
- `GITHUB_REPOSITORY`
- `GITHUB_SHA`

The command reads GitHub context directly from the bounded event file. Workflow authors must not interpolate event fields into shell source.

Inputs:

- `--input` is required, workspace-relative, and must identify a tracked regular file inside `GITHUB_WORKSPACE`.
- `--output` is required, workspace-relative, and must identify a new path inside an ignored location in `GITHUB_WORKSPACE`.
- `--allow-partial` is optional and defaults to false.
- No explicit SHA override flags exist in v0.1.
- No overwrite or in-place mode exists in v0.1.

Successful output:

- writes one finalized JSON file atomically;
- prints only a fixed success message and the safe workspace-relative output path;
- never prints receipt strings, event payload content, diff bodies, commands, or credentials; and
- exits zero.

Failure output uses fixed error codes and safe descriptions. It must not embed caught exception messages that may contain paths or receipt content.

## File-system safety

Apply the same hostile-path controls as the GitHub Action:

- receipt and event payload limit: 1 MiB each;
- bounded reads rather than unbounded `readFile` calls;
- lexical containment plus `realpath` containment;
- reject absolute input/output values and `..` traversal;
- reject symbolic-link, junction, and reparse-point escapes;
- require input to be a regular tracked file;
- require output to differ from input, not exist, be ignored, and be absent from both index and `HEAD`;
- reject an output parent that escapes the workspace; and
- use create-exclusive plus atomic rename without following a destination link.

The output may live in the checkout worktree because the existing Action accepts only workspace-local receipts. It must remain ignored and untracked, so it is outside the commit tree identified by `head_sha`.

## GitHub context rules

### Pull request

- Event head: `pull_request.head.sha`.
- Review base: `pull_request.base.sha`.
- Require `git rev-parse HEAD` to equal the event head.
- Require the review base, capture start, and capture end objects to exist locally.
- Require full ancestry checks. A shallow history that cannot prove them fails.
- The workflow must explicitly check out the PR head; GitHub's default PR checkout may be a synthetic merge commit.

### Push

- Event head: `GITHUB_SHA`.
- Review base: event `before`, unless it is all zeroes.
- Require checked-out `HEAD` to equal the event head.
- A nonzero base must exist and be an ancestor of the head.

### Workflow dispatch

- Event head: `GITHUB_SHA`.
- No review base is inferred.
- Require checked-out `HEAD` to equal the event head.

Other events fail as unsupported. `pull_request_target` is explicitly unsupported.

## Git evidence checks

Before writing output, require all of the following:

1. repository owner and name match `GITHUB_REPOSITORY` case-insensitively;
2. draft capture start is an ancestor of or equal to capture end;
3. capture end is an ancestor of or equal to the event head;
4. review base, when present, is an ancestor of or equal to the event head;
5. the event head equals checked-out `HEAD`;
6. each receipt file path is repository-relative and unique;
7. changed paths from `capture_start_sha..head_sha`, after excluding exactly the tracked draft input path, equal the receipt file-summary paths;
8. change type, rename source, and line counts agree whenever the receipt declares line counts known;
9. added, modified, and renamed files have an `after_digest` that matches the file bytes in the event-head tree; and
10. modified, deleted, and renamed files have a `before_digest` that matches the file bytes in the capture-start tree.

No other path may be excluded. The output does not need exclusion because it does not exist in the bound commit.

A mismatch is evidence that the result commit contains work outside the captured file summary or that the receipt is stale. It must fail rather than silently broaden the receipt's claim. Required file digests may not be omitted: filename equality alone cannot detect a post-capture edit to the same path.

## Receipt validation order

1. validate environment and event type;
2. safely resolve and bound input/output paths;
3. bounded-read and parse the draft;
4. run shared schema and semantic validation;
5. require draft state and reject any attestation;
6. independently recompute and compare the draft digest;
7. run privacy and credential screening;
8. inspect Git objects, ancestry, index state, and changed-file metadata;
9. construct a new object through the transition allowlist;
10. recompute the finalized digest;
11. validate the finalized object through the shared schema;
12. create the output atomically; and
13. print a safe result.

Any failed step prevents output creation.

## Capture completeness policy

- `complete_for_declared_surface`: eligible for finalization.
- `partial`: fails by default; `--allow-partial` produces a finalized partial receipt with an explicit warning.
- `failed`: always fails.

Finalization never upgrades or rewrites capture status.

## Trust and claims

Permitted language:

> This finalized receipt is internally consistent with the inspected Git topology and file summary and is bound to the identified GitHub event.

After a later attestation milestone:

> This artifact was produced by the identified workflow and has not changed since attestation.

Forbidden language:

- “The receipt proves everything happened exactly as stated.”
- “Signed means true.”
- “Verified safe,” “verified correct,” or “approved.”

A malicious or compromised capture source can fabricate schema-valid events and recompute an unsigned draft digest. Finalization detects inconsistencies that are independently observable from Git; it cannot establish the truth of unobservable event claims.

## Safe failure codes

The implementation should expose stable codes without sensitive details:

- `invalid_input`
- `invalid_github_context`
- `unsupported_event`
- `unsafe_input_path`
- `unsafe_output_path`
- `receipt_too_large`
- `malformed_json`
- `schema_invalid`
- `draft_required`
- `draft_integrity_mismatch`
- `privacy_check_failed`
- `repository_mismatch`
- `checkout_head_mismatch`
- `git_history_unavailable`
- `git_ancestry_mismatch`
- `file_evidence_mismatch`
- `partial_capture_rejected`
- `failed_capture_rejected`
- `output_exists`
- `internal_error`

## Required tests for implementation

- happy-path pull-request finalization;
- push and new-branch push binding;
- workflow-dispatch head binding;
- default rejection of partial and unconditional rejection of failed capture;
- explicit partial opt-in warning;
- missing and mismatched draft digest;
- mutation of every field outside the transition allowlist;
- self-reference/in-place output rejection;
- tracked, staged, existing, traversing, absolute, and link-escaping output;
- malformed and oversized input/event JSON;
- repository, checkout head, review base, capture ancestry, and shallow-history failures;
- extra, missing, renamed, deleted, and line-count-mismatched files;
- missing or mismatched before/after file digests, including a same-path post-capture edit;
- tracked draft path as the only permitted diff exclusion;
- PR synthetic merge checkout rejection;
- summary/log leakage using credential-like canaries; and
- finalized receipt acceptance by the GitHub Action.

## Explicitly deferred

- GitHub artifact attestation generation or verification;
- artifact upload or retention policy;
- pull-request comments or status publication;
- static viewer or replay;
- non-GitHub finalization;
- server-side or hosted finalization;
- signing local drafts;
- proving truth of captured events; and
- marketplace, plugin, or skill packaging.
