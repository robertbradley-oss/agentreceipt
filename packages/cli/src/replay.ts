import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

import { assertReceipt, type AgentReceipt } from "@agentreceipt/schema";

import { CliError } from "./errors.js";
import {
  controlledGitEnvironment,
  hashRepositoryFile,
  isTrackedRepositoryFile,
  readGitExecutableVersion,
  readRepository,
} from "./git.js";
import { sha256 } from "./json.js";
import { readPrivateJson } from "./private-artifacts.js";
import { type AgentRecipe, type StoredParameter, validateRecipe } from "./recipe.js";
import { writeCompletedReceipt } from "./storage.js";
import type { RepositorySnapshot } from "./types.js";

const PARAMETER_NAME = /^[A-Z][A-Z0-9_]{0,63}$/;
const PLACEHOLDER = /^\{\{param\.([A-Z][A-Z0-9_]{0,63})\}\}$/;
const SAFE_PATH = /^(?!-)(?!(?:\.git|\.agentreceipt|\.agents|\.codex-scope)(?:\/|$))(?!~)(?![A-Za-z]:)(?!.*(?:^|\/)\.{1,2}(?:\/|$))[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;
const CREDENTIAL_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}\b/,
  /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
];

export type ReplayErrorCode =
  | "parameter_missing"
  | "preflight_failed"
  | "repository_state_mismatch"
  | "unsupported_action"
  | "verification_failed"
  | "read_only_violation"
  | "internal_error";

export class ReplayError extends CliError {
  readonly code: ReplayErrorCode;

  constructor(code: ReplayErrorCode) {
    super(`Replay failed safely (${code}).`);
    this.name = "ReplayError";
    this.code = code;
  }
}

export interface ReplayOptions {
  cwd: string;
  recipePath: string;
  dryRun: boolean;
  parameters: Map<string, string>;
  environment: NodeJS.ProcessEnv;
  now?: () => Date;
  randomUUID?: () => string;
}

export interface ReplayResult {
  dryRun: boolean;
  stepCount: number;
  parameterNames: string[];
  receiptPath?: string;
  receipt?: AgentReceipt;
}

export interface ReplayDependencies {
  readRepository: typeof readRepository;
  hashRepositoryFile: typeof hashRepositoryFile;
  isTrackedRepositoryFile: typeof isTrackedRepositoryFile;
  readGitExecutableVersion: typeof readGitExecutableVersion;
  runDirectProcess: (
    executable: string,
    args: string[],
    cwd: string,
    environment: NodeJS.ProcessEnv,
  ) => Promise<number>;
  writeCompletedReceipt: typeof writeCompletedReceipt;
}

interface ReceiptEvent {
  id: string;
  sequence: number;
  timestamp: string;
  type: "session" | "command" | "file" | "git";
  outcome: "started" | "succeeded" | "failed" | "info";
  summary: string;
  duration_ms?: number;
  details: Record<string, unknown>;
}

function containsCredential(value: string): boolean {
  return CREDENTIAL_PATTERNS.some((pattern) => pattern.test(value));
}

function safePublicParameters(recipe: AgentRecipe, supplied: Map<string, string>): Map<string, string> {
  const publicParameters = recipe.parameters.filter(
    (parameter): parameter is Extract<StoredParameter, { sensitivity: "public" }> => parameter.sensitivity === "public",
  );
  const expected = new Set(publicParameters.map((parameter) => parameter.name));
  if (
    supplied.size !== expected.size
    || [...supplied.keys()].some((name) => !expected.has(name) || !PARAMETER_NAME.test(name))
    || [...supplied.values()].some((value) => value.length === 0 || value.length > 1024)
  ) throw new ReplayError("parameter_missing");
  if ([...supplied.values()].some(containsCredential)) throw new ReplayError("preflight_failed");
  return new Map(supplied);
}

function resolveValue(value: string, parameters: Map<string, string>): string {
  const name = value.match(PLACEHOLDER)?.[1];
  if (!name) return value;
  const resolved = parameters.get(name);
  if (resolved === undefined) throw new ReplayError("parameter_missing");
  return resolved;
}

function resolvePath(value: string, parameters: Map<string, string>): string {
  const path = resolveValue(value, parameters);
  if (containsCredential(path) || !SAFE_PATH.test(path)) throw new ReplayError("preflight_failed");
  return path;
}

function assertSecretNames(recipe: AgentRecipe, environment: NodeJS.ProcessEnv): void {
  for (const parameter of recipe.parameters) {
    if (parameter.sensitivity !== "secret") continue;
    if (!Object.hasOwn(environment, parameter.source_environment)) throw new ReplayError("parameter_missing");
    if (
      parameter.source_environment !== parameter.target_environment
      && Object.hasOwn(environment, parameter.target_environment)
    ) throw new ReplayError("preflight_failed");
  }
}

function controlledEnvironment(
  recipe: AgentRecipe,
  environment: NodeJS.ProcessEnv,
  requiredNames: string[],
): NodeJS.ProcessEnv {
  const controlled = controlledGitEnvironment(environment);
  const secretParameters = recipe.parameters.filter(
    (parameter): parameter is Extract<StoredParameter, { sensitivity: "secret" }> => parameter.sensitivity === "secret",
  );
  for (const targetName of requiredNames) {
    const declaration = secretParameters.find((parameter) => parameter.target_environment === targetName);
    if (!declaration) throw new ReplayError("unsupported_action");
    const value = environment[declaration.source_environment];
    if (value === undefined || value.length === 0) throw new ReplayError("parameter_missing");
    controlled[targetName] = value;
  }
  return controlled;
}

async function runDirectProcess(
  executable: string,
  args: string[],
  cwd: string,
  environment: NodeJS.ProcessEnv,
): Promise<number> {
  const child = spawn(executable, args, {
    cwd,
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: environment,
  });
  child.stdout?.on("data", () => undefined);
  child.stderr?.on("data", () => undefined);
  return new Promise<number>((resolveExit) => {
    child.once("close", (code) => resolveExit(code ?? 1));
    child.once("error", () => resolveExit(1));
  });
}

function receiptEvent(event: ReceiptEvent): ReceiptEvent & { evidence_digest: `sha256:${string}` } {
  return { ...event, evidence_digest: sha256(event) };
}

function createReplayReceipt(options: {
  recipe: AgentRecipe;
  receiptId: string;
  sessionId: string;
  startedAt: Date;
  endedAt: Date;
  repositoryBefore: RepositorySnapshot;
  repositoryAfter: RepositorySnapshot;
  processExitCodes: number[];
  processDurations: number[];
  verificationPassed: boolean;
  readOnlyViolation: boolean;
}): AgentReceipt {
  const failed = options.processExitCodes.some((code) => code !== 0)
    || !options.verificationPassed
    || options.readOnlyViolation;
  const timestamp = (date: Date) => date.toISOString();
  const events: ReceiptEvent[] = [{
    id: "evt_replay_000000",
    sequence: 0,
    timestamp: timestamp(options.startedAt),
    type: "session",
    outcome: "started",
    summary: "Guarded AgentReceipt recipe replay started.",
    details: { phase: "start", source_event: "adapter", time_basis: "adapter_observed" },
  }];
  options.processExitCodes.forEach((exitCode, index) => {
    events.push({
      id: `evt_replay_${String(events.length).padStart(6, "0")}`,
      sequence: events.length,
      timestamp: timestamp(options.endedAt),
      type: "command",
      outcome: exitCode === 0 ? "succeeded" : "failed",
      summary: "A guarded direct read-only recipe process completed; arguments and output were discarded.",
      duration_ms: options.processDurations[index] ?? 0,
      details: {
        command: "<redacted deterministic read-only process>",
        exit_code: exitCode,
        source_event: "adapter",
        time_basis: "adapter_observed",
      },
    });
  });
  const verificationEventId = `evt_replay_${String(events.length).padStart(6, "0")}`;
  events.push({
    id: verificationEventId,
    sequence: events.length,
    timestamp: timestamp(options.endedAt),
    type: "file",
    outcome: options.verificationPassed ? "succeeded" : "failed",
    summary: "The declared repository file assertion was checked independently.",
    details: {
      file_path: "<redacted-repository-relative-path>",
      file_action: "read",
      source_event: "verification",
      time_basis: "adapter_observed",
    },
  });
  const gitEventId = `evt_replay_${String(events.length).padStart(6, "0")}`;
  events.push({
    id: gitEventId,
    sequence: events.length,
    timestamp: timestamp(options.endedAt),
    type: "git",
    outcome: options.readOnlyViolation ? "failed" : "info",
    summary: options.readOnlyViolation
      ? "Independent repository inspection detected a read-only policy violation."
      : "Independent repository inspection found no replay mutation.",
    details: {
      git_action: "status",
      commit_sha: options.repositoryAfter.headSha,
      source_event: "git",
      time_basis: "adapter_observed",
    },
  });
  events.push({
    id: `evt_replay_${String(events.length).padStart(6, "0")}`,
    sequence: events.length,
    timestamp: timestamp(options.endedAt),
    type: "session",
    outcome: failed ? "failed" : "succeeded",
    summary: "Guarded AgentReceipt recipe replay finished.",
    details: { phase: "finish", source_event: "adapter", time_basis: "adapter_observed" },
  });

  const receiptWithoutIntegrity = {
    schema_version: "0.1",
    receipt_id: options.receiptId,
    created_at: timestamp(options.endedAt),
    task: {
      title: "Replay a learned local recipe",
      description: "Execute one explicitly selected deterministic read-only AgentReceipt recipe.",
      source: "automation",
    },
    session: {
      id: options.sessionId,
      started_at: timestamp(options.startedAt),
      ended_at: timestamp(options.endedAt),
      status: failed ? "failed" : "completed",
    },
    agent: { name: "AgentReceipt Replay", version: "0.1.0" },
    repository: {
      provider: "github",
      owner: options.repositoryBefore.owner,
      name: options.repositoryBefore.name,
      branch: options.repositoryAfter.branch,
      binding_status: "draft",
      capture_start_sha: options.repositoryBefore.headSha,
      capture_end_sha: options.repositoryAfter.headSha,
    },
    capture: {
      adapter: "agentreceipt-replay",
      adapter_version: "0.1.0",
      source: "direct_observation",
      surface: "agentreceipt_recipe_replay",
      status: failed ? "failed" : "complete_for_declared_surface",
      capabilities: ["lifecycle", "commands", "files", "git"],
      observed_capabilities: ["lifecycle", "commands", "files", "git"],
      unavailable_capabilities: [
        "host activity outside the AgentReceipt-owned recipe runner",
        "general shell, network, interactive, random, clock-dependent, and write-capable actions",
      ],
      record_counts: {
        parsed: options.processExitCodes.length + 1,
        discarded_sensitive: options.processExitCodes.length,
        unknown: 0,
        malformed: 0,
      },
      terminal_event_received: true,
      limitations: [...options.recipe.limitations],
    },
    privacy: {
      capture_level: "metadata",
      raw_content_included: false,
      redactions: options.processExitCodes.length > 0
        ? [{ category: "command_argument", count: options.processExitCodes.length }]
        : [],
    },
    events: events.map(receiptEvent),
    files: [],
    verification: {
      status: options.verificationPassed && !options.readOnlyViolation ? "passed" : "failed",
      tests: { passed: 0, failed: 0, skipped: 0 },
      checks: [
        {
          name: "Declared read-only file assertion",
          status: options.verificationPassed ? "passed" : "failed",
          event_id: verificationEventId,
        },
        {
          name: "Read-only repository state",
          status: options.readOnlyViolation ? "failed" : "passed",
          event_id: gitEventId,
        },
      ],
    },
    extensions: {
      "dev.agentreceipt.recipe-replay": {
        recipe_digest: options.recipe.integrity.content_digest,
        source_receipt_content_digest: options.recipe.source.source_receipt_content_digest,
        mode: "executed",
      },
    },
  };
  const receipt = {
    ...receiptWithoutIntegrity,
    integrity: {
      algorithm: "sha256",
      canonicalization: "RFC8785",
      content_digest: sha256(receiptWithoutIntegrity),
    },
  };
  assertReceipt(receipt);
  return receipt;
}

export async function replayRecipe(
  options: ReplayOptions,
  overrides: Partial<ReplayDependencies> = {},
): Promise<ReplayResult> {
  const now = options.now ?? (() => new Date());
  const uuid = options.randomUUID ?? randomUUID;
  const dependencies: ReplayDependencies = {
    readRepository,
    hashRepositoryFile,
    isTrackedRepositoryFile,
    readGitExecutableVersion,
    runDirectProcess,
    writeCompletedReceipt,
    ...overrides,
  };
  const repository = await dependencies.readRepository(options.cwd);
  if (!repository.isClean) throw new ReplayError("repository_state_mismatch");
  const rawRecipe = await readPrivateJson(repository.root, options.recipePath, "recipe");
  validateRecipe(rawRecipe);
  const recipe = rawRecipe;
  if (
    recipe.repository.owner.toLowerCase() !== repository.owner.toLowerCase()
    || recipe.repository.name.toLowerCase() !== repository.name.toLowerCase()
  ) throw new ReplayError("repository_state_mismatch");

  const parameters = safePublicParameters(recipe, options.parameters);
  assertSecretNames(recipe, options.environment);
  const expectedVersion = recipe.preconditions.required_programs[0]?.version;
  if (!expectedVersion || await dependencies.readGitExecutableVersion(repository.root) !== expectedVersion) {
    throw new ReplayError("preflight_failed");
  }
  for (const file of recipe.preconditions.required_files) {
    const path = resolvePath(file.path, parameters);
    if (
      !await dependencies.isTrackedRepositoryFile(repository.root, path)
      || await dependencies.hashRepositoryFile(repository.root, path).catch(() => undefined) !== file.digest
    ) {
      throw new ReplayError("preflight_failed");
    }
  }
  const resolvedSteps = recipe.steps.map((step) => {
    const args = step.arguments.map((argument) => resolveValue(argument, parameters));
    if (
      step.executable !== "git"
      || args.length !== 3
      || args[0] !== "hash-object"
      || args[1] !== "--no-filters"
      || !SAFE_PATH.test(args[2] ?? "")
      || step.environment_names.length !== 0
    ) throw new ReplayError("unsupported_action");
    return { step, args };
  });

  if (options.dryRun) {
    return {
      dryRun: true,
      stepCount: resolvedSteps.length,
      parameterNames: recipe.parameters.map((parameter) => parameter.name).sort(),
    };
  }

  for (const parameter of recipe.parameters) {
    if (parameter.sensitivity === "secret") {
      const value = options.environment[parameter.source_environment];
      if (value === undefined || value.length === 0) throw new ReplayError("parameter_missing");
    }
  }

  const startedAt = now();
  const processExitCodes: number[] = [];
  const processDurations: number[] = [];
  for (const { step, args } of resolvedSteps) {
    const processStarted = now();
    const exitCode = await dependencies.runDirectProcess(
      process.env.AGENTRECEIPT_GIT_PATH ?? step.executable,
      args,
      repository.root,
      controlledEnvironment(recipe, options.environment, step.environment_names),
    ).catch(() => 1);
    processExitCodes.push(exitCode);
    processDurations.push(Math.max(0, now().getTime() - processStarted.getTime()));
    if (exitCode !== step.expected_exit_code) break;
  }

  let verificationPassed = false;
  if (processExitCodes.length === resolvedSteps.length && processExitCodes.every((code) => code === 0)) {
    const verificationPath = resolvePath(recipe.verification.path, parameters);
    verificationPassed = await dependencies.hashRepositoryFile(repository.root, verificationPath).catch(() => undefined)
      === recipe.verification.digest;
  }
  const repositoryAfter = await dependencies.readRepository(repository.root).catch(() => ({
    ...repository,
    isClean: false,
  }));
  const readOnlyViolation = !repositoryAfter.isClean
    || repositoryAfter.headSha !== repository.headSha
    || repositoryAfter.branch !== repository.branch
    || repositoryAfter.owner.toLowerCase() !== repository.owner.toLowerCase()
    || repositoryAfter.name.toLowerCase() !== repository.name.toLowerCase();
  const endedAt = now();
  const receiptId = uuid();
  let receipt: AgentReceipt;
  try {
    receipt = createReplayReceipt({
      recipe,
      receiptId,
      sessionId: uuid(),
      startedAt,
      endedAt,
      repositoryBefore: repository,
      repositoryAfter,
      processExitCodes,
      processDurations,
      verificationPassed,
      readOnlyViolation,
    });
  } catch {
    throw new ReplayError("internal_error");
  }
  const receiptPath = await dependencies.writeCompletedReceipt(repository.root, receiptId, receipt).catch(() => {
    throw new ReplayError("internal_error");
  });
  return {
    dryRun: false,
    stepCount: resolvedSteps.length,
    parameterNames: recipe.parameters.map((parameter) => parameter.name).sort(),
    receiptPath,
    receipt,
  };
}
