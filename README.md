# AgentReceipt

AgentReceipt is a portable, privacy-first proof-of-work format for AI coding agents. It records observable evidence—tool and command lifecycles, file changes, verification results, and Git state—without recording prompts, messages, source content, command output, or private reasoning.

The project is pre-alpha. It now has four local workflows:

- a simulator for exercising `start`, `finish`, and `inspect`;
- a first real adapter that wraps the documented `codex exec --json` stream.
- a GitHub Actions-only finalizer that converts a committed draft into a separate event-bound receipt; and
- a local GitHub Action that validates a finalized receipt against its workflow event.

## Development

Requirements: Node.js 20 or newer, pnpm 10 or newer, Git, and Codex CLI for real captures.

```bash
pnpm install
pnpm check
pnpm test
pnpm build
```

## Real Codex capture

The `codex` command requires a Git repository with at least one commit and a clean worktree. A clean starting point lets AgentReceipt distinguish changes made during the wrapped run from work that already existed.

The default sandbox is read-only:

```bash
agentreceipt codex \
  --title "Inspect the project" \
  --prompt "Run one harmless project inspection and summarize the result." \
  --verify "pnpm test"
```

To let Codex edit the repository, opt into the workspace-write sandbox:

```bash
agentreceipt codex \
  --title "Add a health check" \
  --prompt "Add a small health-check endpoint and cover it with tests." \
  --sandbox workspace-write \
  --verify "pnpm test"
```

The prompt is passed to Codex over standard input and is never written to the receipt. However, a value supplied through `--prompt` may still be retained by your shell history or visible to operating-system process inspection while AgentReceipt is running. Do not place credentials in prompts.

If the Codex executable is not available as `codex` on `PATH`, set `AGENTRECEIPT_CODEX_PATH` to the executable location for that invocation.

After the run:

```bash
agentreceipt inspect
agentreceipt inspect --json
```

### What the adapter keeps

- Adapter-observed command and tool lifecycle states
- Exit codes
- Numeric token usage when Codex emits it
- Independently read Git base/head state and changed paths
- Independently executed verification status when `--verify` is supplied
- Redaction counts, capture counters, and explicit limitations

### What the adapter discards

- Prompt and conversation text
- Agent messages and reasoning
- Raw commands and command output
- MCP arguments and results
- Web queries and results
- Diff bodies and source content
- Raw Codex thread, turn, and item identifiers
- Absolute personal paths and credentials

Omitting `--verify`, receiving an unknown or malformed event, losing the terminal event, or failing to collect required Git evidence produces a visibly **partial** receipt. Even a fully observed run is labeled **complete for declared surface**, never “complete Codex capture.” The receipt covers only the wrapped JSONL process and is not a tamper-proof audit record.

## Simulated CLI workflow

The original simulator remains available for schema and interface development:

```bash
agentreceipt start --title "Add a demo endpoint"
agentreceipt inspect
agentreceipt finish --file src/demo.ts --tests 12
agentreceipt inspect
```

Every simulated receipt is labeled `SIMULATED RECEIPT — NOT AGENT OBSERVATION`.

## GitHub Action validation

The local JavaScript Action treats the receipt path and JSON as untrusted input. It validates the shared v0.1 schema and semantic rules, runs a high-confidence credential screen, independently recomputes the content digest, enforces capture-completeness policy, and binds the repository plus expected base and head commits to the GitHub event.

Package the Action before committing a change to it:

```bash
pnpm --filter @agentreceipt/github-action build
```

Use it from a workflow in this repository after checkout:

```yaml
permissions:
  contents: read

steps:
  - uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5 # v4.3.1
    with:
      persist-credentials: false
  - uses: ./packages/github-action
    with:
      receipt-path: .agentreceipt/finalized/receipt.json
      allow-partial: "false"
```

The Action makes no network requests and needs no token beyond read-only checkout. `receipt-path` must be relative to `GITHUB_WORKSPACE`; absolute paths, traversal, symlinks or junctions that escape the workspace, non-files, malformed JSON, and files larger than 1 MiB are rejected. Raw receipt data is never copied into logs or the step summary.

Complete-for-declared-surface receipts pass the completeness check. Partial receipts fail unless `allow-partial: "true"` is explicitly set, in which case the summary shows a warning. Failed receipts always fail. For pull requests, binding uses the pull request head and base SHAs rather than the synthetic merge SHA. For pushes, it uses `GITHUB_SHA` and the previous commit when one exists.

The simulator and Codex adapter produce **draft** receipts. Drafts preserve distinct capture-start and capture-end SHAs, contain change-appropriate before/after file digests, and intentionally fail the Action's finalized-lifecycle check.

Passing this Action means the receipt is structurally valid, privacy-screened, matches its embedded digest, meets the selected completeness policy, and is bound to the workflow event. Because an unsigned digest can be recomputed, this is an internal consistency check rather than external authentication. It does **not** prove code quality, prove that every action was observed, provide cryptographic attestation, or make the agent's claims independently true.

## Receipt finalization

The finalized receipt cannot be stored inside the commit whose SHA it contains: changing the receipt changes the commit. The approved design instead commits a sanitized draft as transport input, checks out the GitHub event head, and creates the canonical finalized receipt at a new ignored, untracked workspace path. The finalized artifact can then be validated and, in a later milestone, attested and uploaded.

After capture, place the sanitized draft at a tracked path and include it in the result commit. In GitHub Actions, check out the real event head with full history, build the workspace, and run:

```bash
agentreceipt finalize \
  --input receipts/agentreceipt-draft.json \
  --output .agentreceipt/finalized/receipt.json
```

For a partial capture, finalization fails unless `--allow-partial` is present. Failed captures always fail. The command is unavailable outside GitHub Actions and accepts no SHA overrides, overwrite mode, or in-place output.

The finalizer independently requires:

- a schema-valid, integrity-valid, privacy-screened, unattested draft;
- a regular tracked input whose bytes match the checked-out commit;
- a new ignored and untracked output path inside `GITHUB_WORKSPACE`;
- repository identity and checked-out `HEAD` matching the bounded GitHub event;
- provable capture and review ancestry from local Git objects;
- an exact changed-path summary after excluding only the tracked draft input; and
- matching change types, rename sources, declared line counts, and before/after Git-tree digests.

Only repository binding status, review base, event head, finalization metadata, and the integrity block may change. The output is written through an exclusive temporary file and atomically published. Receipt strings, event payloads, diff bodies, commands, credentials, personal paths, and unsafe caught exception text are not logged.

Pull-request workflows must explicitly check out the pull-request head rather than GitHub's synthetic merge commit:

```yaml
- uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5 # v4.3.1
  with:
    persist-credentials: false
    fetch-depth: 0
    ref: ${{ github.event_name == 'pull_request' && github.event.pull_request.head.sha || github.sha }}
```

Then validate the generated output with the local Action and its existing `allow-partial` policy. The full behavior is specified in [the v0.1 finalization contract](docs/receipt-finalization-contract-v0.1.md).

A future signature or GitHub artifact attestation may prove which workflow produced the finalized bytes and that they were not changed afterward. It will not prove that every statement inside the receipt is true.

## Project status

Completed:

- v0.1 product and privacy contracts;
- JSON Schema, validator, fixtures, and schema tests;
- simulated `start`, `finish`, and `inspect` commands;
- documented Codex capture feasibility spike;
- first privacy-safe `codex exec --json` adapter vertical slice;
- explicit draft/finalized lifecycle with per-file before/after digests;
- GitHub-event finalization with strict ancestry, file-evidence, and path checks;
- local GitHub Action validation with safe step summaries;
- finalized-state enforcement in the local GitHub Action.

Deferred to later milestones: attestations, artifact upload, comments/status publication, static replay/viewer, hooks, App Server, telemetry, plugins, and publishing.
