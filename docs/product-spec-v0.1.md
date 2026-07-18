# AgentReceipt v0.1 Product Specification

Status: Draft implementation contract

Date: 2026-07-17

## Product promise

AgentReceipt gives a code reviewer a portable answer to one question:

> What observable work did an AI coding agent perform to produce this change?

The receipt is evidence, not a quality score. Validation can show that a record follows the schema and is internally consistent with independently inspected repository state. A later attestation can establish workflow provenance and resistance to subsequent modification. Neither proves that every recorded statement is true or that the resulting code is correct or safe.

## Primary user

The first user is an open-source maintainer reviewing a pull request produced with Codex. They should be able to inspect the work without installing AgentReceipt or creating an account.

## v0.1 user journey

1. A contributor starts a local AgentReceipt session.
2. Codex performs a coding task while the adapter records observable events.
3. The contributor finishes the session.
4. AgentReceipt normalizes and redacts the event stream into a digest-bound draft receipt.
5. The contributor commits the sanitized draft with the resulting change.
6. GitHub checks out the event head and finalizes a separate ignored, untracked receipt artifact.
7. A GitHub Action validates schema, privacy, file evidence, integrity, and event binding.
8. A later workflow may attest and publish the finalized artifact.
9. The pull request may receive a concise summary and a link to a static replay.

## What v0.1 records

- A shareable task title and description supplied by the user.
- Session start, finish, duration, and outcome.
- Agent product name and optional public version information.
- Repository identity, branch, capture-start commit, capture-end commit, review base, and resulting event head.
- Observable command, tool, file, test, Git, and lifecycle events.
- A summary of changed files and line counts.
- Verification checks and aggregate test results.
- Redaction categories and counts.
- Cryptographic digests that bind evidence to content.

## What v0.1 does not record by default

- Hidden chain-of-thought or private model reasoning.
- Raw prompts or conversation transcripts.
- Raw standard output or standard error.
- File contents.
- Environment variables, credentials, tokens, or secrets.
- Absolute home-directory paths.
- Personal identity beyond repository-visible GitHub metadata.

Raw content capture is outside the v0.1 contract. Implementations must not quietly add it as an undocumented field.

## Trust model

AgentReceipt distinguishes five claims:

1. **Schema validity**: the receipt has the expected structure.
2. **Internal consistency**: independently inspected Git topology and file digests agree with the receipt's bounded claims.
3. **Integrity**: hashes show whether the recorded receipt or evidence changed.
4. **Provenance**: an external attestation can link the receipt artifact to a GitHub workflow and repository state.
5. **Truthfulness**: whether every statement accurately describes what happened; schema, hashes, and signatures do not establish this on their own.

None of those claims establish code quality. A signature proves origin and resistance to later modification, not the truth of every signed statement. The interface must never label a pull request “safe,” “correct,” “approved,” or “proven true” solely because a receipt verifies or is attested.

## Event model

Events are ordered by an integer sequence and carry a timestamp, outcome, short human-readable summary, structured details, and an evidence digest. Event details are deliberately bounded; unstructured logs belong in an external artifact whose digest may be referenced, not embedded.

Supported event types in v0.1:

- `session`: capture lifecycle boundaries.
- `tool`: a named tool was invoked.
- `command`: a redacted command was executed.
- `file`: a repository-relative file was inspected or changed.
- `test`: a test suite or check was executed.
- `git`: a Git action or state transition occurred.

During CLI development, receipts may declare `capture.source` as `simulated`. Simulated receipts must identify the simulator as the agent and display an explicit warning; they are test artifacts, not claims about real agent behavior.

## Digest rules

All v0.1 digests use lowercase SHA-256 in the form `sha256:<64 hexadecimal characters>`.

`integrity.content_digest`, when present, is computed over RFC 8785 JSON Canonicalization Scheme output after omitting the entire top-level `integrity` and `attestation` properties. This avoids a self-referential digest and permits attestations to be added without changing the underlying content claim.

A draft digest covers capture-time content before GitHub event binding exists. Finalization verifies that digest, preserves it as `finalization.draft_content_digest`, adds the event binding, and computes a new finalized content digest. The finalized receipt must remain outside the commit tree identified by its own `head_sha`; otherwise embedding the SHA changes the commit being identified.

## Privacy defaults

- `capture_level` must be `metadata` in v0.1.
- `raw_content_included` must be `false` in v0.1.
- File paths must be repository-relative and use `/` separators.
- Commands must be filtered before persistence, not merely hidden by the viewer.
- A second redaction and secret scan must run in CI before publishing artifacts.
- Redaction totals must be reported without preserving the removed value.
- Finalized output must be a new ignored, untracked workspace file; in-place or tracked output is forbidden.
- Finalization logs must use fixed safe messages and must not echo receipt or event payload strings.

## Explicit v0.1 exclusions

- Cloud accounts, hosted dashboards, or a database.
- Support for more than one coding-agent adapter.
- Team analytics, rankings, or quality scoring.
- Guaranteed human-versus-agent line attribution.
- Cross-repository sessions.
- Streaming or live monitoring.
- Automatic publication of prompts, logs, or source content.

## Release gate

Milestone 1 is complete when:

- both example receipts validate as expected;
- invalid fixtures fail for the intended reasons;
- TypeScript compilation succeeds;
- the schema documents every persisted field;
- no fixture contains a real credential or a real user path; and
- the trust and privacy limitations are visible in the README and specification.
