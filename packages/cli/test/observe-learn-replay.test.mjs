import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { runCodexCaptureWithPrivateProjection } from "@agentreceipt/codex-adapter";
import { validateReceipt } from "@agentreceipt/schema";

import {
  executeCli,
  readPrivateJson,
  replayRecipe,
  validateRecipe,
  writePrivateJson,
} from "../dist/src/index.js";

const execFileAsync = promisify(execFile);
const testDirectory = dirname(fileURLToPath(import.meta.url));
const fixtureDirectory = join(testDirectory, "..", "..", "..", "docs", "fixtures", "observe-learn-replay");

async function git(cwd, args) {
  const { stdout } = await execFileAsync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  return stdout.trim();
}

function outputPath(output, label) {
  const line = output.split("\n").find((entry) => entry.startsWith(`${label}: `));
  assert.ok(line, `missing ${label} output`);
  return line.slice(label.length + 2);
}

test("fixture captures, learns, dry-runs, replays, verifies, and writes a fresh receipt", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentreceipt-replay-e2e-"));
  const repository = join(root, "repository");
  const fakeCodex = join(root, "fake-codex.mjs");
  const stream = await readFile(join(fixtureDirectory, "codex-exec-read-only.jsonl"), "utf8");
  const input = await readFile(join(fixtureDirectory, "input.txt"), "utf8");
  const promptCanary = "PROMPT_PRIVATE_REPLAY_CANARY_71a4";

  await mkdir(repository);
  await git(repository, ["init"]);
  await git(repository, ["config", "user.email", "agentreceipt@example.invalid"]);
  await git(repository, ["config", "user.name", "AgentReceipt Test"]);
  await git(repository, ["branch", "-M", "main"]);
  await writeFile(join(repository, ".gitignore"), ".agentreceipt/\n", "utf8");
  await writeFile(join(repository, "input.txt"), input, "utf8");
  await writeFile(join(repository, "runback-request.json"), `${JSON.stringify({
    schemaVersion: 1,
    intent: {
      id: "hash-and-verify",
      needs: [
        {
          id: "hash",
          function: "observe",
          capability: "hash_repository_file",
          inputs: ["repository_file"],
          outputs: ["git_blob_digest"],
          requiredScopes: ["repository:read"],
          maxRisk: "read",
        },
        {
          id: "verify",
          function: "verify",
          capability: "verify_file_digest",
          dependsOn: ["hash"],
          inputs: ["repository_file"],
          outputs: ["verification_result"],
          requiredScopes: ["repository:read"],
          maxRisk: "read",
        },
      ],
    },
    initialArtifacts: ["repository_file"],
    allowedScopes: ["repository:read"],
  }, null, 2)}\n`, "utf8");
  await git(repository, ["add", ".gitignore", "input.txt", "runback-request.json"]);
  await git(repository, ["commit", "-m", "fixture"]);
  await writeFile(fakeCodex, `
if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 9.9.9-fixture\\n");
} else {
  process.stdin.resume();
  process.stdout.write(${JSON.stringify(stream)});
}
`, "utf8");

  const dependencies = {
    cwd: repository,
    runCodexCaptureWithPrivateProjection: (options) => runCodexCaptureWithPrivateProjection({
      ...options,
      executable: process.execPath,
      executableArgsPrefix: [fakeCodex],
    }),
  };

  try {
    const captureOutput = await executeCli([
      "codex",
      "--title", "Capture the harmless replay fixture",
      "--prompt", promptCanary,
      "--capsule",
      "--verify-file", "input.txt",
      "--param", "INPUT_FILE=input.txt",
    ], dependencies);
    const capsulePath = outputPath(captureOutput, "Private capsule");
    const receiptPath = outputPath(captureOutput, "Receipt");
    const capsule = JSON.parse(await readFile(join(repository, capsulePath), "utf8"));
    const sourceReceipt = JSON.parse(await readFile(receiptPath, "utf8"));
    assert.equal(sourceReceipt.capture.surface, "codex_exec_jsonl");
    assert.equal(capsule.source_receipt_content_digest, sourceReceipt.integrity.content_digest);
    assert.deepEqual(capsule.actions[0].arguments, ["hash-object", "--no-filters", "{{param.INPUT_FILE}}"]);
    assert.equal(JSON.stringify(capsule).includes(promptCanary), false);
    assert.equal(JSON.stringify(capsule).includes("aggregated_output"), false);

    const hiddenSourceReceiptPath = `${receiptPath}.linkage-test`;
    await rename(receiptPath, hiddenSourceReceiptPath);
    await assert.rejects(
      executeCli(["learn", capsulePath], dependencies),
      /source receipt linkage could not be verified/i,
    );
    await rename(hiddenSourceReceiptPath, receiptPath);

    const learnOutput = await executeCli(["learn", capsulePath], dependencies);
    const recipePath = outputPath(learnOutput, "Recipe");
    const componentReleasePath = outputPath(learnOutput, "Component release");
    const recipeAbsolutePath = join(repository, recipePath);
    const recipeText = await readFile(recipeAbsolutePath, "utf8");
    const recipe = JSON.parse(recipeText);
    assert.doesNotThrow(() => validateRecipe(recipe));
    assert.equal(recipe.verification.path, "{{param.INPUT_FILE}}");
    assert.equal(recipe.source.source_receipt_content_digest, sourceReceipt.integrity.content_digest);
    assert.equal(JSON.stringify(recipe).includes("input.txt"), false);
    const componentRelease = await readPrivateJson(repository, componentReleasePath, "runback_release");
    assert.equal(componentRelease.schemaVersion, 1);
    assert.equal(componentRelease.components.length, 2);
    assert.equal(JSON.stringify(componentRelease).includes(promptCanary), false);
    assert.equal(JSON.stringify(componentRelease).includes("input.txt"), false);

    const incompleteRailOutput = await executeCli([
      "runback", "runback-request.json",
    ], dependencies);
    assert.match(incompleteRailOutput, /Runback preflight: uncovered/);
    assert.match(incompleteRailOutput, /missing_parameters/);
    assert.match(incompleteRailOutput, /INPUT_FILE/);
    const railOutput = await executeCli([
      "runback", "runback-request.json", "--param", "INPUT_FILE=input.txt",
    ], dependencies);
    assert.match(railOutput, /Runback preflight: covered/);
    assert.match(railOutput, /Coverage: 2\/2/);
    assert.match(railOutput, /Local component releases: 1/);
    assert.match(railOutput, /No tools were executed/);
    assert.equal(railOutput.includes("input.txt"), false);

    const receiptDirectory = join(repository, ".agentreceipt", "receipts");
    const beforeDryRun = await readdir(receiptDirectory);
    await assert.rejects(
      executeCli(["replay", recipePath, "--dry-run"], dependencies),
      (error) => error?.code === "parameter_missing",
    );
    assert.deepEqual(await readdir(receiptDirectory), beforeDryRun);

    let dryRunExecuted = false;
    const directDryRun = await replayRecipe({
      cwd: repository,
      recipePath,
      dryRun: true,
      parameters: new Map([["INPUT_FILE", "input.txt"]]),
      environment: process.env,
    }, {
      runDirectProcess: async () => {
        dryRunExecuted = true;
        return 0;
      },
    });
    assert.equal(directDryRun.dryRun, true);
    assert.equal(dryRunExecuted, false);
    assert.deepEqual(await readdir(receiptDirectory), beforeDryRun);

    const dryRunOutput = await executeCli([
      "replay", recipePath, "--dry-run", "--param", "INPUT_FILE=input.txt",
    ], dependencies);
    assert.match(dryRunOutput, /without executing actions/);
    assert.deepEqual(await readdir(receiptDirectory), beforeDryRun);

    const tamperedRecipe = structuredClone(recipe);
    tamperedRecipe.limitations.push("Tampered without recomputing integrity.");
    await writeFile(recipeAbsolutePath, `${JSON.stringify(tamperedRecipe, null, 2)}\n`, "utf8");
    await assert.rejects(
      executeCli(["replay", recipePath, "--dry-run", "--param", "INPUT_FILE=input.txt"], dependencies),
      (error) => error?.code === "recipe_integrity_mismatch",
    );
    assert.deepEqual(await readdir(receiptDirectory), beforeDryRun);
    await writeFile(recipeAbsolutePath, recipeText, "utf8");

    const replayOutput = await executeCli([
      "replay", recipePath, "--param", "INPUT_FILE=input.txt",
    ], dependencies);
    const replayReceiptPath = outputPath(replayOutput, "Receipt");
    const replayReceipt = JSON.parse(await readFile(replayReceiptPath, "utf8"));
    assert.equal(validateReceipt(replayReceipt).valid, true);
    assert.equal(replayReceipt.capture.surface, "agentreceipt_recipe_replay");
    assert.equal(
      replayReceipt.extensions["dev.agentreceipt.recipe-replay"].recipe_digest,
      recipe.integrity.content_digest,
    );
    assert.equal(
      replayReceipt.extensions["dev.agentreceipt.recipe-replay"].source_receipt_content_digest,
      sourceReceipt.integrity.content_digest,
    );
    assert.equal(JSON.stringify(replayReceipt).includes("private_capsule_digest"), false);
    assert.equal(JSON.stringify(replayReceipt).includes(promptCanary), false);
    assert.equal(JSON.stringify(replayReceipt).includes("input.txt"), false);
    assert.equal((await readdir(receiptDirectory)).length, beforeDryRun.length + 1);
    assert.equal(await git(repository, ["status", "--porcelain=v1", "--untracked-files=all"]), "");

    await writeFile(join(repository, "input.txt"), "stale file canary\n", "utf8");
    await git(repository, ["add", "input.txt"]);
    await git(repository, ["commit", "-m", "make recipe precondition stale"]);
    await assert.rejects(
      executeCli(["replay", recipePath, "--dry-run", "--param", "INPUT_FILE=input.txt"], dependencies),
      (error) => error?.code === "preflight_failed",
    );
    assert.equal((await readdir(receiptDirectory)).length, beforeDryRun.length + 1);
    await writeFile(join(repository, "input.txt"), input, "utf8");
    await git(repository, ["add", "input.txt"]);
    await git(repository, ["commit", "-m", "restore recipe precondition"]);

    const mutationResult = await replayRecipe({
      cwd: repository,
      recipePath,
      dryRun: false,
      parameters: new Map([["INPUT_FILE", "input.txt"]]),
      environment: process.env,
    }, {
      runDirectProcess: async () => {
        await writeFile(join(repository, "unexpected-mutation.txt"), "mutation canary\n", "utf8");
        return 0;
      },
    });
    assert.equal(mutationResult.receipt.capture.status, "failed");
    assert.equal(mutationResult.receipt.verification.status, "failed");
    assert.match(
      await git(repository, ["status", "--porcelain=v1", "--untracked-files=all"]),
      /unexpected-mutation\.txt/,
    );
    assert.equal((await readdir(receiptDirectory)).length, beforeDryRun.length + 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("private artifact I/O rejects traversal, unignored storage, tracked files, and oversized content", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentreceipt-private-io-"));
  const repository = join(root, "repository");
  const recipePath = `.agentreceipt/recipes/${randomUUID()}.json`;
  try {
    await mkdir(repository);
    await git(repository, ["init"]);
    await git(repository, ["config", "user.email", "agentreceipt@example.invalid"]);
    await git(repository, ["config", "user.name", "AgentReceipt Test"]);
    await writeFile(join(repository, "README.md"), "fixture\n", "utf8");
    await git(repository, ["add", "README.md"]);
    await git(repository, ["commit", "-m", "fixture"]);

    await assert.rejects(
      readPrivateJson(repository, "../outside.json", "recipe"),
      (error) => error?.code === "unsafe_private_path",
    );
    await assert.rejects(
      writePrivateJson(repository, recipePath, "recipe", {}),
      (error) => error?.code === "unsafe_private_path",
    );

    await writeFile(join(repository, ".gitignore"), ".agentreceipt/\n", "utf8");
    await git(repository, ["add", ".gitignore"]);
    await git(repository, ["commit", "-m", "ignore private artifacts"]);
    await assert.rejects(
      writePrivateJson(repository, recipePath, "recipe", { content: "x".repeat(1024 * 1024) }),
      (error) => error?.code === "private_artifact_too_large",
    );

    await mkdir(join(repository, ".agentreceipt", "recipes"), { recursive: true });
    await writeFile(join(repository, recipePath), "{}\n", "utf8");
    await git(repository, ["add", "-f", recipePath]);
    await git(repository, ["commit", "-m", "unsafe tracked private artifact"]);
    await assert.rejects(
      readPrivateJson(repository, recipePath, "recipe"),
      (error) => error?.code === "unsafe_private_path",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
