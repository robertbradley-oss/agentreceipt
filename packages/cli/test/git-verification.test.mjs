import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { computeReceiptContentDigest } from "@agentreceipt/schema";

import {
  FinalizationError,
  executeCli,
  finalizeReceipt,
  readRepository,
  readRepositoryChanges,
  runVerification,
} from "../dist/src/index.js";
import { publishTemporaryFileNoReplace } from "../dist/src/finalize.js";

const execFileAsync = promisify(execFile);

function digest(content) {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

async function git(cwd, args) {
  const { stdout } = await execFileAsync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  return stdout.trim();
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function createFinalizationRepository(options = {}) {
  const root = await mkdtemp(join(tmpdir(), "agentreceipt-finalize-test-"));
  await git(root, ["init"]);
  await git(root, ["config", "user.email", "agentreceipt@example.invalid"]);
  await git(root, ["config", "user.name", "AgentReceipt Test"]);
  await git(root, ["branch", "-M", "main"]);
  await writeFile(join(root, ".gitignore"), ".agentreceipt/\n", "utf8");
  await writeFile(join(root, "source.txt"), "base\n", "utf8");
  await git(root, ["add", ".gitignore", "source.txt"]);
  await git(root, ["commit", "-m", "base"]);
  const captureStart = await git(root, ["rev-parse", "HEAD"]);

  await writeFile(join(root, "source.txt"), "changed\n", "utf8");
  const draft = {
    schema_version: "0.1",
    receipt_id: "c094c148-b96b-4d35-8e6d-64db7c7235c9",
    created_at: "2026-07-17T22:00:09Z",
    task: {
      title: "Change a source file",
      description: options.description ?? "Change one source file and verify its Git evidence.",
      source: "user",
    },
    session: {
      id: "ad7d06ec-f393-40f3-8475-65a19290a4d6",
      started_at: "2026-07-17T21:58:00Z",
      ended_at: "2026-07-17T22:00:09Z",
      status: options.captureStatus === "failed" ? "failed" : "completed",
    },
    agent: { name: "Codex" },
    repository: {
      provider: "github",
      owner: options.owner ?? "example",
      name: options.name ?? "project",
      branch: "main",
      binding_status: "draft",
      capture_start_sha: captureStart,
      capture_end_sha: captureStart,
    },
    capture: {
      adapter: "agentreceipt-test",
      source: "direct_observation",
      surface: options.surface ?? "codex_exec_jsonl",
      status: options.captureStatus ?? "complete_for_declared_surface",
      capabilities: ["lifecycle", "files", "git"],
      observed_capabilities: ["lifecycle", "files", "git"],
      unavailable_capabilities: [],
      record_counts: { parsed: 2, discarded_sensitive: 0, unknown: 0, malformed: 0 },
      terminal_event_received: true,
      limitations: [],
    },
    privacy: { capture_level: "metadata", raw_content_included: false, redactions: [] },
    events: [
      {
        id: "evt_start01",
        sequence: 0,
        timestamp: "2026-07-17T21:58:00Z",
        type: "session",
        outcome: "started",
        summary: "Receipt capture started.",
        evidence_digest: digest("start"),
        details: { phase: "start" },
      },
      {
        id: "evt_finish1",
        sequence: 1,
        timestamp: "2026-07-17T22:00:09Z",
        type: "session",
        outcome: options.captureStatus === "failed" ? "failed" : "succeeded",
        summary: "Receipt capture finished.",
        evidence_digest: digest("finish"),
        details: { phase: "finish" },
      },
    ],
    files: options.missingFile ? [] : [
      {
        path: "source.txt",
        change: "modified",
        additions: options.lineCountMismatch ? 99 : 1,
        deletions: 1,
        line_counts_known: true,
        before_digest: digest("base\n"),
        after_digest: options.afterDigest ?? digest("changed\n"),
      },
    ],
    verification: {
      status: "passed",
      tests: { passed: 0, failed: 0, skipped: 0 },
      checks: [],
    },
    ...(options.extensions ? { extensions: options.extensions } : {}),
  };
  if (options.extraFile) {
    draft.files.push({
      path: "extra.txt",
      change: "added",
      additions: 1,
      deletions: 0,
      line_counts_known: true,
      after_digest: digest("extra\n"),
    });
  }
  draft.integrity = {
    algorithm: "sha256",
    canonicalization: "RFC8785",
    content_digest: computeReceiptContentDigest(draft),
  };
  if (options.integrityMismatch) {
    draft.integrity.content_digest = digest("wrong-draft");
  }

  const inputPath = "draft-receipt.json";
  await writeFile(join(root, inputPath), `${JSON.stringify(draft, null, 2)}\n`, "utf8");
  await git(root, ["add", "source.txt", inputPath]);
  await git(root, ["commit", "-m", "result"]);
  const head = await git(root, ["rev-parse", "HEAD"]);
  const eventPath = join(root, "event.json");

  return {
    root,
    inputPath,
    eventPath,
    draft,
    captureStart,
    head,
    environment(eventName) {
      return {
        GITHUB_ACTIONS: "true",
        GITHUB_WORKSPACE: root,
        GITHUB_EVENT_NAME: eventName,
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_REPOSITORY: "example/project",
        GITHUB_SHA: head,
      };
    },
  };
}

async function writeEvent(fixture, value) {
  await writeFile(fixture.eventPath, JSON.stringify(value), "utf8");
}

async function rejectsCode(promise, code) {
  await assert.rejects(
    promise,
    (error) => error instanceof FinalizationError && error.code === code,
  );
}

test("Git evidence is collected independently from a clean base commit", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentreceipt-git-test-"));
  try {
    await git(root, ["init"]);
    await git(root, ["config", "user.email", "agentreceipt@example.invalid"]);
    await git(root, ["config", "user.name", "AgentReceipt Test"]);
    await writeFile(join(root, "README.md"), "base\n", "utf8");
    await writeFile(join(root, "delete.txt"), "deleted later\n", "utf8");
    await writeFile(join(root, "old-name.txt"), "renamed later\n", "utf8");
    await git(root, ["add", "README.md", "delete.txt", "old-name.txt"]);
    await git(root, ["commit", "-m", "base"]);

    await mkdir(join(root, ".agentreceipt"));
    await writeFile(join(root, ".agentreceipt", "latest.json"), "{}\n", "utf8");

    const before = await readRepository(root);
    assert.equal(before.isClean, true);
    assert.match(before.headSha, /^[a-f0-9]{40,64}$/);

    await writeFile(join(root, "README.md"), "changed\n", "utf8");
    await writeFile(join(root, "new-file.txt"), "new\n", "utf8");
    await rm(join(root, "delete.txt"));
    await git(root, ["mv", "old-name.txt", "new-name.txt"]);
    const changes = await readRepositoryChanges(root, before.headSha);

    assert.deepEqual(new Map(changes.map((change) => [change.path, change])), new Map([
      ["delete.txt", {
        path: "delete.txt",
        change: "deleted",
        additions: 0,
        deletions: 0,
        lineCountsKnown: false,
        beforeDigest: digest("deleted later\n"),
      }],
      ["new-file.txt", {
        path: "new-file.txt",
        change: "added",
        additions: 0,
        deletions: 0,
        lineCountsKnown: false,
        afterDigest: digest("new\n"),
      }],
      ["new-name.txt", {
        path: "new-name.txt",
        previousPath: "old-name.txt",
        change: "renamed",
        additions: 0,
        deletions: 0,
        lineCountsKnown: false,
        beforeDigest: digest("renamed later\n"),
        afterDigest: digest("renamed later\n"),
      }],
      ["README.md", {
        path: "README.md",
        change: "modified",
        additions: 0,
        deletions: 0,
        lineCountsKnown: false,
        beforeDigest: digest("base\n"),
        afterDigest: digest("changed\n"),
      }],
    ]));
    assert.equal(changes.some((change) => change.path.startsWith(".agentreceipt/")), false);
    assert.equal((await readRepository(root)).isClean, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("verification records only timing and exit status", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentreceipt-verification-test-"));
  const executable = JSON.stringify(process.execPath);
  try {
    const success = await runVerification(
      `${executable} -e "process.stdout.write('SECRET_OUTPUT'); process.exit(0)"`,
      root,
    );
    assert.equal(success.exitCode, 0);
    assert.equal(JSON.stringify(success).includes("SECRET_OUTPUT"), false);

    const failure = await runVerification(`${executable} -e "process.exit(7)"`, root);
    assert.equal(failure.exitCode, 7);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("finalization binds pull request evidence and changes only allowlisted fields", async () => {
  const fixture = await createFinalizationRepository();
  try {
    await writeEvent(fixture, {
      pull_request: {
        head: { sha: fixture.head },
        base: { sha: fixture.captureStart },
      },
    });
    const outputPath = ".agentreceipt/finalized/pr.json";
    const output = await executeCli([
      "finalize",
      "--input",
      fixture.inputPath,
      "--output",
      outputPath,
      "--allow-partial",
    ], {
      cwd: fixture.root,
      environment: fixture.environment("pull_request"),
      now: () => new Date("2026-07-18T00:00:00Z"),
    });
    const finalized = JSON.parse(await readFile(join(fixture.root, outputPath), "utf8"));
    assert.equal(output, `Finalized AgentReceipt successfully.\nOutput: ${outputPath}\n`);
    assert.equal(finalized.repository.binding_status, "finalized");
    assert.equal(finalized.repository.capture_start_sha, fixture.captureStart);
    assert.equal(finalized.repository.capture_end_sha, fixture.captureStart);
    assert.equal(finalized.repository.base_sha, fixture.captureStart);
    assert.equal(finalized.repository.head_sha, fixture.head);
    assert.equal(finalized.finalization.event, "pull_request");
    assert.equal(finalized.finalization.draft_content_digest, computeReceiptContentDigest(fixture.draft));
    assert.notEqual(finalized.integrity.content_digest, fixture.draft.integrity.content_digest);

    const unchangedDraft = structuredClone(fixture.draft);
    const unchangedFinalized = structuredClone(finalized);
    for (const value of [unchangedDraft, unchangedFinalized]) {
      delete value.repository.binding_status;
      delete value.repository.base_sha;
      delete value.repository.head_sha;
      delete value.finalization;
      delete value.integrity;
    }
    assert.deepEqual(unchangedFinalized, unchangedDraft);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("finalization preserves digest-only replay binding unchanged", async () => {
  const extension = {
    "dev.agentreceipt.recipe-replay": {
      recipe_digest: "sha256:" + "a".repeat(64),
      source_receipt_content_digest: "sha256:" + "b".repeat(64),
      mode: "executed",
    },
  };
  const fixture = await createFinalizationRepository({
    surface: "agentreceipt_recipe_replay",
    extensions: extension,
  });
  try {
    await writeEvent(fixture, { before: fixture.captureStart });
    const result = await finalizeReceipt({
      cwd: fixture.root,
      inputPath: fixture.inputPath,
      outputPath: ".agentreceipt/finalized/replay.json",
      allowPartial: false,
      environment: fixture.environment("push"),
    });
    assert.deepEqual(result.receipt.extensions, extension);
    assert.equal(result.receipt.capture.surface, "agentreceipt_recipe_replay");
    assert.equal(result.receipt.integrity.content_digest, computeReceiptContentDigest(result.receipt));
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("finalization rejects a worktree draft that differs from the committed bytes", async () => {
  const fixture = await createFinalizationRepository();
  try {
    await writeEvent(fixture, { before: fixture.captureStart });
    await git(fixture.root, ["update-index", "--assume-unchanged", fixture.inputPath]);
    const replacement = structuredClone(fixture.draft);
    replacement.task.description = "Uncommitted replacement draft";
    replacement.integrity.content_digest = computeReceiptContentDigest(replacement);
    await writeFile(join(fixture.root, fixture.inputPath), `${JSON.stringify(replacement, null, 2)}\n`, "utf8");

    await rejectsCode(finalizeReceipt({
      cwd: fixture.root,
      inputPath: fixture.inputPath,
      outputPath: ".agentreceipt/finalized/committed-draft.json",
      allowPartial: false,
      environment: fixture.environment("push"),
    }), "draft_integrity_mismatch");
    assert.equal(await pathExists(join(fixture.root, ".agentreceipt/finalized/committed-draft.json")), false);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("push, new-branch push, and workflow dispatch produce event-correct bindings", async () => {
  const fixture = await createFinalizationRepository();
  try {
    const cases = [
      {
        eventName: "push",
        event: { before: fixture.captureStart },
        output: ".agentreceipt/finalized/push.json",
        expectedBase: fixture.captureStart,
      },
      {
        eventName: "push",
        event: { before: "0".repeat(40) },
        output: ".agentreceipt/finalized/new-branch.json",
        expectedBase: undefined,
      },
      {
        eventName: "workflow_dispatch",
        event: {},
        output: ".agentreceipt/finalized/dispatch.json",
        expectedBase: undefined,
      },
    ];

    for (const entry of cases) {
      await writeEvent(fixture, entry.event);
      const result = await finalizeReceipt({
        cwd: fixture.root,
        inputPath: fixture.inputPath,
        outputPath: entry.output,
        allowPartial: false,
        environment: fixture.environment(entry.eventName),
        now: () => new Date("2026-07-18T00:00:00Z"),
      });
      const repository = result.receipt.repository;
      assert.equal(repository.base_sha, entry.expectedBase);
      assert.equal(result.receipt.finalization.event, entry.eventName);
    }
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("CLI GitHub context accepts only SHA-1 or SHA-256 object ID lengths", async () => {
  const fixture = await createFinalizationRepository();
  try {
    await writeEvent(fixture, { before: fixture.captureStart });
    for (const length of [39, 41, 63, 65]) {
      await rejectsCode(finalizeReceipt({
        cwd: fixture.root,
        inputPath: fixture.inputPath,
        outputPath: `.agentreceipt/finalized/invalid-${length}.json`,
        allowPartial: false,
        environment: { ...fixture.environment("push"), GITHUB_SHA: "a".repeat(length) },
      }), "invalid_github_context");
    }

    await rejectsCode(finalizeReceipt({
      cwd: fixture.root,
      inputPath: fixture.inputPath,
      outputPath: ".agentreceipt/finalized/sha256-context.json",
      allowPartial: false,
      environment: { ...fixture.environment("push"), GITHUB_SHA: "a".repeat(64) },
    }), "checkout_head_mismatch");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("partial capture is opt-in and failed capture is always rejected", async () => {
  const partial = await createFinalizationRepository({ captureStatus: "partial" });
  try {
    await writeEvent(partial, { before: partial.captureStart });
    await rejectsCode(finalizeReceipt({
      cwd: partial.root,
      inputPath: partial.inputPath,
      outputPath: ".agentreceipt/finalized/rejected.json",
      allowPartial: false,
      environment: partial.environment("push"),
    }), "partial_capture_rejected");
    const acceptedOutput = await executeCli([
      "finalize",
      "--input",
      partial.inputPath,
      "--output",
      ".agentreceipt/finalized/accepted.json",
      "--allow-partial",
    ], {
      cwd: partial.root,
      environment: partial.environment("push"),
    });
    assert.match(acceptedOutput, /Warning: partial capture was explicitly accepted\./);
    const accepted = JSON.parse(await readFile(join(partial.root, ".agentreceipt/finalized/accepted.json"), "utf8"));
    assert.equal(accepted.capture.status, "partial");
  } finally {
    await rm(partial.root, { recursive: true, force: true });
  }

  const failed = await createFinalizationRepository({ captureStatus: "failed" });
  try {
    await writeEvent(failed, { before: failed.captureStart });
    await rejectsCode(finalizeReceipt({
      cwd: failed.root,
      inputPath: failed.inputPath,
      outputPath: ".agentreceipt/finalized/failed.json",
      allowPartial: true,
      environment: failed.environment("push"),
    }), "failed_capture_rejected");
  } finally {
    await rm(failed.root, { recursive: true, force: true });
  }
});

test("draft tampering and mismatched file evidence fail before output creation", async () => {
  for (const options of [
    { integrityMismatch: true },
    { afterDigest: digest("stale") },
    { missingFile: true },
    { extraFile: true },
    { lineCountMismatch: true },
  ]) {
    const fixture = await createFinalizationRepository(options);
    try {
      await writeEvent(fixture, { before: fixture.captureStart });
      const outputPath = ".agentreceipt/finalized/rejected.json";
      await rejectsCode(finalizeReceipt({
        cwd: fixture.root,
        inputPath: fixture.inputPath,
        outputPath,
        allowPartial: false,
        environment: fixture.environment("push"),
      }), options.integrityMismatch ? "draft_integrity_mismatch" : "file_evidence_mismatch");
      assert.equal(await pathExists(join(fixture.root, outputPath)), false);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  }
});

test("unsafe, existing, and self-referential outputs are rejected", async () => {
  const fixture = await createFinalizationRepository();
  try {
    await writeEvent(fixture, { before: fixture.captureStart });
    const environment = fixture.environment("push");
    for (const [outputPath, code] of [
      ["../outside.json", "unsafe_output_path"],
      [join(fixture.root, "absolute.json"), "unsafe_output_path"],
      [fixture.inputPath, "unsafe_output_path"],
      ["source.txt", "output_exists"],
      ["not-ignored/finalized.json", "unsafe_output_path"],
    ]) {
      await rejectsCode(finalizeReceipt({
        cwd: fixture.root,
        inputPath: fixture.inputPath,
        outputPath,
        allowPartial: false,
        environment,
      }), code);
    }

    const outside = await mkdtemp(join(tmpdir(), "agentreceipt-finalize-outside-"));
    try {
      await mkdir(join(fixture.root, ".agentreceipt"), { recursive: true });
      await symlink(outside, join(fixture.root, ".agentreceipt", "escape"), "junction");
      await rejectsCode(finalizeReceipt({
        cwd: fixture.root,
        inputPath: fixture.inputPath,
        outputPath: ".agentreceipt/escape/finalized.json",
        allowPartial: false,
        environment,
      }), "unsafe_output_path");
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("atomic publication preserves a destination present at publication time", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentreceipt-publish-test-"));
  try {
    const temporary = join(root, "temporary.json");
    const destination = join(root, "destination.json");
    await writeFile(temporary, "new receipt\n", "utf8");
    await writeFile(destination, "existing receipt\n", "utf8");

    await rejectsCode(publishTemporaryFileNoReplace(temporary, destination), "output_exists");
    assert.equal(await readFile(destination, "utf8"), "existing receipt\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("repository mismatch and a synthetic pull-request checkout are rejected safely", async () => {
  const mismatch = await createFinalizationRepository({ owner: "different" });
  try {
    await writeEvent(mismatch, { before: mismatch.captureStart });
    await rejectsCode(finalizeReceipt({
      cwd: mismatch.root,
      inputPath: mismatch.inputPath,
      outputPath: ".agentreceipt/finalized/mismatch.json",
      allowPartial: false,
      environment: mismatch.environment("push"),
    }), "repository_mismatch");
  } finally {
    await rm(mismatch.root, { recursive: true, force: true });
  }

  const synthetic = await createFinalizationRepository();
  try {
    const eventHead = synthetic.head;
    await writeFile(join(synthetic.root, "merge-only.txt"), "synthetic\n", "utf8");
    await git(synthetic.root, ["add", "merge-only.txt"]);
    await git(synthetic.root, ["commit", "-m", "synthetic merge checkout"]);
    await writeEvent(synthetic, {
      pull_request: {
        head: { sha: eventHead },
        base: { sha: synthetic.captureStart },
      },
    });
    await rejectsCode(finalizeReceipt({
      cwd: synthetic.root,
      inputPath: synthetic.inputPath,
      outputPath: ".agentreceipt/finalized/synthetic.json",
      allowPartial: false,
      environment: synthetic.environment("pull_request"),
    }), "checkout_head_mismatch");
  } finally {
    await rm(synthetic.root, { recursive: true, force: true });
  }
});

test("malformed and oversized committed drafts fail with bounded safe codes", async () => {
  for (const entry of [
    { content: "{private-canary", code: "malformed_json" },
    { content: "x".repeat(1024 * 1024 + 1), code: "receipt_too_large" },
  ]) {
    const fixture = await createFinalizationRepository();
    try {
      await writeFile(join(fixture.root, fixture.inputPath), entry.content, "utf8");
      await git(fixture.root, ["add", fixture.inputPath]);
      await git(fixture.root, ["commit", "-m", "replace draft input"]);
      const currentHead = await git(fixture.root, ["rev-parse", "HEAD"]);
      await writeEvent(fixture, { before: fixture.captureStart });
      const environment = {
        ...fixture.environment("push"),
        GITHUB_SHA: currentHead,
      };
      try {
        await finalizeReceipt({
          cwd: fixture.root,
          inputPath: fixture.inputPath,
          outputPath: ".agentreceipt/finalized/rejected.json",
          allowPartial: false,
          environment,
        });
        assert.fail("unsafe draft unexpectedly finalized");
      } catch (error) {
        assert.equal(error instanceof FinalizationError, true);
        assert.equal(error.code, entry.code);
        assert.equal(error.message.includes("private-canary"), false);
      }
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  }
});

test("credential canaries and unsupported events fail without leaking receipt content", async () => {
  const secret = "github_pat_abcdefghijklmnopqrstuvwxyz123456";
  const fixture = await createFinalizationRepository({ description: secret });
  try {
    await writeEvent(fixture, { before: fixture.captureStart });
    try {
      await finalizeReceipt({
        cwd: fixture.root,
        inputPath: fixture.inputPath,
        outputPath: ".agentreceipt/finalized/private.json",
        allowPartial: false,
        environment: fixture.environment("push"),
      });
      assert.fail("private draft unexpectedly finalized");
    } catch (error) {
      assert.equal(error.code, "privacy_check_failed");
      assert.equal(error.message.includes(secret), false);
    }

    await rejectsCode(finalizeReceipt({
      cwd: fixture.root,
      inputPath: fixture.inputPath,
      outputPath: ".agentreceipt/finalized/unsupported.json",
      allowPartial: false,
      environment: fixture.environment("pull_request_target"),
    }), "unsupported_event");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("review-base and capture-end ancestry must be proven locally", async () => {
  const reviewBase = await createFinalizationRepository();
  try {
    const tree = await git(reviewBase.root, ["rev-parse", `${reviewBase.captureStart}^{tree}`]);
    const sibling = await git(reviewBase.root, [
      "commit-tree",
      tree,
      "-p",
      reviewBase.captureStart,
      "-m",
      "sibling review base",
    ]);
    await writeEvent(reviewBase, { before: sibling });
    await rejectsCode(finalizeReceipt({
      cwd: reviewBase.root,
      inputPath: reviewBase.inputPath,
      outputPath: ".agentreceipt/finalized/bad-base.json",
      allowPartial: false,
      environment: reviewBase.environment("push"),
    }), "git_ancestry_mismatch");
  } finally {
    await rm(reviewBase.root, { recursive: true, force: true });
  }

  const captureEnd = await createFinalizationRepository();
  try {
    const tree = await git(captureEnd.root, ["rev-parse", `${captureEnd.captureStart}^{tree}`]);
    const sibling = await git(captureEnd.root, [
      "commit-tree",
      tree,
      "-p",
      captureEnd.captureStart,
      "-m",
      "sibling capture end",
    ]);
    const draft = JSON.parse(await readFile(join(captureEnd.root, captureEnd.inputPath), "utf8"));
    draft.repository.capture_end_sha = sibling;
    draft.integrity.content_digest = computeReceiptContentDigest(draft);
    await writeFile(join(captureEnd.root, captureEnd.inputPath), `${JSON.stringify(draft, null, 2)}\n`, "utf8");
    await git(captureEnd.root, ["add", captureEnd.inputPath]);
    await git(captureEnd.root, ["commit", "-m", "bind divergent capture end"]);
    const currentHead = await git(captureEnd.root, ["rev-parse", "HEAD"]);
    await writeEvent(captureEnd, { before: captureEnd.captureStart });
    await rejectsCode(finalizeReceipt({
      cwd: captureEnd.root,
      inputPath: captureEnd.inputPath,
      outputPath: ".agentreceipt/finalized/bad-capture.json",
      allowPartial: false,
      environment: { ...captureEnd.environment("push"), GITHUB_SHA: currentHead },
    }), "git_ancestry_mismatch");
  } finally {
    await rm(captureEnd.root, { recursive: true, force: true });
  }
});

test("event JSON limits, missing integrity, and draft attestation fail safely", async () => {
  for (const entry of [
    { content: "{event-canary", code: "malformed_json" },
    { content: "x".repeat(1024 * 1024 + 1), code: "receipt_too_large" },
  ]) {
    const fixture = await createFinalizationRepository();
    try {
      await writeFile(fixture.eventPath, entry.content, "utf8");
      await rejectsCode(finalizeReceipt({
        cwd: fixture.root,
        inputPath: fixture.inputPath,
        outputPath: ".agentreceipt/finalized/event-rejected.json",
        allowPartial: false,
        environment: fixture.environment("push"),
      }), entry.code);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  }

  for (const mode of ["missing-integrity", "attested"]) {
    const fixture = await createFinalizationRepository();
    try {
      const draft = JSON.parse(await readFile(join(fixture.root, fixture.inputPath), "utf8"));
      if (mode === "missing-integrity") {
        delete draft.integrity;
      } else {
        draft.attestation = {
          provider: "github",
          subject_digest: digest("attested"),
          verification_uri: "https://github.com/example/project/attestations/1",
        };
        draft.integrity.content_digest = computeReceiptContentDigest(draft);
      }
      await writeFile(join(fixture.root, fixture.inputPath), `${JSON.stringify(draft, null, 2)}\n`, "utf8");
      await git(fixture.root, ["add", fixture.inputPath]);
      await git(fixture.root, ["commit", "-m", mode]);
      const currentHead = await git(fixture.root, ["rev-parse", "HEAD"]);
      await writeEvent(fixture, { before: fixture.captureStart });
      await rejectsCode(finalizeReceipt({
        cwd: fixture.root,
        inputPath: fixture.inputPath,
        outputPath: `.agentreceipt/finalized/${mode}.json`,
        allowPartial: false,
        environment: { ...fixture.environment("push"), GITHUB_SHA: currentHead },
      }), mode === "missing-integrity" ? "schema_invalid" : "draft_required");
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  }
});
