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

export type CodexParameterInput =
  | {
      name: string;
      sensitivity: "public";
      value: string;
    }
  | {
      name: string;
      sensitivity: "secret";
      value: string;
      source_environment: string;
      target_environment: string;
    };

export type CodexPrivateProjectionParameter =
  | { name: string; sensitivity: "public" }
  | {
      name: string;
      sensitivity: "secret";
      source_environment: string;
      target_environment: string;
    };

export interface CodexPrivateActionCandidate {
  sequence: number;
  kind: "process";
  cwd: ".";
  executable: "git";
  arguments: string[];
  environment_names: string[];
  file_paths: string[];
  read_only: true;
  classifier_version: "0.1";
  expected_exit_code: 0;
  observed_exit_code: number;
  duration_ms: number;
}

export type CodexPrivateCommandShape =
  | "direct_allowlisted"
  | "allowlisted_command_embedded"
  | "unsupported";

export type CodexPrivateIneligibilityReason =
  | "malformed_record"
  | "lifecycle_incomplete"
  | "turn_failed"
  | "unknown_event"
  | "unsupported_item"
  | "unsupported_command_shape"
  | "allowlisted_command_embedded"
  | "secret_material"
  | "parameter_unused"
  | "command_failed"
  | "no_action";

export interface CodexPrivateProjectionDiagnostic {
  command_shapes: CodexPrivateCommandShape[];
  ineligibility_reasons: CodexPrivateIneligibilityReason[];
  action_count: number;
}

export interface CodexPrivateProjection {
  parameters: CodexPrivateProjectionParameter[];
  actions: CodexPrivateActionCandidate[];
  structurally_eligible: boolean;
  unsupported_material: boolean;
  secret_material_detected: boolean;
  malformed_records: number;
  pending_items: number;
  diagnostic: CodexPrivateProjectionDiagnostic;
}

export interface CodexPrivateRunOptions extends CodexRunOptions {
  parameters?: CodexParameterInput[];
}

export interface CodexCaptureWithPrivateProjection {
  capture: CodexCaptureResult;
  private_projection: CodexPrivateProjection;
}

export type RunCodexCapture = (options: CodexRunOptions) => Promise<CodexCaptureResult>;
export type RunCodexCaptureWithPrivateProjection = (
  options: CodexPrivateRunOptions,
) => Promise<CodexCaptureWithPrivateProjection>;
