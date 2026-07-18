import { Ajv2020, type ErrorObject } from "ajv/dist/2020.js";
import * as addFormatsModule from "ajv-formats";
import receiptSchema from "../schemas/receipt.v0.1.schema.json" with { type: "json" };

import type { AgentReceipt, ValidationIssue, ValidationResult } from "./types.js";

export { computeReceiptContentDigest, receiptContentDigestMatches } from "./integrity.js";

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  // Conditional event requirements refer to properties declared by eventDetails.
  strictRequired: false,
});

const addFormats = addFormatsModule.default as unknown as (instance: Ajv2020) => Ajv2020;
addFormats(ajv);

const validate = ajv.compile(receiptSchema);

interface ReceiptForSemanticValidation {
  created_at: string;
  session: {
    started_at: string;
    ended_at: string;
  };
  events: Array<{
    id: string;
    sequence: number;
    timestamp: string;
  }>;
  files: Array<{
    path: string;
  }>;
  verification: {
    checks: Array<{
      event_id?: string;
    }>;
  };
}

function normalizeError(error: ErrorObject): ValidationIssue {
  return {
    instancePath: error.instancePath,
    schemaPath: error.schemaPath,
    keyword: error.keyword,
    message: error.message ?? "Schema validation failed",
    params: error.params as Record<string, unknown>,
  };
}

function semanticIssue(
  instancePath: string,
  keyword: string,
  message: string,
  params: Record<string, unknown> = {},
): ValidationIssue {
  return {
    instancePath,
    schemaPath: `#/$semantic/${keyword}`,
    keyword,
    message,
    params,
  };
}

function validateSemantics(value: AgentReceipt): ValidationIssue[] {
  const receipt = value as unknown as ReceiptForSemanticValidation;
  const issues: ValidationIssue[] = [];
  const startedAt = Date.parse(receipt.session.started_at);
  const endedAt = Date.parse(receipt.session.ended_at);
  const createdAt = Date.parse(receipt.created_at);

  if (endedAt < startedAt) {
    issues.push(semanticIssue(
      "/session/ended_at",
      "timeOrder",
      "must not be earlier than session.started_at",
    ));
  }

  if (createdAt < endedAt) {
    issues.push(semanticIssue(
      "/created_at",
      "timeOrder",
      "must not be earlier than session.ended_at",
    ));
  }

  const eventIds = new Set<string>();
  let previousTimestamp = startedAt;

  receipt.events.forEach((event, index) => {
    const path = `/events/${index}`;
    const timestamp = Date.parse(event.timestamp);

    if (event.sequence !== index) {
      issues.push(semanticIssue(
        `${path}/sequence`,
        "eventSequence",
        `must equal its zero-based event position (${index})`,
        { expected: index, actual: event.sequence },
      ));
    }

    if (eventIds.has(event.id)) {
      issues.push(semanticIssue(
        `${path}/id`,
        "uniqueEventId",
        "must be unique within the receipt",
        { id: event.id },
      ));
    }
    eventIds.add(event.id);

    if (timestamp < startedAt || timestamp > endedAt) {
      issues.push(semanticIssue(
        `${path}/timestamp`,
        "sessionTimeRange",
        "must fall within the session time range",
      ));
    }

    if (timestamp < previousTimestamp) {
      issues.push(semanticIssue(
        `${path}/timestamp`,
        "eventTimeOrder",
        "must not be earlier than the preceding event",
      ));
    }
    previousTimestamp = timestamp;
  });

  const filePaths = new Set<string>();
  receipt.files.forEach((file, index) => {
    if (filePaths.has(file.path)) {
      issues.push(semanticIssue(
        `/files/${index}/path`,
        "uniqueFilePath",
        "must be unique within the file summary",
        { path: file.path },
      ));
    }
    filePaths.add(file.path);
  });

  receipt.verification.checks.forEach((check, index) => {
    if (check.event_id !== undefined && !eventIds.has(check.event_id)) {
      issues.push(semanticIssue(
        `/verification/checks/${index}/event_id`,
        "eventReference",
        "must reference an event in this receipt",
        { eventId: check.event_id },
      ));
    }
  });

  return issues;
}

export function validateReceipt(value: unknown): ValidationResult {
  const structurallyValid = validate(value);

  if (!structurallyValid) {
    return {
      valid: false,
      errors: (validate.errors ?? []).map(normalizeError),
    };
  }

  const errors = validateSemantics(value as AgentReceipt);

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function assertReceipt(value: unknown): asserts value is AgentReceipt {
  const result = validateReceipt(value);

  if (!result.valid) {
    const message = result.errors
      .map((error) => `${error.instancePath || "/"}: ${error.message}`)
      .join("\n");

    throw new Error(`Invalid AgentReceipt:\n${message}`);
  }
}

export { receiptSchema };
export type {
  AgentReceipt,
  Digest,
  EventOutcome,
  EventType,
  ValidationIssue,
  ValidationResult,
} from "./types.js";
