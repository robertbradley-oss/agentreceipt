import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import {
  runCodexCapture,
  runCodexCaptureWithPrivateProjection,
  type CodexParameterInput,
} from "@agentreceipt/codex-adapter";
import { assertReceipt, type AgentReceipt } from "@agentreceipt/schema";

import { parseArguments, rejectUnknownOptions, stringOption, stringOptions } from "./args.js";
import { createCodexReceipt } from "./codex.js";
import { CliError } from "./errors.js";
import { FinalizationError, finalizeReceipt, shouldWarnForAcceptedPartial } from "./finalize.js";
import { formatReceipt } from "./format.js";
import {
  hashRepositoryFile,
  isTrackedRepositoryFile,
  readGitExecutableVersion,
  readRepository,
  readRepositoryChanges,
} from "./git.js";
import { listPrivateJson, readPrivateJson, sourceReceiptDigestExists, writePrivateJson } from "./private-artifacts.js";
import { createPrivateCapsule, createRecipe, RecipeError, validatePrivateCapsule } from "./recipe.js";
import { replayRecipe } from "./replay.js";
import { createRunbackRelease, planLocalRunback } from "./runback.js";
import {
  classifyPrivateCapture,
  type SafeCaptureDiagnosticClassification,
} from "./safe-capture-diagnostic.js";
import { createSimulatedReceipt } from "./simulation.js";
import {
  createActiveSession,
  findStoreRoot,
  finishActiveSession,
  hasLatestReceipt,
  readActiveSession,
  readLatestReceipt,
  readReceiptFile,
  writeCompletedReceipt,
} from "./storage.js";
import type { ActiveSession, CliDependencies } from "./types.js";
import { runVerification } from "./verification.js";

const helpText = `AgentReceipt CLI

Usage:
  agentreceipt start --title <title> [--description <text>]
  agentreceipt finish [--result pass|fail] [--file <relative-path>] [--tests <count>]
  agentreceipt codex --title <title> --prompt <text> [--description <text>] [--sandbox read-only|workspace-write] [--verify <command>]
  agentreceipt codex --title <title> --prompt <text> --capsule --verify-file <path> [--param NAME=VALUE] [--secret-env NAME=SOURCE:TARGET]
  agentreceipt learn <capsule-path>
  agentreceipt replay <recipe-path> [--dry-run] [--param NAME=VALUE]
  agentreceipt runback <request.json> [--param NAME=VALUE]
  agentreceipt finalize --input <draft.json> --output <finalized.json> [--allow-partial]
  agentreceipt inspect [receipt.json] [--json]

Commands:
  start    Begin a simulated recording in the current Git repository.
  finish   Generate and validate a simulated receipt, then archive the session.
  codex    Run one wrapped Codex exec JSONL session and create a privacy-safe receipt.
  learn    Convert one eligible private capsule into a canonical local recipe.
  replay   Preflight or execute one guarded deterministic read-only recipe.
  runback  Build a component-level rail from all private local evidence releases.
  finalize Bind a committed draft receipt to the checked-out GitHub event head.
  inspect  Show the active session or the latest completed receipt.

The start/finish workflow remains simulated. The codex command requires a clean Git worktree,
discards prompts, messages, reasoning, commands, and command output before persistence, and
never claims capture beyond the wrapped Codex JSONL surface.
`;

function defaultDependencies(): CliDependencies {
  return {
    cwd: process.cwd(),
    environment: process.env,
    now: () => new Date(),
    randomUUID,
    readRepository,
    readRepositoryChanges,
    runCodexCapture,
    runCodexCaptureWithPrivateProjection,
    runVerification,
  };
}

function withDependencies(overrides: Partial<CliDependencies>): CliDependencies {
  return { ...defaultDependencies(), ...overrides };
}

function reportSafeCaptureDiagnostic(
  dependencies: CliDependencies,
  classification: SafeCaptureDiagnosticClassification,
): void {
  try {
    const pending = dependencies.onSafeCaptureDiagnostic?.(classification);
    if (pending && typeof pending.catch === "function") void pending.catch(() => undefined);
  } catch {
    // Diagnostics are observational and must never alter CLI execution.
  }
}

const PARAMETER_NAME = /^[A-Z][A-Z0-9_]{0,63}$/;
const SAFE_CAPTURE_FILE = /^(?!-)(?!(?:\.git|\.agentreceipt|\.agents|\.codex-scope)(?:\/|$))(?!~)(?![A-Za-z]:)(?!.*(?:^|\/)\.{1,2}(?:\/|$))[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;

function booleanOption(parsed: ReturnType<typeof parseArguments>, name: string): boolean {
  const value = parsed.options.get(name);
  if (value === undefined) return false;
  if (value !== true) throw new CliError(`--${name} does not accept a value.`, 2);
  return true;
}

function publicParameterInputs(values: string[]): CodexParameterInput[] {
  const seen = new Set<string>();
  return values.map((value) => {
    const equals = value.indexOf("=");
    const name = value.slice(0, equals);
    const parameterValue = value.slice(equals + 1);
    if (
      equals < 1 || !PARAMETER_NAME.test(name) || !parameterValue
      || parameterValue.length > 1024 || seen.has(name)
    ) throw new CliError("Invalid public parameter declaration.", 2);
    seen.add(name);
    return { name, sensitivity: "public" as const, value: parameterValue };
  });
}

function secretParameterInputs(
  values: string[],
  environment: NodeJS.ProcessEnv,
  occupied: Set<string>,
): CodexParameterInput[] {
  const sourceNames = new Set<string>();
  const targetNames = new Set<string>();
  return values.map((value) => {
    const equals = value.indexOf("=");
    const name = value.slice(0, equals);
    const [sourceEnvironment, targetEnvironment, extra] = value.slice(equals + 1).split(":");
    const secretValue = sourceEnvironment ? environment[sourceEnvironment] : undefined;
    if (
      equals < 1 || !PARAMETER_NAME.test(name) || occupied.has(name)
      || !sourceEnvironment || !targetEnvironment || extra !== undefined
      || !PARAMETER_NAME.test(sourceEnvironment) || !PARAMETER_NAME.test(targetEnvironment)
      || sourceNames.has(sourceEnvironment) || targetNames.has(targetEnvironment)
      || !secretValue
      || (sourceEnvironment !== targetEnvironment && Object.hasOwn(environment, targetEnvironment))
    ) throw new CliError("Invalid secret environment declaration.", 2);
    occupied.add(name);
    sourceNames.add(sourceEnvironment);
    targetNames.add(targetEnvironment);
    return {
      name,
      sensitivity: "secret" as const,
      value: secretValue,
      source_environment: sourceEnvironment,
      target_environment: targetEnvironment,
    };
  });
}

function replayParameters(values: string[]): Map<string, string> {
  const parameters = new Map<string, string>();
  for (const value of values) {
    const equals = value.indexOf("=");
    const name = value.slice(0, equals);
    const parameterValue = value.slice(equals + 1);
    if (equals < 1 || !PARAMETER_NAME.test(name) || !parameterValue || parameters.has(name)) {
      throw new CliError("Invalid replay parameter.", 2);
    }
    parameters.set(name, parameterValue);
  }
  return parameters;
}

function requireNoPositionals(positionals: string[], command: string): void {
  if (positionals.length > 0) {
    throw new CliError(`${command} does not accept positional arguments.`, 2);
  }
}

async function startCommand(
  parsed: ReturnType<typeof parseArguments>,
  dependencies: CliDependencies,
): Promise<string> {
  rejectUnknownOptions(parsed, ["title", "description"]);
  requireNoPositionals(parsed.positionals, "start");
  const title = stringOption(parsed, "title", { required: true })!;
  const description = stringOption(parsed, "description", { fallback: title })!;

  if (title.length > 160) {
    throw new CliError("--title must be 160 characters or fewer.", 2);
  }

  const repository = await dependencies.readRepository(dependencies.cwd);
  const startedAt = dependencies.now().toISOString();
  const session: ActiveSession = {
    state_version: "0.1",
    simulation: true,
    receipt_id: dependencies.randomUUID(),
    session_id: dependencies.randomUUID(),
    started_at: startedAt,
    task: { title, description },
    repository: {
      owner: repository.owner,
      name: repository.name,
      branch: repository.branch,
      capture_start_sha: repository.headSha,
    },
    limitations: [
      "This session uses generated events and is not connected to Codex.",
      ...repository.limitations,
    ],
  };

  await createActiveSession(repository.root, session);
  return [
    "Started a simulated AgentReceipt recording.",
    `Task: ${title}`,
    `Session: ${session.session_id}`,
    "Run `agentreceipt finish` to generate the receipt.",
    "",
  ].join("\n");
}

function parseTestCount(value: string | undefined): number {
  const parsed = Number(value ?? "12");
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100000) {
    throw new CliError("--tests must be an integer between 1 and 100000.", 2);
  }
  return parsed;
}

async function finishCommand(
  parsed: ReturnType<typeof parseArguments>,
  dependencies: CliDependencies,
): Promise<string> {
  rejectUnknownOptions(parsed, ["result", "file", "tests"]);
  requireNoPositionals(parsed.positionals, "finish");
  const result = stringOption(parsed, "result", { fallback: "pass" });
  const filePath = stringOption(parsed, "file", { fallback: "src/simulated-change.ts" })!;
  const testCount = parseTestCount(stringOption(parsed, "tests"));

  if (result !== "pass" && result !== "fail") {
    throw new CliError("--result must be either pass or fail.", 2);
  }

  const root = await findStoreRoot(dependencies.cwd);
  const session = await readActiveSession(root);
  const repository = await dependencies.readRepository(root);
  const receipt = createSimulatedReceipt(session, repository, {
    endedAt: dependencies.now(),
    filePath,
    result,
    testCount,
  });
  const receiptPath = await finishActiveSession(root, session, receipt);

  return [
    "Finished the simulated AgentReceipt recording.",
    `Result: ${result}`,
    `Receipt: ${receiptPath}`,
    "Run `agentreceipt inspect` to view the summary.",
    "",
  ].join("\n");
}

async function codexCommand(
  parsed: ReturnType<typeof parseArguments>,
  dependencies: CliDependencies,
): Promise<string> {
  rejectUnknownOptions(parsed, [
    "title", "description", "prompt", "sandbox", "verify", "capsule", "verify-file", "param", "secret-env",
  ]);
  requireNoPositionals(parsed.positionals, "codex");
  const title = stringOption(parsed, "title", { required: true })!;
  const description = stringOption(parsed, "description", { fallback: title })!;
  const prompt = stringOption(parsed, "prompt", { required: true })!;
  const sandbox = stringOption(parsed, "sandbox", { fallback: "read-only" })!;
  const verificationCommand = stringOption(parsed, "verify");
  const capsuleEnabled = booleanOption(parsed, "capsule");
  const verificationFile = stringOption(parsed, "verify-file");
  const publicInputs = publicParameterInputs(stringOptions(parsed, "param"));
  const parameterNames = new Set(publicInputs.map((parameter) => parameter.name));
  const secretInputs = secretParameterInputs(
    stringOptions(parsed, "secret-env"),
    dependencies.environment,
    parameterNames,
  );
  const parameterInputs = [...publicInputs, ...secretInputs];

  if (title.length > 160) {
    throw new CliError("--title must be 160 characters or fewer.", 2);
  }
  if (description.length > 4000) {
    throw new CliError("--description must be 4000 characters or fewer.", 2);
  }
  if (prompt.length > 32000) {
    throw new CliError("--prompt must be 32000 characters or fewer.", 2);
  }
  if (sandbox !== "read-only" && sandbox !== "workspace-write") {
    throw new CliError("--sandbox must be either read-only or workspace-write.", 2);
  }
  if (capsuleEnabled && (
    sandbox !== "read-only" || !verificationFile || verificationCommand
    || !SAFE_CAPTURE_FILE.test(verificationFile)
  )) {
    throw new CliError("Private capsule capture requires read-only sandboxing and a safe --verify-file without --verify.", 2);
  }
  if (!capsuleEnabled && (verificationFile || parameterInputs.length > 0)) {
    throw new CliError("Capsule parameters and --verify-file require --capsule.", 2);
  }

  const repositoryBefore = await dependencies.readRepository(dependencies.cwd);
  if (repositoryBefore.isClean === false) {
    throw new CliError(
      "The codex command requires a clean Git worktree so changes can be attributed honestly. Commit or stash existing work first.",
    );
  }

  const startedAt = dependencies.now();
  const privateRun = capsuleEnabled
    ? await dependencies.runCodexCaptureWithPrivateProjection({
        cwd: repositoryBefore.root,
        prompt,
        sandbox: "read-only",
        now: dependencies.now,
        parameters: parameterInputs,
      })
    : undefined;
  const privateCaptureClassification = privateRun
    ? classifyPrivateCapture(privateRun.capture, privateRun.private_projection)
    : undefined;
  const capture = privateRun?.capture ?? await dependencies.runCodexCapture({
    cwd: repositoryBefore.root,
    prompt,
    sandbox,
    now: dependencies.now,
  });
  let verification = verificationCommand
    ? await dependencies.runVerification(verificationCommand, repositoryBefore.root, dependencies.now)
    : undefined;
  let verificationFileDigest: `sha256:${string}` | undefined;
  if (verificationFile) {
    const verificationStarted = dependencies.now();
    verificationFileDigest = await hashRepositoryFile(repositoryBefore.root, verificationFile);
    const verificationEnded = dependencies.now();
    verification = {
      startedAt: verificationStarted.toISOString(),
      endedAt: verificationEnded.toISOString(),
      durationMs: Math.max(0, verificationEnded.getTime() - verificationStarted.getTime()),
      exitCode: 0,
    };
  }

  const gitLimitations: string[] = [];
  let repositoryAfter = repositoryBefore;
  try {
    repositoryAfter = await dependencies.readRepository(repositoryBefore.root);
  } catch {
    gitLimitations.push("The final Git repository state could not be read; the starting state was retained.");
  }

  let changes: Awaited<ReturnType<CliDependencies["readRepositoryChanges"]>> = [];
  try {
    changes = await dependencies.readRepositoryChanges(repositoryBefore.root, repositoryBefore.headSha);
  } catch {
    gitLimitations.push("The changed-file summary could not be collected independently.");
  }

  const endedAt = dependencies.now();
  const receiptId = dependencies.randomUUID();
  const receipt = createCodexReceipt({
    receiptId,
    sessionId: dependencies.randomUUID(),
    title,
    description,
    startedAt,
    endedAt,
    repositoryBefore,
    repositoryAfter,
    changes,
    capture,
    ...(verification ? { verification } : {}),
    additionalLimitations: gitLimitations,
  });
  const receiptPath = await writeCompletedReceipt(repositoryBefore.root, receiptId, receipt);
  let capsulePath: string | undefined;
  if (capsuleEnabled && privateRun) {
    try {
      if (gitLimitations.length > 0 || !verification || !verificationFile || !verificationFileDigest) {
        throw new RecipeError("capsule_ineligible");
      }
      const fileDigests = new Map<string, `sha256:${string}`>();
      for (const action of privateRun.private_projection.actions) {
        for (const filePath of action.file_paths) {
          if (!fileDigests.has(filePath)) {
            if (!await isTrackedRepositoryFile(repositoryBefore.root, filePath)) {
              throw new RecipeError("capsule_ineligible");
            }
            fileDigests.set(filePath, await hashRepositoryFile(repositoryBefore.root, filePath));
          }
        }
      }
      if (!await isTrackedRepositoryFile(repositoryBefore.root, verificationFile)) {
        throw new RecipeError("capsule_ineligible");
      }
      const capsuleRepositoryAfter = await dependencies.readRepository(repositoryBefore.root).catch(() => {
        throw new RecipeError("capsule_ineligible");
      });
      const capsuleId = dependencies.randomUUID();
      const receiptDigest = (receipt as unknown as {
        integrity: { content_digest: `sha256:${string}` };
      }).integrity.content_digest;
      const capsule = createPrivateCapsule({
        capsuleId,
        createdAt: endedAt,
        elapsedMs: Math.max(0, endedAt.getTime() - startedAt.getTime()),
        sourceReceiptContentDigest: receiptDigest,
        repositoryBefore,
        repositoryAfter: capsuleRepositoryAfter,
        capture,
        projection: privateRun.private_projection,
        executableVersion: await readGitExecutableVersion(repositoryBefore.root),
        fileDigests,
        verification: {
          ...verification,
          path: verificationFile,
          digest: verificationFileDigest,
        },
      });
      capsulePath = `.agentreceipt/private/capsules/${capsuleId}.json`;
      await writePrivateJson(repositoryBefore.root, capsulePath, "capsule", capsule);
      reportSafeCaptureDiagnostic(
        dependencies,
        privateCaptureClassification === "invalid_private_diagnostic"
          ? privateCaptureClassification
          : "capsule_created",
      );
    } catch (error) {
      if (error instanceof RecipeError) {
        const classification = error.code === "secret_material_detected"
          ? "secret_material"
          : privateCaptureClassification === "projection_eligible"
            ? "post_capture_ineligible"
            : privateCaptureClassification ?? "post_capture_ineligible";
        reportSafeCaptureDiagnostic(dependencies, classification);
      }
      throw error;
    }
  }
  const view = receipt as unknown as { capture: { status: string } };

  return [
    "Captured a wrapped Codex AgentReceipt.",
    `Capture: ${view.capture.status.replaceAll("_", " ")}`,
    `Receipt: ${receiptPath}`,
    ...(capsulePath ? [`Private capsule: ${capsulePath}`] : []),
    "Run `agentreceipt inspect` to view the evidence and limitations.",
    "",
  ].join("\n");
}

async function learnCommand(
  parsed: ReturnType<typeof parseArguments>,
  dependencies: CliDependencies,
): Promise<string> {
  rejectUnknownOptions(parsed, []);
  if (parsed.positionals.length !== 1) throw new CliError("learn requires one capsule path.", 2);
  const repository = await dependencies.readRepository(dependencies.cwd);
  if (!repository.isClean) throw new CliError("Learning requires a clean Git worktree.");
  const capsulePath = parsed.positionals[0]!;
  const value = await readPrivateJson(repository.root, capsulePath, "capsule");
  validatePrivateCapsule(value);
  if (
    value.repository.owner.toLowerCase() !== repository.owner.toLowerCase()
    || value.repository.name.toLowerCase() !== repository.name.toLowerCase()
  ) throw new CliError("Capsule repository binding does not match.");
  if (!await sourceReceiptDigestExists(repository.root, value.source_receipt_content_digest, value.repository)) {
    throw new CliError("Capsule source receipt linkage could not be verified.");
  }
  const recipeId = dependencies.randomUUID();
  const recipe = createRecipe(value, recipeId, dependencies.now());
  const recipePath = `.agentreceipt/recipes/${recipeId}.json`;
  const release = createRunbackRelease(value, recipe);
  const releasePath = `.agentreceipt/private/runback/releases/${recipeId}.json`;
  await writePrivateJson(repository.root, releasePath, "runback_release", release);
  await writePrivateJson(repository.root, recipePath, "recipe", recipe);
  return [
    "Learned one local AgentReceipt recipe.",
    `Recipe: ${recipePath}`,
    `Component release: ${releasePath}`,
    "Review the recipe before replay.",
    "",
  ].join("\n");
}

async function runbackCommand(
  parsed: ReturnType<typeof parseArguments>,
  dependencies: CliDependencies,
): Promise<string> {
  rejectUnknownOptions(parsed, ["param"]);
  if (parsed.positionals.length !== 1) throw new CliError("runback requires one request path.", 2);
  const parameters = replayParameters(stringOptions(parsed, "param"));
  const repository = await dependencies.readRepository(dependencies.cwd);
  const result = await planLocalRunback({
    root: repository.root,
    requestPath: parsed.positionals[0]!,
    parameters: Object.fromEntries(parameters),
    now: dependencies.now,
  });
  const covered = result.plan.rail.length;
  const total = covered + result.plan.gaps.length;
  const steps = result.plan.rail.map((step) => [
    `${step.position}. ${step.function}: need ${step.needId}`,
    `   Tool: ${step.tool}; score: ${step.score.toFixed(4)}; parameters: ${Object.keys(step.parameters).sort().join(", ") || "none"}`,
  ].join("\n"));
  const gaps = result.plan.gaps.map((gap) => [
    `Gap: ${gap.need.id} (${gap.reason})`,
    ...(gap.missingParameters?.length ? [`   Missing parameters: ${gap.missingParameters.join(", ")}`] : []),
  ].join("\n"));
  return [
    `Runback preflight: ${result.plan.status}`,
    `Coverage: ${covered}/${total}`,
    `Local component releases: ${result.releaseCount}`,
    ...steps,
    ...gaps,
    "No tools were executed and no execution authority was granted.",
    "",
  ].join("\n");
}

async function replayCommand(
  parsed: ReturnType<typeof parseArguments>,
  dependencies: CliDependencies,
): Promise<string> {
  rejectUnknownOptions(parsed, ["dry-run", "param"]);
  if (parsed.positionals.length !== 1) throw new CliError("replay requires one recipe path.", 2);
  const result = await replayRecipe({
    cwd: dependencies.cwd,
    recipePath: parsed.positionals[0]!,
    dryRun: booleanOption(parsed, "dry-run"),
    parameters: replayParameters(stringOptions(parsed, "param")),
    environment: dependencies.environment,
    now: dependencies.now,
    randomUUID: dependencies.randomUUID,
  });
  if (result.dryRun) {
    return [
      "Replay dry run passed without executing actions.",
      `Read-only steps: ${result.stepCount}`,
      `Parameters: ${result.parameterNames.length}`,
      "",
    ].join("\n");
  }
  return [
    "Executed one guarded read-only AgentReceipt replay.",
    `Receipt: ${result.receiptPath}`,
    "",
  ].join("\n");
}

async function finalizeCommand(
  parsed: ReturnType<typeof parseArguments>,
  dependencies: CliDependencies,
): Promise<string> {
  let inputPath: string;
  let outputPath: string;
  let allowPartialOption: string | true | Array<string | true> | undefined;
  try {
    rejectUnknownOptions(parsed, ["input", "output", "allow-partial"]);
    requireNoPositionals(parsed.positionals, "finalize");
    inputPath = stringOption(parsed, "input", { required: true })!;
    outputPath = stringOption(parsed, "output", { required: true })!;
    allowPartialOption = parsed.options.get("allow-partial");
    if (allowPartialOption !== undefined && allowPartialOption !== true) {
      throw new CliError("Invalid boolean option.", 2);
    }
  } catch {
    throw new FinalizationError("invalid_input");
  }

  const result = await finalizeReceipt({
    cwd: dependencies.cwd,
    inputPath,
    outputPath,
    allowPartial: allowPartialOption === true,
    environment: dependencies.environment,
    now: dependencies.now,
  });

  return [
    "Finalized AgentReceipt successfully.",
    `Output: ${result.outputPath}`,
    ...(shouldWarnForAcceptedPartial(result.receipt, allowPartialOption === true)
      ? ["Warning: partial capture was explicitly accepted."]
      : []),
    "",
  ].join("\n");
}

function formatActiveSession(session: ActiveSession): string {
  return [
    "SIMULATED RECORDING ACTIVE",
    "==========================",
    `Task:    ${session.task.title}`,
    `Session: ${session.session_id}`,
    `Started: ${session.started_at}`,
    "",
    "Run `agentreceipt finish` to generate a simulated receipt.",
    "",
  ].join("\n");
}

async function inspectCommand(
  parsed: ReturnType<typeof parseArguments>,
  dependencies: CliDependencies,
): Promise<string> {
  rejectUnknownOptions(parsed, ["json"]);
  if (parsed.positionals.length > 1) {
    throw new CliError("inspect accepts at most one receipt path.", 2);
  }
  const jsonOption = parsed.options.get("json");
  if (jsonOption !== undefined && jsonOption !== true) {
    throw new CliError("--json does not accept a value.", 2);
  }

  let value: unknown;
  if (parsed.positionals[0]) {
    value = await readReceiptFile(resolve(dependencies.cwd, parsed.positionals[0]));
  } else {
    const root = await findStoreRoot(dependencies.cwd);
    if (!(await hasLatestReceipt(root))) {
      return formatActiveSession(await readActiveSession(root));
    }
    value = await readLatestReceipt(root);
  }

  assertReceipt(value);
  return jsonOption === true
    ? `${JSON.stringify(value, null, 2)}\n`
    : formatReceipt(value as AgentReceipt);
}

export async function executeCli(
  args: string[],
  overrides: Partial<CliDependencies> = {},
): Promise<string> {
  let parsed: ReturnType<typeof parseArguments>;
  try {
    parsed = parseArguments(args);
  } catch (error) {
    if (args[0] === "finalize") throw new FinalizationError("invalid_input");
    throw error;
  }
  const dependencies = withDependencies(overrides);

  switch (parsed.command) {
    case undefined:
    case "help":
    case "--help":
    case "-h":
      return helpText;
    case "start":
      return startCommand(parsed, dependencies);
    case "finish":
      return finishCommand(parsed, dependencies);
    case "codex":
      return codexCommand(parsed, dependencies);
    case "learn":
      return learnCommand(parsed, dependencies);
    case "replay":
      return replayCommand(parsed, dependencies);
    case "runback":
      return runbackCommand(parsed, dependencies);
    case "finalize":
      return finalizeCommand(parsed, dependencies);
    case "inspect":
      return inspectCommand(parsed, dependencies);
    default:
      throw new CliError(`Unknown command: ${parsed.command}\n\n${helpText}`, 2);
  }
}

export { CliError } from "./errors.js";
export { FinalizationError, finalizeReceipt } from "./finalize.js";
export type { FinalizationErrorCode, FinalizeReceiptOptions, FinalizeReceiptResult } from "./finalize.js";
export { readRepository, readRepositoryChanges } from "./git.js";
export { runVerification } from "./verification.js";
export { replayRecipe, ReplayError } from "./replay.js";
export { createRunbackRelease, planLocalRunback } from "./runback.js";
export {
  classifyPrivateCapture,
  isSafeCaptureDiagnosticClassification,
  SAFE_CAPTURE_DIAGNOSTIC_CLASSIFICATIONS,
} from "./safe-capture-diagnostic.js";
export type { SafeCaptureDiagnosticClassification } from "./safe-capture-diagnostic.js";
export {
  createPrivateCapsule,
  createRecipe,
  RecipeError,
  validatePrivateCapsule,
  validateRecipe,
} from "./recipe.js";
export {
  PrivateArtifactError,
  readPrivateJson,
  listPrivateJson,
  sourceReceiptDigestExists,
  writePrivateJson,
} from "./private-artifacts.js";
export type {
  CliDependencies,
  RepositoryFileChange,
  RepositorySnapshot,
  VerificationResult,
} from "./types.js";
