export type Digest = `sha256:${string}`;

export type EventType = "session" | "tool" | "command" | "file" | "test" | "git";
export type EventOutcome = "started" | "succeeded" | "failed" | "skipped" | "info";

export interface ValidationIssue {
  instancePath: string;
  schemaPath: string;
  keyword: string;
  message: string;
  params: Record<string, unknown>;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationIssue[];
}

/**
 * The runtime validator is authoritative. This intentionally broad type prevents
 * hand-maintained TypeScript declarations from drifting away from the JSON Schema.
 */
export type AgentReceipt = Record<string, unknown>;
