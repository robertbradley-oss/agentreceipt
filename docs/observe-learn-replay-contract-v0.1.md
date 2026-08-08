# AgentReceipt Observe, Learn, and Replay Contract v0.1

Status: Phase 1 implementation contract; implementation requires separate Phase 2 approval

Date: 2026-07-22

Decision source: [`GAMEPLAN.md`](../GAMEPLAN.md)

## Purpose

This contract defines the smallest privacy-preserving observe, learn, and replay loop for AgentReceipt. It adds a private local artifact path for recipe-essential execution data while preserving the current public receipt as metadata-only evidence.

The first implementation is limited to an AgentReceipt-owned `codex exec --json` run in a local Git repository, one canonical JSON recipe format, deterministic read-only process and file behavior, one `learn` command, one guarded `replay` command, and one harmless fixture.

This contract authorizes no implementation. It is the Phase 1 boundary that a separately approved Phase 2 must implement.

## Existing contract preserved

The public v0.1 receipt and its trust language remain authoritative:

- A receipt is evidence, not proof of complete observation, truth, safety, correctness, or task satisfaction.
- `capture.status: complete_for_declared_surface` refers only to the declared capture surface.
- Prompts, messages, reasoning, source content, raw command output, tool arguments and results, credentials, environment values, personal absolute paths, and raw Codex identifiers remain excluded from public receipts.
- Git and verification evidence are collected independently rather than inferred from agent prose.
- Finalization may change only its existing allowlisted fields and must preserve all recipe-binding extension data unchanged.
- A digest establishes internal consistency, not external authenticity or truth.

The current Codex adapter deliberately discards command text and output before constructing the public receipt. That behavior MUST remain unchanged. Recipe learning MUST use a separate private capsule projection created from the live owned stream before the public projection discards recipe-essential structure.

## Product boundary

The supported source is one successful local run that AgentReceipt launches through `codex exec --json`. The first replay surface is local, deterministic, read-only, and repository-scoped.

The following remain out of scope:

- unrelated Codex desktop, IDE, interactive, hook, App Server, or imported sessions;
- hosted or remote execution;
- network-dependent, interactive, random, clock-dependent, or write-capable replay;
- arbitrary shell programs, pipelines, redirection, command substitution, or compound commands;
- automatic recipe recall, search, ranking, sharing, publication, or synchronization;
- browser automation, MCP replay, web-search replay, multi-agent orchestration, or a general workflow engine;
- proving that an observed action was truthful or that replayed work is safe or correct.

## Artifact boundaries

AgentReceipt uses four distinct artifacts.

| Artifact | Visibility | Purpose | Content boundary |
|---|---|---|---|
| Public source receipt | Shareable | Evidence for the original Codex run | Existing metadata-only v0.1 contract |
| Private run capsule | Local private | Minimal structured input to learning | Recipe-essential allowlist only; never public |
| Recipe | Local by default | Reviewable parameterized replay definition | No secret values, outputs, prompts, reasoning, or source content |
| Public replay receipt | Shareable | Fresh evidence for an actual replay | Existing public boundary plus digest-only replay metadata |

No artifact inherits authority from another. The source receipt does not prove the capsule truthful, the capsule does not prove the recipe safe, and a recipe digest does not prove a replay correct.

## Lifecycle

### Observe

The owned Codex wrapper produces the existing sanitized public receipt projection and, only when the private path is explicitly enabled, a separate private capsule projection. Both projections are derived in memory from the live JSONL stream. Raw JSONL MUST NOT be written to a temporary file or log.

The public projection MUST remain byte-for-byte compatible in meaning with the current privacy and capture contracts. The private projection MUST apply its own allowlist, path checks, secret controls, eligibility checks, and integrity digest before persistence.

### Learn

The `learn` command consumes one eligible capsule and creates one new recipe. It validates capsule structure, integrity, eligibility, repository binding, parameters, and every action before writing a recipe.

Learning MUST NOT modify the original public source receipt. A receipt cannot safely predict a future recipe digest, and back-patching a committed or finalized receipt would invalidate its digest and binding. The recipe instead binds backward to the source receipt, while every actual replay receipt binds forward to the recipe digest.

### Replay

The `replay` command validates one recipe and the current local repository before any execution. Dry run stops after a safely redacted preflight. Actual replay executes only the supported read-only surface, runs verification, checks that repository state was not mutated, and writes a fresh draft AgentReceipt.

A preflight failure is not an actual replay and produces no replay receipt. Once execution begins, the command MUST attempt to produce a fresh receipt that records success or failure and all safe limitations. A process crash can still prevent receipt creation and MUST be reported as a fixed safe failure rather than as successful replay evidence.

## Private run capsule contract

### Storage

Capsules MUST be written beneath:

```text
.agentreceipt/private/capsules/<capsule-id>.json
```

Before writing, AgentReceipt MUST prove that the destination is repository-local, ignored, untracked, absent from the index and `HEAD`, new, and not reachable through a symbolic link, junction, reparse point, or traversal. It MUST use bounded input, create-exclusive output, and atomic publication. The maximum serialized capsule size is 1 MiB.

A capsule MUST never be committed, staged, finalized, uploaded, attached to a public receipt, copied into a fixture, or included in diagnostic output. The CLI may print only a fixed success or failure message and the safe repository-relative path.

Capsules are retained locally by default. A future Phase 2 `learn` option may delete the exact source capsule only after the new recipe has been atomically written, re-read, and validated. Deletion MUST be explicit, path-bounded, and off by default.

### Eligibility

A capsule is learnable only when all of the following are true:

- the source is an AgentReceipt-owned `codex exec --json` run;
- the process and turn completed successfully;
- the public capture status is `complete_for_declared_surface` with its terminal event present;
- unknown, malformed, discarded-unknown, pending, web-search, MCP, and unsupported records are absent;
- independent Git evidence was collected and the worktree was clean before and after the run;
- independent verification ran and passed;
- every retained action is losslessly normalized, explicitly classified, and supported by the read-only policy;
- no file-change event, write-capable action, network dependency, interaction, nondeterministic input, secret ambiguity, or unsafe path is present;
- every declared file input is repository-relative and has a SHA-256 content digest;
- every required executable has an exact safe identity and version fingerprint.

Absence of a Codex event is not proof that an action did not occur. Eligibility means only that the delivered declared surface and independently collected evidence satisfy this bounded contract.

### Persisted fields

The capsule is canonical JSON with these top-level fields only:

| Field | Required content |
|---|---|
| `capsule_version` | Constant `0.1` |
| `capsule_id` | Receipt-local UUID |
| `created_at` | Adapter observation timestamp |
| `source_receipt_content_digest` | Verified digest of the sanitized source receipt |
| `repository` | Public repository identity, Git object format, capture start/end SHAs, and clean-state booleans |
| `capture` | Surface, status, terminal-event presence, Codex CLI version, adapter version, safe counters, and limitations |
| `parameters` | Parameter declarations and placeholders; never values |
| `actions` | Ordered allowlisted read-only process, file assertion, and verification records |
| `measurements` | Wrapper-observed elapsed time and numeric Codex usage only when emitted |
| `integrity` | SHA-256 and RFC 8785 content digest metadata |

An action may retain only:

- zero-based sequence;
- action kind: `process`, `file_assertion`, or `verification`;
- repository-relative working directory;
- direct executable name and safe version fingerprint;
- an argument vector containing literals or declared public-parameter placeholders;
- declared environment-variable names, never values;
- repository-relative file inputs with SHA-256 digests;
- read-only classification and classifier version;
- expected and observed exit code;
- bounded wrapper-observed duration.

The capsule MUST NOT retain:

- prompts, messages, reasoning, plans, or source identifiers;
- raw JSONL records, command output, standard error, diff bodies, file contents, or source snippets;
- arbitrary tool arguments or results, web queries or results, MCP data, or network payloads;
- environment values, secret values, secret digests, cookies, tokens, credentials, or personal absolute paths;
- arbitrary shell source, redirection, pipelines, command substitution, or compound commands;
- data kept only because it may be useful to a future architecture.

### Integrity

The capsule content digest uses lowercase SHA-256 over RFC 8785 canonical JSON after omitting the top-level `integrity` property. The digest is an internal consistency check only. The capsule remains private even though it is digest-bound.

Any validation, sanitization, secret-screen, path, size, eligibility, or digest failure MUST prevent capsule creation and emit only a fixed safe error.

## Parameter and secret contract

Parameter names MUST match `^[A-Z][A-Z0-9_]{0,63}$`. Recipes distinguish `public` and `secret` parameters. Neither kind may contain a default secret value.

Public parameters may appear in an argument vector through an exact placeholder of the form `{{param.NAME}}`. Their runtime values are not public receipt content.

Secret parameters use one mechanism only in the first contract:

- the recipe stores the parameter name, sensitivity `secret`, a source environment-variable name, and a target child environment-variable name;
- runtime secret values are read from the named environment variable after preflight;
- secret values are passed only through the child environment;
- secret values MUST NOT be supplied through AgentReceipt CLI arguments, interpolated into command text or argument vectors, serialized, hashed, printed, logged, or added to receipts;
- a step using a secret parameter MUST directly execute a reviewed executable that consumes the target environment variable; shell wrappers and argument substitution are forbidden;
- missing, empty, ambiguous, unexpectedly present, or command-visible secret material fails closed before execution.

For capture and learning, users declare secret environment-variable names, never values. AgentReceipt may compare a declared value in memory solely to detect leakage into candidate fields. If a declared secret value or a high-confidence secret pattern appears in command text, arguments, paths, output metadata, or any other persistable field, the capsule is not learnable and MUST NOT be written. Automatic guessing never converts an unknown value into a trusted parameter.

This resolves the runtime-secret question: environment-only injection keeps secret values out of capsules, recipes, AgentReceipt process arguments, logs, and receipts. Workflows that cannot satisfy this restriction remain unsupported.

Environment-only injection does not protect a secret from the selected child process, a compromised host, or operating-system process/environment inspection. Those remain inside the user's local trust boundary and MUST be stated as limitations rather than represented as solved by AgentReceipt.

## Canonical recipe contract

### Storage and review

Recipes are written beneath this local default:

```text
.agentreceipt/recipes/<recipe-id>.json
```

Phase 2 MUST apply the same containment, ignored/untracked, new-file, link, bounded-size, exclusive-create, and atomic-publication controls as capsules. Recipes are local by default. Publishing or sharing them is outside the locked phases even when they contain no detected secrets.

The recipe is ordinary reviewable JSON. Serialized bytes may be pretty-printed; canonicalization refers to the RFC 8785 projection used for the digest. Selecting an exact recipe path for replay is explicit user intent to run its read-only contract; it is not approval for writes or unsupported actions.

### Persisted fields

The recipe uses one versioned format with these top-level fields only:

| Field | Required content |
|---|---|
| `recipe_version` | Constant `0.1` |
| `recipe_id` | UUID |
| `created_at` | Learning timestamp |
| `source` | Source receipt content digest and private capsule digest |
| `repository` | Expected provider, owner, and repository name |
| `parameters` | Typed public/secret declarations without values |
| `preconditions` | Clean state, required programs and versions, required file paths and digests, and declared environment names |
| `steps` | Ordered read-only `process` and `file_assertion` definitions |
| `verification` | One required read-only verification definition and expected result |
| `limitations` | Explicit bounded replay limitations |
| `integrity` | SHA-256 and RFC 8785 recipe content digest metadata |

The recipe content digest uses lowercase SHA-256 over RFC 8785 canonical JSON after omitting the top-level `integrity` property.

### Supported actions

A `process` step is a direct executable plus argument vector. It MUST use `shell: false` or its platform-equivalent direct process API. Phase 2 supports only the exact executable-and-argument patterns needed by the harmless fixture and encoded in a versioned read-only classifier. Unknown programs, unknown flags, shell interpreters, scripts, pipelines, redirection, glob expansion, command substitution, compound commands, interactive commands, and network-capable commands fail closed.

A `file_assertion` step may check only existence, regular-file type, containment, and SHA-256 digest for a declared repository-relative file. It cannot create, modify, rename, delete, chmod, link, or follow a workspace-escaping link.

The verification definition follows the same direct-process and file restrictions. Agent prose and a normal command exit code cannot silently become verification evidence.

The phrase "shell workflow" in this contract means a bounded direct-process workflow derived from observed shell activity. It does not authorize arbitrary shell source.

## Learn command contract

The `learn` command MUST:

- accept one safe repository-relative capsule path;
- bounded-read and validate the capsule before using it;
- recompute and compare the capsule digest;
- require every eligibility condition;
- verify repository identity and the source receipt digest linkage;
- preserve only the recipe allowlist and declared placeholders;
- reject unsupported, ambiguous, write-capable, or nondeterministic material;
- construct a new recipe rather than mutating the capsule or source receipt;
- validate and digest the recipe before atomic publication;
- print only a fixed result and safe repository-relative output path.

It MUST NOT call a model, infer a hidden workflow from agent prose, retrieve external context, publish data, overwrite a recipe, or weaken a failed eligibility decision.

## Replay command contract

### Preflight

Replay MUST complete all preflight checks before executing any recipe action:

- safe path, bounded size, JSON structure, semantic validation, and recipe digest;
- repository provider, owner, name, root containment, and clean worktree;
- required executables and exact version fingerprints;
- required repository-relative files and SHA-256 digests;
- declared parameters and environment-variable names;
- absence of secret values from recipe fields, AgentReceipt arguments, and safe output;
- read-only classifier acceptance for every step and verification definition;
- absence of write, network, interactive, random, clock-dependent, shell-wrapper, or unsupported behavior.

Any preflight failure executes nothing, writes no replay receipt, and emits a fixed safe error.

### Dry run

`replay --dry-run` performs the complete preflight and prints a safely redacted summary of step kinds, counts, required parameter names, and precondition status. It MUST NOT execute recipe actions, resolve or print secret values, write a replay receipt, or claim that replay occurred.

### Actual replay

Actual replay MUST:

- snapshot independent Git and file state immediately before execution;
- use direct process execution with a minimal controlled environment;
- inject only declared secret values through their target child environment variables;
- drain standard output and standard error without retaining or logging them;
- stop on the first failed or policy-violating action;
- run the declared independent verification when prior actions succeed;
- snapshot Git and file state after execution and require no tracked, staged, or untracked repository change outside AgentReceipt's verified ignored output paths;
- create a fresh draft public receipt after execution begins, including failed execution or failed verification when a structurally valid receipt can be produced.

If a supposedly read-only action mutates repository state, replay MUST stop, classify the receipt as failed, report a fixed `read_only_violation`, and preserve the workspace for user inspection. AgentReceipt MUST NOT attempt an automatic destructive rollback.

## Public replay receipt contract

The replay receipt preserves every existing public privacy and trust invariant. It contains sanitized lifecycle, command category/status, exit codes, independently inspected Git state, verification status, redaction counts, limitations, and integrity metadata. It contains no capsule content, recipe content, parameter values, command text, or output.

### Capture identity

The current schema cannot honestly identify replay because `capture.surface` accepts only `simulator` and `codex_exec_jsonl`. Phase 2 therefore requires the smallest additive schema change:

```json
{
  "capture": {
    "adapter": "agentreceipt-replay",
    "source": "direct_observation",
    "surface": "agentreceipt_recipe_replay"
  }
}
```

The additive surface value MUST be supported consistently by the shared validator and every in-repository public validation path that accepts replay receipts. Existing v0.1 receipts and semantics MUST remain valid and unchanged. A replay receipt MUST NOT claim the `codex_exec_jsonl` surface.

### Recipe binding

The current reverse-DNS `extensions` object is suitable for digest-only recipe binding because it is included in the receipt content digest, preserved unchanged by finalization's allowlisted transition, and traversed by the existing public credential screen.

The replay receipt uses exactly this extension:

```json
{
  "extensions": {
    "dev.agentreceipt.recipe-replay": {
      "recipe_digest": "sha256:<64 lowercase hexadecimal characters>",
      "source_receipt_content_digest": "sha256:<64 lowercase hexadecimal characters>",
      "mode": "executed"
    }
  }
}
```

The extension MUST NOT contain a capsule digest, recipe path, recipe contents, parameter names or values, executable arguments, output, personal path, or user identity. Its semantic shape MUST be validated by the replay producer even though v0.1 `extensions` permits arbitrary namespaced values.

The source receipt remains unchanged. The binding chain is:

```text
source public receipt digest <- private capsule <- local recipe digest <- fresh public replay receipt
```

Only the two public digests appear in the replay receipt. The private capsule and its digest remain local.

This resolves the public-binding question: use the existing namespaced extension for digest-only metadata and add one honest replay capture-surface value. A broader receipt redesign or recipe-content field is not required for the first slice.

### Completeness and finalization

Replay receipt completeness is limited to the AgentReceipt-owned recipe runner and its declared direct-process/file surface. It MUST say `complete_for_declared_surface`, `partial`, or `failed` under the existing meanings and MUST list unavailable capabilities and limitations honestly.

The finalizer may later process a committed replay draft only through its existing rules. It MUST preserve the recipe extension canonically, scan it for credentials, include it in the finalized digest, and never change replay claims or recipe linkage. Phase 2 MUST demonstrate compatibility before claiming that a replay receipt can use the public finalization path.

## Measurements

The capsule may retain wrapper-observed source-run wall time and numeric Codex usage only when the source emits them. The replay receipt may retain wrapper-observed replay wall time in a namespaced safe extension if Phase 2 validates the exact field.

Replay does not invoke a model. It MUST report `model_invoked: false` or equivalent bounded metadata rather than inventing a measured token count of zero. A token-benefit claim requires emitted source usage plus direct evidence that replay invoked no model. Missing or incomparable values remain unavailable, not estimated.

Wall-time comparisons MUST state the measured boundaries, environment, repository preconditions, tool versions, and cache conditions. One harmless fixture supports only a bounded comparison.

## Safe failure contract

Errors MUST use fixed safe codes and descriptions. Caught exception text, command text, paths containing personal data, capsule or recipe content, parameter values, and process output MUST NOT be echoed.

The first implementation should use stable categories including:

- `unsafe_private_path`
- `capsule_too_large`
- `capsule_invalid`
- `capsule_integrity_mismatch`
- `capsule_ineligible`
- `secret_material_detected`
- `recipe_invalid`
- `recipe_integrity_mismatch`
- `repository_state_mismatch`
- `parameter_missing`
- `unsupported_action`
- `preflight_failed`
- `verification_failed`
- `read_only_violation`
- `internal_error`

Rejected content MUST never be retained in logs or a partially published artifact.

## Phase 2 acceptance boundary

A future Phase 2 proposal is bounded by this contract. Its acceptance evidence must demonstrate one harmless local fixture through owned Codex capture, private capsule creation, `learn`, human-readable canonical recipe output, dry-run preflight, actual read-only replay, independent verification, and a fresh digest-bound public receipt.

Phase 2 must also demonstrate that:

- the current public receipt projection remains privacy-compatible;
- capsules and recipes remain ignored and untracked;
- private content and secret canaries do not enter public receipts or safe logs;
- unsupported, ambiguous, nondeterministic, network, and write-capable actions fail closed;
- dry run performs no action and emits no replay receipt;
- an actual replay emits a fresh receipt and detects any mutation;
- existing v0.1 receipts remain valid after the additive replay-surface change;
- the recipe extension survives integrity checking and finalization unchanged;
- no package, platform, hosted, search, sharing, or general workflow abstraction is introduced without separate approval.

## Decisions and rationale

- Keep the public sanitizer unchanged. Its deliberate information loss is correct for shareable evidence.
- Derive a separate minimal capsule projection in memory. Public receipts cannot supply the structured command data needed for learning.
- Keep capsules private, ignored, untracked, bounded, and secret-free. Local storage is not a waiver of privacy controls.
- Use environment-only secret injection and forbid secret values in AgentReceipt arguments or executable arguments. Ambiguous workflows remain unsupported.
- Use one canonical JSON recipe with RFC 8785 and SHA-256 integrity. This reuses the project's current digest conventions.
- Restrict the first recipe runner to direct read-only process and file assertions. Arbitrary shell replay cannot be classified honestly as deterministic or safe.
- Do not back-patch the source receipt. The recipe binds to the source digest, and replay receipts bind to the recipe digest.
- Use `dev.agentreceipt.recipe-replay` for digest-only public linkage and add `agentreceipt_recipe_replay` as the minimum honest capture surface.
- Treat measured benefits as evidence with stated boundaries, never as a product promise.

## Refresh triggers

Re-open this contract before implementation if Codex changes the relevant JSONL event model; a privacy finding shows that the capsule allowlist can retain sensitive material; the existing extension, integrity, finalization, or credential screen cannot preserve digest-only binding; environment-only secret injection proves unsafe or unusable; the harmless fixture cannot be classified and replayed without arbitrary shell execution; or the first slice requires writes, network access, remote state, another agent surface, automatic recall, or sharing.
