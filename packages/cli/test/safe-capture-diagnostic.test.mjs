import assert from "node:assert/strict";
import { execFile, fork } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  classifyPrivateCapture,
  executeCli,
  isSafeCaptureDiagnosticClassification,
} from "../dist/src/index.js";

const execFileAsync = promisify(execFile);
const PRIVATE_CANARY = "RAW_PRIVATE_DIAGNOSTIC_CANARY_8f17";
const testDirectory = dirname(fileURLToPath(import.meta.url));

const baseCapture = {
  status: "complete_for_declared_surface",
  process_exit_code: 0,
  terminal_event_received: true,
  cli_version: "9.9.9-fixture",
  events: [],
  record_counts: { parsed: 4, discarded_sensitive: 2, unknown: 0, malformed: 0 },
  redactions: { command: 1, command_output: 1 },
  observed_capabilities: ["lifecycle", "commands"],
  unavailable_capabilities: ["unowned host activity"],
  limitations: ["Synthetic diagnostic fixture."],
};

function projection(reasons = [], options = {}) {
  return {
    parameters: [],
    actions: [],
    structurally_eligible: options.structurallyEligible ?? false,
    unsupported_material: reasons.length > 0,
    secret_material_detected: options.secretMaterial ?? false,
    malformed_records: 0,
    pending_items: 0,
    diagnostic: {
      command_shapes: options.commandShapes ?? [],
      ineligibility_reasons: reasons,
      action_count: options.actionCount ?? 0,
      raw_command: PRIVATE_CANARY,
    },
  };
}

test("safe capture classifier returns only bounded allowlisted categories", () => {
  const cases = [
    [{ ...baseCapture, status: "failed" }, projection(), "capture_failed"],
    [baseCapture, projection(["secret_material"], { secretMaterial: true }), "secret_material"],
    [baseCapture, projection(["allowlisted_command_embedded"]), "allowlisted_command_embedded"],
    [baseCapture, projection(["unsupported_command_shape"]), "unsupported_command_shape"],
    [baseCapture, projection(["unsupported_item"]), "unsupported_event_shape"],
    [baseCapture, projection(["lifecycle_incomplete"]), "lifecycle_ineligible"],
    [baseCapture, projection(["command_failed"]), "command_failed"],
    [baseCapture, projection(["parameter_unused"]), "parameter_unused"],
    [baseCapture, projection(["no_action"]), "no_action"],
    [baseCapture, projection([], { structurallyEligible: true, commandShapes: ["direct_allowlisted"] }), "projection_eligible"],
    [baseCapture, projection(), "other_ineligible"],
  ];

  for (const [capture, privateProjection, expected] of cases) {
    const actual = classifyPrivateCapture(capture, privateProjection);
    assert.equal(actual, expected);
    assert.equal(isSafeCaptureDiagnosticClassification(actual), true);
    assert.equal(JSON.stringify(actual).includes(PRIVATE_CANARY), false);
  }
});

test("malformed or unbounded private diagnostics collapse to one fixed category", () => {
  for (const privateProjection of [
    projection([], { actionCount: 10_001 }),
    projection(["unknown_unapproved_reason"]),
    projection(["no_action", "command_failed"]),
    { ...projection(), diagnostic: { command_shapes: [], action_count: 0, raw: PRIVATE_CANARY } },
  ]) {
    assert.equal(classifyPrivateCapture(baseCapture, privateProjection), "invalid_private_diagnostic");
  }
  assert.equal(isSafeCaptureDiagnosticClassification(PRIVATE_CANARY), false);
});

test("instrumented CLI callback receives one safe category without changing the fixed failure", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentreceipt-safe-diagnostic-"));
  const repository = join(root, "repository");
  const promptCanary = "PRIVATE_PROMPT_CANARY_b941";
  const classifications = [];
  try {
    await mkdir(repository);
    await execFileAsync("git", ["init"], { cwd: repository, windowsHide: true });
    await execFileAsync("git", ["config", "user.email", "agentreceipt@example.invalid"], { cwd: repository, windowsHide: true });
    await execFileAsync("git", ["config", "user.name", "AgentReceipt Test"], { cwd: repository, windowsHide: true });
    await writeFile(join(repository, ".gitignore"), ".agentreceipt/\n", "utf8");
    await writeFile(join(repository, "input.txt"), "safe diagnostic fixture\n", "utf8");
    await execFileAsync("git", ["add", ".gitignore", "input.txt"], { cwd: repository, windowsHide: true });
    await execFileAsync("git", ["commit", "-m", "safe diagnostic fixture"], { cwd: repository, windowsHide: true });

    const privateProjection = projection([
      "allowlisted_command_embedded",
      "no_action",
      "parameter_unused",
      "unsupported_item",
    ], { commandShapes: ["allowlisted_command_embedded"] });

    await assert.rejects(
      executeCli([
        "codex",
        "--title", "Safe callback fixture",
        "--prompt", promptCanary,
        "--capsule",
        "--verify-file", "input.txt",
        "--param", "INPUT_FILE=input.txt",
      ], {
        cwd: repository,
        runCodexCaptureWithPrivateProjection: async () => ({
          capture: { ...baseCapture, status: "partial" },
          private_projection: privateProjection,
        }),
        onSafeCaptureDiagnostic: (classification) => {
          classifications.push(classification);
          throw new Error(PRIVATE_CANARY);
        },
      }),
      (error) => error?.code === "capsule_ineligible"
        && !error.message.includes(PRIVATE_CANARY)
        && !error.message.includes(promptCanary),
    );

    assert.deepEqual(classifications, ["allowlisted_command_embedded"]);
    const receipts = await readdir(join(repository, ".agentreceipt", "receipts"));
    assert.equal(receipts.length, 1);
    const receipt = await readFile(join(repository, ".agentreceipt", "receipts", receipts[0]), "utf8");
    assert.equal(receipt.includes(PRIVATE_CANARY), false);
    assert.equal(receipt.includes(promptCanary), false);
    assert.equal(receipt.includes("allowlisted_command_embedded"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Phase 4 instrumented child sends one allowlisted IPC category and fixed stderr", async () => {
  const result = await new Promise((resolve, reject) => {
    const child = fork(
      join(testDirectory, "support", "phase-4-instrumented-cli.mjs"),
      ["--self-test-safe-diagnostic-ipc"],
      { silent: true },
    );
    const messages = [];
    let stderr = "";
    child.on("message", (message) => messages.push(message));
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.once("error", reject);
    child.once("close", (exitCode) => resolve({ exitCode, messages, stderr }));
  });

  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.messages, [{
    kind: "safe_capture_diagnostic",
    classification: "allowlisted_command_embedded",
  }]);
  assert.equal(
    result.stderr,
    "AgentReceipt error: Observe, learn, or replay input failed safely (capsule_ineligible).\n",
  );
  assert.equal(JSON.stringify(result).includes(PRIVATE_CANARY), false);
});
