import {
  computeReceiptContentDigest,
  receiptContentDigestMatches,
  validateReceipt,
} from "@agentreceipt/schema";

import { SafeValidationError } from "./errors.js";
import { loadReceiptJson } from "./loader.js";
import type {
  CheckName,
  GitHubBinding,
  ValidationCheck,
  ValidationOptions,
  ValidationReport,
} from "./types.js";

interface ReceiptShape {
  capture: { status: "complete_for_declared_surface" | "partial" | "failed" };
  integrity?: { content_digest?: string };
  privacy: { capture_level: string; raw_content_included: boolean };
  repository: {
    provider: string;
    owner: string;
    name: string;
    binding_status: "draft" | "finalized";
    base_sha?: string;
    head_sha?: string;
  };
  finalization?: {
    method: string;
    event: "pull_request" | "push" | "workflow_dispatch";
    draft_content_digest: string;
  };
}

const CREDENTIAL_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}\b/,
  /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
];

const CHECK_NAMES: CheckName[] = [
  "schema",
  "privacy",
  "integrity",
  "finalization",
  "repository_binding",
  "capture_completeness",
];

function check(name: CheckName, status: ValidationCheck["status"], reason: string): ValidationCheck {
  return { name, status, reason };
}

function scanContainsCredential(value: unknown): boolean {
  const pending: unknown[] = [value];
  let visited = 0;

  while (pending.length > 0) {
    const entry = pending.pop();
    visited += 1;
    if (visited > 100_000) {
      return true;
    }
    if (typeof entry === "string" && CREDENTIAL_PATTERNS.some((pattern) => pattern.test(entry))) {
      return true;
    }
    if (Array.isArray(entry)) {
      pending.push(...entry);
    } else if (entry !== null && typeof entry === "object") {
      pending.push(...Object.values(entry as Record<string, unknown>));
    }
  }
  return false;
}

function repositoryMatches(receipt: ReceiptShape, binding: GitHubBinding): boolean {
  const repository = receipt.repository;
  if (
    repository.provider !== "github"
    || repository.owner.toLowerCase() !== binding.owner.toLowerCase()
    || repository.name.toLowerCase() !== binding.name.toLowerCase()
    || repository.binding_status !== "finalized"
    || repository.head_sha !== binding.headSha
  ) {
    return false;
  }

  return binding.baseSha === undefined
    ? repository.base_sha === undefined
    : repository.base_sha === binding.baseSha;
}

export function validateLoadedReceipt(
  value: unknown,
  binding: GitHubBinding,
  allowPartial: boolean,
): ValidationReport {
  const schemaResult = validateReceipt(value);
  if (!schemaResult.valid) {
    return {
      passed: false,
      failureCode: "schema_invalid",
      checks: [
        check("schema", "fail", "Receipt structure or semantics are invalid."),
        ...CHECK_NAMES.slice(1).map((name) => check(name, "not_run", "Not run because schema validation failed.")),
      ],
    };
  }

  const receipt = value as ReceiptShape;
  const checks: ValidationCheck[] = [check("schema", "pass", "Receipt structure and semantics are valid.")];

  const privacyPassed = receipt.privacy.capture_level === "metadata"
    && receipt.privacy.raw_content_included === false
    && !scanContainsCredential(value);
  checks.push(check(
    "privacy",
    privacyPassed ? "pass" : "fail",
    privacyPassed
      ? "Metadata-only privacy rules passed."
      : "Metadata-only privacy rules or credential screening failed.",
  ));

  let integrityPassed = false;
  try {
    const expected = receipt.integrity?.content_digest;
    integrityPassed = typeof expected === "string"
      && computeReceiptContentDigest(value).startsWith("sha256:")
      && receiptContentDigestMatches(value, expected);
  } catch {
    integrityPassed = false;
  }
  checks.push(check(
    "integrity",
    integrityPassed ? "pass" : "fail",
    integrityPassed ? "The content digest matches." : "The content digest is missing or does not match.",
  ));

  const finalizationPassed = receipt.repository.binding_status === "finalized"
    && receipt.finalization?.method === "github_event"
    && receipt.finalization.event === binding.eventName
    && /^sha256:[a-f0-9]{64}$/.test(receipt.finalization.draft_content_digest);
  checks.push(check(
    "finalization",
    finalizationPassed ? "pass" : "fail",
    finalizationPassed
      ? "The receipt is finalized for this GitHub event type."
      : "A GitHub-event finalized receipt is required.",
  ));

  const bindingPassed = repositoryMatches(receipt, binding);
  checks.push(check(
    "repository_binding",
    bindingPassed ? "pass" : "fail",
    bindingPassed
      ? "Repository and commit binding match the GitHub event."
      : "Repository or commit binding does not match the GitHub event.",
  ));

  let completenessPassed = false;
  let completenessStatus: ValidationCheck["status"] = "fail";
  let completenessReason = "Capture failed and cannot be accepted.";
  if (receipt.capture.status === "complete_for_declared_surface") {
    completenessPassed = true;
    completenessStatus = "pass";
    completenessReason = "Capture is complete for its declared surface.";
  } else if (receipt.capture.status === "partial" && allowPartial) {
    completenessPassed = true;
    completenessStatus = "warning";
    completenessReason = "Partial capture was explicitly accepted.";
  } else if (receipt.capture.status === "partial") {
    completenessReason = "Partial capture requires explicit opt-in.";
  }
  checks.push(check("capture_completeness", completenessStatus, completenessReason));

  const passed = privacyPassed && integrityPassed && finalizationPassed && bindingPassed && completenessPassed;
  return {
    passed,
    checks,
    ...(passed ? {} : { failureCode: "receipt_validation_failed" }),
  };
}

export async function executeValidation(options: ValidationOptions): Promise<ValidationReport> {
  try {
    const receipt = await loadReceiptJson(
      options.workspace,
      options.receiptPath,
      options.maxBytes,
    );
    return validateLoadedReceipt(receipt, options.binding, options.allowPartial);
  } catch (error) {
    if (error instanceof SafeValidationError) {
      return {
        passed: false,
        failureCode: error.code,
        checks: CHECK_NAMES.map((name) => check(name, "not_run", "Receipt loading failed safely.")),
      };
    }
    return {
      passed: false,
      failureCode: "internal_error",
      checks: CHECK_NAMES.map((name) => check(name, "not_run", "Validation could not be completed safely.")),
    };
  }
}
