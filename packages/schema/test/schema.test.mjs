import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertReceipt,
  computeReceiptContentDigest,
  receiptContentDigestMatches,
  validateReceipt,
} from "../dist/src/index.js";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const examplesDirectory = join(currentDirectory, "..", "examples");

async function loadJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

test("all valid examples satisfy the v0.1 schema", async () => {
  const directory = join(examplesDirectory, "valid");
  const files = (await readdir(directory)).filter((file) => file.endsWith(".json"));

  assert.ok(files.length >= 2, "expected at least two valid fixtures");

  for (const file of files) {
    const value = await loadJson(join(directory, file));
    const result = validateReceipt(value);
    assert.equal(result.valid, true, `${file}: ${JSON.stringify(result.errors, null, 2)}`);
    assert.doesNotThrow(() => assertReceipt(value));
  }
});

test("all invalid examples are rejected", async () => {
  const directory = join(examplesDirectory, "invalid");
  const files = (await readdir(directory)).filter((file) => file.endsWith(".json"));

  assert.ok(files.length >= 2, "expected at least two invalid fixtures");

  for (const file of files) {
    const value = await loadJson(join(directory, file));
    const result = validateReceipt(value);
    assert.equal(result.valid, false, `${file} unexpectedly passed`);
    assert.throws(() => assertReceipt(value), /Invalid AgentReceipt/);
  }
});

test("v0.1 forbids raw content capture", async () => {
  const receipt = await loadJson(join(examplesDirectory, "valid", "minimal.json"));
  receipt.privacy.raw_content_included = true;

  const result = validateReceipt(receipt);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.instancePath === "/privacy/raw_content_included"));
});

test("capture completeness and declared surface are mandatory", async () => {
  const receipt = await loadJson(join(examplesDirectory, "valid", "minimal.json"));
  delete receipt.capture.status;
  delete receipt.capture.surface;

  const result = validateReceipt(receipt);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.instancePath === "/capture"));
});

test("a receipt cannot claim generic complete Codex capture", async () => {
  const receipt = await loadJson(join(examplesDirectory, "valid", "minimal.json"));
  receipt.capture.status = "complete";

  const result = validateReceipt(receipt);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.instancePath === "/capture/status"));
});

test("repository paths cannot be absolute or traverse upward", async () => {
  const receipt = await loadJson(join(examplesDirectory, "valid", "minimal.json"));

  for (const unsafePath of ["/etc/passwd", "C:/Users/example/key.txt", "../outside.txt", "src/../../outside.txt", "~/.ssh/id_ed25519"]) {
    receipt.files[0].path = unsafePath;
    const result = validateReceipt(receipt);
    assert.equal(result.valid, false, `${unsafePath} unexpectedly passed`);
  }
});

test("semantic validation rejects broken ordering and references", async () => {
  const receipt = await loadJson(join(examplesDirectory, "valid", "minimal.json"));
  receipt.events[1].sequence = 8;
  receipt.events[1].timestamp = "2026-07-17T21:57:00Z";
  receipt.verification.checks[0].event_id = "evt_missing1";

  const result = validateReceipt(receipt);
  assert.equal(result.valid, false);
  assert.deepEqual(
    new Set(result.errors.map((error) => error.keyword)),
    new Set(["eventSequence", "sessionTimeRange", "eventTimeOrder", "eventReference"]),
  );
});

test("content digests are deterministic and exclude integrity and attestation", async () => {
  const receipt = await loadJson(join(examplesDirectory, "valid", "minimal.json"));
  const digest = computeReceiptContentDigest(receipt);

  receipt.integrity = {
    algorithm: "sha256",
    canonicalization: "RFC8785",
    content_digest: digest,
  };
  receipt.attestation = {
    provider: "github",
    subject_digest: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    verification_uri: "https://github.com/example/api-service/attestations/1",
  };

  assert.equal(computeReceiptContentDigest(receipt), digest);
  assert.equal(receiptContentDigestMatches(receipt, digest), true);

  receipt.repository.head_sha = "3333333333333333333333333333333333333333";
  assert.equal(receiptContentDigestMatches(receipt, digest), false);
});
