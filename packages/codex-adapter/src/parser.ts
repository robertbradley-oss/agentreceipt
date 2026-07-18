import type {
  CaptureRecordCounts,
  CodexCaptureResult,
  CodexCaptureStatus,
  CodexUsage,
  RedactionCategory,
  SafeCodexEvent,
} from "./types.js";

const documentedItemTypes = new Set([
  "agent_message",
  "reasoning",
  "command_execution",
  "file_change",
  "mcp_tool_call",
  "web_search",
  "plan_update",
]);

const unavailableCapabilities = [
  "Codex-origin event timestamps",
  "Codex-origin command duration",
  "model identity from the JSONL stream",
  "host activity outside the wrapped process",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numericUsage(value: unknown): CodexUsage | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const usage: CodexUsage = {};
  for (const key of [
    "input_tokens",
    "cached_input_tokens",
    "cache_write_input_tokens",
    "output_tokens",
    "reasoning_output_tokens",
  ] as const) {
    const candidate = value[key];
    if (typeof candidate === "number" && Number.isFinite(candidate) && candidate >= 0) {
      usage[key] = candidate;
    }
  }

  return Object.keys(usage).length > 0 ? usage : undefined;
}

function deduplicate(values: string[]): string[] {
  return [...new Set(values)];
}

export class CodexJsonlCapture {
  readonly #events: SafeCodexEvent[] = [];
  readonly #counts: CaptureRecordCounts = {
    parsed: 0,
    discarded_sensitive: 0,
    unknown: 0,
    malformed: 0,
  };
  readonly #redactions: Partial<Record<RedactionCategory, number>> = {};
  readonly #observed = new Set<string>(["lifecycle"]);
  readonly #localIds = new Map<string, string>();
  readonly #pending = new Set<string>();
  #nextLocalId = 1;
  #terminalEventReceived = false;
  #sourceFailure = false;
  #usage: CodexUsage | undefined;

  ingest(line: string, observedAt = new Date()): void {
    if (!line.trim()) {
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch {
      this.#counts.malformed += 1;
      return;
    }

    if (!isRecord(parsed) || typeof parsed.type !== "string") {
      this.#counts.malformed += 1;
      return;
    }

    this.#counts.parsed += 1;
    const observed = observedAt.toISOString();

    switch (parsed.type) {
      case "thread.started":
        this.#redact("identifier", typeof parsed.thread_id === "string");
        return;
      case "turn.started":
        return;
      case "turn.completed":
        this.#terminalEventReceived = true;
        this.#usage = numericUsage(parsed.usage);
        if (this.#usage) {
          this.#observed.add("usage");
        }
        return;
      case "turn.failed":
        this.#terminalEventReceived = true;
        this.#sourceFailure = true;
        this.#redact("message", typeof parsed.message === "string" || typeof parsed.error === "string");
        return;
      case "error":
        this.#sourceFailure = true;
        this.#redact("message", true);
        return;
      case "item.started":
      case "item.completed":
        this.#ingestItem(parsed.type, parsed.item, observed);
        return;
      default:
        this.#counts.unknown += 1;
    }
  }

  finish(processExitCode: number, cliVersion?: string): CodexCaptureResult {
    const limitations = [
      "Capture is limited to the wrapped Codex process and its documented JSONL stream.",
      "Absence of an event is not host-level proof that an action did not occur.",
      "Event timestamps are adapter observation times, not Codex-origin timestamps.",
      "Messages, reasoning, commands, command output, and raw Codex identifiers were discarded.",
      "This receipt is local structured evidence, not a tamper-proof audit record.",
    ];

    let status: CodexCaptureStatus = "complete_for_declared_surface";
    if (processExitCode !== 0 || this.#sourceFailure) {
      status = "failed";
      limitations.push("The wrapped Codex run reported a failure.");
    } else if (
      !this.#terminalEventReceived
      || this.#pending.size > 0
      || this.#counts.unknown > 0
      || this.#counts.malformed > 0
    ) {
      status = "partial";
    }

    if (!this.#terminalEventReceived) {
      limitations.push("The JSONL stream ended without a terminal turn event.");
    }
    if (this.#pending.size > 0) {
      limitations.push("At least one started item had no matching completed event.");
    }
    if (this.#counts.unknown > 0) {
      limitations.push(`${this.#counts.unknown} unknown JSONL record(s) were discarded.`);
    }
    if (this.#counts.malformed > 0) {
      limitations.push(`${this.#counts.malformed} malformed JSONL record(s) were discarded.`);
    }
    if (!cliVersion) {
      limitations.push("The Codex CLI version could not be determined.");
    }

    return {
      status,
      process_exit_code: processExitCode,
      terminal_event_received: this.#terminalEventReceived,
      ...(cliVersion ? { cli_version: cliVersion } : {}),
      events: [...this.#events],
      ...(this.#usage ? { usage: { ...this.#usage } } : {}),
      record_counts: { ...this.#counts },
      redactions: { ...this.#redactions },
      observed_capabilities: [...this.#observed].sort(),
      unavailable_capabilities: [...unavailableCapabilities],
      limitations: deduplicate(limitations),
    };
  }

  #ingestItem(sourceEvent: "item.started" | "item.completed", value: unknown, observedAt: string): void {
    if (!isRecord(value) || typeof value.type !== "string") {
      this.#counts.malformed += 1;
      return;
    }

    if (!documentedItemTypes.has(value.type)) {
      this.#counts.unknown += 1;
      return;
    }

    const rawId = typeof value.id === "string" ? value.id : undefined;
    this.#redact("identifier", rawId !== undefined);
    const localId = this.#localId(rawId);

    if (sourceEvent === "item.started") {
      this.#pending.add(localId);
    } else {
      this.#pending.delete(localId);
    }

    switch (value.type) {
      case "agent_message":
        this.#redact("message", true);
        return;
      case "reasoning":
        this.#redact("reasoning", true);
        return;
      case "command_execution":
        this.#observed.add("commands");
        this.#redact("command", "command" in value);
        this.#redact("command_output", "aggregated_output" in value || "output" in value);
        this.#events.push({
          kind: "command",
          source_event: sourceEvent,
          local_item_id: localId,
          observed_at: observedAt,
          outcome: this.#outcome(sourceEvent, value),
          ...(typeof value.exit_code === "number" ? { exit_code: value.exit_code } : {}),
        });
        return;
      case "file_change":
        this.#observed.add("files");
        this.#redact("source_content", true);
        this.#pushTool(sourceEvent, localId, observedAt, value, "codex-file-change");
        return;
      case "mcp_tool_call":
        this.#observed.add("tools");
        this.#redact("tool_argument", true);
        this.#pushTool(sourceEvent, localId, observedAt, value, "codex-mcp-tool");
        return;
      case "web_search":
        this.#observed.add("tools");
        this.#redact("source_content", true);
        this.#pushTool(sourceEvent, localId, observedAt, value, "codex-web-search");
        return;
      case "plan_update":
        this.#observed.add("tools");
        this.#redact("message", true);
        this.#pushTool(sourceEvent, localId, observedAt, value, "codex-plan-update");
    }
  }

  #pushTool(
    sourceEvent: "item.started" | "item.completed",
    localId: string,
    observedAt: string,
    item: Record<string, unknown>,
    toolName: "codex-file-change" | "codex-mcp-tool" | "codex-web-search" | "codex-plan-update",
  ): void {
    this.#events.push({
      kind: "tool",
      source_event: sourceEvent,
      local_item_id: localId,
      observed_at: observedAt,
      outcome: this.#outcome(sourceEvent, item),
      tool_name: toolName,
    });
  }

  #outcome(
    sourceEvent: "item.started" | "item.completed",
    item: Record<string, unknown>,
  ): "started" | "succeeded" | "failed" {
    if (sourceEvent === "item.started") {
      return "started";
    }
    return item.status === "failed" || (typeof item.exit_code === "number" && item.exit_code !== 0)
      ? "failed"
      : "succeeded";
  }

  #localId(rawId: string | undefined): string {
    if (rawId) {
      const existing = this.#localIds.get(rawId);
      if (existing) {
        return existing;
      }
    }

    const localId = `item_${String(this.#nextLocalId).padStart(6, "0")}`;
    this.#nextLocalId += 1;
    if (rawId) {
      this.#localIds.set(rawId, localId);
    }
    return localId;
  }

  #redact(category: RedactionCategory, condition: boolean): void {
    if (!condition) {
      return;
    }
    this.#redactions[category] = (this.#redactions[category] ?? 0) + 1;
    this.#counts.discarded_sensitive += 1;
  }
}
