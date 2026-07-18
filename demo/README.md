# Public demo walkthrough

This demo shows the complete AgentReceipt lifecycle on a pull request:

1. **Local capture:** AgentReceipt wraps the coding-agent run on the developer's machine, records the harmless `demo/hello.txt` change, and creates a privacy-safe draft. Prompts, messages, reasoning, source content, command text, and command output are not written to the receipt.
2. **Commit:** The sanitized draft is placed at `demo/receipt-draft.json` and committed with `demo/hello.txt`. The draft is intentionally not finalized yet.
3. **GitHub-hosted finalization:** The `public-demo.yml` workflow checks out the actual pull-request head with full history and finalizes the committed draft against the pull-request event into the ignored `.agentreceipt/finalized/receipt.json` path.
4. **GitHub-hosted validation:** The same job validates that finalized file with the repository's local `./packages/github-action`, with partial captures disallowed.
5. **Review:** The CLI's safe inspect summary appears in the job summary, and only the finalized JSON is uploaded as a 30-day artifact.

Capture happens **locally**. Finalization and validation run on a **GitHub-hosted runner**. The workflow does not upload the draft or any private capture stream.

Open the [public demo workflow](https://github.com/robertbradley-oss/agentreceipt/actions/workflows/public-demo.yml) or return to the [repository](https://github.com/robertbradley-oss/agentreceipt).
