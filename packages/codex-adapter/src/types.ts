export type CodexCaptureStatus = "complete_for_declared_surface" | "partial" | "failed";

export type CodexSandbox = "read-only" | "workspace-write";

export type SafeCodexEvent =
  | {
      kind: "command";
      source_event: "item.started" | "item.completed";
      local_item_id: string;
      observed_at: string;
      outcome: "started" | "succeeded" | "failed";
      exit_code?: number;
    }
  | {
      kind: "tool";
      source_event: "item.started" | "item.completed";
      local_item_id: string;
      observed_at: string;
      outcome: "started" | "succeeded" | "failed";
      tool_name: "codex-file-change" | "codex-mcp-tool" | "codex-web-search" | "codex-plan-update";
    };

export interface CodexUsage {
  input_tokens?: number;
  cached_input_tokens?: number;
  cache_write_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
}

export interface CaptureRecordCounts {
  parsed: number;
  discarded_sensitive: number;
  unknown: number;
  malformed: number;
}

export type RedactionCategory =
  | "prompt"
  | "message"
  | "reasoning"
  | "command"
  | "command_output"
  | "identifier"
  | "source_content"
  | "tool_argument";

export interface CodexCaptureResult {
  status: CodexCaptureStatus;
  process_exit_code: number;
  terminal_event_received: boolean;
  cli_version?: string;
  events: SafeCodexEvent[];
  usage?: CodexUsage;
  record_counts: CaptureRecordCounts;
  redactions: Partial<Record<RedactionCategory, number>>;
  observed_capabilities: string[];
  unavailable_capabilities: string[];
  limitations: string[];
}

export interface CodexRunOptions {
  cwd: string;
  prompt: string;
  sandbox: CodexSandbox;
  executable?: string;
  executableArgsPrefix?: string[];
  now?: () => Date;
}

export type RunCodexCapture = (options: CodexRunOptions) => Promise<CodexCaptureResult>;
