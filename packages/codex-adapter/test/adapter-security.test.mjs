import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  CodexPrivateProjectionCapture,
  runCodexCaptureWithPrivateProjection,
} from "../dist/src/index.js";

const SYNTHETIC_CREDENTIAL = "github_pat_phase3syntheticcredential123456";

function completeCommand(command, parameters = []) {
  const capture = new CodexPrivateProjectionCapture(parameters);
  const start = new Date("2026-07-22T12:00:00.000Z");
  const end = new Date("2026-07-22T12:00:00.010Z");
  for (const [record, observedAt] of [
    [{ type: "thread.started", thread_id: "private-thread-id" }, start],
    [{ type: "turn.started" }, start],
    [{ type: "item.started", item: { id: "command-1", type: "command_execution", command } }, start],
    [{
      type: "item.completed",
      item: {
        id: "command-1",
        type: "command_execution",
        command,
        aggregated_output: SYNTHETIC_CREDENTIAL,
        exit_code: 0,
      },
    }, end],
    [{ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } }, end],
  ]) capture.ingest(JSON.stringify(record), observedAt);
  return capture.finish();
}

test("discarded messages, reasoning, and process output never enter the private projection", () => {
  const promptCanary = "PHASE3_SYNTHETIC_PROMPT_CANARY";
  const reasoningCanary = "PHASE3_SYNTHETIC_REASONING_CANARY";
  const capture = new CodexPrivateProjectionCapture([
    { name: "INPUT_FILE", sensitivity: "public", value: "input.txt" },
  ]);
  const records = [
    { type: "thread.started", thread_id: "private-thread-id" },
    { type: "turn.started" },
    { type: "item.completed", item: { id: "message-1", type: "agent_message", text: promptCanary } },
    { type: "item.completed", item: { id: "reasoning-1", type: "reasoning", text: reasoningCanary } },
    { type: "item.started", item: { id: "command-1", type: "command_execution", command: "git hash-object --no-filters input.txt" } },
    {
      type: "item.completed",
      item: {
        id: "command-1",
        type: "command_execution",
        command: "git hash-object --no-filters input.txt",
        aggregated_output: SYNTHETIC_CREDENTIAL,
        exit_code: 0,
      },
    },
    { type: "turn.completed" },
  ];
  records.forEach((record, index) => capture.ingest(
    JSON.stringify(record),
    new Date(`2026-07-22T12:00:00.${String(index).padStart(3, "0")}Z`),
  ));

  const projection = capture.finish();
  const serialized = JSON.stringify(projection);
  const serializedDiagnostic = JSON.stringify(projection.diagnostic);
  assert.equal(projection.structurally_eligible, true);
  for (const discarded of [promptCanary, reasoningCanary, SYNTHETIC_CREDENTIAL, "private-thread-id"]) {
    assert.equal(serialized.includes(discarded), false);
  }
  for (const privateSource of [
    promptCanary,
    reasoningCanary,
    SYNTHETIC_CREDENTIAL,
    "private-thread-id",
    "command-1",
    "git hash-object",
    "input.txt",
  ]) assert.equal(serializedDiagnostic.includes(privateSource), false);
});

test("private diagnostic reduces embedded commands to enum-only classifications", () => {
  const pathCanary = "phase4-sensitive-input.txt";
  const command = `cmd /c git hash-object --no-filters ${pathCanary}`;
  const projection = completeCommand(command);
  assert.deepEqual(projection.diagnostic, {
    command_shapes: ["allowlisted_command_embedded"],
    ineligibility_reasons: ["allowlisted_command_embedded", "no_action"],
    action_count: 0,
  });
  const serialized = JSON.stringify(projection.diagnostic);
  for (const sourceMaterial of [command, pathCanary, "cmd /c", "command-1", SYNTHETIC_CREDENTIAL]) {
    assert.equal(serialized.includes(sourceMaterial), false);
  }
});

test("alternate, shell-wrapped, write-capable, network-shaped, and unsafe-path commands fail closed", () => {
  const rejectedCommands = [
    "git.exe hash-object --no-filters input.txt",
    "GIT hash-object --no-filters input.txt",
    "git hash-object input.txt",
    "git hash-object --no-filters=input.txt",
    "git hash-object --no-filters input.txt --",
    "git cat-file blob input.txt",
    "git status",
    "cmd /c git hash-object --no-filters input.txt",
    "powershell -Command git hash-object --no-filters input.txt",
    "sh -c git hash-object --no-filters input.txt",
    "curl https://example.invalid",
    "git hash-object --no-filters ../input.txt",
    "git hash-object --no-filters C:/input.txt",
    "git hash-object --no-filters .git/config",
    "git hash-object --no-filters .agentreceipt/recipes/input.json",
  ];

  for (const command of rejectedCommands) {
    const projection = completeCommand(command);
    assert.equal(projection.structurally_eligible, false);
    assert.equal(projection.unsupported_material, true);
  }
});

test("credential-shaped command material and parameter ambiguity are ineligible", () => {
  const credentialProjection = completeCommand(`git hash-object --no-filters ${SYNTHETIC_CREDENTIAL}`);
  assert.equal(credentialProjection.secret_material_detected, true);
  assert.equal(credentialProjection.structurally_eligible, false);

  const unusedParameter = completeCommand("git hash-object --no-filters input.txt", [
    { name: "OTHER_FILE", sensitivity: "public", value: "other.txt" },
  ]);
  assert.equal(unusedParameter.structurally_eligible, false);

  const injectedParameter = completeCommand("git hash-object --no-filters input.txt;curl", [
    { name: "INPUT_FILE", sensitivity: "public", value: "input.txt;curl" },
  ]);
  assert.equal(injectedParameter.structurally_eligible, false);

  assert.throws(
    () => new CodexPrivateProjectionCapture([
      { name: "lowercase", sensitivity: "public", value: "input.txt" },
    ]),
    /Invalid private projection parameter declaration/,
  );
});

test("partial, mismatched, unknown, and failed lifecycles remain ineligible", () => {
  const cases = [
    [
      { type: "thread.started" },
      { type: "turn.started" },
      { type: "item.started", item: { id: "command-1", type: "command_execution", command: "git hash-object --no-filters input.txt" } },
      { type: "turn.completed" },
    ],
    [
      { type: "thread.started" },
      { type: "turn.started" },
      { type: "item.started", item: { id: "command-1", type: "command_execution", command: "git hash-object --no-filters input.txt" } },
      { type: "item.completed", item: { id: "command-1", type: "command_execution", command: "git hash-object --no-filters other.txt", exit_code: 0 } },
      { type: "turn.completed" },
    ],
    [
      { type: "thread.started" },
      { type: "turn.started" },
      { type: "future.event", opaque: true },
      { type: "turn.completed" },
    ],
    [
      { type: "thread.started" },
      { type: "turn.started" },
      { type: "turn.failed", error: { message: "discarded" } },
    ],
  ];

  for (const records of cases) {
    const capture = new CodexPrivateProjectionCapture();
    records.forEach((record) => capture.ingest(JSON.stringify(record)));
    assert.equal(capture.finish().structurally_eligible, false);
  }
});

test("the owned runner drains prompt, stderr, messages, reasoning, and command output", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentreceipt-phase3-adapter-"));
  const fakeCodex = join(root, "fake-codex.mjs");
  const promptCanary = "PHASE3_RUNNER_PROMPT_CANARY";
  const stderrCanary = "PHASE3_RUNNER_STDERR_CANARY";
  const records = [
    { type: "thread.started", thread_id: "runner-private-thread" },
    { type: "turn.started" },
    { type: "item.completed", item: { id: "message-1", type: "agent_message", text: promptCanary } },
    { type: "item.completed", item: { id: "reasoning-1", type: "reasoning", text: "PHASE3_RUNNER_REASONING_CANARY" } },
    { type: "item.started", item: { id: "command-1", type: "command_execution", command: "git hash-object --no-filters input.txt" } },
    { type: "item.completed", item: { id: "command-1", type: "command_execution", command: "git hash-object --no-filters input.txt", aggregated_output: SYNTHETIC_CREDENTIAL, exit_code: 0 } },
    { type: "turn.completed" },
  ];
  await writeFile(fakeCodex, `
if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 9.9.9-phase3\\n");
} else {
  process.stdin.resume();
  process.stderr.write(${JSON.stringify(stderrCanary)} + "\\n");
  for (const record of ${JSON.stringify(records)}) process.stdout.write(JSON.stringify(record) + "\\n");
}
`, "utf8");

  try {
    const result = await runCodexCaptureWithPrivateProjection({
      cwd: root,
      prompt: promptCanary,
      sandbox: "read-only",
      parameters: [{ name: "INPUT_FILE", sensitivity: "public", value: "input.txt" }],
      executable: process.execPath,
      executableArgsPrefix: [fakeCodex],
    });
    assert.equal(result.private_projection.structurally_eligible, true);
    const serialized = JSON.stringify(result);
    for (const discarded of [promptCanary, stderrCanary, SYNTHETIC_CREDENTIAL, "PHASE3_RUNNER_REASONING_CANARY", "runner-private-thread"]) {
      assert.equal(serialized.includes(discarded), false);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
