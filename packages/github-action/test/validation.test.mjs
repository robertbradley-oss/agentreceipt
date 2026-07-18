import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { computeReceiptContentDigest } from "@agentreceipt/schema";

import { bindingFromEnvironment } from "../dist/src/context.js";
import { renderSafeSummary } from "../dist/src/summary.js";
import { executeValidation, validateLoadedReceipt } from "../dist/src/validate.js";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(testDirectory, "..", "..", "schema", "examples", "valid", "minimal.json");
const HEAD = "2222222222222222222222222222222222222222";
const BASE = "1111111111111111111111111111111111111111";
const binding = {
  owner: "example",
  name: "api-service",
  headSha: HEAD,
  baseSha: BASE,
  eventName: "pull_request",
};

async function fixture() {
  const receipt = JSON.parse(await readFile(fixturePath, "utf8"));
  const draftDigest = computeReceiptContentDigest(receipt);
  receipt.repository = {
    ...receipt.repository,
    binding_status: "finalized",
    base_sha: BASE,
    head_sha: HEAD,
  };
  receipt.finalization = {
    method: "github_event",
    event: "pull_request",
    draft_content_digest: draftDigest,
    finalized_at: "2026-07-17T22:01:00Z",
  };
  receipt.integrity = {
    algorithm: "sha256",
    canonicalization: "RFC8785",
    content_digest: computeReceiptContentDigest(receipt),
  };
  return receipt;
}

async function withWorkspace(run) {
  const root = await mkdtemp(join(tmpdir(), "agentreceipt-action-"));
  const workspace = join(root, "workspace");
  await mkdir(workspace);
  try {
    await run({ root, workspace });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function writeReceipt(workspace, receipt) {
  await writeFile(join(workspace, "receipt.json"), JSON.stringify(receipt), "utf8");
}

test("a valid, bound, complete receipt passes every check", async () => {
  await withWorkspace(async ({ workspace }) => {
    await writeReceipt(workspace, await fixture());
    const report = await executeValidation({
      workspace,
      receiptPath: "receipt.json",
      allowPartial: false,
      binding,
    });

    assert.equal(report.passed, true);
    assert.deepEqual(report.checks.map((entry) => entry.status), ["pass", "pass", "pass", "pass", "pass", "pass"]);
  });
});

test("a schema-valid draft receipt fails finalized lifecycle binding", async () => {
  const draft = JSON.parse(await readFile(fixturePath, "utf8"));
  draft.integrity.content_digest = computeReceiptContentDigest(draft);
  const report = validateLoadedReceipt(draft, binding, false);
  assert.equal(report.passed, false);
  assert.equal(report.checks.find((entry) => entry.name === "finalization")?.status, "fail");
  assert.equal(report.checks.find((entry) => entry.name === "repository_binding")?.status, "fail");
});

test("content tampering is rejected by independent digest verification", async () => {
  const receipt = await fixture();
  receipt.task.title = "Tampered after digest creation";

  const report = validateLoadedReceipt(receipt, binding, false);
  assert.equal(report.passed, false);
  assert.equal(report.checks.find((entry) => entry.name === "integrity")?.status, "fail");
});

test("malformed and oversized receipt files fail with safe codes", async () => {
  await withWorkspace(async ({ workspace }) => {
    await writeFile(join(workspace, "receipt.json"), "{secret-do-not-print", "utf8");
    const malformed = await executeValidation({
      workspace,
      receiptPath: "receipt.json",
      allowPartial: false,
      binding,
    });
    assert.equal(malformed.failureCode, "malformed_json");
    assert.equal(JSON.stringify(malformed).includes("secret-do-not-print"), false);

    await writeFile(join(workspace, "receipt.json"), "x".repeat(65), "utf8");
    const oversized = await executeValidation({
      workspace,
      receiptPath: "receipt.json",
      allowPartial: false,
      binding,
      maxBytes: 64,
    });
    assert.equal(oversized.failureCode, "receipt_too_large");
  });
});

test("path traversal and absolute receipt paths are rejected", async () => {
  await withWorkspace(async ({ root, workspace }) => {
    await writeFile(join(root, "outside.json"), JSON.stringify(await fixture()), "utf8");

    for (const receiptPath of ["../outside.json", join(root, "outside.json")]) {
      const report = await executeValidation({
        workspace,
        receiptPath,
        allowPartial: false,
        binding,
      });
      assert.equal(report.passed, false);
      assert.ok(["invalid_input", "path_outside_workspace"].includes(report.failureCode));
    }
  });
});

test("a link in the workspace cannot escape to an outside receipt", async () => {
  await withWorkspace(async ({ root, workspace }) => {
    const outside = join(root, "outside");
    await mkdir(outside);
    await writeReceipt(outside, await fixture());
    await symlink(outside, join(workspace, "linked"), "junction");

    const report = await executeValidation({
      workspace,
      receiptPath: "linked/receipt.json",
      allowPartial: false,
      binding,
    });
    assert.equal(report.failureCode, "link_not_allowed");
  });
});

test("repository, head, and base mismatches are rejected", async () => {
  for (const changedBinding of [
    { ...binding, name: "different" },
    { ...binding, headSha: "3333333333333333333333333333333333333333" },
    { ...binding, baseSha: "4444444444444444444444444444444444444444" },
  ]) {
    const report = validateLoadedReceipt(await fixture(), changedBinding, false);
    assert.equal(report.passed, false);
    assert.equal(report.checks.find((entry) => entry.name === "repository_binding")?.status, "fail");
  }
});

test("partial capture is opt-in and failed capture is never accepted", async () => {
  const partial = await fixture();
  partial.capture.status = "partial";
  partial.integrity.content_digest = computeReceiptContentDigest(partial);

  const rejected = validateLoadedReceipt(partial, binding, false);
  assert.equal(rejected.passed, false);
  assert.equal(rejected.checks.at(-1)?.status, "fail");

  const accepted = validateLoadedReceipt(partial, binding, true);
  assert.equal(accepted.passed, true);
  assert.equal(accepted.checks.at(-1)?.status, "warning");

  const failed = await fixture();
  failed.capture.status = "failed";
  failed.integrity.content_digest = computeReceiptContentDigest(failed);
  assert.equal(validateLoadedReceipt(failed, binding, true).passed, false);
});

test("credential-like content fails privately and never enters the summary", async () => {
  const secret = "github_pat_abcdefghijklmnopqrstuvwxyz123456";
  const receipt = await fixture();
  receipt.task.description = secret;
  receipt.integrity.content_digest = computeReceiptContentDigest(receipt);

  const report = validateLoadedReceipt(receipt, binding, false);
  const summary = renderSafeSummary(report);
  assert.equal(report.checks.find((entry) => entry.name === "privacy")?.status, "fail");
  assert.equal(JSON.stringify(report).includes(secret), false);
  assert.equal(summary.includes(secret), false);
  assert.equal(summary.includes(receipt.task.title), false);
  assert.equal(summary.includes(receipt.events[0].details.command ?? "impossible-marker"), false);
});

test("pull request binding uses event head and base instead of the merge SHA", async () => {
  await withWorkspace(async ({ workspace }) => {
    const eventPath = join(workspace, "event.json");
    await writeFile(eventPath, JSON.stringify({
      pull_request: {
        head: { sha: HEAD },
        base: { sha: BASE },
      },
    }), "utf8");

    const derived = await bindingFromEnvironment({
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_REPOSITORY: "example/api-service",
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_SHA: "5555555555555555555555555555555555555555",
    });
    assert.deepEqual(derived, binding);
  });
});

test("push binding uses GITHUB_SHA and a meaningful before SHA", async () => {
  await withWorkspace(async ({ workspace }) => {
    const eventPath = join(workspace, "event.json");
    await writeFile(eventPath, JSON.stringify({ before: BASE }), "utf8");

    const derived = await bindingFromEnvironment({
      GITHUB_EVENT_NAME: "push",
      GITHUB_REPOSITORY: "example/api-service",
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_SHA: HEAD,
    });
    assert.deepEqual(derived, {
      owner: "example",
      name: "api-service",
      eventName: "push",
      headSha: HEAD,
      baseSha: BASE,
    });
  });
});

test("GitHub context accepts only SHA-1 or SHA-256 object ID lengths", async () => {
  await withWorkspace(async ({ workspace }) => {
    const eventPath = join(workspace, "event.json");
    await writeFile(eventPath, "{}", "utf8");
    const environment = {
      GITHUB_EVENT_NAME: "workflow_dispatch",
      GITHUB_REPOSITORY: "example/api-service",
      GITHUB_EVENT_PATH: eventPath,
    };

    for (const length of [40, 64]) {
      const headSha = "a".repeat(length);
      const derived = await bindingFromEnvironment({ ...environment, GITHUB_SHA: headSha });
      assert.equal(derived.headSha, headSha);
    }

    for (const length of [39, 41, 63, 65]) {
      await assert.rejects(
        bindingFromEnvironment({ ...environment, GITHUB_SHA: "a".repeat(length) }),
        (error) => error.code === "invalid_github_context",
      );
    }
  });
});

test("new-branch push and workflow-dispatch receipts require an absent review base", async () => {
  for (const eventName of ["push", "workflow_dispatch"]) {
    const receipt = await fixture();
    delete receipt.repository.base_sha;
    receipt.finalization.event = eventName;
    receipt.integrity.content_digest = computeReceiptContentDigest(receipt);
    const eventBinding = {
      owner: "example",
      name: "api-service",
      eventName,
      headSha: HEAD,
    };
    assert.equal(validateLoadedReceipt(receipt, eventBinding, false).passed, true);

    receipt.repository.base_sha = BASE;
    receipt.integrity.content_digest = computeReceiptContentDigest(receipt);
    assert.equal(validateLoadedReceipt(receipt, eventBinding, false).passed, false);
  }
});

test("pull_request_target and unknown events are rejected", async () => {
  await withWorkspace(async ({ workspace }) => {
    const eventPath = join(workspace, "event.json");
    await writeFile(eventPath, "{}", "utf8");
    for (const eventName of ["pull_request_target", "issues"]) {
      await assert.rejects(bindingFromEnvironment({
        GITHUB_EVENT_NAME: eventName,
        GITHUB_REPOSITORY: "example/api-service",
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_SHA: HEAD,
      }), (error) => error.code === "unsupported_event");
    }
  });
});
