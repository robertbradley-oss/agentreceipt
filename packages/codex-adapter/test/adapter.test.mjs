import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { CodexJsonlCapture, runCodexCapture } from "../dist/src/index.js";

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
  process.stderr.write("${secretPrompt}\\n");
  process.stdout.write(JSON.stringify({ type: "thread.started", thread_id: "raw-runner-id" }) + "\\n");
  process.stdout.write(JSON.stringify({ type: "turn.started" }) + "\\n");
  process.stdout.write(JSON.stringify({ type: "turn.completed", usage: { output_tokens: 1 } }) + "\\n");
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
