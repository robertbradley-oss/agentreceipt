import { createHash } from "node:crypto";
import { open, lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import {
  ComponentCatalog,
  PreflightPlanner,
  type CatalogSnapshot,
  type RailPlan,
  type RunRequest,
  type StructuredIntent,
  type TraceSubmission,
} from "@agentreceipt/runback";

import { CliError } from "./errors.js";
import { listPrivateJson } from "./private-artifacts.js";
import {
  type AgentRecipe,
  type PrivateCapsule,
  validatePrivateCapsule,
  validateRecipe,
} from "./recipe.js";

const MAX_REQUEST_BYTES = 64 * 1024;
const PLACEHOLDER = /^\{\{param\.([A-Z][A-Z0-9_]{0,63})\}\}$/;
const SAFE_REQUEST_PATH = /^(?!-)(?!(?:\.git|\.agentreceipt|\.agents|\.codex-scope)(?:\/|$))(?!~)(?![A-Za-z]:)(?!.*(?:^|\/)\.{1,2}(?:\/|$))[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;
const FUNCTIONS = new Set(["observe", "transform", "act", "verify", "recover"]);
const RISKS = new Set(["none", "read", "reversible_write", "destructive_write"]);

interface LocalRunbackRequest {
  schemaVersion: 1;
  intent: StructuredIntent;
  initialArtifacts: string[];
  allowedScopes: string[];
}

export interface LocalRunbackResult {
  releaseCount: number;
  plan: RailPlan;
}

function pathIsWithin(parent: string, candidate: string): boolean {
  const child = relative(parent, candidate);
  return child === "" || (!child.startsWith("..") && !isAbsolute(child));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function boundedStringArray(value: unknown, maximum = 100): value is string[] {
  return Array.isArray(value)
    && value.length <= maximum
    && value.every((entry) => typeof entry === "string" && entry.length > 0 && entry.length <= 128);
}

function validRequest(value: unknown): value is LocalRunbackRequest {
  if (
    !isRecord(value)
    || !exactKeys(value, ["schemaVersion", "intent", "initialArtifacts", "allowedScopes"])
    || value.schemaVersion !== 1
    || !boundedStringArray(value.initialArtifacts)
    || !boundedStringArray(value.allowedScopes)
    || !isRecord(value.intent)
    || !exactKeys(value.intent, ["id", "goal", "needs"])
    || (value.intent.id !== undefined && (typeof value.intent.id !== "string" || value.intent.id.length > 128))
    || (value.intent.goal !== undefined && (typeof value.intent.goal !== "string" || value.intent.goal.length > 1_000))
    || !Array.isArray(value.intent.needs)
    || value.intent.needs.length === 0
    || value.intent.needs.length > 100
  ) return false;
  return value.intent.needs.every((need) => {
    if (
      !isRecord(need)
      || !exactKeys(need, [
        "id", "function", "capability", "aliases", "inputs", "outputs", "dependsOn",
        "requiredScopes", "maxRisk", "minScore",
      ])
      || typeof need.id !== "string" || need.id.length === 0 || need.id.length > 128
      || typeof need.function !== "string" || !FUNCTIONS.has(need.function)
      || typeof need.capability !== "string" || need.capability.length === 0 || need.capability.length > 128
      || (need.maxRisk !== undefined && (typeof need.maxRisk !== "string" || !RISKS.has(need.maxRisk)))
      || (need.minScore !== undefined && (
        typeof need.minScore !== "number" || !Number.isFinite(need.minScore) || need.minScore < 0 || need.minScore > 1
      ))
    ) return false;
    return ["aliases", "inputs", "outputs", "dependsOn", "requiredScopes"]
      .every((key) => need[key] === undefined || boundedStringArray(need[key]));
  });
}

async function assertSafeRequestDirectories(rootRealPath: string, candidate: string): Promise<void> {
  const relativeParent = relative(rootRealPath, dirname(candidate));
  let current = rootRealPath;
  for (const part of relativeParent.split(sep).filter(Boolean)) {
    current = resolve(current, part);
    const [stats, currentRealPath] = await Promise.all([lstat(current), realpath(current)]).catch(() => {
      throw new CliError("Runback request path is unsafe.", 2);
    });
    if (stats.isSymbolicLink() || !stats.isDirectory() || !pathIsWithin(rootRealPath, currentRealPath)) {
      throw new CliError("Runback request path is unsafe.", 2);
    }
  }
}

function parameterKeys(values: readonly string[]): string[] {
  return [...new Set(values.flatMap((value) => {
    const match = value.match(PLACEHOLDER)?.[1];
    return match ? [match] : [];
  }))].sort();
}

function evidenceReceiptId(capsuleDigest: string, componentKind: string, sequence: number): string {
  return `evidence_${createHash("sha256")
    .update(`${capsuleDigest}:${componentKind}:${sequence}`)
    .digest("hex")}`;
}

/** Converts one validated learned run into independent, task-agnostic evidence components. */
export function createRunbackRelease(capsule: PrivateCapsule, recipe: AgentRecipe): CatalogSnapshot {
  validatePrivateCapsule(capsule);
  validateRecipe(recipe);
  if (
    recipe.source.private_capsule_digest !== capsule.integrity.content_digest
    || recipe.source.source_receipt_content_digest !== capsule.source_receipt_content_digest
  ) throw new CliError("Runback release binding does not match.");

  const processes = capsule.actions.filter((action) => action.kind === "process");
  const verification = capsule.actions.at(-1);
  const components: TraceSubmission["components"] = [
    ...processes.map((action) => {
      const keys = parameterKeys(action.arguments);
      return {
        receiptId: evidenceReceiptId(capsule.integrity.content_digest, "process", action.sequence),
        tool: "git.hash-object",
        operation: "read",
        capability: "hash_repository_file",
        description: "Hash one repository file with Git without writing an object",
        function: "observe" as const,
        inputs: ["repository_file"],
        outputs: ["git_blob_digest"],
        parameterKeys: keys,
        requiredParameterKeys: keys,
        requiredScopes: ["repository:read"],
        risk: "read" as const,
        mutates: false,
        version: action.classifier_version,
        outcome: action.observed_exit_code === action.expected_exit_code ? "success" as const : "failure" as const,
        observedAt: capsule.created_at,
        durationMs: action.duration_ms,
      };
    }),
    ...(verification?.kind === "verification" ? [{
      receiptId: evidenceReceiptId(capsule.integrity.content_digest, "verification", verification.sequence),
      tool: "agentreceipt.file-assertion",
      operation: "verify",
      capability: "verify_file_digest",
      description: "Verify that a repository file matches its expected digest",
      function: "verify" as const,
      inputs: ["repository_file"],
      outputs: ["verification_result"],
      parameterKeys: parameterKeys([recipe.verification.path]),
      requiredParameterKeys: parameterKeys([recipe.verification.path]),
      requiredScopes: ["repository:read"],
      risk: "read" as const,
      mutates: false,
      version: verification.classifier_version,
      outcome: verification.observed_exit_code === verification.expected_exit_code ? "success" as const : "failure" as const,
      observedAt: capsule.created_at,
      durationMs: verification.duration_ms,
    }] : []),
  ];
  const catalog = new ComponentCatalog();
  catalog.submitTrace({
    traceRef: capsule.integrity.content_digest,
    observedAt: capsule.created_at,
    components,
  });
  return catalog.snapshot();
}

async function readRequest(root: string, requestPath: string): Promise<LocalRunbackRequest> {
  if (!requestPath || !SAFE_REQUEST_PATH.test(requestPath)) {
    throw new CliError("Runback request path is unsafe.", 2);
  }
  const rootRealPath = await realpath(root).catch(() => {
    throw new CliError("Runback request path is unsafe.", 2);
  });
  const candidate = resolve(rootRealPath, requestPath);
  if (!pathIsWithin(rootRealPath, candidate)) throw new CliError("Runback request path is unsafe.", 2);
  const [stats, candidateRealPath] = await Promise.all([
    lstat(candidate),
    realpath(candidate),
  ]).catch(() => {
    throw new CliError("Runback request could not be read.", 2);
  });
  if (stats.isSymbolicLink() || !stats.isFile() || stats.size > MAX_REQUEST_BYTES || !pathIsWithin(rootRealPath, candidateRealPath)) {
    throw new CliError("Runback request path is unsafe.", 2);
  }
  await assertSafeRequestDirectories(rootRealPath, candidate);
  const handle = await open(candidateRealPath, "r");
  let value: unknown;
  try {
    const openedStats = await handle.stat();
    if (!openedStats.isFile() || openedStats.nlink !== 1 || openedStats.dev !== stats.dev || openedStats.ino !== stats.ino) {
      throw new CliError("Runback request path is unsafe.", 2);
    }
    const buffer = Buffer.alloc(MAX_REQUEST_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > MAX_REQUEST_BYTES) throw new CliError("Runback request is too large.", 2);
    value = JSON.parse(buffer.subarray(0, bytesRead).toString("utf8")) as unknown;
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError("Runback request is invalid.", 2);
  } finally {
    await handle.close();
  }
  if (!validRequest(value)) throw new CliError("Runback request is invalid.", 2);
  return value;
}

export async function planLocalRunback(options: {
  root: string;
  requestPath: string;
  parameters?: Readonly<Record<string, unknown>>;
  now?: () => Date;
}): Promise<LocalRunbackResult> {
  const [request, releases] = await Promise.all([
    readRequest(options.root, options.requestPath),
    listPrivateJson(options.root, "runback_release"),
  ]);
  const catalog = new ComponentCatalog(options.now ? { now: options.now } : {});
  for (const release of releases) catalog.mergeSnapshot(release as CatalogSnapshot);
  const runRequest: RunRequest = {
    intent: request.intent,
    initialArtifacts: request.initialArtifacts,
    policy: {
      allowWrites: false,
      allowedScopes: request.allowedScopes,
      approvedWriteScopes: [],
    },
    parameters: options.parameters ?? {},
  };
  return {
    releaseCount: releases.length,
    plan: new PreflightPlanner({ catalog }).plan(runRequest),
  };
}
