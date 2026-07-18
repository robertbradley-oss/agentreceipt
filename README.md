# AgentReceipt

AgentReceipt creates a privacy-safe record of what an AI coding agent did: tool and command lifecycle events, changed file paths, verification results, and Git state. It deliberately leaves out prompts, messages, reasoning, source code, command text, and command output.

The project is pre-alpha. Receipts are useful evidence, not proof that every action was observed or every claim is true.

## The 60-second public demo

1. **Capture locally.** AgentReceipt wraps one local Codex run and writes a sanitized **draft** receipt. Private capture data stays on the local machine; only the privacy-safe draft is selected for commit.
2. **Commit the result.** The draft is committed as `demo/receipt-draft.json` alongside the harmless [`demo/hello.txt`](demo/hello.txt) change.
3. **Finalize on the pull request.** The [public demo workflow](https://github.com/robertbradley-oss/agentreceipt/actions/workflows/public-demo.yml) checks out the real pull-request head and finalizes the draft against the GitHub pull-request event.
4. **Validate with the local Action.** `./packages/github-action` checks the finalized lifecycle, schema, privacy screen, digest, completeness policy, repository, and pull-request base/head binding.
5. **Download the result.** The workflow uploads only `.agentreceipt/finalized/receipt.json` as a 30-day artifact and puts the CLI's safe inspect summary in the workflow summary.

See the short [demo walkthrough](demo/README.md), browse the [AgentReceipt repository](https://github.com/robertbradley-oss/agentreceipt), or watch the [public demo workflow](https://github.com/robertbradley-oss/agentreceipt/actions/workflows/public-demo.yml).

## What a passing demo means

A passing workflow means the receipt is structurally valid, passes a high-confidence credential screen, matches its embedded digest, meets the selected completeness policy, and is bound to the pull-request event. The finalized receipt is created at an ignored, untracked path because it cannot be stored inside the commit whose SHA it contains.

It does **not** prove code quality, prove every agent action was observed, independently verify every statement, provide cryptographic attestation, or make the receipt tamper-proof. An unsigned digest is an internal consistency check, not external authentication. Even a fully observed run is described as **complete for declared surface**, never complete capture of Codex.

## Install and develop

Requirements: Node.js 20 or newer, pnpm 10 or newer, Git, and the Codex CLI for real captures.

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm build
```

The workspace CLI can be run after building:

```bash
node packages/cli/dist/src/bin.js --help
```

## Capture a real Codex run

The `codex` command requires a Git repository with at least one commit and a clean worktree. This lets AgentReceipt distinguish changes made during the wrapped run from pre-existing work.

The default sandbox is read-only:

```bash
node packages/cli/dist/src/bin.js codex \
  --title "Inspect the project" \
  --prompt "Run one harmless project inspection and summarize the result." \
  --verify "pnpm test"
```

To allow edits, explicitly use the workspace-write sandbox:

```bash
node packages/cli/dist/src/bin.js codex \
  --title "Add a health check" \
  --prompt "Add a small health-check endpoint and cover it with tests." \
  --sandbox workspace-write \
  --verify "pnpm test"
```

The prompt is passed to Codex over standard input and is never written to the receipt. A value supplied through `--prompt` may still be retained in shell history or visible to operating-system process inspection while AgentReceipt runs, so never put credentials in a prompt. If `codex` is not on `PATH`, set `AGENTRECEIPT_CODEX_PATH` for that invocation.

After capture:

```bash
node packages/cli/dist/src/bin.js inspect
node packages/cli/dist/src/bin.js inspect --json
```

### What capture keeps

- Adapter-observed command and tool lifecycle states
- Exit codes and numeric token usage when Codex emits it
- Independently read Git base/head state and changed paths
- Independently executed verification status when `--verify` is supplied
- Redaction counts, capture counters, and explicit limitations

### What capture discards

- Prompts, conversation text, agent messages, and reasoning
- Raw commands, command output, MCP arguments, and MCP results
- Web queries and results
- Diff bodies and source content
- Raw Codex thread, turn, and item identifiers
- Absolute personal paths and credentials

Omitting `--verify`, receiving an unknown or malformed event, losing the terminal event, or failing to collect required Git evidence produces a visibly **partial** receipt. The receipt covers only the wrapped JSONL process and is not a tamper-proof audit record.

## Finalize a committed draft

The simulator and Codex adapter produce draft receipts. A draft preserves capture-start and capture-end SHAs and intentionally fails the GitHub Action's finalized-lifecycle check.

After capture, copy the sanitized draft to a tracked path and commit it with the captured change. In GitHub Actions, check out the real event head with full history, build the workspace, and run the built CLI:

```bash
node packages/cli/dist/src/bin.js finalize \
  --input demo/receipt-draft.json \
  --output .agentreceipt/finalized/receipt.json
```

Finalization is available only inside GitHub Actions. A partial capture fails unless `--allow-partial` is present; a failed capture always fails. The command accepts no SHA overrides, overwrite mode, or in-place output.

The finalizer independently requires:

- A schema-valid, integrity-valid, privacy-screened, unattested draft
- A regular tracked input whose bytes match the checked-out commit
- A new ignored and untracked output path inside `GITHUB_WORKSPACE`
- Repository identity and checked-out `HEAD` matching the bounded GitHub event
- Provable capture and review ancestry from local Git objects
- An exact changed-path summary after excluding only the tracked draft input
- Matching change types, rename sources, declared line counts, and before/after Git-tree digests

Only repository binding status, review base, event head, finalization metadata, and the integrity block may change. The output is written through an exclusive temporary file and atomically published. Receipt strings, event payloads, diff bodies, commands, credentials, personal paths, and unsafe caught exception text are not logged.

The complete behavior is defined in the [v0.1 finalization contract](docs/receipt-finalization-contract-v0.1.md).

## Validate a finalized receipt

The local JavaScript Action treats both the receipt path and JSON as untrusted input. Use it after checkout:

```yaml
permissions:
  contents: read

steps:
  - uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5 # v4.3.1
    with:
      persist-credentials: false
      fetch-depth: 0
      ref: ${{ github.event.pull_request.head.sha }}
  - uses: ./packages/github-action
    with:
      receipt-path: .agentreceipt/finalized/receipt.json
      allow-partial: "false"
```

The Action makes no network requests and needs no token beyond read-only checkout. The receipt path must be relative to `GITHUB_WORKSPACE`. It rejects absolute paths, traversal, workspace-escaping symlinks or junctions, non-files, malformed JSON, and files larger than 1 MiB. Raw receipt data is never copied into logs or the step summary.

Complete-for-declared-surface receipts pass the completeness check. Partial receipts fail unless `allow-partial: "true"` is explicitly set, in which case the summary warns. Failed receipts always fail. Pull-request binding uses the pull request's head and base SHAs rather than GitHub's synthetic merge SHA.

## Simulated CLI workflow

The simulator remains available for schema and interface development:

```bash
node packages/cli/dist/src/bin.js start --title "Add a demo endpoint"
node packages/cli/dist/src/bin.js inspect
node packages/cli/dist/src/bin.js finish --file src/demo.ts --tests 12
node packages/cli/dist/src/bin.js inspect
```

Every simulated receipt is labeled `SIMULATED RECEIPT — NOT AGENT OBSERVATION`.

## Project status

Implemented in v0.1: the product and privacy contracts, JSON Schema and validator, simulator, privacy-safe Codex JSONL adapter, draft/finalized lifecycle, GitHub-event finalization, per-file before/after digests, and local GitHub Action validation.

Future work may add signatures or GitHub artifact attestations. Those could establish which workflow produced finalized bytes and whether they changed afterward, but would still not prove that every statement inside a receipt is true.
