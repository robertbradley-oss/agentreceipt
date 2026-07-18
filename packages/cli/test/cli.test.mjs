import assert from "node:assert/strict";
import { access, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { CliError, FinalizationError, executeCli } from "../dist/src/index.js";
import { shouldWarnForAcceptedPartial } from "../dist/src/finalize.js";

const baseSha = "1111111111111111111111111111111111111111";
const headSha = "2222222222222222222222222222222222222222";

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function withFixture(run) {
  const root = await mkdtemp(join(tmpdir(), "agentreceipt-cli-test-"));
  const times = {
    current: new Date("2026-07-17T20:00:00.000Z"),
  };
  const uuids = [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
    "33333333-3333-4333-8333-333333333333",
    "44444444-4444-4444-8444-444444444444",
  ];
  let uuidIndex = 0;
  let currentHead = baseSha;

  const dependencies = {
    cwd: root,
    now: () => new Date(times.current),
    randomUUID: () => uuids[uuidIndex++],
    readRepository: async () => ({
      root,
      owner: "agentreceipt-demo",
      name: "sample-repository",
      branch: "feature/simulated-receipt",
      headSha: currentHead,
      limitations: [],
    }),
  };

  try {
    await run({ root, times, dependencies, setHead: (sha) => { currentHead = sha; } });
  } finally {
    const resolvedRoot = join(tmpdir(), root.slice(tmpdir().length));
    assert.ok(resolvedRoot.startsWith(tmpdir()), "test cleanup must remain inside the temporary directory");
    await rm(root, { recursive: true, force: true });
  }
}

test("start, inspect, and finish complete a simulated receipt lifecycle", async () => {
  await withFixture(async ({ root, times, dependencies, setHead }) => {
    const startOutput = await executeCli([
      "start",
      "--title",
      "Add a demo endpoint",
      "--description",
      "Create a simulated change for the CLI demonstration.",
    ], dependencies);

    assert.match(startOutput, /Started a simulated AgentReceipt recording/);
    assert.equal(await pathExists(join(root, ".agentreceipt", "current.json")), true);

    const activeOutput = await executeCli(["inspect"], dependencies);
    assert.match(activeOutput, /SIMULATED RECORDING ACTIVE/);
    assert.match(activeOutput, /Add a demo endpoint/);

    await assert.rejects(
      executeCli(["start", "--title", "Overlapping task"], dependencies),
      (error) => error instanceof CliError && /already active/.test(error.message),
    );

    times.current = new Date("2026-07-17T20:05:00.000Z");
    setHead(headSha);
    const finishOutput = await executeCli([
      "finish",
      "--file",
      "src/demo-endpoint.ts",
      "--tests",
      "18",
    ], dependencies);

    assert.match(finishOutput, /Finished the simulated AgentReceipt recording/);
    assert.equal(await pathExists(join(root, ".agentreceipt", "current.json")), false);

    const archives = await readdir(join(root, ".agentreceipt", "sessions"));
    const receipts = await readdir(join(root, ".agentreceipt", "receipts"));
    assert.equal(archives.length, 1);
    assert.equal(receipts.length, 1);

    const summary = await executeCli(["inspect"], dependencies);
    assert.match(summary, /SIMULATED RECEIPT/);
    assert.match(summary, /18 passed, 0 failed/);
    assert.match(summary, /src\/demo-endpoint\.ts/);

    const jsonOutput = await executeCli(["inspect", "--json"], dependencies);
    const receipt = JSON.parse(jsonOutput);
    assert.equal(receipt.capture.source, "simulated");
    assert.equal(receipt.repository.binding_status, "draft");
    assert.equal(receipt.repository.capture_start_sha, baseSha);
    assert.equal(receipt.repository.capture_end_sha, headSha);
    assert.equal(receipt.repository.base_sha, undefined);
    assert.equal(receipt.repository.head_sha, undefined);
    assert.equal(receipt.events.length, 7);
    assert.equal(receipt.integrity.canonicalization, "RFC8785");
    assert.equal(
      new Set(receipt.capture.limitations).size,
      receipt.capture.limitations.length,
      "limitations should be deduplicated",
    );
  });
});

test("finish can generate a valid simulated failure receipt", async () => {
  await withFixture(async ({ dependencies, times }) => {
    await executeCli(["start", "--title", "Demonstrate a failed check"], dependencies);
    times.current = new Date("2026-07-17T20:01:00.000Z");
    await executeCli(["finish", "--result", "fail", "--tests", "5"], dependencies);

    const receipt = JSON.parse(await executeCli(["inspect", "--json"], dependencies));
    assert.equal(receipt.session.status, "failed");
    assert.equal(receipt.verification.status, "failed");
    assert.deepEqual(receipt.verification.tests, { passed: 4, failed: 1, skipped: 0 });
  });
});

test("a later session safely advances the latest receipt pointer", async () => {
  await withFixture(async ({ root, dependencies, times }) => {
    await executeCli(["start", "--title", "First simulated task"], dependencies);
    times.current = new Date("2026-07-17T20:01:00.000Z");
    await executeCli(["finish"], dependencies);

    times.current = new Date("2026-07-17T20:02:00.000Z");
    await executeCli(["start", "--title", "Second simulated task"], dependencies);
    times.current = new Date("2026-07-17T20:03:00.000Z");
    await executeCli(["finish"], dependencies);

    const latest = JSON.parse(await executeCli(["inspect", "--json"], dependencies));
    assert.equal(latest.task.title, "Second simulated task");
    assert.equal((await readdir(join(root, ".agentreceipt", "receipts"))).length, 2);
    assert.equal((await readdir(join(root, ".agentreceipt", "sessions"))).length, 2);
  });
});

test("invalid simulated paths are rejected without archiving the active session", async () => {
  await withFixture(async ({ root, dependencies, times }) => {
    await executeCli(["start", "--title", "Reject unsafe paths"], dependencies);
    times.current = new Date("2026-07-17T20:01:00.000Z");

    await assert.rejects(
      executeCli(["finish", "--file", "../outside.ts"], dependencies),
      /Invalid AgentReceipt/,
    );

    assert.equal(await pathExists(join(root, ".agentreceipt", "current.json")), true);
    assert.equal(await pathExists(join(root, ".agentreceipt", "receipts")), false);
  });
});

test("help is available and unknown commands fail clearly", async () => {
  const help = await executeCli(["help"]);
  assert.match(help, /agentreceipt start/);
  assert.match(help, /agentreceipt finalize/);
  assert.match(help, /start\/finish workflow remains simulated/i);

  await assert.rejects(
    executeCli(["launch"]),
    (error) => error instanceof CliError && error.exitCode === 2 && /Unknown command/.test(error.message),
  );

  await assert.rejects(
    executeCli(["finalize", "--input"]),
    (error) => error instanceof FinalizationError && error.code === "invalid_input",
  );
});

test("partial acceptance warnings reflect the finalized receipt status", () => {
  const complete = { capture: { status: "complete_for_declared_surface" } };
  const partial = { capture: { status: "partial" } };

  assert.equal(shouldWarnForAcceptedPartial(complete, true), false);
  assert.equal(shouldWarnForAcceptedPartial(partial, false), false);
  assert.equal(shouldWarnForAcceptedPartial(partial, true), true);
});

test("codex command writes a sanitized, schema-valid real capture receipt", async () => {
  const promptSecret = "PROMPT_SECRET_a91f";

  await withFixture(async ({ root, dependencies }) => {
    const codexDependencies = {
      ...dependencies,
      readRepository: async () => ({
        root,
        owner: "agentreceipt-demo",
        name: "sample-repository",
        branch: "feature/real-receipt",
        headSha,
        isClean: true,
        limitations: [],
      }),
      readRepositoryChanges: async () => [{
        path: "src/real-change.ts",
        change: "added",
        additions: 0,
        deletions: 0,
        lineCountsKnown: false,
        afterDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      }],
      runCodexCapture: async ({ prompt, sandbox }) => {
        assert.equal(prompt, promptSecret);
        assert.equal(sandbox, "read-only");
        return {
          status: "complete_for_declared_surface",
          process_exit_code: 0,
          terminal_event_received: true,
          cli_version: "0.145.0-test",
          events: [
            {
              kind: "command",
              source_event: "item.started",
              local_item_id: "item_000001",
              observed_at: "2026-07-17T20:00:00.000Z",
              outcome: "started",
            },
            {
              kind: "command",
              source_event: "item.completed",
              local_item_id: "item_000001",
              observed_at: "2026-07-17T20:00:00.000Z",
              outcome: "succeeded",
              exit_code: 0,
            },
          ],
          usage: { input_tokens: 20, output_tokens: 4 },
          record_counts: { parsed: 5, discarded_sensitive: 4, unknown: 0, malformed: 0 },
          redactions: { command: 2, command_output: 1, identifier: 2 },
          observed_capabilities: ["lifecycle", "commands", "usage"],
          unavailable_capabilities: ["host activity outside the wrapped process"],
          limitations: ["Capture is limited to the wrapped Codex process and its documented JSONL stream."],
        };
      },
      runVerification: async (command) => {
        assert.equal(command, "verify-secret-command");
        return {
          startedAt: "2026-07-17T20:00:00.000Z",
          endedAt: "2026-07-17T20:00:00.000Z",
          durationMs: 0,
          exitCode: 0,
        };
      },
    };

    const output = await executeCli([
      "codex",
      "--title",
      "Capture a real task",
      "--prompt",
      promptSecret,
      "--verify",
      "verify-secret-command",
    ], codexDependencies);

    assert.match(output, /Captured a wrapped Codex AgentReceipt/);
    assert.match(output, /complete for declared surface/);
    assert.equal(output.includes(promptSecret), false);
    assert.equal(output.includes("verify-secret-command"), false);

    const receiptFiles = await readdir(join(root, ".agentreceipt", "receipts"));
    const receipt = JSON.parse(await readFile(join(root, ".agentreceipt", "receipts", receiptFiles[0]), "utf8"));
    const serialized = JSON.stringify(receipt);
    assert.equal(serialized.includes(promptSecret), false);
    assert.equal(serialized.includes("verify-secret-command"), false);
    assert.equal(receipt.capture.surface, "codex_exec_jsonl");
    assert.equal(receipt.capture.status, "complete_for_declared_surface");
    assert.equal(receipt.capture.terminal_event_received, true);
    assert.equal(receipt.verification.status, "passed");
    assert.equal(receipt.files[0].path, "src/real-change.ts");
    assert.equal(receipt.files[0].line_counts_known, false);
    assert.match(receipt.files[0].after_digest, /^sha256:[a-f0-9]{64}$/);
    assert.equal(receipt.repository.binding_status, "draft");
    assert.equal(receipt.events.some((event) => event.details.command === "<redacted>"), true);

    const summary = await executeCli(["inspect"], codexDependencies);
    assert.match(summary, /CODEX RECEIPT — COMPLETE FOR DECLARED SURFACE/);
    assert.match(summary, /line counts unavailable/);
  });
});

test("codex command labels a receipt partial when independent verification is omitted", async () => {
  await withFixture(async ({ root, dependencies }) => {
    const codexDependencies = {
      ...dependencies,
      readRepository: async () => ({
        root,
        owner: "local",
        name: "sample",
        branch: "main",
        headSha: baseSha,
        isClean: true,
        limitations: [],
      }),
      readRepositoryChanges: async () => [],
      runCodexCapture: async () => ({
        status: "complete_for_declared_surface",
        process_exit_code: 0,
        terminal_event_received: true,
        events: [],
        record_counts: { parsed: 3, discarded_sensitive: 0, unknown: 0, malformed: 0 },
        redactions: {},
        observed_capabilities: ["lifecycle"],
        unavailable_capabilities: [],
        limitations: [],
      }),
    };

    await executeCli(["codex", "--title", "No verification", "--prompt", "harmless"], codexDependencies);
    const receipt = JSON.parse(await executeCli(["inspect", "--json"], codexDependencies));
    assert.equal(receipt.capture.status, "partial");
    assert.equal(receipt.verification.status, "not_run");
    assert.match(receipt.capture.limitations.join("\n"), /No independent verification command/);
  });
});

test("codex command rejects a dirty starting worktree", async () => {
  await withFixture(async ({ root, dependencies }) => {
    await assert.rejects(
      executeCli(["codex", "--title", "Unsafe attribution", "--prompt", "harmless"], {
        ...dependencies,
        readRepository: async () => ({
          root,
          owner: "local",
          name: "sample",
          branch: "main",
          headSha: baseSha,
          isClean: false,
          limitations: [],
        }),
      }),
      /requires a clean Git worktree/,
    );
  });
});
