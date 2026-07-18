import { createHash, timingSafeEqual } from "node:crypto";

import type { Digest } from "./types.js";

type JsonPrimitive = boolean | null | number | string;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

function canonicalize(value: JsonValue): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }

  const entries = Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key] as JsonValue)}`);

  return `{${entries.join(",")}}`;
}

function receiptContent(value: unknown): JsonValue {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Receipt content must be a JSON object");
  }

  const source = value as Record<string, JsonValue>;
  const content: Record<string, JsonValue> = {};

  for (const [key, entry] of Object.entries(source)) {
    if (key !== "integrity" && key !== "attestation") {
      content[key] = entry;
    }
  }

  return content;
}

export function computeReceiptContentDigest(value: unknown): Digest {
  const bytes = canonicalize(receiptContent(value));
  const digest = createHash("sha256").update(bytes, "utf8").digest("hex");
  return `sha256:${digest}`;
}

export function receiptContentDigestMatches(value: unknown, expected: string): boolean {
  if (!/^sha256:[a-f0-9]{64}$/.test(expected)) {
    return false;
  }

  const actualBytes = Buffer.from(computeReceiptContentDigest(value), "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");

  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}
