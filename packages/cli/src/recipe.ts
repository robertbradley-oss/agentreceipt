import type { CodexCaptureResult, CodexPrivateProjection } from "@agentreceipt/codex-adapter";

import { CliError } from "./errors.js";
import { sha256OmittingIntegrity } from "./json.js";
import type { RepositorySnapshot, VerificationResult } from "./types.js";

const DIGEST = /^sha256:[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PARAMETER_NAME = /^[A-Z][A-Z0-9_]{0,63}$/;
const PLACEHOLDER = /^\{\{param\.([A-Z][A-Z0-9_]{0,63})\}\}$/;
const SAFE_PATH = /^(?!-)(?!(?:\.git|\.agentreceipt|\.agents|\.codex-scope)(?:\/|$))(?!~)(?![A-Za-z]:)(?!.*(?:^|\/)\.{1,2}(?:\/|$))[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;
const CREDENTIAL_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}\b/,
  /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
];

export type RecipeErrorCode =
  | "capsule_ineligible"
  | "capsule_invalid"
  | "capsule_integrity_mismatch"
  | "recipe_invalid"
  | "recipe_integrity_mismatch"
  | "secret_material_detected";

export class RecipeError extends CliError {
  readonly code: RecipeErrorCode;

  constructor(code: RecipeErrorCode) {
    super(`Observe, learn, or replay input failed safely (${code}).`);
    this.name = "RecipeError";
    this.code = code;
  }
}

export type StoredParameter =
  | { name: string; sensitivity: "public" }
  | {
      name: string;
      sensitivity: "secret";
      source_environment: string;
      target_environment: string;
    };

export interface FileDigest {
  path: string;
  digest: `sha256:${string}`;
}

export interface CapsuleProcessAction {
  sequence: number;
  kind: "process";
  cwd: ".";
  executable: "git";
  executable_version: string;
  arguments: string[];
  environment_names: string[];
  file_inputs: FileDigest[];
  read_only: true;
  classifier_version: "0.1";
  expected_exit_code: 0;
  observed_exit_code: number;
  duration_ms: number;
}

export interface CapsuleVerificationAction {
  sequence: number;
  kind: "verification";
  verification_kind: "file_assertion";
  path: string;
  digest: `sha256:${string}`;
  read_only: true;
  classifier_version: "0.1";
  expected_exit_code: 0;
  observed_exit_code: number;
  duration_ms: number;
}

export interface PrivateCapsule extends Record<string, unknown> {
  capsule_version: "0.1";
  capsule_id: string;
  created_at: string;
  source_receipt_content_digest: `sha256:${string}`;
  repository: {
    provider: "github";
    owner: string;
    name: string;
    object_format: "sha1" | "sha256";
    capture_start_sha: string;
    capture_end_sha: string;
    clean_before: true;
    clean_after: true;
  };
  capture: {
    surface: "codex_exec_jsonl";
    status: "complete_for_declared_surface";
    terminal_event_received: true;
    codex_cli_version: string;
    adapter_version: "0.1.0";
    record_counts: CodexCaptureResult["record_counts"];
    limitations: string[];
  };
  parameters: StoredParameter[];
  actions: Array<CapsuleProcessAction | CapsuleVerificationAction>;
  measurements: {
    elapsed_ms: number;
    usage?: CodexCaptureResult["usage"];
  };
  integrity: {
    algorithm: "sha256";
    canonicalization: "RFC8785";
    content_digest: `sha256:${string}`;
  };
}

export interface RecipeStep {
  sequence: number;
  kind: "process";
  cwd: ".";
  executable: "git";
  arguments: string[];
  environment_names: string[];
  read_only: true;
  classifier_version: "0.1";
  expected_exit_code: 0;
}

export interface AgentRecipe extends Record<string, unknown> {
  recipe_version: "0.1";
  recipe_id: string;
  created_at: string;
  source: {
    source_receipt_content_digest: `sha256:${string}`;
    private_capsule_digest: `sha256:${string}`;
  };
  repository: { provider: "github"; owner: string; name: string };
  parameters: StoredParameter[];
  preconditions: {
    clean_worktree: true;
    required_programs: Array<{ executable: "git"; version: string }>;
    required_files: FileDigest[];
    declared_environment_names: string[];
  };
  steps: RecipeStep[];
  verification: {
    kind: "file_assertion";
    path: string;
    digest: `sha256:${string}`;
  };
  limitations: string[];
  integrity: {
    algorithm: "sha256";
    canonicalization: "RFC8785";
    content_digest: `sha256:${string}`;
  };
}

interface CreateCapsuleOptions {
  capsuleId: string;
  createdAt: Date;
  elapsedMs: number;
  sourceReceiptContentDigest: `sha256:${string}`;
  repositoryBefore: RepositorySnapshot;
  repositoryAfter: RepositorySnapshot;
  capture: CodexCaptureResult;
  projection: CodexPrivateProjection;
  executableVersion: string;
  fileDigests: Map<string, `sha256:${string}`>;
  verification: VerificationResult & { path: string; digest: `sha256:${string}` };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === [...expected].sort()[index]);
}

function nonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function validTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const timestamp = new Date(value);
  return Number.isFinite(timestamp.getTime()) && timestamp.toISOString() === value;
}

function validUsage(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const allowed = new Set([
    "input_tokens", "cached_input_tokens", "cache_write_input_tokens", "output_tokens", "reasoning_output_tokens",
  ]);
  return Object.keys(value).length > 0
    && Object.keys(value).every((key) => allowed.has(key))
    && Object.values(value).every((entry) => nonnegativeInteger(entry));
}

function containsCredential(value: unknown): boolean {
  const pending: unknown[] = [value];
  let visited = 0;
  while (pending.length > 0) {
    const entry = pending.pop();
    visited += 1;
    if (visited > 100_000) return true;
    if (typeof entry === "string" && CREDENTIAL_PATTERNS.some((pattern) => pattern.test(entry))) return true;
    if (Array.isArray(entry)) pending.push(...entry);
    else if (isRecord(entry)) pending.push(...Object.values(entry));
  }
  return false;
}

function validParameter(parameter: unknown): parameter is StoredParameter {
  if (!isRecord(parameter) || !PARAMETER_NAME.test(String(parameter.name ?? ""))) return false;
  if (parameter.sensitivity === "public") {
    return exactKeys(parameter, ["name", "sensitivity"]);
  }
  return parameter.sensitivity === "secret"
    && PARAMETER_NAME.test(String(parameter.source_environment ?? ""))
    && PARAMETER_NAME.test(String(parameter.target_environment ?? ""))
    && exactKeys(parameter, ["name", "sensitivity", "source_environment", "target_environment"]);
}

function validFileDigest(value: unknown): value is FileDigest {
  return isRecord(value)
    && exactKeys(value, ["path", "digest"])
    && typeof value.path === "string"
    && (SAFE_PATH.test(value.path) || PLACEHOLDER.test(value.path))
    && typeof value.digest === "string"
    && DIGEST.test(value.digest);
}

function validArguments(argumentsValue: unknown, parameters: StoredParameter[]): argumentsValue is string[] {
  if (!Array.isArray(argumentsValue) || argumentsValue.length !== 3) return false;
  if (argumentsValue[0] !== "hash-object" || argumentsValue[1] !== "--no-filters") return false;
  const fileArgument = argumentsValue[2];
  if (typeof fileArgument !== "string") return false;
  const placeholder = fileArgument.match(PLACEHOLDER)?.[1];
  return placeholder
    ? parameters.some((parameter) => parameter.name === placeholder && parameter.sensitivity === "public")
    : SAFE_PATH.test(fileArgument);
}

function assertIntegrity(value: Record<string, unknown>, code: RecipeErrorCode): void {
  const integrity = value.integrity;
  if (
    !isRecord(integrity)
    || !exactKeys(integrity, ["algorithm", "canonicalization", "content_digest"])
    || integrity.algorithm !== "sha256"
    || integrity.canonicalization !== "RFC8785"
    || typeof integrity.content_digest !== "string"
    || !DIGEST.test(integrity.content_digest)
    || sha256OmittingIntegrity(value) !== integrity.content_digest
  ) {
    throw new RecipeError(code);
  }
}

export function createPrivateCapsule(options: CreateCapsuleOptions): PrivateCapsule {
  const capture = options.capture;
  if (
    !UUID.test(options.capsuleId)
    || !DIGEST.test(options.sourceReceiptContentDigest)
    || capture.status !== "complete_for_declared_surface"
    || capture.process_exit_code !== 0
    || !capture.terminal_event_received
    || capture.record_counts.unknown !== 0
    || capture.record_counts.malformed !== 0
    || !capture.cli_version
    || !options.projection.structurally_eligible
    || options.projection.secret_material_detected
    || options.repositoryBefore.isClean !== true
    || options.repositoryAfter.isClean !== true
    || options.repositoryBefore.headSha !== options.repositoryAfter.headSha
    || options.repositoryBefore.branch !== options.repositoryAfter.branch
    || options.repositoryBefore.owner.toLowerCase() !== options.repositoryAfter.owner.toLowerCase()
    || options.repositoryBefore.name.toLowerCase() !== options.repositoryAfter.name.toLowerCase()
    || options.verification.exitCode !== 0
  ) {
    throw new RecipeError(options.projection.secret_material_detected
      ? "secret_material_detected"
      : "capsule_ineligible");
  }

  const actions: Array<CapsuleProcessAction | CapsuleVerificationAction> = options.projection.actions.map((action) => {
    const fileInputs = action.file_paths.map((path) => {
      const digest = options.fileDigests.get(path);
      if (!digest) throw new RecipeError("capsule_ineligible");
      return { path, digest };
    });
    return {
      sequence: action.sequence,
      kind: "process" as const,
      cwd: "." as const,
      executable: "git" as const,
      executable_version: options.executableVersion,
      arguments: [...action.arguments],
      environment_names: [...action.environment_names],
      file_inputs: fileInputs,
      read_only: true as const,
      classifier_version: "0.1" as const,
      expected_exit_code: 0 as const,
      observed_exit_code: action.observed_exit_code,
      duration_ms: action.duration_ms,
    };
  });
  actions.push({
    sequence: actions.length,
    kind: "verification",
    verification_kind: "file_assertion",
    path: options.verification.path,
    digest: options.verification.digest,
    read_only: true,
    classifier_version: "0.1",
    expected_exit_code: 0,
    observed_exit_code: options.verification.exitCode,
    duration_ms: options.verification.durationMs,
  });

  const withoutIntegrity = {
    capsule_version: "0.1" as const,
    capsule_id: options.capsuleId,
    created_at: options.createdAt.toISOString(),
    source_receipt_content_digest: options.sourceReceiptContentDigest,
    repository: {
      provider: "github" as const,
      owner: options.repositoryBefore.owner,
      name: options.repositoryBefore.name,
      object_format: options.repositoryBefore.headSha.length === 64 ? "sha256" as const : "sha1" as const,
      capture_start_sha: options.repositoryBefore.headSha,
      capture_end_sha: options.repositoryAfter.headSha,
      clean_before: true as const,
      clean_after: true as const,
    },
    capture: {
      surface: "codex_exec_jsonl" as const,
      status: "complete_for_declared_surface" as const,
      terminal_event_received: true as const,
      codex_cli_version: capture.cli_version,
      adapter_version: "0.1.0" as const,
      record_counts: { ...capture.record_counts },
      limitations: [...capture.limitations],
    },
    parameters: options.projection.parameters.map((parameter) => ({ ...parameter })),
    actions,
    measurements: {
      elapsed_ms: Math.max(0, options.elapsedMs),
      ...(capture.usage ? { usage: { ...capture.usage } } : {}),
    },
  };
  const capsule = {
    ...withoutIntegrity,
    integrity: {
      algorithm: "sha256" as const,
      canonicalization: "RFC8785" as const,
      content_digest: sha256OmittingIntegrity(withoutIntegrity),
    },
  } as PrivateCapsule;
  validatePrivateCapsule(capsule);
  return capsule;
}

export function validatePrivateCapsule(value: unknown): asserts value is PrivateCapsule {
  if (!isRecord(value) || containsCredential(value)) {
    throw new RecipeError(containsCredential(value) ? "secret_material_detected" : "capsule_invalid");
  }
  if (!exactKeys(value, [
    "capsule_version", "capsule_id", "created_at", "source_receipt_content_digest", "repository",
    "capture", "parameters", "actions", "measurements", "integrity",
  ])) throw new RecipeError("capsule_invalid");
  if (
    value.capsule_version !== "0.1"
    || typeof value.capsule_id !== "string" || !UUID.test(value.capsule_id)
    || !validTimestamp(value.created_at)
    || typeof value.source_receipt_content_digest !== "string" || !DIGEST.test(value.source_receipt_content_digest)
    || !Array.isArray(value.parameters) || !value.parameters.every(validParameter)
    || !Array.isArray(value.actions) || value.actions.length < 2
  ) throw new RecipeError("capsule_invalid");
  const parameters = value.parameters as StoredParameter[];
  if (new Set(parameters.map((parameter) => parameter.name)).size !== parameters.length) {
    throw new RecipeError("capsule_invalid");
  }
  const repository = value.repository;
  const capture = value.capture;
  const measurements = value.measurements;
  if (
    !isRecord(repository)
    || !exactKeys(repository, [
      "provider", "owner", "name", "object_format", "capture_start_sha", "capture_end_sha", "clean_before", "clean_after",
    ])
    || repository.provider !== "github"
    || typeof repository.owner !== "string" || repository.owner.length < 1 || repository.owner.length > 100
    || typeof repository.name !== "string" || repository.name.length < 1 || repository.name.length > 100
    || (repository.object_format !== "sha1" && repository.object_format !== "sha256")
    || typeof repository.capture_start_sha !== "string" || typeof repository.capture_end_sha !== "string"
    || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(repository.capture_start_sha)
    || repository.capture_start_sha !== repository.capture_end_sha
    || repository.capture_start_sha.length !== (repository.object_format === "sha256" ? 64 : 40)
    || repository.clean_before !== true || repository.clean_after !== true
    || !isRecord(capture)
    || !exactKeys(capture, [
      "surface", "status", "terminal_event_received", "codex_cli_version", "adapter_version", "record_counts", "limitations",
    ])
    || capture.surface !== "codex_exec_jsonl" || capture.status !== "complete_for_declared_surface"
    || capture.terminal_event_received !== true
    || typeof capture.codex_cli_version !== "string"
    || !/^[0-9A-Za-z.+-]{1,100}$/.test(capture.codex_cli_version)
    || capture.adapter_version !== "0.1.0"
    || !isRecord(capture.record_counts)
    || !exactKeys(capture.record_counts, ["parsed", "discarded_sensitive", "unknown", "malformed"])
    || !Object.values(capture.record_counts).every(nonnegativeInteger)
    || capture.record_counts.unknown !== 0 || capture.record_counts.malformed !== 0
    || !Array.isArray(capture.limitations)
    || !capture.limitations.every((entry) => typeof entry === "string" && entry.length > 0 && entry.length <= 500)
    || !isRecord(measurements)
    || !(exactKeys(measurements, ["elapsed_ms"]) || exactKeys(measurements, ["elapsed_ms", "usage"]))
    || !nonnegativeInteger(measurements.elapsed_ms)
    || (measurements.usage !== undefined && !validUsage(measurements.usage))
  ) throw new RecipeError("capsule_invalid");
  const secretParameters = parameters
    .filter((parameter): parameter is Extract<StoredParameter, { sensitivity: "secret" }> => parameter.sensitivity === "secret");
  const secretSources = new Set(secretParameters.map((parameter) => parameter.source_environment));
  const secretTargets = new Set(secretParameters.map((parameter) => parameter.target_environment));
  if (secretSources.size !== secretParameters.length || secretTargets.size !== secretParameters.length) {
    throw new RecipeError("capsule_invalid");
  }
  const actions = value.actions;
  const usedPublicParameters = new Set<string>();
  const usedSecretTargets = new Set<string>();
  const executableVersions = new Set<string>();
  const parameterPathBindings = new Map<string, string>();
  const observedFileDigests = new Map<string, string>();
  actions.forEach((action, index) => {
    if (!isRecord(action) || action.sequence !== index || action.read_only !== true || action.classifier_version !== "0.1") {
      throw new RecipeError("capsule_invalid");
    }
    if (action.kind === "process") {
      if (
        index === actions.length - 1
        || !exactKeys(action, [
          "sequence", "kind", "cwd", "executable", "executable_version", "arguments", "environment_names",
          "file_inputs", "read_only", "classifier_version", "expected_exit_code", "observed_exit_code", "duration_ms",
        ])
        || action.cwd !== "." || action.executable !== "git"
        || typeof action.executable_version !== "string"
        || !/^git version [0-9A-Za-z.+() -]{1,80}$/.test(action.executable_version)
        || !validArguments(action.arguments, parameters)
        || !Array.isArray(action.environment_names)
        || action.environment_names.length !== 0
        || !action.environment_names.every((name) => typeof name === "string" && secretTargets.has(name))
        || new Set(action.environment_names).size !== action.environment_names.length
        || !Array.isArray(action.file_inputs) || action.file_inputs.length !== 1
        || !action.file_inputs.every((entry) => validFileDigest(entry) && SAFE_PATH.test(entry.path))
        || action.expected_exit_code !== 0 || action.observed_exit_code !== 0
        || !Number.isInteger(action.duration_ms) || (action.duration_ms as number) < 0
      ) throw new RecipeError("capsule_invalid");
      const placeholder = (action.arguments as string[])[2]?.match(PLACEHOLDER)?.[1];
      const fileInput = (action.file_inputs as FileDigest[])[0]!;
      if (placeholder) {
        usedPublicParameters.add(placeholder);
        const existingPath = parameterPathBindings.get(placeholder);
        if (existingPath !== undefined && existingPath !== fileInput.path) {
          throw new RecipeError("capsule_invalid");
        }
        parameterPathBindings.set(placeholder, fileInput.path);
      } else if ((action.arguments as string[])[2] !== fileInput.path) {
        throw new RecipeError("capsule_invalid");
      }
      const existingDigest = observedFileDigests.get(fileInput.path);
      if (existingDigest !== undefined && existingDigest !== fileInput.digest) {
        throw new RecipeError("capsule_invalid");
      }
      observedFileDigests.set(fileInput.path, fileInput.digest);
      executableVersions.add(action.executable_version as string);
      for (const name of action.environment_names as string[]) usedSecretTargets.add(name);
      return;
    }
    if (
      index !== actions.length - 1
      || action.kind !== "verification"
      || !exactKeys(action, [
        "sequence", "kind", "verification_kind", "path", "digest", "read_only", "classifier_version",
        "expected_exit_code", "observed_exit_code", "duration_ms",
      ])
      || action.verification_kind !== "file_assertion"
      || typeof action.path !== "string" || !SAFE_PATH.test(action.path)
      || typeof action.digest !== "string" || !DIGEST.test(action.digest)
      || action.expected_exit_code !== 0 || action.observed_exit_code !== 0
      || !Number.isInteger(action.duration_ms) || (action.duration_ms as number) < 0
    ) throw new RecipeError("capsule_invalid");
  });
  const last = actions.at(-1);
  const verificationPath = isRecord(last) && typeof last.path === "string" ? last.path : undefined;
  const verificationDigest = isRecord(last) && typeof last.digest === "string" ? last.digest : undefined;
  if (
    !isRecord(last)
    || last.kind !== "verification"
    || executableVersions.size !== 1
    || (
      verificationPath !== undefined
      && observedFileDigests.has(verificationPath)
      && observedFileDigests.get(verificationPath) !== verificationDigest
    )
    || parameters.some((parameter) => (
      parameter.sensitivity === "public"
        ? !usedPublicParameters.has(parameter.name)
        : !usedSecretTargets.has(parameter.target_environment)
    ))
  ) throw new RecipeError("capsule_invalid");
  assertIntegrity(value, "capsule_integrity_mismatch");
}

export function createRecipe(
  capsule: PrivateCapsule,
  recipeId: string,
  createdAt: Date,
): AgentRecipe {
  validatePrivateCapsule(capsule);
  if (!UUID.test(recipeId)) throw new RecipeError("recipe_invalid");
  const processes = capsule.actions.filter((action): action is CapsuleProcessAction => action.kind === "process");
  const verification = capsule.actions.at(-1) as CapsuleVerificationAction;
  const requiredFiles = new Map<string, FileDigest>();
  const parameterizedPaths = new Map<string, string>();
  for (const process of processes) {
    const fileArgument = process.arguments[2];
    for (const file of process.file_inputs) {
      const path = typeof fileArgument === "string" && PLACEHOLDER.test(fileArgument)
        ? fileArgument
        : file.path;
      parameterizedPaths.set(file.path, path);
      requiredFiles.set(path, { path, digest: file.digest });
    }
  }
  const verificationPath = parameterizedPaths.get(verification.path) ?? verification.path;
  requiredFiles.set(verificationPath, { path: verificationPath, digest: verification.digest });
  const withoutIntegrity = {
    recipe_version: "0.1" as const,
    recipe_id: recipeId,
    created_at: createdAt.toISOString(),
    source: {
      source_receipt_content_digest: capsule.source_receipt_content_digest,
      private_capsule_digest: capsule.integrity.content_digest,
    },
    repository: {
      provider: capsule.repository.provider,
      owner: capsule.repository.owner,
      name: capsule.repository.name,
    },
    parameters: capsule.parameters.map((parameter) => ({ ...parameter })),
    preconditions: {
      clean_worktree: true as const,
      required_programs: [...new Map(processes.map((process) => [
        process.executable,
        { executable: process.executable, version: process.executable_version },
      ])).values()],
      required_files: [...requiredFiles.values()].sort((left, right) => left.path.localeCompare(right.path)),
      declared_environment_names: capsule.parameters
        .filter((parameter): parameter is Extract<StoredParameter, { sensitivity: "secret" }> => parameter.sensitivity === "secret")
        .map((parameter) => parameter.source_environment)
        .sort(),
    },
    steps: processes.map((process, sequence) => ({
      sequence,
      kind: "process" as const,
      cwd: "." as const,
      executable: "git" as const,
      arguments: [...process.arguments],
      environment_names: [...process.environment_names],
      read_only: true as const,
      classifier_version: "0.1" as const,
      expected_exit_code: 0 as const,
    })),
    verification: {
      kind: "file_assertion" as const,
      path: verificationPath,
      digest: verification.digest,
    },
    limitations: [
      "Replay is limited to the versioned fixture read-only direct-process and file-assertion surface.",
      "A matching digest is internal consistency evidence, not proof of safety, correctness, or general determinism.",
      "Replay invokes no model and makes no speed or token-benefit claim.",
    ],
  };
  const recipe = {
    ...withoutIntegrity,
    integrity: {
      algorithm: "sha256" as const,
      canonicalization: "RFC8785" as const,
      content_digest: sha256OmittingIntegrity(withoutIntegrity),
    },
  } as AgentRecipe;
  validateRecipe(recipe);
  return recipe;
}

export function validateRecipe(value: unknown): asserts value is AgentRecipe {
  if (!isRecord(value) || containsCredential(value)) {
    throw new RecipeError(containsCredential(value) ? "secret_material_detected" : "recipe_invalid");
  }
  if (!exactKeys(value, [
    "recipe_version", "recipe_id", "created_at", "source", "repository", "parameters", "preconditions",
    "steps", "verification", "limitations", "integrity",
  ])) throw new RecipeError("recipe_invalid");
  if (
    value.recipe_version !== "0.1"
    || typeof value.recipe_id !== "string" || !UUID.test(value.recipe_id)
    || !validTimestamp(value.created_at)
    || !Array.isArray(value.parameters) || !value.parameters.every(validParameter)
    || !Array.isArray(value.steps) || value.steps.length < 1
    || !Array.isArray(value.limitations)
    || value.limitations.length < 1
    || value.limitations.length > 20
    || !value.limitations.every((entry) => typeof entry === "string" && entry.length > 0 && entry.length <= 500)
  ) throw new RecipeError("recipe_invalid");
  const parameters = value.parameters as StoredParameter[];
  if (new Set(parameters.map((parameter) => parameter.name)).size !== parameters.length) {
    throw new RecipeError("recipe_invalid");
  }
  const secretParameters = parameters.filter(
    (parameter): parameter is Extract<StoredParameter, { sensitivity: "secret" }> => parameter.sensitivity === "secret",
  );
  const secretSources = secretParameters.map((parameter) => parameter.source_environment).sort();
  const secretTargets = new Set(secretParameters.map((parameter) => parameter.target_environment));
  const publicParameterNames = new Set(parameters
    .filter((parameter) => parameter.sensitivity === "public")
    .map((parameter) => parameter.name));
  if (
    new Set(secretSources).size !== secretSources.length
    || secretTargets.size !== secretParameters.length
  ) throw new RecipeError("recipe_invalid");
  if (
    !isRecord(value.source)
    || !exactKeys(value.source, ["source_receipt_content_digest", "private_capsule_digest"])
    || typeof value.source.source_receipt_content_digest !== "string" || !DIGEST.test(value.source.source_receipt_content_digest)
    || typeof value.source.private_capsule_digest !== "string" || !DIGEST.test(value.source.private_capsule_digest)
    || !isRecord(value.repository)
    || !exactKeys(value.repository, ["provider", "owner", "name"])
    || value.repository.provider !== "github"
    || typeof value.repository.owner !== "string" || value.repository.owner.length < 1 || value.repository.owner.length > 100
    || typeof value.repository.name !== "string" || value.repository.name.length < 1 || value.repository.name.length > 100
  ) throw new RecipeError("recipe_invalid");
  if (!isRecord(value.preconditions) || !exactKeys(value.preconditions, [
    "clean_worktree", "required_programs", "required_files", "declared_environment_names",
  ])) throw new RecipeError("recipe_invalid");
  const preconditions = value.preconditions;
  if (!Array.isArray(preconditions.required_programs) || preconditions.required_programs.length !== 1) {
    throw new RecipeError("recipe_invalid");
  }
  const requiredProgram = preconditions.required_programs[0];
  if (
    preconditions.clean_worktree !== true
    || !isRecord(requiredProgram)
    || !exactKeys(requiredProgram, ["executable", "version"])
    || requiredProgram.executable !== "git"
    || typeof requiredProgram.version !== "string"
    || !/^git version [0-9A-Za-z.+() -]{1,80}$/.test(requiredProgram.version)
    || !Array.isArray(preconditions.required_files) || preconditions.required_files.length < 1 || !preconditions.required_files.every(validFileDigest)
    || !Array.isArray(preconditions.declared_environment_names)
    || !preconditions.declared_environment_names.every((name) => typeof name === "string" && PARAMETER_NAME.test(name))
    || JSON.stringify([...preconditions.declared_environment_names].sort()) !== JSON.stringify(secretSources)
  ) throw new RecipeError("recipe_invalid");
  const requiredFiles = preconditions.required_files as FileDigest[];
  if (
    new Set(requiredFiles.map((file) => file.path)).size !== requiredFiles.length
    || requiredFiles.some((file) => {
      const placeholder = file.path.match(PLACEHOLDER)?.[1];
      return placeholder !== undefined && !publicParameterNames.has(placeholder);
    })
  ) throw new RecipeError("recipe_invalid");
  const usedPublicParameters = new Set<string>();
  const usedSecretTargets = new Set<string>();
  (value.steps as unknown[]).forEach((step, index) => {
    if (
      !isRecord(step)
      || !exactKeys(step, [
        "sequence", "kind", "cwd", "executable", "arguments", "environment_names", "read_only",
        "classifier_version", "expected_exit_code",
      ])
      || step.sequence !== index || step.kind !== "process" || step.cwd !== "." || step.executable !== "git"
      || !validArguments(step.arguments, parameters)
      || !Array.isArray(step.environment_names)
      || step.environment_names.length !== 0
      || !step.environment_names.every((name) => typeof name === "string" && secretTargets.has(name))
      || new Set(step.environment_names).size !== step.environment_names.length
      || !requiredFiles.some((file) => file.path === (step.arguments as string[])[2])
      || step.read_only !== true || step.classifier_version !== "0.1" || step.expected_exit_code !== 0
    ) throw new RecipeError("recipe_invalid");
    const placeholder = (step.arguments as string[])[2]?.match(PLACEHOLDER)?.[1];
    if (placeholder) usedPublicParameters.add(placeholder);
    for (const name of step.environment_names as string[]) usedSecretTargets.add(name);
  });
  if (parameters.some((parameter) => (
    parameter.sensitivity === "public"
      ? !usedPublicParameters.has(parameter.name)
      : !usedSecretTargets.has(parameter.target_environment)
  ))) throw new RecipeError("recipe_invalid");
  const verification = value.verification;
  if (
    !isRecord(verification)
    || !exactKeys(verification, ["kind", "path", "digest"])
    || verification.kind !== "file_assertion"
    || typeof verification.path !== "string"
    || !(SAFE_PATH.test(verification.path) || PLACEHOLDER.test(verification.path))
    || typeof verification.digest !== "string" || !DIGEST.test(verification.digest)
    || !requiredFiles.some((file) => file.path === verification.path && file.digest === verification.digest)
  ) throw new RecipeError("recipe_invalid");
  assertIntegrity(value, "recipe_integrity_mismatch");
}
