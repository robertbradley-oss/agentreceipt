import { assertReceipt, type AgentReceipt } from "@agentreceipt/schema";
import type { CodexCaptureResult, SafeCodexEvent } from "@agentreceipt/codex-adapter";

import { sha256 } from "./json.js";
import type {
  RepositoryFileChange,
  RepositorySnapshot,
  VerificationResult,
} from "./types.js";

interface CreateCodexReceiptOptions {
  receiptId: string;
  sessionId: string;
  title: string;
  description: string;
  startedAt: Date;
  endedAt: Date;
  repositoryBefore: RepositorySnapshot;
  repositoryAfter: RepositorySnapshot;
  changes: RepositoryFileChange[];
  capture: CodexCaptureResult;
  verification?: VerificationResult;
  additionalLimitations?: string[];
}

type ReceiptEvent = {
  id: string;
  sequence: number;
  timestamp: string;
  type: "session" | "tool" | "command" | "git";
  outcome: "started" | "succeeded" | "failed" | "info";
  summary: string;
  duration_ms?: number;
  details: Record<string, unknown>;
  evidence_digest?: `sha256:${string}`;
};

function deduplicate(values: string[]): string[] {
  return [...new Set(values)];
}

function clampTimestamp(value: string, minimum: number, maximum: number): string {
  const parsed = Date.parse(value);
  const safe = Number.isFinite(parsed) ? parsed : minimum;
  return new Date(Math.min(maximum, Math.max(minimum, safe))).toISOString();
}

function adapterEvent(event: SafeCodexEvent, timestamp: string): Omit<ReceiptEvent, "id" | "sequence" | "evidence_digest"> {
  if (event.kind === "command") {
    return {
      timestamp,
      type: "command",
      outcome: event.outcome,
      summary: event.outcome === "started"
        ? "Codex started a command; command text and output were discarded."
        : "Codex completed a command; command text and output were discarded.",
      details: {
        command: "<redacted>",
        ...(event.exit_code !== undefined ? { exit_code: event.exit_code } : {}),
        source_event: event.source_event,
        time_basis: "adapter_observed",
      },
    };
  }

  return {
    timestamp,
    type: "tool",
    outcome: event.outcome,
    summary: `Codex ${event.outcome === "started" ? "started" : "completed"} a ${event.tool_name} event; sensitive content was discarded.`,
    details: {
      tool_name: event.tool_name,
      source_event: event.source_event,
      time_basis: "adapter_observed",
    },
  };
}

export function createCodexReceipt(options: CreateCodexReceiptOptions): AgentReceipt {
  const startedMs = options.startedAt.getTime();
  const endedMs = Math.max(startedMs, options.endedAt.getTime());
  const eventsWithoutDigests: Array<Omit<ReceiptEvent, "evidence_digest">> = [];

  eventsWithoutDigests.push({
    id: "evt_codex_000000",
    sequence: 0,
    timestamp: new Date(startedMs).toISOString(),
    type: "session",
    outcome: "started",
    summary: "Wrapped Codex receipt capture started.",
    details: {
      phase: "start",
      source_event: "adapter",
      time_basis: "adapter_observed",
    },
  });

  let previousTimestamp = startedMs;
  for (const event of options.capture.events) {
    const timestamp = clampTimestamp(event.observed_at, previousTimestamp, endedMs);
    previousTimestamp = Date.parse(timestamp);
    const normalized = adapterEvent(event, timestamp);
    eventsWithoutDigests.push({
      ...normalized,
      id: `evt_codex_${String(eventsWithoutDigests.length).padStart(6, "0")}`,
      sequence: eventsWithoutDigests.length,
    });
  }

  let verificationEventId: string | undefined;
  if (options.verification) {
    verificationEventId = `evt_codex_${String(eventsWithoutDigests.length).padStart(6, "0")}`;
    const verificationTimestamp = clampTimestamp(options.verification.endedAt, previousTimestamp, endedMs);
    previousTimestamp = Date.parse(verificationTimestamp);
    eventsWithoutDigests.push({
      id: verificationEventId,
      sequence: eventsWithoutDigests.length,
      timestamp: verificationTimestamp,
      type: "command",
      outcome: options.verification.exitCode === 0 ? "succeeded" : "failed",
      summary: "An independently executed verification command completed; command text and output were discarded.",
      duration_ms: options.verification.durationMs,
      details: {
        command: "<redacted authorized verification command>",
        exit_code: options.verification.exitCode,
        source_event: "verification",
        time_basis: "adapter_observed",
      },
    });
  }

  eventsWithoutDigests.push({
    id: `evt_codex_${String(eventsWithoutDigests.length).padStart(6, "0")}`,
    sequence: eventsWithoutDigests.length,
    timestamp: new Date(endedMs).toISOString(),
    type: "git",
    outcome: "info",
    summary: "AgentReceipt independently recorded the repository state after the wrapped run.",
    details: {
      git_action: "diff",
      commit_sha: options.repositoryAfter.headSha,
      source_event: "git",
      time_basis: "adapter_observed",
    },
  });

  eventsWithoutDigests.push({
    id: `evt_codex_${String(eventsWithoutDigests.length).padStart(6, "0")}`,
    sequence: eventsWithoutDigests.length,
    timestamp: new Date(endedMs).toISOString(),
    type: "session",
    outcome: options.capture.status === "failed"
      || (options.verification && options.verification.exitCode !== 0)
      ? "failed"
      : "succeeded",
    summary: "Wrapped Codex receipt capture finished.",
    details: {
      phase: "finish",
      source_event: "adapter",
      time_basis: "adapter_observed",
    },
  });

  const events = eventsWithoutDigests.map((event) => ({
    ...event,
    evidence_digest: sha256(event),
  }));

  const limitations = deduplicate([
    ...options.capture.limitations,
    ...options.repositoryBefore.limitations,
    ...options.repositoryAfter.limitations,
    ...(options.additionalLimitations ?? []),
    ...(!options.verification ? ["No independent verification command was requested."] : []),
    ...(options.changes.length > 0
      ? ["Changed-file line counts are unavailable in this milestone; zero values are placeholders, not measured counts."]
      : []),
  ]);

  const captureStatus = options.capture.status === "failed"
    ? "failed"
    : options.capture.status === "partial" || !options.verification || (options.additionalLimitations?.length ?? 0) > 0
      ? "partial"
      : "complete_for_declared_surface";
  const observedCapabilities = deduplicate([
    ...options.capture.observed_capabilities,
    "git",
    ...(options.verification ? ["tests"] : []),
  ]).sort();
  const unavailableCapabilities = deduplicate([
    ...options.capture.unavailable_capabilities,
    ...(!options.verification ? ["independent verification"] : []),
  ]);

  const redactions = Object.entries({ prompt: 1, ...options.capture.redactions })
    .filter((entry): entry is [string, number] => typeof entry[1] === "number" && entry[1] > 0)
    .map(([category, count]) => ({ category, count }));

  const receiptWithoutIntegrity = {
    schema_version: "0.1",
    receipt_id: options.receiptId,
    created_at: new Date(endedMs).toISOString(),
    task: {
      title: options.title,
      description: options.description,
      source: "user",
    },
    session: {
      id: options.sessionId,
      started_at: new Date(startedMs).toISOString(),
      ended_at: new Date(endedMs).toISOString(),
      status: options.capture.status === "failed"
        || (options.verification && options.verification.exitCode !== 0)
        ? "failed"
        : "completed",
    },
    agent: {
      name: "Codex",
      ...(options.capture.cli_version ? { version: options.capture.cli_version } : {}),
    },
    repository: {
      provider: "github",
      owner: options.repositoryBefore.owner,
      name: options.repositoryBefore.name,
      branch: options.repositoryAfter.branch,
      binding_status: "draft",
      capture_start_sha: options.repositoryBefore.headSha,
      capture_end_sha: options.repositoryAfter.headSha,
    },
    capture: {
      adapter: "agentreceipt-codex-exec",
      adapter_version: "0.1.0",
      source: "direct_observation",
      surface: "codex_exec_jsonl",
      status: captureStatus,
      capabilities: ["lifecycle", "tools", "commands", "files", "tests", "git", "usage"],
      observed_capabilities: observedCapabilities,
      unavailable_capabilities: unavailableCapabilities,
      record_counts: options.capture.record_counts,
      terminal_event_received: options.capture.terminal_event_received,
      limitations,
    },
    privacy: {
      capture_level: "metadata",
      raw_content_included: false,
      redactions,
    },
    events,
    files: options.changes.map((change) => ({
      path: change.path,
      ...(change.previousPath ? { previous_path: change.previousPath } : {}),
      change: change.change,
      additions: change.additions,
      deletions: change.deletions,
      line_counts_known: change.lineCountsKnown,
      ...(change.beforeDigest ? { before_digest: change.beforeDigest } : {}),
      ...(change.afterDigest ? { after_digest: change.afterDigest } : {}),
    })),
    verification: {
      status: options.verification
        ? options.verification.exitCode === 0 ? "passed" : "failed"
        : "not_run",
      tests: { passed: 0, failed: 0, skipped: 0 },
      checks: options.verification
        ? [{
            name: "User-authorized verification command",
            status: options.verification.exitCode === 0 ? "passed" : "failed",
            event_id: verificationEventId,
          }]
        : [],
    },
    extensions: {
      "dev.agentreceipt.codex-exec": {
        usage: options.capture.usage ?? {},
        process_exit_code: options.capture.process_exit_code,
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
