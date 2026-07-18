# AgentReceipt v0.1 Privacy and Threat Model

## Assets to protect

- Repository source code and unreleased diffs.
- Credentials, access tokens, cookies, and environment variables.
- User prompts and private conversation content.
- Personal paths, usernames, hostnames, and machine identifiers.
- The integrity of the receipt and its distinct connections to capture-start, capture-end, review-base, and result commits.

## Trust boundaries

1. The local adapter observes agent activity.
2. The normalizer converts adapter events to the public schema.
3. The redactor removes sensitive values before persistence.
4. The post-checkout finalizer treats the committed draft and GitHub event as untrusted input.
5. GitHub Actions independently validates and scans the finalized artifact.
6. A future attestation binds artifact bytes to workflow provenance.
7. A static viewer renders only the sanitized receipt.

## Principal threats and controls

### Secret leakage

Commands and paths can contain credentials. Redaction must occur before an event is written to disk. CI performs a second scan before the receipt becomes a workflow artifact.

### Misleading completeness

An adapter may miss activity that occurs outside its supported hooks. Each receipt therefore declares its capture source and capabilities. The viewer must say “recorded events,” never “everything the agent did.”

### Receipt tampering

Content and evidence digests detect changes after their calculation. A GitHub attestation can bind finalized artifact bytes to a workflow identity and commit. Neither a digest nor an attestation proves that each statement inside the receipt is true, and verification does not imply code safety.

### Commit self-reference

Writing a result commit's SHA into a receipt stored in that same commit changes the commit. Finalization therefore writes only to a new ignored, untracked workspace path after checkout. In-place, tracked, or staged finalized output is rejected.

### Binding confusion

Capture start, capture end, pull-request base, and event head can differ. Dedicated fields preserve each fact. The finalizer fails on missing Git objects, shallow or unverifiable history, non-ancestor relationships, synthetic merge checkout, or stale/rebased event context.

### Post-capture edits

Matching filenames alone does not show that committed bytes equal captured bytes. Producers must persist before/after file digests, and finalization compares them with the capture-start and event-head Git trees. The one tracked draft transport path is the only permitted file-set exclusion.

### Command spoofing

A malicious process could emit fabricated events. v0.1 does not claim tamper-proof local capture. The schema records capture provenance so future versions can distinguish direct observation, agent self-reporting, and imported logs.

### Path disclosure

Persisted file paths must be repository-relative. The validator rejects paths beginning with `/`, `~`, a drive letter, or `..` traversal.

### Viewer injection

All receipt strings are untrusted input. The static viewer must render them as text and must not execute receipt HTML, Markdown, URLs, or commands.

## Safe failure behavior

If redaction, schema validation, draft verification, Git ancestry, file evidence, hash verification, or the CI secret scan fails, AgentReceipt must not finalize, attest, publish, or replay the receipt. It should report a fixed safe failure and preserve no rejected content in logs.
