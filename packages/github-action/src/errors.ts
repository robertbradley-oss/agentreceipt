export type SafeErrorCode =
  | "invalid_input"
  | "path_outside_workspace"
  | "link_not_allowed"
  | "not_a_file"
  | "receipt_missing"
  | "receipt_too_large"
  | "malformed_json"
  | "invalid_github_context"
  | "unsupported_event"
  | "internal_error";

const SAFE_MESSAGES: Record<SafeErrorCode, string> = {
  invalid_input: "The Action input is invalid.",
  path_outside_workspace: "The receipt path must remain inside the GitHub workspace.",
  link_not_allowed: "Symbolic links and link escapes are not allowed for the receipt path.",
  not_a_file: "The receipt path must identify a regular file.",
  receipt_missing: "The receipt file could not be opened.",
  receipt_too_large: "The receipt exceeds the 1 MiB validation limit.",
  malformed_json: "The receipt is not valid JSON.",
  invalid_github_context: "The GitHub event context is invalid.",
  unsupported_event: "This GitHub event is not supported for repository binding.",
  internal_error: "Validation could not be completed safely.",
};

export class SafeValidationError extends Error {
  readonly code: SafeErrorCode;

  constructor(code: SafeErrorCode) {
    super(SAFE_MESSAGES[code]);
    this.name = "SafeValidationError";
    this.code = code;
  }
}

export function safeMessage(code: SafeErrorCode): string {
  return SAFE_MESSAGES[code];
}
