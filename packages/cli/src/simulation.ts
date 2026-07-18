import { assertReceipt, type AgentReceipt } from "@agentreceipt/schema";

import { sha256 } from "./json.js";
import type { ActiveSession, RepositorySnapshot } from "./types.js";

export interface SimulationOptions {
  endedAt: Date;
  filePath: string;
  result: "pass" | "fail";
  testCount: number;
}

function eventTimestamp(startedAt: number, endedAt: number, index: number, finalIndex: number): string {
  const elapsed = endedAt - startedAt;
  return new Date(startedAt + Math.floor((elapsed * index) / finalIndex)).toISOString();
}

function evidenceDigest(value: Record<string, unknown>): `sha256:${string}` {
  return sha256(value);
}

export function createSimulatedReceipt(
  session: ActiveSession,
  repository: RepositorySnapshot,
  options: SimulationOptions,
): AgentReceipt {
  const startedAt = Date.parse(session.started_at);
  const endedAt = Math.max(startedAt, options.endedAt.getTime());
  const passed = options.result === "pass" ? options.testCount : Math.max(0, options.testCount - 1);
  const failed = options.result === "fail" ? 1 : 0;
  const testOutcome = options.result === "pass" ? "succeeded" : "failed";
  const eventsWithoutDigests = [
    {
      id: "evt_session_start",
      sequence: 0,
      timestamp: eventTimestamp(startedAt, endedAt, 0, 6),
      type: "session",
      outcome: "started",
      summary: "Simulated receipt capture started.",
      details: { phase: "start" },
    },
    {
      id: "evt_tool_simulator",
      sequence: 1,
      timestamp: eventTimestamp(startedAt, endedAt, 1, 6),
      type: "tool",
      outcome: "succeeded",
      summary: "The simulator generated an observable tool event.",
      duration_ms: 20,
      details: { tool_name: "agentreceipt-simulator" },
    },
    {
      id: "evt_file_change",
      sequence: 2,
      timestamp: eventTimestamp(startedAt, endedAt, 2, 6),
      type: "file",
      outcome: "succeeded",
      summary: `Simulated a modification to ${options.filePath}.`,
      details: { file_path: options.filePath, file_action: "modified" },
    },
    {
      id: "evt_command_test",
      sequence: 3,
      timestamp: eventTimestamp(startedAt, endedAt, 3, 6),
      type: "command",
      outcome: testOutcome,
      summary: "Simulated a test command.",
      duration_ms: 1250,
      details: {
        command: "pnpm test --filter simulated",
        exit_code: options.result === "pass" ? 0 : 1,
        output_digest: sha256({ fixture: "simulated-test-output", result: options.result }),
      },
    },
    {
      id: "evt_test_result",
      sequence: 4,
      timestamp: eventTimestamp(startedAt, endedAt, 4, 6),
      type: "test",
      outcome: testOutcome,
      summary: options.result === "pass" ? "Simulated tests passed." : "A simulated test failed.",
      details: {
        test_framework: "node:test (simulated)",
        passed,
        failed,
        skipped: 0,
      },
    },
    {
      id: "evt_git_diff",
      sequence: 5,
      timestamp: eventTimestamp(startedAt, endedAt, 5, 6),
      type: "git",
      outcome: "info",
      summary: "Recorded the repository state for the simulated receipt.",
      details: {
        git_action: "diff",
        commit_sha: repository.headSha,
      },
    },
    {
      id: "evt_session_finish",
      sequence: 6,
      timestamp: eventTimestamp(startedAt, endedAt, 6, 6),
      type: "session",
      outcome: testOutcome,
      summary: "Simulated receipt capture finished.",
      details: { phase: "finish" },
    },
  ] as const;

  const events = eventsWithoutDigests.map((event) => ({
    ...event,
    evidence_digest: evidenceDigest(event),
  }));

  const receiptWithoutIntegrity = {
    schema_version: "0.1",
    receipt_id: session.receipt_id,
    created_at: new Date(endedAt).toISOString(),
    task: {
      ...session.task,
      source: "user",
      input_digest: sha256(session.task),
    },
    session: {
      id: session.session_id,
      started_at: session.started_at,
      ended_at: new Date(endedAt).toISOString(),
      status: options.result === "pass" ? "completed" : "failed",
    },
    agent: {
      name: "AgentReceipt Simulator",
      version: "0.1.0",
    },
    repository: {
      provider: "github",
      owner: repository.owner,
      name: repository.name,
      branch: repository.branch,
      base_sha: session.repository.base_sha,
      head_sha: repository.headSha,
    },
    capture: {
      adapter: "agentreceipt-simulator",
      adapter_version: "0.1.0",
      source: "simulated",
      surface: "simulator",
      status: "complete_for_declared_surface",
      capabilities: ["lifecycle", "tools", "commands", "files", "tests", "git"],
      observed_capabilities: ["lifecycle", "tools", "commands", "files", "tests", "git"],
      unavailable_capabilities: ["real agent observation"],
      record_counts: {
        parsed: 7,
        discarded_sensitive: 0,
        unknown: 0,
        malformed: 0,
      },
      terminal_event_received: true,
      limitations: [...new Set([
        "This receipt contains simulated events and is not evidence of a real agent run.",
        ...session.limitations,
        ...repository.limitations,
      ])],
    },
    privacy: {
      capture_level: "metadata",
      raw_content_included: false,
      redactions: [],
    },
    events,
    files: [
      {
        path: options.filePath,
        change: "modified",
        additions: 12,
        deletions: 3,
        before_digest: sha256({ path: options.filePath, state: "simulated-before" }),
        after_digest: sha256({ path: options.filePath, state: "simulated-after" }),
      },
    ],
    verification: {
      status: options.result === "pass" ? "passed" : "failed",
      tests: { passed, failed, skipped: 0 },
      checks: [
        {
          name: "Simulated test suite",
          status: options.result === "pass" ? "passed" : "failed",
          event_id: "evt_test_result",
        },
      ],
    },
    extensions: {
      "dev.agentreceipt.simulation": {
        enabled: true,
      },
    },
  };

  const receipt = {
    ...receiptWithoutIntegrity,
    integrity: {
      algorithm: "sha256",
      canonicalization: "RFC8785",
      content_digest: sha256(receiptWithoutIntegrity),
    },
  };

  assertReceipt(receipt);
  return receipt;
}
