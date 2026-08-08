import { spawn } from "node:child_process";
import { access, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { validateReceipt } from "@agentreceipt/schema";
import { runCodexCaptureWithPrivateProjection } from "@agentreceipt/codex-adapter";

const LIVE_ARGUMENTS = new Set(["--live-codex", "--max-live-runs=1"]);
const DIAGNOSTIC_ARGUMENTS = new Set(["--diagnose-capture", "--max-live-runs=0"]);
const REPAIR_ARGUMENTS = new Set(["--repair-live-codex", "--max-live-runs=1"]);
const EVENT_SHAPE_ARGUMENTS = new Set(["--diagnose-event-shape", "--max-live-runs=1"]);
const COMMAND_SHAPES = new Set([
  "direct_allowlisted",
  "allowlisted_command_embedded",
  "unsupported",
]);
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
]);
const MAX_OUTPUT_BYTES = 64 * 1024;
const CAPSULE_INELIGIBLE_STDERR = Buffer.from(
  "AgentReceipt error: Observe, learn, or replay input failed safely (capsule_ineligible).\n",
  "utf8",
);
const SAFE_PRIVATE_PATH = /^\.agentreceipt\/(?:private\/capsules|recipes)\/[0-9a-f-]+\.json$/;
const SAFE_DIGEST = /^sha256:[0-9a-f]{64}$/;
const FIXTURE_PREFIX = "agentreceipt-phase4-";
const FIXTURE_INPUT = "AgentReceipt Phase 4 harmless measurement fixture.\n";
const FIXED_PROMPT = [
  "Perform exactly one action in the repository root:",
  "run `git hash-object --no-filters input.txt`.",
  "Do not run any other command, read any other file, use the network, or modify any file.",
  "After that command completes successfully, stop.",
].join(" ");

const testDirectory = dirname(fileURLToPath(import.meta.url));
const cliPath = resolve(testDirectory, "..", "dist", "src", "bin.js");

class SafeFailure extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function exactArguments(argumentsList, expectedArguments) {
  return argumentsList.length === expectedArguments.size
    && argumentsList.every((argument) => expectedArguments.has(argument));
}

function harnessMode(argumentsList) {
  if (exactArguments(argumentsList, LIVE_ARGUMENTS)) return "live";
  if (exactArguments(argumentsList, DIAGNOSTIC_ARGUMENTS)) return "diagnostic";
  if (exactArguments(argumentsList, REPAIR_ARGUMENTS)) return "repair";
  if (exactArguments(argumentsList, EVENT_SHAPE_ARGUMENTS)) return "event_shape";
  return undefined;
}

function createAgentReceiptStderrClassifier() {
  let index = 0;
  let matches = true;
  return {
    ingest(chunk) {
      if (!matches) return;
      for (const byte of chunk) {
        if (index >= CAPSULE_INELIGIBLE_STDERR.length || byte !== CAPSULE_INELIGIBLE_STDERR[index]) {
          matches = false;
          return;
        }
        index += 1;
      }
    },
    finish() {
      return matches && index === CAPSULE_INELIGIBLE_STDERR.length
        ? "capsule_ineligible"
        : "agentreceipt_failure_unclassified";
    },
  };
}

function verifyAgentReceiptStderrClassifier() {
  const exact = createAgentReceiptStderrClassifier();
  exact.ingest(CAPSULE_INELIGIBLE_STDERR.subarray(0, 23));
  exact.ingest(CAPSULE_INELIGIBLE_STDERR.subarray(23));
  if (exact.finish() !== "capsule_ineligible") throw new SafeFailure("stderr_classifier_invalid");

  const rejected = createAgentReceiptStderrClassifier();
  rejected.ingest(Buffer.from("unapproved nested failure detail\n", "utf8"));
  if (rejected.finish() !== "agentreceipt_failure_unclassified") {
    throw new SafeFailure("stderr_classifier_invalid");
  }
}

function runProcess(executable, argumentsList, options = {}) {
  return new Promise((resolveProcess) => {
    const stderrClassifier = options.classifyAgentReceiptStderr
      ? createAgentReceiptStderrClassifier()
      : undefined;
    const child = spawn(executable, argumentsList, {
      cwd: options.cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", stderrClassifier ? "pipe" : "ignore"],
    });
    let stdout = Buffer.alloc(0);
    let outputExceeded = false;
    let settled = false;
    const timeout = setTimeout(() => {
      child.kill();
    }, options.timeoutMs ?? 20_000);

    child.stdout?.on("data", (chunk) => {
      if (!options.collectStdout || outputExceeded) return;
      const next = Buffer.concat([stdout, Buffer.from(chunk)]);
      if (next.length > MAX_OUTPUT_BYTES) {
        outputExceeded = true;
        stdout = Buffer.alloc(0);
        child.kill();
      } else {
        stdout = next;
      }
    });
    child.stderr?.on("data", (chunk) => stderrClassifier?.ingest(chunk));

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolveProcess(result);
    };
    child.once("error", () => finish({
      exitCode: 1,
      output: "",
      outputExceeded: false,
      stderrClassification: stderrClassifier?.finish(),
    }));
    child.once("close", (code) => finish({
      exitCode: code ?? 1,
      output: options.collectStdout && !outputExceeded ? stdout.toString("utf8") : "",
      outputExceeded,
      stderrClassification: stderrClassifier?.finish(),
    }));
  });
}

async function requireSuccess(executable, argumentsList, options = {}) {
  const result = await runProcess(executable, argumentsList, options);
  if (result.exitCode !== 0 || result.outputExceeded) {
    throw new SafeFailure(result.stderrClassification ?? options.failureCode ?? "command_failed");
  }
  return result.output;
}

async function git(repository, argumentsList, options = {}) {
  return requireSuccess("git", argumentsList, {
    cwd: repository,
    collectStdout: options.collectStdout ?? false,
    failureCode: "git_failed",
  });
}

async function runCli(repository, argumentsList, timeoutMs = 20_000) {
  return requireSuccess(process.execPath, [cliPath, ...argumentsList], {
    cwd: repository,
    collectStdout: true,
    classifyAgentReceiptStderr: true,
    timeoutMs,
    failureCode: "agentreceipt_failure_unclassified",
  });
}

function outputPath(output, label) {
  const line = output.split(/\r?\n/u).find((entry) => entry.startsWith(`${label}: `));
  const value = line?.slice(label.length + 2).trim();
  if (!value) throw new SafeFailure("safe_output_missing");
  return value;
}

function containedReceiptPath(repository, candidate) {
  const absolute = resolve(repository, candidate);
  const relativePath = relative(repository, absolute).replaceAll("\\", "/");
  if (relativePath.startsWith("../") || relativePath === ".." || !/^\.agentreceipt\/receipts\/[0-9a-f-]+\.json$/.test(relativePath)) {
    throw new SafeFailure("unsafe_receipt_path");
  }
  return absolute;
}

function privatePath(candidate) {
  const normalized = candidate.replaceAll("\\", "/");
  if (!SAFE_PRIVATE_PATH.test(normalized)) throw new SafeFailure("unsafe_private_path");
  return normalized;
}

function numericUsage(receipt) {
  const candidate = receipt?.extensions?.["dev.agentreceipt.codex-exec"]?.usage;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return undefined;
  const usage = {};
  for (const key of [
    "input_tokens",
    "cached_input_tokens",
    "cache_write_input_tokens",
    "output_tokens",
    "reasoning_output_tokens",
  ]) {
    const value = candidate[key];
    if (Number.isInteger(value) && value >= 0) usage[key] = value;
  }
  return Object.keys(usage).length > 0 ? usage : undefined;
}

async function publicReceipt(path) {
  const value = JSON.parse(await readFile(path, "utf8"));
  if (!validateReceipt(value).valid) throw new SafeFailure("public_receipt_invalid");
  return value;
}

async function repositoryIsClean(repository) {
  return (await git(repository, ["status", "--porcelain=v1", "--untracked-files=all"], { collectStdout: true })).trim() === "";
}

async function removeFixture(root) {
  const temporaryRoot = `${resolve(tmpdir())}${sep}`;
  const resolvedRoot = resolve(root);
  if (!resolvedRoot.startsWith(temporaryRoot) || !basename(resolvedRoot).startsWith(FIXTURE_PREFIX)) {
    throw new SafeFailure("unsafe_cleanup_path");
  }
  await rm(resolvedRoot, { recursive: true, force: true });
}

function selectedCodexExecutable() {
  if (!process.env.AGENTRECEIPT_CODEX_PATH) {
    const applicationData = process.env.APPDATA;
    const target = process.arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc";
    if (process.platform !== "win32" || !applicationData || !["x64", "arm64"].includes(process.arch)) {
      throw new SafeFailure("codex_executable_unavailable");
    }
    return join(
      applicationData,
      "npm",
      "node_modules",
      "@openai",
      "codex",
      "node_modules",
      "@openai",
      `codex-win32-${process.arch}`,
      "vendor",
      target,
      "bin",
      "codex.exe",
    );
  }
  return process.env.AGENTRECEIPT_CODEX_PATH;
}

async function selectCodexExecutable() {
  const executable = selectedCodexExecutable();
  await access(executable);
  await requireSuccess(executable, ["--version"], {
    collectStdout: false,
    failureCode: "codex_executable_unavailable",
  });
  process.env.AGENTRECEIPT_CODEX_PATH = executable;
}

async function requireRepairPreflight() {
  const executable = selectedCodexExecutable();
  const version = await runProcess(executable, ["--version"], { collectStdout: true });
  const loginStatus = await runProcess(executable, ["login", "status"]);
  const execHelp = await runProcess(executable, ["exec", "--help"], { collectStdout: true });
  const versionMatch = !version.outputExceeded
    ? version.output.trim().match(/^codex-cli\s+([0-9A-Za-z.+-]+)$/u)
    : undefined;
  const versionAvailable = version.exitCode === 0 && versionMatch?.[1] !== undefined;
  if (!versionAvailable) throw new SafeFailure("codex_executable_unavailable");
  if (loginStatus.exitCode !== 0) throw new SafeFailure("login_not_ready");
  const requiredOptions = [
    "--json",
    "--ephemeral",
    "--sandbox",
    "--ignore-user-config",
    "--ignore-rules",
  ];
  if (
    execHelp.exitCode !== 0
    || execHelp.outputExceeded
    || requiredOptions.some((option) => !execHelp.output.includes(option))
  ) throw new SafeFailure("exec_surface_incompatible");
  process.env.AGENTRECEIPT_CODEX_PATH = executable;
  return { executable, codexCliVersion: versionMatch[1] };
}

function isSortedUniqueAllowed(values, allowed) {
  return Array.isArray(values)
    && values.every((value) => typeof value === "string" && allowed.has(value))
    && values.every((value, index) => index === 0 || values[index - 1] < value);
}

function validatePrivateDiagnostic(diagnostic) {
  if (
    !diagnostic
    || typeof diagnostic !== "object"
    || Array.isArray(diagnostic)
    || !isSortedUniqueAllowed(diagnostic.command_shapes, COMMAND_SHAPES)
    || !isSortedUniqueAllowed(diagnostic.ineligibility_reasons, INELIGIBILITY_REASONS)
    || !Number.isInteger(diagnostic.action_count)
    || diagnostic.action_count < 0
  ) throw new SafeFailure("private_diagnostic_invalid");
}

function eventShapeClassification(capture, projection) {
  if (capture.status === "failed") return "capture_failed";
  const { command_shapes: shapes, ineligibility_reasons: reasons } = projection.diagnostic;
  if (
    projection.structurally_eligible
    && shapes.length === 1
    && shapes[0] === "direct_allowlisted"
  ) return "eligible_direct";
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
  return "other_ineligible";
}

async function runEventShapeDiagnostic() {
  let liveAttempts = 0;
  let root;
  try {
    const { executable, codexCliVersion } = await requireRepairPreflight();
    root = await mkdtemp(join(tmpdir(), FIXTURE_PREFIX));
    const repository = join(root, "repository");
    await mkdir(repository);
    await git(repository, ["init"]);
    await git(repository, ["config", "user.email", "agentreceipt@example.invalid"]);
    await git(repository, ["config", "user.name", "AgentReceipt Measurement"]);
    await git(repository, ["branch", "-M", "main"]);
    await git(repository, ["remote", "add", "origin", "https://github.com/agentreceipt/phase4-measurement-fixture.git"]);
    await writeFile(join(repository, ".gitignore"), ".agentreceipt/\n", "utf8");
    await writeFile(join(repository, "input.txt"), FIXTURE_INPUT, "utf8");
    await git(repository, ["add", ".gitignore", "input.txt"]);
    await git(repository, ["commit", "-m", "harmless Phase 4 fixture"]);
    if (!await repositoryIsClean(repository)) throw new SafeFailure("repository_not_clean");

    liveAttempts += 1;
    const result = await runCodexCaptureWithPrivateProjection({
      cwd: repository,
      prompt: FIXED_PROMPT,
      sandbox: "read-only",
      executable,
      parameters: [{ name: "INPUT_FILE", sensitivity: "public", value: "input.txt" }],
    });
    validatePrivateDiagnostic(result.private_projection.diagnostic);
    if (typeof result.private_projection.structurally_eligible !== "boolean") {
      throw new SafeFailure("private_diagnostic_invalid");
    }
    if ((await readdir(repository)).includes(".agentreceipt")) {
      throw new SafeFailure("private_artifact_created");
    }
    if (!await repositoryIsClean(repository)) throw new SafeFailure("repository_mutated");

    process.stdout.write(`${JSON.stringify({
      schema: "agentreceipt-phase4-event-shape-diagnostic/v1",
      status: "completed",
      codex_cli_version: codexCliVersion,
      live_attempts: liveAttempts,
      public_capture: {
        status: result.capture.status,
        terminal_event_received: result.capture.terminal_event_received,
      },
      private_projection: {
        structurally_eligible: result.private_projection.structurally_eligible,
        action_count: result.private_projection.diagnostic.action_count,
        command_shapes: result.private_projection.diagnostic.command_shapes,
        ineligibility_reasons: result.private_projection.diagnostic.ineligibility_reasons,
      },
      classification: eventShapeClassification(result.capture, result.private_projection),
    }, null, 2)}\n`);
  } catch (error) {
    const code = error instanceof SafeFailure ? error.code : "internal_error";
    process.stdout.write(`${JSON.stringify({
      schema: "agentreceipt-phase4-event-shape-diagnostic/v1",
      status: "failed",
      codex_cli_version: "unavailable",
      live_attempts: liveAttempts,
      code,
    }, null, 2)}\n`);
    process.exitCode = 1;
  } finally {
    if (root) {
      try {
        await removeFixture(root);
      } catch {
        process.exitCode = 1;
      }
    }
  }
}

async function runCaptureDiagnostic() {
  const executable = selectedCodexExecutable();
  const version = await runProcess(executable, ["--version"], { collectStdout: true });
  const loginStatus = await runProcess(executable, ["login", "status"]);
  const execHelp = await runProcess(executable, ["exec", "--help"], { collectStdout: true });
  const versionMatch = !version.outputExceeded
    ? version.output.trim().match(/^codex-cli\s+([0-9A-Za-z.+-]+)$/u)
    : undefined;
  const codexCliVersion = versionMatch?.[1];
  const versionAvailable = version.exitCode === 0 && codexCliVersion !== undefined;
  const loginReady = loginStatus.exitCode === 0;
  const supportsJson = execHelp.exitCode === 0 && !execHelp.outputExceeded && execHelp.output.includes("--json");
  const supportsEphemeral = execHelp.exitCode === 0 && !execHelp.outputExceeded && execHelp.output.includes("--ephemeral");
  const supportsSandbox = execHelp.exitCode === 0 && !execHelp.outputExceeded && execHelp.output.includes("--sandbox");
  const execSurfaceCompatible = supportsJson && supportsEphemeral && supportsSandbox;
  const classification = !versionAvailable
    ? "executable_unavailable"
    : !loginReady
      ? "login_not_ready"
      : !execSurfaceCompatible
        ? "exec_surface_incompatible"
        : "unresolved";

  process.stdout.write(`${JSON.stringify({
    schema: "agentreceipt-phase4-capture-diagnostic/v1",
    status: "completed",
    diagnostic: "capture_preflight",
    codex_cli_version: codexCliVersion ?? "unavailable",
    checks: {
      version: {
        exit_code: version.exitCode,
        available: versionAvailable,
      },
      login_status: {
        exit_code: loginStatus.exitCode,
        ready: loginReady,
      },
      exec_help: {
        exit_code: execHelp.exitCode,
        supports_json: supportsJson,
        supports_ephemeral: supportsEphemeral,
        supports_sandbox: supportsSandbox,
      },
    },
    live_attempts: 0,
    classification,
  }, null, 2)}\n`);
}

async function main() {
  const mode = harnessMode(process.argv.slice(2));
  if (!mode) throw new SafeFailure("invalid_harness_arguments");
  if (mode === "diagnostic") {
    await runCaptureDiagnostic();
    return;
  }
  if (mode === "event_shape") {
    await runEventShapeDiagnostic();
    return;
  }

  let stage = "setup";
  let liveAttempts = 0;
  let root;
  try {
    if (mode === "repair") {
      stage = "preflight";
      verifyAgentReceiptStderrClassifier();
      await requireRepairPreflight();
    } else {
      await selectCodexExecutable();
    }
    root = await mkdtemp(join(tmpdir(), FIXTURE_PREFIX));
    const repository = join(root, "repository");
    await mkdir(repository);
    await git(repository, ["init"]);
    await git(repository, ["config", "user.email", "agentreceipt@example.invalid"]);
    await git(repository, ["config", "user.name", "AgentReceipt Measurement"]);
    await git(repository, ["branch", "-M", "main"]);
    await git(repository, ["remote", "add", "origin", "https://github.com/agentreceipt/phase4-measurement-fixture.git"]);
    await writeFile(join(repository, ".gitignore"), ".agentreceipt/\n", "utf8");
    await writeFile(join(repository, "input.txt"), FIXTURE_INPUT, "utf8");
    await git(repository, ["add", ".gitignore", "input.txt"]);
    await git(repository, ["commit", "-m", "harmless Phase 4 fixture"]);
    if (!await repositoryIsClean(repository)) throw new SafeFailure("repository_not_clean");

    const gitVersion = (await requireSuccess("git", ["--version"], {
      cwd: repository,
      collectStdout: true,
      failureCode: "git_version_unavailable",
    })).trim();

    stage = "live_capture";
    liveAttempts += 1;
    const sourceStarted = performance.now();
    const captureOutput = await runCli(repository, [
      "codex",
      "--title", "Phase 4 harmless live baseline",
      "--description", "One bounded read-only Codex baseline for AgentReceipt measurement.",
      "--prompt", FIXED_PROMPT,
      "--sandbox", "read-only",
      "--capsule",
      "--verify-file", "input.txt",
      "--param", "INPUT_FILE=input.txt",
    ], 180_000);
    const sourceCommandMs = Math.round(performance.now() - sourceStarted);
    const sourceReceiptPath = containedReceiptPath(repository, outputPath(captureOutput, "Receipt"));
    const capsulePath = privatePath(outputPath(captureOutput, "Private capsule"));
    const sourceReceipt = await publicReceipt(sourceReceiptPath);
    const sourceDigest = sourceReceipt.integrity?.content_digest;
    if (!SAFE_DIGEST.test(sourceDigest)) throw new SafeFailure("source_digest_invalid");
    if (sourceReceipt.capture?.surface !== "codex_exec_jsonl") throw new SafeFailure("source_surface_invalid");

    stage = "learn";
    const learnOutput = await runCli(repository, ["learn", capsulePath]);
    const recipePath = privatePath(outputPath(learnOutput, "Recipe"));
    const receiptDirectory = join(repository, ".agentreceipt", "receipts");
    const beforeDryRun = (await readdir(receiptDirectory)).length;

    stage = "dry_run";
    await runCli(repository, ["replay", recipePath, "--dry-run", "--param", "INPUT_FILE=input.txt"]);
    const afterDryRun = (await readdir(receiptDirectory)).length;
    if (afterDryRun !== beforeDryRun) throw new SafeFailure("dry_run_wrote_receipt");

    stage = "replay";
    process.env.AGENTRECEIPT_CODEX_PATH = join(root, "codex-must-not-run.exe");
    const replayStarted = performance.now();
    const replayOutput = await runCli(repository, ["replay", recipePath, "--param", "INPUT_FILE=input.txt"]);
    const replayCommandMs = Math.round(performance.now() - replayStarted);
    const replayReceiptPath = containedReceiptPath(repository, outputPath(replayOutput, "Receipt"));
    const replayReceipt = await publicReceipt(replayReceiptPath);
    const replayBinding = replayReceipt.extensions?.["dev.agentreceipt.recipe-replay"];
    if (
      replayReceipt.capture?.surface !== "agentreceipt_recipe_replay"
      || !replayBinding
      || !SAFE_DIGEST.test(replayBinding.recipe_digest)
      || replayBinding.source_receipt_content_digest !== sourceDigest
      || replayBinding.mode !== "executed"
    ) throw new SafeFailure("replay_binding_invalid");
    if (!await repositoryIsClean(repository)) throw new SafeFailure("replay_mutated_repository");

    stage = "report";
    const usage = numericUsage(sourceReceipt);
    const result = {
      schema: "agentreceipt-phase4-measurement/v1",
      status: "passed",
      live_attempts: liveAttempts,
      environment: {
        platform: process.platform,
        architecture: process.arch,
        node_version: process.version,
        git_version: gitVersion,
        codex_cli_version: sourceReceipt.agent?.version ?? "unavailable",
        agentreceipt_cli_version: "0.1.0",
      },
      preconditions: {
        local_disposable_repository: true,
        source_then_replay_order: true,
        cache_state: "uncontrolled_source_then_replay",
        repository_clean_before_and_after: true,
      },
      chain: {
        source_receipt_digest: sourceDigest,
        capsule_source_link_validated_by_learn: true,
        recipe_digest: replayBinding.recipe_digest,
        replay_source_link_matches: true,
        replay_receipt_schema_valid: true,
      },
      replay: {
        dry_run_receipt_count_unchanged: true,
        actual_replay_receipt_created: true,
        configured_codex_path_disabled_during_replay: true,
        model_invoked: false,
      },
      measurements: {
        boundary: "complete_agentreceipt_cli_command",
        source_wall_time_ms: sourceCommandMs,
        replay_wall_time_ms: replayCommandMs,
        source_usage_available: usage !== undefined,
        ...(usage ? { source_usage: usage } : {}),
        replay_usage: "unavailable_not_measured_as_zero",
      },
      limitations: [
        "One harmless read-only workflow in one disposable local repository.",
        "Source ran before replay; operating-system and Git cache effects were uncontrolled.",
        "Receipts are evidence for the declared surface, not proof of safety, correctness, or general determinism.",
      ],
    };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    const code = error instanceof SafeFailure ? error.code : "internal_error";
    process.stdout.write(`${JSON.stringify({
      schema: "agentreceipt-phase4-measurement/v1",
      status: "failed",
      stage,
      code,
      live_attempts: liveAttempts,
      comparison_available: false,
    }, null, 2)}\n`);
    process.exitCode = 1;
  } finally {
    if (root) {
      try {
        await removeFixture(root);
      } catch {
        process.exitCode = 1;
      }
    }
  }
}

await main();
