import assert from "node:assert/strict";
import test from "node:test";

import { CodexPrivateProjectionCapture } from "../dist/src/index.js";

const ALLOWLISTED_COMMAND = "git hash-object --no-filters input.txt";

function projectionFor(command, additionalItems = []) {
  const capture = new CodexPrivateProjectionCapture();
  const records = [
    { type: "thread.started", thread_id: "synthetic-thread" },
    { type: "turn.started" },
    ...additionalItems.map((item, index) => ({
      type: "item.completed",
      item: { id: `synthetic-item-${index}`, ...item },
    })),
    {
      type: "item.started",
      item: { id: "synthetic-command", type: "command_execution", command },
    },
    {
      type: "item.completed",
      item: {
        id: "synthetic-command",
        type: "command_execution",
        command,
        aggregated_output: "discarded synthetic output",
        exit_code: 0,
      },
    },
    { type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } },
  ];
  records.forEach((record) => capture.ingest(JSON.stringify(record)));
  return capture.finish();
}

test("direct allowlisted command remains the only eligible command control", () => {
  const projection = projectionFor(ALLOWLISTED_COMMAND);
  assert.equal(projection.structurally_eligible, true);
  assert.deepEqual(projection.diagnostic, {
    command_shapes: ["direct_allowlisted"],
    ineligibility_reasons: [],
    action_count: 1,
  });
});

test("benign-looking envelopes and executable near misses collapse to the same rejected shape", () => {
  const envelopeCandidates = [
    `cmd /c ${ALLOWLISTED_COMMAND}`,
    `powershell -Command "${ALLOWLISTED_COMMAND}"`,
    `sh -lc '${ALLOWLISTED_COMMAND}'`,
    `"${ALLOWLISTED_COMMAND}"`,
    `prefix ${ALLOWLISTED_COMMAND}`,
    `${ALLOWLISTED_COMMAND} suffix`,
  ];
  const executableNearMisses = [
    `${ALLOWLISTED_COMMAND} && git status`,
    `${ALLOWLISTED_COMMAND} ; git status`,
    `${ALLOWLISTED_COMMAND} | more`,
    `${ALLOWLISTED_COMMAND} > digest.txt`,
    `$(${ALLOWLISTED_COMMAND})`,
    `${ALLOWLISTED_COMMAND}\ngit status`,
  ];
  const expectedDiagnostic = {
    command_shapes: ["allowlisted_command_embedded"],
    ineligibility_reasons: ["allowlisted_command_embedded", "no_action"],
    action_count: 0,
  };

  const diagnostics = [...envelopeCandidates, ...executableNearMisses].map((command) => {
    const projection = projectionFor(command);
    assert.equal(projection.structurally_eligible, false);
    assert.equal(projection.unsupported_material, true);
    assert.deepEqual(projection.diagnostic, expectedDiagnostic);
    assert.equal(JSON.stringify(projection.diagnostic).includes(command), false);
    return JSON.stringify(projection.diagnostic);
  });

  assert.equal(new Set(diagnostics).size, 1);
});

test("ignored controls remain distinguishable from unsupported actionable item categories", () => {
  for (const item of [
    { type: "agent_message", text: "discarded synthetic message" },
    { type: "reasoning", text: "discarded synthetic reasoning" },
  ]) {
    const projection = projectionFor(ALLOWLISTED_COMMAND, [item]);
    assert.equal(projection.structurally_eligible, true);
    assert.deepEqual(projection.diagnostic, {
      command_shapes: ["direct_allowlisted"],
      ineligibility_reasons: [],
      action_count: 1,
    });
  }

  const unsupportedItems = [
    { type: "file_change", changes: [{ path: "synthetic.txt", diff: "discarded" }] },
    { type: "mcp_tool_call", tool: "synthetic", arguments: { canary: "discarded" } },
    { type: "web_search", query: "discarded synthetic query" },
    { type: "plan_update", plan: [{ step: "discarded", status: "completed" }] },
  ];
  const diagnostics = unsupportedItems.map((item) => {
    const projection = projectionFor(ALLOWLISTED_COMMAND, [item]);
    assert.equal(projection.structurally_eligible, false);
    assert.equal(projection.unsupported_material, true);
    assert.deepEqual(projection.diagnostic, {
      command_shapes: ["direct_allowlisted"],
      ineligibility_reasons: ["unsupported_item"],
      action_count: 1,
    });
    assert.equal(JSON.stringify(projection.diagnostic).includes(item.type), false);
    return JSON.stringify(projection.diagnostic);
  });

  assert.equal(new Set(diagnostics).size, 1);
});
