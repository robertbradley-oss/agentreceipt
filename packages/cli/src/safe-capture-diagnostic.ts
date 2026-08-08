import type { CodexCaptureResult, CodexPrivateProjection } from "@agentreceipt/codex-adapter";

const COMMAND_SHAPES = new Set([
  "direct_allowlisted",
  "allowlisted_command_embedded",
  "unsupported",
] as const);

const INELIGIBILITY_REASONS = new Set([
  "malformed_record",
  "lifecycle_incomplete",
  "turn_failed",
  "unknown_event",
  "unsupported_item",
  "unsupported_command_shape",
  "allowlisted_command_embedded",
  "secret_material",
  "parameter_unused",
  "command_failed",
  "no_action",
] as const);

export const SAFE_CAPTURE_DIAGNOSTIC_CLASSIFICATIONS = [
  "capsule_created",
  "projection_eligible",
  "capture_failed",
  "secret_material",
  "allowlisted_command_embedded",
  "unsupported_command_shape",
  "unsupported_event_shape",
  "lifecycle_ineligible",
  "command_failed",
  "parameter_unused",
  "no_action",
  "other_ineligible",
  "post_capture_ineligible",
  "invalid_private_diagnostic",
] as const;

export type SafeCaptureDiagnosticClassification =
  typeof SAFE_CAPTURE_DIAGNOSTIC_CLASSIFICATIONS[number];

const SAFE_CLASSIFICATIONS = new Set<string>(SAFE_CAPTURE_DIAGNOSTIC_CLASSIFICATIONS);
const MAX_DIAGNOSTIC_ACTIONS = 10_000;

function isSortedUniqueAllowed(values: unknown, allowed: ReadonlySet<string>): values is string[] {
  return Array.isArray(values)
    && values.every((value) => typeof value === "string" && allowed.has(value))
    && values.every((value, index) => index === 0 || values[index - 1]! < value);
}

function hasValidDiagnosticShape(projection: CodexPrivateProjection): boolean {
  if (!projection || typeof projection !== "object" || Array.isArray(projection)) return false;
  const candidate = projection as unknown as Record<string, unknown>;
  const diagnostic = candidate.diagnostic;
  if (!diagnostic || typeof diagnostic !== "object" || Array.isArray(diagnostic)) return false;
  const fields = diagnostic as Record<string, unknown>;
  return typeof candidate.structurally_eligible === "boolean"
    && typeof candidate.secret_material_detected === "boolean"
    && isSortedUniqueAllowed(fields.command_shapes, COMMAND_SHAPES)
    && isSortedUniqueAllowed(fields.ineligibility_reasons, INELIGIBILITY_REASONS)
    && Number.isInteger(fields.action_count)
    && (fields.action_count as number) >= 0
    && (fields.action_count as number) <= MAX_DIAGNOSTIC_ACTIONS;
}

export function isSafeCaptureDiagnosticClassification(
  value: unknown,
): value is SafeCaptureDiagnosticClassification {
  return typeof value === "string" && SAFE_CLASSIFICATIONS.has(value);
}

export function classifyPrivateCapture(
  capture: CodexCaptureResult,
  projection: CodexPrivateProjection,
): Exclude<SafeCaptureDiagnosticClassification, "capsule_created" | "post_capture_ineligible"> {
  if (
    !capture
    || typeof capture !== "object"
    || Array.isArray(capture)
    || !["complete_for_declared_surface", "partial", "failed"].includes(capture.status)
    || !hasValidDiagnosticShape(projection)
  ) return "invalid_private_diagnostic";

  const reasons = projection.diagnostic.ineligibility_reasons;
  if (projection.secret_material_detected || reasons.includes("secret_material")) {
    return "secret_material";
  }
  if (capture.status === "failed") return "capture_failed";
  if (reasons.includes("allowlisted_command_embedded")) return "allowlisted_command_embedded";
  if (reasons.includes("unsupported_command_shape")) return "unsupported_command_shape";
  if (reasons.includes("unknown_event") || reasons.includes("unsupported_item")) {
    return "unsupported_event_shape";
  }
  if (
    reasons.includes("malformed_record")
    || reasons.includes("lifecycle_incomplete")
    || reasons.includes("turn_failed")
  ) return "lifecycle_ineligible";
  if (reasons.includes("command_failed")) return "command_failed";
  if (reasons.includes("parameter_unused")) return "parameter_unused";
  if (reasons.includes("no_action")) return "no_action";
  if (projection.structurally_eligible) return "projection_eligible";
  return "other_ineligible";
}
