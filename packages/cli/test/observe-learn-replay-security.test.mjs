import "./observe-learn-replay.test.mjs";

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  access,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { validateReceipt } from "@agentreceipt/schema";

import {
  createPrivateCapsule,
  createRecipe,
  executeCli,
  readPrivateJson,
  readRepository,
  replayRecipe,
  validatePrivateCapsule,
  validateRecipe,
  writePrivateJson,
} from "../dist/src/index.js";
import { sha256OmittingIntegrity } from "../dist/src/json.js";

const execFileAsync = promisify(execFile);
const INPUT = "Phase 3 deterministic harmless input.\n";
const INPUT_DIGEST = `sha256:${createHash("sha256").update(INPUT).digest("hex")}`;
const SOURCE_RECEIPT_DIGEST = `sha256:${"a".repeat(64)}`;
const SYNTHETIC_CREDENTIAL = "github_pat_phase3syntheticcredential123456";
const GIT_VERSION = "git version 9.9.9-phase3";

async function git(cwd, args) {
  const { stdout } = await execFileAsync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  return stdout.trim();
}

function withIntegrity(value) {
  value.integrity.content_digest = sha256OmittingIntegrity(value);
  return value;
}

async function createFixture(options = {}) {
  const root = await mkdtemp(join(tmpdir(), "agentreceipt-phase3-cli-"));
  const repository = join(root, "repository");
  await mkdir(repository);
  await git(repository, ["init"]);
  await git(repository, ["config", "user.email", "agentreceipt@example.invalid"]);
  await git(repository, ["config", "user.name", "AgentReceipt Test"]);
  await git(repository, ["branch", "-M", "main"]);
  if (options.ignored !== false) await writeFile(join(repository, ".gitignore"), ".agentreceipt/\n", "utf8");
  await writeFile(join(repository, "input.txt"), INPUT, "utf8");
  await git(repository, ["add", "input.txt", ...(options.ignored === false ? [] : [".gitignore"])]);
  await git(repository, ["commit", "-m", "phase 3 fixture"]);
  const snapshot = await readRepository(repository);

  const capture = {
    status: "complete_for_declared_surface",
    process_exit_code: 0,
    terminal_event_received: true,
    cli_version: "9.9.9-phase3",
    events: [],
    record_counts: { parsed: 5, discarded_sensitive: 3, unknown: 0, malformed: 0 },
    redactions: { command: 1, command_output: 1 },
    observed_capabilities: ["lifecycle", "commands"],
    unavailable_capabilities: ["unowned host activity"],
    limitations: ["Synthetic local Phase 3 fixture; no model or network was invoked."],
  };
  const projection = {
    parameters: [{ name: "INPUT_FILE", sensitivity: "public" }],
    actions: [{
      sequence: 0,
      kind: "process",
      cwd: ".",
      executable: "git",
      arguments: ["hash-object", "--no-filters", "{{param.INPUT_FILE}}"],
      environment_names: [],
      file_paths: ["input.txt"],
      read_only: true,
      classifier_version: "0.1",
      expected_exit_code: 0,
      observed_exit_code: 0,
      duration_ms: 1,
    }],
    structurally_eligible: true,
    unsupported_material: false,
    secret_material_detected: false,
    malformed_records: 0,
    pending_items: 0,
  };
  const capsule = createPrivateCapsule({
    capsuleId: randomUUID(),
    createdAt: new Date("2026-07-22T12:00:00.000Z"),
    elapsedMs: 10,
    sourceReceiptContentDigest: SOURCE_RECEIPT_DIGEST,
    repositoryBefore: snapshot,
    repositoryAfter: snapshot,
    capture,
    projection,
    executableVersion: GIT_VERSION,
    fileDigests: new Map([["input.txt", INPUT_DIGEST]]),
    verification: {
      startedAt: "2026-07-22T12:00:00.008Z",
      endedAt: "2026-07-22T12:00:00.009Z",
      durationMs: 1,
      exitCode: 0,
      path: "input.txt",
      digest: INPUT_DIGEST,
    },
  });
  const recipe = createRecipe(capsule, randomUUID(), new Date("2026-07-22T12:00:01.000Z"));
  const capsulePath = `.agentreceipt/private/capsules/${capsule.capsule_id}.json`;
  const recipePath = `.agentreceipt/recipes/${recipe.recipe_id}.json`;
  if (options.writeArtifacts !== false && options.ignored !== false) {
    await writePrivateJson(repository, capsulePath, "capsule", capsule);
    await writePrivateJson(repository, recipePath, "recipe", recipe);
  }
  return { root, repository, snapshot, capsule, capsulePath, recipe, recipePath };
}

async function rejectsCode(promise, code) {
  await assert.rejects(promise, (error) => error?.code === code && !String(error.message).includes(SYNTHETIC_CREDENTIAL));
}

function preflightDependencies(snapshot, options = {}) {
  const counters = { executions: 0, writes: 0, probes: 0, repositoryReads: 0 };
  const dependencies = {
    readRepository: async () => {
      counters.repositoryReads += 1;
      return options.repositoryAfter && counters.repositoryReads > 1 ? options.repositoryAfter : snapshot;
    },
    hashRepositoryFile: async () => options.digest ?? INPUT_DIGEST,
    isTrackedRepositoryFile: async () => {
      counters.probes += 1;
      return options.tracked ?? true;
    },
    readGitExecutableVersion: async () => options.version ?? GIT_VERSION,
    runDirectProcess: async (executable, args, cwd, environment) => {
      counters.executions += 1;
      if (options.onExecute) await options.onExecute({ executable, args, cwd, environment });
      return options.exitCode ?? 0;
    },
    writeCompletedReceipt: async (_root, _receiptId, receipt) => {
      counters.writes += 1;
      if (options.onWrite) options.onWrite(receipt);
      return ".agentreceipt/receipts/phase3-replay.json";
    },
  };
  return { counters, dependencies };
}

test("capsule and recipe validators reject credential canaries and unknown fields with safe codes", async () => {
  const fixture = await createFixture();
  try {
    const credentialCapsule = structuredClone(fixture.capsule);
    credentialCapsule.capture.limitations.push(SYNTHETIC_CREDENTIAL);
    withIntegrity(credentialCapsule);
    assert.throws(
      () => validatePrivateCapsule(credentialCapsule),
      (error) => error?.code === "secret_material_detected" && !error.message.includes(SYNTHETIC_CREDENTIAL),
    );

    const credentialRecipe = structuredClone(fixture.recipe);
    credentialRecipe.limitations.push(SYNTHETIC_CREDENTIAL);
    withIntegrity(credentialRecipe);
    assert.throws(
      () => validateRecipe(credentialRecipe),
      (error) => error?.code === "secret_material_detected" && !error.message.includes(SYNTHETIC_CREDENTIAL),
    );

    const unknownField = structuredClone(fixture.recipe);
    unknownField.unreviewed_extension = true;
    withIntegrity(unknownField);
    assert.throws(() => validateRecipe(unknownField), (error) => error?.code === "recipe_invalid");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("private artifact storage rejects credential persistence, wrong paths, links, overwrites, and malformed data", async () => {
  const fixture = await createFixture();
  try {
    const credentialPath = `.agentreceipt/recipes/${randomUUID()}.json`;
    await rejectsCode(
      writePrivateJson(fixture.repository, credentialPath, "recipe", { value: SYNTHETIC_CREDENTIAL }),
      "private_artifact_invalid",
    );
    await assert.rejects(access(join(fixture.repository, credentialPath)));

    for (const path of [
      `../${randomUUID()}.json`,
      join(fixture.root, `${randomUUID()}.json`),
      `.agentreceipt/private/capsules/${randomUUID()}.json`,
      `.agentreceipt/recipes/../${randomUUID()}.json`,
      `.agentreceipt\\recipes\\${randomUUID()}.json`,
    ]) {
      await rejectsCode(readPrivateJson(fixture.repository, path, "recipe"), "unsafe_private_path");
    }

    await rejectsCode(
      writePrivateJson(fixture.repository, fixture.recipePath, "recipe", fixture.recipe),
      "private_artifact_exists",
    );
    assert.deepEqual(await readPrivateJson(fixture.repository, fixture.recipePath, "recipe"), fixture.recipe);

    const hardLink = join(fixture.root, "hard-linked-recipe.json");
    await link(join(fixture.repository, fixture.recipePath), hardLink);
    await rejectsCode(readPrivateJson(fixture.repository, fixture.recipePath, "recipe"), "unsafe_private_path");

    const malformedPath = `.agentreceipt/private/capsules/${randomUUID()}.json`;
    await writeFile(join(fixture.repository, malformedPath), "{malformed", "utf8");
    await rejectsCode(readPrivateJson(fixture.repository, malformedPath, "capsule"), "private_artifact_invalid");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }

  const linked = await createFixture({ writeArtifacts: false });
  try {
    const outside = join(linked.root, "outside-private");
    await mkdir(outside);
    await symlink(outside, join(linked.repository, ".agentreceipt"), process.platform === "win32" ? "junction" : "dir");
    await rejectsCode(
      writePrivateJson(linked.repository, `.agentreceipt/recipes/${randomUUID()}.json`, "recipe", linked.recipe),
      "unsafe_private_path",
    );
  } finally {
    await rm(linked.root, { recursive: true, force: true });
  }
});

test("recipe grammar rejects command reclassification, unsafe paths, secret targets, and semantic tampering", async () => {
  const fixture = await createFixture();
  try {
    const mutations = [
      (recipe) => { recipe.steps[0].executable = "curl"; },
      (recipe) => { recipe.steps[0].arguments = ["cat-file", "blob", "{{param.INPUT_FILE}}"] },
      (recipe) => { recipe.steps[0].arguments = ["hash-object", "--no-filters", "../input.txt"] },
      (recipe) => { recipe.steps[0].arguments.push("--write") },
      (recipe) => { recipe.steps[0].environment_names = ["TOKEN"] },
      (recipe) => { recipe.steps[0].read_only = false },
      (recipe) => { recipe.verification.path = ".git/config" },
      (recipe) => { recipe.preconditions.required_files[0].path = ".agentreceipt/private/capsules/x.json" },
      (recipe) => { recipe.parameters.push({ ...recipe.parameters[0] }) },
      (recipe) => { recipe.steps[0].unexpected = true },
    ];
    for (const mutate of mutations) {
      const changed = structuredClone(fixture.recipe);
      mutate(changed);
      withIntegrity(changed);
      assert.throws(() => validateRecipe(changed), (error) => error?.code === "recipe_invalid");
    }
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("missing, duplicate, undeclared, injection-shaped, and credential-shaped parameters execute nothing", async () => {
  const fixture = await createFixture();
  try {
    for (const [parameters, code] of [
      [new Map(), "parameter_missing"],
      [new Map([["INPUT_FILE", "input.txt"], ["EXTRA", "input.txt"]]), "parameter_missing"],
      [new Map([["INPUT_FILE", "../outside.txt"]]), "preflight_failed"],
      [new Map([["INPUT_FILE", "input.txt;curl"]]), "preflight_failed"],
    ]) {
      const { counters, dependencies } = preflightDependencies(fixture.snapshot);
      await rejectsCode(replayRecipe({
        cwd: fixture.repository,
        recipePath: fixture.recipePath,
        dryRun: true,
        parameters,
        environment: {},
      }, dependencies), code);
      assert.equal(counters.executions, 0);
      assert.equal(counters.writes, 0);
    }

    const credentialPreflight = preflightDependencies(fixture.snapshot);
    await rejectsCode(replayRecipe({
      cwd: fixture.repository,
      recipePath: fixture.recipePath,
      dryRun: true,
      parameters: new Map([["INPUT_FILE", SYNTHETIC_CREDENTIAL]]),
      environment: {},
    }, credentialPreflight.dependencies), "preflight_failed");
    assert.equal(credentialPreflight.counters.probes, 0);
    assert.equal(credentialPreflight.counters.executions, 0);
    assert.equal(credentialPreflight.counters.writes, 0);

    await assert.rejects(
      executeCli([
        "replay", fixture.recipePath, "--dry-run",
        "--param", "INPUT_FILE=input.txt",
        "--param", "INPUT_FILE=other.txt",
      ], { cwd: fixture.repository }),
      /Invalid replay parameter/,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("stale state, integrity mismatch, repository mismatch, and source linkage mismatch fail before execution", async () => {
  const fixture = await createFixture();
  try {
    const dirty = preflightDependencies({ ...fixture.snapshot, isClean: false });
    await rejectsCode(replayRecipe({
      cwd: fixture.repository,
      recipePath: fixture.recipePath,
      dryRun: true,
      parameters: new Map([["INPUT_FILE", "input.txt"]]),
      environment: {},
    }, dirty.dependencies), "repository_state_mismatch");

    const stale = preflightDependencies(fixture.snapshot, { digest: `sha256:${"b".repeat(64)}` });
    await rejectsCode(replayRecipe({
      cwd: fixture.repository,
      recipePath: fixture.recipePath,
      dryRun: true,
      parameters: new Map([["INPUT_FILE", "input.txt"]]),
      environment: {},
    }, stale.dependencies), "preflight_failed");

    const tampered = structuredClone(fixture.recipe);
    tampered.limitations.push("Integrity was not recomputed.");
    const tamperedPath = `.agentreceipt/recipes/${randomUUID()}.json`;
    await writePrivateJson(fixture.repository, tamperedPath, "recipe", tampered);
    const tamperedDependencies = preflightDependencies(fixture.snapshot);
    await rejectsCode(replayRecipe({
      cwd: fixture.repository,
      recipePath: tamperedPath,
      dryRun: true,
      parameters: new Map([["INPUT_FILE", "input.txt"]]),
      environment: {},
    }, tamperedDependencies.dependencies), "recipe_integrity_mismatch");

    const wrongRepository = structuredClone(fixture.recipe);
    wrongRepository.repository.name = "different-repository";
    withIntegrity(wrongRepository);
    const wrongRepositoryPath = `.agentreceipt/recipes/${randomUUID()}.json`;
    await writePrivateJson(fixture.repository, wrongRepositoryPath, "recipe", wrongRepository);
    const repositoryDependencies = preflightDependencies(fixture.snapshot);
    await rejectsCode(replayRecipe({
      cwd: fixture.repository,
      recipePath: wrongRepositoryPath,
      dryRun: true,
      parameters: new Map([["INPUT_FILE", "input.txt"]]),
      environment: {},
    }, repositoryDependencies.dependencies), "repository_state_mismatch");

    const recipesBefore = await readdir(join(fixture.repository, ".agentreceipt", "recipes"));
    await assert.rejects(
      executeCli(["learn", fixture.capsulePath], { cwd: fixture.repository }),
      /source receipt linkage could not be verified/i,
    );
    assert.deepEqual(await readdir(join(fixture.repository, ".agentreceipt", "recipes")), recipesBefore);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("post-execution mutation emits one fresh failed receipt without private or runtime values", async () => {
  const fixture = await createFixture();
  let writtenReceipt;
  try {
    const after = { ...fixture.snapshot, isClean: false };
    const { counters, dependencies } = preflightDependencies(fixture.snapshot, {
      repositoryAfter: after,
      onExecute: async ({ args, environment }) => {
        assert.deepEqual(args, ["hash-object", "--no-filters", "input.txt"]);
        assert.equal(environment.UNRELATED_SECRET, undefined);
      },
      onWrite: (receipt) => { writtenReceipt = receipt; },
    });
    const result = await replayRecipe({
      cwd: fixture.repository,
      recipePath: fixture.recipePath,
      dryRun: false,
      parameters: new Map([["INPUT_FILE", "input.txt"]]),
      environment: { UNRELATED_SECRET: SYNTHETIC_CREDENTIAL },
      now: (() => {
        let milliseconds = 0;
        return () => new Date(1_753_185_600_000 + milliseconds++);
      })(),
      randomUUID,
    }, dependencies);

    assert.equal(counters.executions, 1);
    assert.equal(counters.writes, 1);
    assert.equal(result.receipt.capture.status, "failed");
    assert.equal(result.receipt.verification.status, "failed");
    assert.equal(validateReceipt(result.receipt).valid, true);
    assert.deepEqual(writtenReceipt, result.receipt);
    assert.deepEqual(Object.keys(result.receipt.extensions), ["dev.agentreceipt.recipe-replay"]);
    assert.deepEqual(Object.keys(result.receipt.extensions["dev.agentreceipt.recipe-replay"]).sort(), [
      "mode", "recipe_digest", "source_receipt_content_digest",
    ]);
    const serialized = JSON.stringify(result.receipt);
    for (const forbidden of [SYNTHETIC_CREDENTIAL, "input.txt", "private_capsule_digest"]) {
      assert.equal(serialized.includes(forbidden), false);
    }
    assert.equal(serialized.toLowerCase().includes("rollback"), false);
    assert.ok(result.receipt.capture.limitations.some((entry) => entry.includes("not proof of safety")));
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
