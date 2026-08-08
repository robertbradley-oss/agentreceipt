import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  CodexJsonlCapture,
  CodexPrivateProjectionCapture,
  runCodexCapture,
  runCodexCaptureWithPrivateProjection,
} from "../dist/src/index.js";

const secretPrompt = "SECRET_PROMPT_4f581";
const secretCommand = "echo SECRET_COMMAND_9a221";
const secretOutput = "SECRET_OUTPUT_b8732";
const rawThreadId = "0199a213-81c0-7800-8aa1-bbab2a035a53";

function safeCapture() {
  const parser = new CodexJsonlCapture();
  const at = new Date("2026-07-18T02:00:00.000Z");
  for (const record of [
    { type: "thread.started", thread_id: rawThreadId },
    { type: "turn.started" },
    { type: "item.completed", item: { id: "agent-secret-id", type: "agent_message", text: secretPrompt } },
    { type: "item.completed", item: { id: "reasoning-secret-id", type: "reasoning", text: "private reasoning" } },
    { type: "item.started", item: { id: "command-secret-id", type: "command_execution", command: secretCommand, status: "in_progress" } },
    { type: "item.completed", item: { id: "command-secret-id", type: "command_execution", command: secretCommand, aggregated_output: secretOutput, exit_code: 0, status: "completed" } },
    { type: "item.completed", item: { id: "file-secret-id", type: "file_change", changes: [{ path: "src/private.ts", diff: "source" }] } },
    { type: "turn.completed", usage: { input_tokens: 12, output_tokens: 4 } },
  ]) {
    parser.ingest(JSON.stringify(record), at);
  }
  return parser.finish(0, "0.145.0-alpha.18");
}

test("sanitizes documented JSONL records before returning capture data", () => {
  const result = safeCapture();
  assert.equal(result.status, "complete_for_declared_surface");
  assert.equal(result.terminal_event_received, true);
  assert.equal(result.events.length, 3);
  assert.equal(result.events[1].kind, "command");
  assert.equal(result.events[1].exit_code, 0);
  assert.deepEqual(result.usage, { input_tokens: 12, output_tokens: 4 });

  const serialized = JSON.stringify(result);
  for (const sensitive of [secretPrompt, secretCommand, secretOutput, rawThreadId, "agent-secret-id", "src/private.ts"]) {
    assert.equal(serialized.includes(sensitive), false, `capture leaked ${sensitive}`);
  }
  assert.ok((result.redactions.command ?? 0) > 0);
  assert.ok((result.redactions.command_output ?? 0) > 0);
  assert.ok((result.redactions.reasoning ?? 0) > 0);
});

test("unknown, malformed, and truncated streams are explicitly partial", () => {
  const parser = new CodexJsonlCapture();
  parser.ingest("not-json");
  parser.ingest(JSON.stringify({ type: "future.event", secret: secretOutput }));
  parser.ingest(JSON.stringify({
    type: "item.started",
    item: { id: "pending-id", type: "command_execution", command: secretCommand },
  }));

  const result = parser.finish(0, "0.145.0-alpha.18");
  assert.equal(result.status, "partial");
  assert.equal(result.terminal_event_received, false);
  assert.equal(result.record_counts.malformed, 1);
  assert.equal(result.record_counts.unknown, 1);
  assert.match(result.limitations.join("\n"), /terminal turn event/);
  assert.match(result.limitations.join("\n"), /no matching completed event/);
  assert.equal(JSON.stringify(result).includes(secretOutput), false);
});

test("failed Codex turns remain failed rather than being softened to partial", () => {
  const parser = new CodexJsonlCapture();
  parser.ingest(JSON.stringify({ type: "turn.failed", message: "sensitive failure detail" }));
  const result = parser.finish(1, "0.145.0-alpha.18");
  assert.equal(result.status, "failed");
  assert.equal(JSON.stringify(result).includes("sensitive failure detail"), false);
});

test("runner launches a JSONL process without retaining its prompt or stderr", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentreceipt-adapter-test-"));
  const fakeCodex = join(root, "fake-codex.mjs");
  await writeFile(fakeCodex, `
if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 9.9.9-test\\n");
} else {
  let prompt = "";
  for await (const chunk of process.stdin) prompt += chunk;
  const expectedArguments = [
    "exec",
    "--json",
    "--ephemeral",
    "--ignore-user-config",
    "--ignore-rules",
    "--sandbox",
    "read-only",
    "-",
  ];
  if (prompt !== ${JSON.stringify(secretPrompt)} || JSON.stringify(process.argv.slice(2)) !== JSON.stringify(expectedArguments)) {
    process.exitCode = 2;
  } else {
  process.stderr.write("${secretPrompt}\\n");
  process.stdout.write(JSON.stringify({ type: "thread.started", thread_id: "raw-runner-id" }) + "\\n");
  process.stdout.write(JSON.stringify({ type: "turn.started" }) + "\\n");
  process.stdout.write(JSON.stringify({ type: "turn.completed", usage: { output_tokens: 1 } }) + "\\n");
  }
}
`, "utf8");

  try {
    const result = await runCodexCapture({
      cwd: root,
      prompt: secretPrompt,
      sandbox: "read-only",
      executable: process.execPath,
      executableArgsPrefix: [fakeCodex],
    });
    assert.equal(result.status, "complete_for_declared_surface");
    assert.equal(result.cli_version, "9.9.9-test");
    assert.equal(JSON.stringify(result).includes(secretPrompt), false);
    assert.equal(JSON.stringify(result).includes("raw-runner-id"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("private projection normalizes only the fixture allowlist without changing public capture", () => {
  const privateCapture = new CodexPrivateProjectionCapture([{
    name: "INPUT_FILE",
    sensitivity: "public",
    value: "input.txt",
  }]);
  const publicCapture = new CodexJsonlCapture();
  const at = new Date("2026-07-22T16:00:00.000Z");
  for (const record of [
    { type: "thread.started", thread_id: rawThreadId },
    { type: "turn.started" },
    { type: "item.started", item: { id: "private-command-id", type: "command_execution", command: "git hash-object --no-filters input.txt", status: "in_progress" } },
    { type: "item.completed", item: { id: "private-command-id", type: "command_execution", command: "git hash-object --no-filters input.txt", aggregated_output: secretOutput, exit_code: 0, status: "completed" } },
    { type: "turn.completed", usage: { input_tokens: 2, output_tokens: 1 } },
  ]) {
    const line = JSON.stringify(record);
    publicCapture.ingest(line, at);
    privateCapture.ingest(line, at);
  }

  const publicResult = publicCapture.finish(0, "9.9.9-test");
  const privateResult = privateCapture.finish();
  assert.equal(privateResult.structurally_eligible, true);
  assert.deepEqual(privateResult.actions[0].arguments, [
    "hash-object",
    "--no-filters",
    "{{param.INPUT_FILE}}",
  ]);
  assert.deepEqual(privateResult.diagnostic, {
    command_shapes: ["direct_allowlisted"],
    ineligibility_reasons: [],
    action_count: 1,
  });
  assert.equal(JSON.stringify(privateResult).includes("input.txt"), true);
  assert.equal(JSON.stringify(privateResult).includes(secretOutput), false);
  assert.equal(JSON.stringify(publicResult).includes("git hash-object"), false);
  assert.equal(JSON.stringify(publicResult).includes(secretOutput), false);
  assert.equal("diagnostic" in publicResult, false);
});

test("private projection rejects shell-shaped and secret-bearing commands", () => {
  for (const [command, shape, reason] of [
    ["git hash-object --no-filters input.txt | more", "allowlisted_command_embedded", "allowlisted_command_embedded"],
    ["powershell -Command Get-Content input.txt", "unsupported", "unsupported_command_shape"],
    ["git hash-object --no-filters github_pat_abcdefghijklmnopqrstuvwxyz123456", "direct_allowlisted", "secret_material"],
  ]) {
    const capture = new CodexPrivateProjectionCapture();
    capture.ingest(JSON.stringify({ type: "thread.started", thread_id: "unsafe-thread" }));
    capture.ingest(JSON.stringify({ type: "turn.started" }));
    capture.ingest(JSON.stringify({
      type: "item.started",
      item: { id: "unsafe", type: "command_execution", command, status: "in_progress" },
    }));
    capture.ingest(JSON.stringify({
      type: "item.completed",
      item: { id: "unsafe", type: "command_execution", command, exit_code: 0, status: "completed" },
    }));
    capture.ingest(JSON.stringify({ type: "turn.completed", usage: {} }));
    const result = capture.finish();
    assert.equal(result.structurally_eligible, false);
    assert.deepEqual(result.diagnostic.command_shapes, [shape]);
    assert.equal(result.diagnostic.ineligibility_reasons.includes(reason), true);
    if (command.includes("github_pat_")) assert.equal(result.secret_material_detected, true);
  }
});

test("private projection rejects unused or ambiguous parameter declarations", () => {
  for (const parameters of [
    [{ name: "UNUSED", sensitivity: "public", value: "other.txt" }],
    [{
      name: "TOKEN",
      sensitivity: "secret",
      value: "private-value-not-in-command",
      source_environment: "SOURCE_TOKEN",
      target_environment: "TARGET_TOKEN",
    }],
  ]) {
    const capture = new CodexPrivateProjectionCapture(parameters);
    capture.ingest(JSON.stringify({ type: "thread.started", thread_id: "parameter-thread" }));
    capture.ingest(JSON.stringify({ type: "turn.started" }));
    capture.ingest(JSON.stringify({
      type: "item.started",
      item: {
        id: "parameter-command",
        type: "command_execution",
        command: "git hash-object --no-filters input.txt",
        status: "in_progress",
      },
    }));
    capture.ingest(JSON.stringify({
      type: "item.completed",
      item: {
        id: "parameter-command",
        type: "command_execution",
        command: "git hash-object --no-filters input.txt",
        exit_code: 0,
        status: "completed",
      },
    }));
    capture.ingest(JSON.stringify({ type: "turn.completed", usage: {} }));
    const result = capture.finish();
    assert.equal(result.structurally_eligible, false);
    assert.equal(result.diagnostic.ineligibility_reasons.includes("parameter_unused"), true);
  }
});

test("private projection rejects mismatched or incomplete action lifecycles", () => {
  const mismatched = new CodexPrivateProjectionCapture();
  mismatched.ingest(JSON.stringify({ type: "thread.started", thread_id: "mismatch-thread" }));
  mismatched.ingest(JSON.stringify({ type: "turn.started" }));
  mismatched.ingest(JSON.stringify({
    type: "item.started",
    item: {
      id: "mismatch",
      type: "command_execution",
      command: "git hash-object --no-filters input.txt",
      status: "in_progress",
    },
  }));
  mismatched.ingest(JSON.stringify({
    type: "item.completed",
    item: {
      id: "mismatch",
      type: "command_execution",
      command: "git hash-object --no-filters other.txt",
      exit_code: 0,
      status: "completed",
    },
  }));
  mismatched.ingest(JSON.stringify({ type: "turn.completed", usage: {} }));
  assert.equal(mismatched.finish().structurally_eligible, false);

  const incomplete = new CodexPrivateProjectionCapture();
  incomplete.ingest(JSON.stringify({ type: "thread.started", thread_id: "incomplete-thread" }));
  incomplete.ingest(JSON.stringify({ type: "turn.started" }));
  incomplete.ingest(JSON.stringify({
    type: "item.started",
    item: {
      id: "incomplete",
      type: "command_execution",
      command: "git hash-object --no-filters input.txt",
      status: "in_progress",
    },
  }));
  assert.equal(incomplete.finish().structurally_eligible, false);
});

test("private projection rejects write and network-capable item types", () => {
  for (const itemType of ["file_change", "web_search", "mcp_tool_call"]) {
    const capture = new CodexPrivateProjectionCapture();
    capture.ingest(JSON.stringify({ type: "thread.started", thread_id: "unsupported-thread" }));
    capture.ingest(JSON.stringify({ type: "turn.started" }));
    capture.ingest(JSON.stringify({
      type: "item.completed",
      item: { id: "unsupported", type: itemType, status: "completed" },
    }));
    capture.ingest(JSON.stringify({ type: "turn.completed", usage: {} }));
    const result = capture.finish();
    assert.equal(result.structurally_eligible, false);
    assert.equal(result.unsupported_material, true);
    assert.equal(result.diagnostic.ineligibility_reasons.includes("unsupported_item"), true);
    assert.equal(result.diagnostic.ineligibility_reasons.includes("no_action"), true);
  }
});

test("private diagnostic uses only bounded sorted event-shape enums", () => {
  const capture = new CodexPrivateProjectionCapture();
  capture.ingest("not-json");
  capture.ingest(JSON.stringify({ type: "thread.started", thread_id: "diagnostic-thread" }));
  capture.ingest(JSON.stringify({ type: "turn.started" }));
  capture.ingest(JSON.stringify({ type: "future.event", opaque: "discarded" }));
  capture.ingest(JSON.stringify({
    type: "item.started",
    item: { id: "failed-command", type: "command_execution", command: "git hash-object --no-filters input.txt" },
  }));
  capture.ingest(JSON.stringify({
    type: "item.completed",
    item: { id: "failed-command", type: "command_execution", command: "git hash-object --no-filters input.txt", exit_code: 7 },
  }));
  capture.ingest(JSON.stringify({ type: "turn.failed", error: { message: "discarded" } }));

  const diagnostic = capture.finish().diagnostic;
  assert.deepEqual(diagnostic, {
    command_shapes: ["direct_allowlisted"],
    ineligibility_reasons: [
      "command_failed",
      "lifecycle_incomplete",
      "malformed_record",
      "turn_failed",
      "unknown_event",
    ],
    action_count: 1,
  });
  assert.deepEqual(diagnostic.command_shapes, [...new Set(diagnostic.command_shapes)].sort());
  assert.deepEqual(
    diagnostic.ineligibility_reasons,
    [...new Set(diagnostic.ineligibility_reasons)].sort(),
  );
});

test("explicit private runner returns two separate projections", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentreceipt-private-adapter-test-"));
  const fakeCodex = join(root, "fake-codex.mjs");
  await writeFile(fakeCodex, `
if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 9.9.9-test\\n");
} else {
  for (const record of [
    { type: "thread.started", thread_id: "private-runner-thread" },
    { type: "turn.started" },
    { type: "item.started", item: { id: "command-1", type: "command_execution", command: "git hash-object --no-filters input.txt", status: "in_progress" } },
    { type: "item.completed", item: { id: "command-1", type: "command_execution", command: "git hash-object --no-filters input.txt", aggregated_output: "discarded", exit_code: 0, status: "completed" } },
    { type: "turn.completed", usage: { output_tokens: 1 } },
  ]) process.stdout.write(JSON.stringify(record) + "\\n");
}
`, "utf8");

  try {
    const result = await runCodexCaptureWithPrivateProjection({
      cwd: root,
      prompt: secretPrompt,
      sandbox: "read-only",
      executable: process.execPath,
      executableArgsPrefix: [fakeCodex],
      parameters: [{ name: "INPUT_FILE", sensitivity: "public", value: "input.txt" }],
    });
    assert.equal(result.capture.status, "complete_for_declared_surface");
    assert.equal(result.private_projection.structurally_eligible, true);
    assert.equal(JSON.stringify(result.capture).includes("git hash-object"), false);
    assert.equal(JSON.stringify(result.private_projection).includes(secretPrompt), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
