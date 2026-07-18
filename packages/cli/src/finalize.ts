import { execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  link,
  mkdir,
  open,
  realpath,
  rm,
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

import {
  assertReceipt,
  computeReceiptContentDigest,
  receiptContentDigestMatches,
  validateReceipt,
  type AgentReceipt,
} from "@agentreceipt/schema";

import { CliError } from "./errors.js";
import { canonicalizeJson } from "./json.js";

const execFileAsync = promisify(execFile);
const MAX_JSON_BYTES = 1024 * 1024;
const MAX_GIT_OUTPUT_BYTES = 4 * 1024 * 1024;
const SHA_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const REPOSITORY_PATTERN = /^([A-Za-z0-9_.-]{1,100})\/([A-Za-z0-9_.-]{1,100})$/;
const SAFE_GIT_PREFIX = [
  "--no-pager",
  "--no-optional-locks",
  "--no-replace-objects",
  "-c", "color.ui=false",
  "-c", "core.fsmonitor=false",
  "-c", "diff.external=",
];

export type FinalizationErrorCode =
  | "invalid_input"
  | "invalid_github_context"
  | "unsupported_event"
  | "unsafe_input_path"
  | "unsafe_output_path"
  | "receipt_too_large"
  | "malformed_json"
  | "schema_invalid"
  | "draft_required"
  | "draft_integrity_mismatch"
  | "privacy_check_failed"
  | "repository_mismatch"
  | "checkout_head_mismatch"
  | "git_history_unavailable"
  | "git_ancestry_mismatch"
  | "file_evidence_mismatch"
  | "partial_capture_rejected"
  | "failed_capture_rejected"
  | "output_exists"
  | "internal_error";

const SAFE_MESSAGES: Record<FinalizationErrorCode, string> = {
  invalid_input: "The finalization input is invalid.",
  invalid_github_context: "The GitHub event context is invalid.",
  unsupported_event: "This GitHub event is not supported.",
  unsafe_input_path: "The draft receipt path is unsafe.",
  unsafe_output_path: "The finalized receipt path is unsafe.",
  receipt_too_large: "A JSON input exceeds the 1 MiB limit.",
  malformed_json: "A required JSON input is malformed.",
  schema_invalid: "The draft receipt does not satisfy the receipt schema.",
  draft_required: "Finalization requires an unattested draft receipt.",
  draft_integrity_mismatch: "The draft receipt integrity digest does not match.",
  privacy_check_failed: "The draft receipt failed privacy screening.",
  repository_mismatch: "The draft repository does not match the GitHub repository.",
  checkout_head_mismatch: "The checked-out commit does not match the GitHub event head.",
  git_history_unavailable: "Required Git history is unavailable.",
  git_ancestry_mismatch: "Required Git ancestry could not be proven.",
  file_evidence_mismatch: "The receipt file evidence does not match Git.",
  partial_capture_rejected: "Partial capture requires explicit opt-in.",
  failed_capture_rejected: "Failed capture cannot be finalized.",
  output_exists: "The finalized output path already exists.",
  internal_error: "Finalization could not be completed safely.",
};

export class FinalizationError extends CliError {
  readonly code: FinalizationErrorCode;

  constructor(code: FinalizationErrorCode) {
    super(`${code}: ${SAFE_MESSAGES[code]}`);
    this.name = "FinalizationError";
    this.code = code;
  }
}

interface GitHubBinding {
  owner: string;
  name: string;
  eventName: "pull_request" | "push" | "workflow_dispatch";
  headSha: string;
  baseSha?: string;
}

interface DraftReceipt {
  repository: {
    provider: "github";
    owner: string;
    name: string;
    branch: string;
    binding_status: "draft";
    capture_start_sha: string;
    capture_end_sha: string;
  };
  capture: {
    status: "complete_for_declared_surface" | "partial" | "failed";
  };
  privacy: {
    capture_level: string;
    raw_content_included: boolean;
  };
  files: Array<{
    path: string;
    previous_path?: string;
    change: "added" | "modified" | "deleted" | "renamed";
    additions: number;
    deletions: number;
    line_counts_known: boolean;
    before_digest?: string;
    after_digest?: string;
  }>;
  integrity: { content_digest: string };
  attestation?: unknown;
  [key: string]: unknown;
}

interface GitChange {
  path: string;
  previousPath?: string;
  change: "added" | "modified" | "deleted" | "renamed";
}

interface LineCounts {
  additions: number;
  deletions: number;
  known: boolean;
}

export interface FinalizeReceiptOptions {
  cwd: string;
  inputPath: string;
  outputPath: string;
  allowPartial: boolean;
  environment?: NodeJS.ProcessEnv;
  now?: () => Date;
}

export interface FinalizeReceiptResult {
  outputPath: string;
  receipt: AgentReceipt;
}

export function shouldWarnForAcceptedPartial(receipt: AgentReceipt, allowPartial: boolean): boolean {
  return allowPartial && (receipt as { capture: { status: string } }).capture.status === "partial";
}

type JsonObject = Record<string, unknown>;

function objectAt(value: unknown, key: string): JsonObject | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entry = (value as JsonObject)[key];
  return entry !== null && typeof entry === "object" && !Array.isArray(entry)
    ? entry as JsonObject
    : undefined;
}

function stringAt(value: unknown, key: string): string | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entry = (value as JsonObject)[key];
  return typeof entry === "string" ? entry : undefined;
}

function pathIsWithin(parent: string, candidate: string): boolean {
  const child = relative(parent, candidate);
  return child === "" || (!child.startsWith("..") && !isAbsolute(child));
}

function safeRelativePath(value: string, code: "unsafe_input_path" | "unsafe_output_path"): string {
  const normalized = value.replaceAll("\\", "/");
  if (
    value.trim() === ""
    || isAbsolute(value)
    || normalized.startsWith("/")
    || /^[A-Za-z]:/.test(normalized)
    || normalized.split("/").includes("..")
    || normalized.split("/").includes("")
    || normalized.length > 1024
    || /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    throw new FinalizationError(code);
  }
  return normalized.split("/").filter((part) => part !== ".").join("/");
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function boundedFileBytes(
  path: string,
  unsafeCode: "unsafe_input_path" | "invalid_github_context",
): Promise<Buffer> {
  let handle;
  try {
    const stats = await lstat(path);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new FinalizationError(unsafeCode);
    }
    handle = await open(path, "r");
    const openedStats = await handle.stat();
    if (!openedStats.isFile()) throw new FinalizationError(unsafeCode);
    if (openedStats.size > MAX_JSON_BYTES) throw new FinalizationError("receipt_too_large");
    const buffer = Buffer.alloc(MAX_JSON_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > MAX_JSON_BYTES) throw new FinalizationError("receipt_too_large");
    return buffer.subarray(0, bytesRead);
  } catch (error) {
    if (error instanceof FinalizationError) throw error;
    throw new FinalizationError(unsafeCode);
  } finally {
    await handle?.close();
  }
}

function parseJsonBytes(bytes: Buffer): unknown {
  try {
    return JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    throw new FinalizationError("malformed_json");
  }
}

async function boundedJson(path: string, unsafeCode: "unsafe_input_path" | "invalid_github_context"): Promise<unknown> {
  return parseJsonBytes(await boundedFileBytes(path, unsafeCode));
}

async function bindingFromEnvironment(environment: NodeJS.ProcessEnv): Promise<GitHubBinding> {
  const eventName = environment.GITHUB_EVENT_NAME;
  const repository = environment.GITHUB_REPOSITORY?.match(REPOSITORY_PATTERN);
  const eventPath = environment.GITHUB_EVENT_PATH;
  const githubSha = environment.GITHUB_SHA;

  if (
    environment.GITHUB_ACTIONS !== "true"
    || !eventName
    || !repository
    || !eventPath
    || !githubSha
    || !SHA_PATTERN.test(githubSha)
  ) {
    throw new FinalizationError("invalid_github_context");
  }

  if (eventName === "pull_request_target" || !["pull_request", "push", "workflow_dispatch"].includes(eventName ?? "")) {
    throw new FinalizationError("unsupported_event");
  }

  const event = await boundedJson(eventPath, "invalid_github_context");
  const owner = repository[1] as string;
  const name = repository[2] as string;

  if (eventName === "pull_request") {
    const pullRequest = objectAt(event, "pull_request");
    const headSha = stringAt(objectAt(pullRequest, "head"), "sha");
    const baseSha = stringAt(objectAt(pullRequest, "base"), "sha");
    if (!headSha || !baseSha || !SHA_PATTERN.test(headSha) || !SHA_PATTERN.test(baseSha)) {
      throw new FinalizationError("invalid_github_context");
    }
    return { owner, name, eventName, headSha, baseSha };
  }

  if (eventName === "push") {
    const before = stringAt(event, "before");
    if (!before || !SHA_PATTERN.test(before)) {
      throw new FinalizationError("invalid_github_context");
    }
    const baseSha = before && !/^0+$/.test(before) ? before : undefined;
    return { owner, name, eventName, headSha: githubSha, ...(baseSha ? { baseSha } : {}) };
  }

  return { owner, name, eventName: "workflow_dispatch", headSha: githubSha };
}

async function runGitRaw(root: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync(process.env.AGENTRECEIPT_GIT_PATH ?? "git", [...SAFE_GIT_PREFIX, ...args], {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: MAX_GIT_OUTPUT_BYTES,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_NO_LAZY_FETCH: "1" },
    });
    return stdout;
  } catch {
    throw new FinalizationError("git_history_unavailable");
  }
}

async function boundedCommittedBytes(root: string, commitSha: string, repositoryPath: string): Promise<Buffer> {
  const path = safeGitPath(repositoryPath);
  const record = await runGitRaw(root, ["ls-tree", "-z", commitSha, "--", path]);
  const tab = record.indexOf("\t");
  const nul = record.indexOf("\0", tab + 1);
  if (tab < 0 || nul < 0 || record.slice(tab + 1, nul) !== path) {
    throw new FinalizationError("git_history_unavailable");
  }
  const [, type, objectId] = record.slice(0, tab).split(" ");
  if (type !== "blob" || !objectId || !SHA_PATTERN.test(objectId)) {
    throw new FinalizationError("git_history_unavailable");
  }

  const sizeText = (await runGitRaw(root, ["cat-file", "-s", objectId])).trim();
  const size = Number(sizeText);
  if (!Number.isSafeInteger(size) || size < 0) throw new FinalizationError("git_history_unavailable");
  if (size > MAX_JSON_BYTES) throw new FinalizationError("receipt_too_large");

  const child = spawn(process.env.AGENTRECEIPT_GIT_PATH ?? "git", [
    ...SAFE_GIT_PREFIX,
    "cat-file",
    "blob",
    objectId,
  ], {
    cwd: root,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_NO_LAZY_FETCH: "1" },
  });
  const chunks: Buffer[] = [];
  let bytesRead = 0;
  let tooLarge = false;
  child.stdout.on("data", (chunk: Buffer) => {
    bytesRead += chunk.length;
    if (bytesRead > MAX_JSON_BYTES) {
      tooLarge = true;
      child.kill();
      return;
    }
    chunks.push(chunk);
  });
  child.stderr.on("data", () => undefined);
  const exitCode = await new Promise<number>((resolveExit) => {
    child.once("close", (code) => resolveExit(code ?? 1));
    child.once("error", () => resolveExit(1));
  });
  if (tooLarge) throw new FinalizationError("receipt_too_large");
  if (exitCode !== 0 || bytesRead !== size) throw new FinalizationError("git_history_unavailable");
  return Buffer.concat(chunks, bytesRead);
}

async function runGitStatus(root: string, args: string[]): Promise<number> {
  const child = spawn(process.env.AGENTRECEIPT_GIT_PATH ?? "git", [...SAFE_GIT_PREFIX, ...args], {
    cwd: root,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_NO_LAZY_FETCH: "1" },
  });
  child.stdout.on("data", () => undefined);
  child.stderr.on("data", () => undefined);
  return new Promise<number>((resolveExit) => {
    child.once("close", (code) => resolveExit(code ?? 2));
    child.once("error", () => resolveExit(2));
  });
}

async function requireGitSuccess(root: string, args: string[], code: FinalizationErrorCode): Promise<void> {
  if (await runGitStatus(root, args) !== 0) throw new FinalizationError(code);
}

function safeGitPath(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  if (
    normalized === ""
    || normalized.startsWith("/")
    || /^[A-Za-z]:/.test(normalized)
    || normalized.split("/").includes("..")
  ) {
    throw new FinalizationError("file_evidence_mismatch");
  }
  return normalized;
}

function parseNameStatus(raw: string): GitChange[] {
  const fields = raw.split("\0");
  const changes: GitChange[] = [];
  let index = 0;
  while (index < fields.length && fields[index]) {
    const status = fields[index++] as string;
    if (status.startsWith("R")) {
      const previousPath = fields[index++];
      const path = fields[index++];
      if (!previousPath || !path) throw new FinalizationError("file_evidence_mismatch");
      changes.push({
        path: safeGitPath(path),
        previousPath: safeGitPath(previousPath),
        change: "renamed",
      });
      continue;
    }
    const path = fields[index++];
    if (!path) throw new FinalizationError("file_evidence_mismatch");
    const change = status.startsWith("A")
      ? "added"
      : status.startsWith("D")
        ? "deleted"
        : status.startsWith("M") || status.startsWith("T")
          ? "modified"
          : undefined;
    if (!change) throw new FinalizationError("file_evidence_mismatch");
    changes.push({ path: safeGitPath(path), change });
  }
  return changes;
}

function parseNumstat(raw: string): Map<string, LineCounts> {
  const fields = raw.split("\0");
  const counts = new Map<string, LineCounts>();
  let index = 0;
  while (index < fields.length && fields[index] !== "") {
    const record = fields[index++] as string;
    const parts = record.split("\t");
    if (parts.length !== 3) throw new FinalizationError("file_evidence_mismatch");
    const additionsText = parts[0] as string;
    const deletionsText = parts[1] as string;
    let path = parts[2] as string;
    if (path === "") {
      const previousPath = fields[index++];
      const renamedPath = fields[index++];
      if (!previousPath || !renamedPath) throw new FinalizationError("file_evidence_mismatch");
      path = renamedPath;
    }
    const known = additionsText !== "-" && deletionsText !== "-";
    const additions = known ? Number(additionsText) : 0;
    const deletions = known ? Number(deletionsText) : 0;
    if (!Number.isInteger(additions) || !Number.isInteger(deletions)) {
      throw new FinalizationError("file_evidence_mismatch");
    }
    counts.set(safeGitPath(path), { additions, deletions, known });
  }
  return counts;
}

async function hashGitBlob(root: string, commitSha: string, repositoryPath: string): Promise<string> {
  const path = safeGitPath(repositoryPath);
  const record = await runGitRaw(root, ["ls-tree", "-z", commitSha, "--", path]);
  const tab = record.indexOf("\t");
  const nul = record.indexOf("\0", tab + 1);
  if (tab < 0 || nul < 0 || record.slice(tab + 1, nul) !== path) {
    throw new FinalizationError("file_evidence_mismatch");
  }
  const [, type, objectId] = record.slice(0, tab).split(" ");
  if (type !== "blob" || !objectId || !SHA_PATTERN.test(objectId)) {
    throw new FinalizationError("file_evidence_mismatch");
  }

  const child = spawn(process.env.AGENTRECEIPT_GIT_PATH ?? "git", [...SAFE_GIT_PREFIX, "cat-file", "blob", objectId], {
    cwd: root,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_NO_LAZY_FETCH: "1" },
  });
  const hash = createHash("sha256");
  child.stdout.on("data", (chunk: Buffer) => hash.update(chunk));
  child.stderr.on("data", () => undefined);
  const exitCode = await new Promise<number>((resolveExit) => {
    child.once("close", (code) => resolveExit(code ?? 1));
    child.once("error", () => resolveExit(1));
  });
  if (exitCode !== 0) throw new FinalizationError("file_evidence_mismatch");
  return `sha256:${hash.digest("hex")}`;
}

function scanContainsCredential(value: unknown): boolean {
  const patterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}\b/,
    /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/,
    /\bAKIA[0-9A-Z]{16}\b/,
  ];
  const pending: unknown[] = [value];
  let visited = 0;
  while (pending.length > 0) {
    const entry = pending.pop();
    visited += 1;
    if (visited > 100_000) return true;
    if (typeof entry === "string" && patterns.some((pattern) => pattern.test(entry))) return true;
    if (Array.isArray(entry)) pending.push(...entry);
    else if (entry !== null && typeof entry === "object") {
      pending.push(...Object.values(entry as JsonObject));
    }
  }
  return false;
}

async function validateFileEvidence(
  root: string,
  draft: DraftReceipt,
  inputPath: string,
  headSha: string,
): Promise<void> {
  const startSha = draft.repository.capture_start_sha;
  const rawChanges = await runGitRaw(root, [
    "diff", "--no-ext-diff", "--no-textconv", "--name-status", "-z", "--find-renames", startSha, headSha, "--",
  ]);
  const allGitChanges = parseNameStatus(rawChanges);
  const inputChanges = allGitChanges.filter((change) => change.path === inputPath);
  if (
    inputChanges.length !== 1
    || !["added", "modified"].includes(inputChanges[0]?.change ?? "")
    || inputChanges[0]?.previousPath !== undefined
  ) {
    throw new FinalizationError("file_evidence_mismatch");
  }
  const gitChanges = allGitChanges.filter((change) => change.path !== inputPath);
  const numstat = parseNumstat(await runGitRaw(root, [
    "diff", "--no-ext-diff", "--no-textconv", "--numstat", "-z", "--find-renames", startSha, headSha, "--",
  ]));

  if (gitChanges.length !== draft.files.length) throw new FinalizationError("file_evidence_mismatch");
  const receiptFiles = new Map(draft.files.map((file) => [file.path, file]));
  if (receiptFiles.size !== draft.files.length) throw new FinalizationError("file_evidence_mismatch");

  for (const change of gitChanges) {
    const file = receiptFiles.get(change.path);
    if (
      !file
      || file.change !== change.change
      || (file.previous_path ?? undefined) !== (change.previousPath ?? undefined)
    ) {
      throw new FinalizationError("file_evidence_mismatch");
    }

    const counts = numstat.get(change.path);
    if (file.line_counts_known && (
      !counts?.known
      || file.additions !== counts.additions
      || file.deletions !== counts.deletions
    )) {
      throw new FinalizationError("file_evidence_mismatch");
    }

    if (change.change !== "added") {
      const beforePath = change.previousPath ?? change.path;
      if (file.before_digest !== await hashGitBlob(root, startSha, beforePath)) {
        throw new FinalizationError("file_evidence_mismatch");
      }
    }
    if (change.change !== "deleted" && file.after_digest !== await hashGitBlob(root, headSha, change.path)) {
      throw new FinalizationError("file_evidence_mismatch");
    }
  }
}

function assertAllowlistedTransition(draft: DraftReceipt, finalized: AgentReceipt): void {
  const draftCopy = structuredClone(draft) as JsonObject;
  const finalizedCopy = structuredClone(finalized) as JsonObject;
  for (const copy of [draftCopy, finalizedCopy]) {
    const repository = copy.repository as JsonObject;
    delete repository.binding_status;
    delete repository.base_sha;
    delete repository.head_sha;
    delete copy.finalization;
    delete copy.integrity;
  }
  if (canonicalizeJson(draftCopy) !== canonicalizeJson(finalizedCopy)) {
    throw new FinalizationError("internal_error");
  }
}

async function validateOutputPath(workspace: string, outputPath: string, root: string): Promise<void> {
  const candidate = resolve(workspace, outputPath);
  if (!pathIsWithin(workspace, candidate)) throw new FinalizationError("unsafe_output_path");
  if (await exists(candidate)) throw new FinalizationError("output_exists");

  let ancestor = dirname(candidate);
  while (!(await exists(ancestor))) {
    const parent = dirname(ancestor);
    if (parent === ancestor || !pathIsWithin(workspace, parent)) throw new FinalizationError("unsafe_output_path");
    ancestor = parent;
  }
  const stats = await lstat(ancestor);
  const ancestorRealPath = await realpath(ancestor);
  if (stats.isSymbolicLink() || !stats.isDirectory() || !pathIsWithin(workspace, ancestorRealPath)) {
    throw new FinalizationError("unsafe_output_path");
  }

  const ignored = await runGitStatus(root, ["check-ignore", "-q", "--", outputPath]);
  if (ignored === 1) throw new FinalizationError("unsafe_output_path");
  if (ignored !== 0) throw new FinalizationError("git_history_unavailable");
  if ((await runGitRaw(root, ["ls-files", "--stage", "--", outputPath])).trim() !== "") {
    throw new FinalizationError("unsafe_output_path");
  }
  if ((await runGitRaw(root, ["ls-tree", "-z", "HEAD", "--", outputPath])).length !== 0) {
    throw new FinalizationError("unsafe_output_path");
  }
}

async function ensureOutputDirectory(workspace: string, outputPath: string): Promise<string> {
  const parent = dirname(resolve(workspace, outputPath));
  const relativeParent = relative(workspace, parent);
  let current = workspace;
  for (const part of relativeParent.split(sep).filter(Boolean)) {
    current = resolve(current, part);
    if (!(await exists(current))) await mkdir(current);
    const stats = await lstat(current);
    const currentRealPath = await realpath(current);
    if (stats.isSymbolicLink() || !stats.isDirectory() || !pathIsWithin(workspace, currentRealPath)) {
      throw new FinalizationError("unsafe_output_path");
    }
  }
  return parent;
}

export async function publishTemporaryFileNoReplace(temporary: string, destination: string): Promise<void> {
  try {
    await link(temporary, destination);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new FinalizationError("output_exists");
    }
    throw new FinalizationError("internal_error");
  }
}

async function writeAtomically(workspace: string, outputPath: string, value: unknown): Promise<void> {
  const parent = await ensureOutputDirectory(workspace, outputPath);
  const destination = resolve(workspace, outputPath);
  const temporary = resolve(parent, `.agentreceipt-${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(temporary, "wx");
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await publishTemporaryFileNoReplace(temporary, destination);
  } catch (error) {
    if (error instanceof FinalizationError) throw error;
    throw new FinalizationError("internal_error");
  } finally {
    await handle?.close();
    await rm(temporary, { force: true });
  }
}

async function finalizeReceiptInternal(options: FinalizeReceiptOptions): Promise<FinalizeReceiptResult> {
  const environment = options.environment ?? process.env;
  const workspaceValue = environment.GITHUB_WORKSPACE;
  if (!workspaceValue) throw new FinalizationError("invalid_github_context");
  const workspace = await realpath(workspaceValue).catch(() => {
    throw new FinalizationError("invalid_github_context");
  });
  const inputPath = safeRelativePath(options.inputPath, "unsafe_input_path");
  const outputPath = safeRelativePath(options.outputPath, "unsafe_output_path");
  if (inputPath === outputPath) throw new FinalizationError("unsafe_output_path");

  const binding = await bindingFromEnvironment(environment);
  const gitRoot = (await runGitRaw(workspace, ["rev-parse", "--show-toplevel"])).trim();
  const gitRootRealPath = await realpath(gitRoot).catch(() => {
    throw new FinalizationError("git_history_unavailable");
  });
  if (gitRootRealPath !== workspace) throw new FinalizationError("invalid_github_context");

  const inputCandidate = resolve(workspace, inputPath);
  if (!pathIsWithin(workspace, inputCandidate)) throw new FinalizationError("unsafe_input_path");
  const inputStats = await lstat(inputCandidate).catch(() => {
    throw new FinalizationError("unsafe_input_path");
  });
  const inputRealPath = await realpath(inputCandidate).catch(() => {
    throw new FinalizationError("unsafe_input_path");
  });
  if (inputStats.isSymbolicLink() || !inputStats.isFile() || !pathIsWithin(workspace, inputRealPath)) {
    throw new FinalizationError("unsafe_input_path");
  }
  await requireGitSuccess(workspace, ["ls-files", "--error-unmatch", "--", inputPath], "unsafe_input_path");
  await requireGitSuccess(workspace, ["diff", "--quiet", "HEAD", "--", inputPath], "draft_integrity_mismatch");
  await requireGitSuccess(workspace, ["diff", "--cached", "--quiet", "HEAD", "--", inputPath], "draft_integrity_mismatch");
  await validateOutputPath(workspace, outputPath, workspace);

  const committedBytes = await boundedCommittedBytes(workspace, "HEAD", inputPath);
  const worktreeBytes = await boundedFileBytes(inputRealPath, "unsafe_input_path");
  if (!worktreeBytes.equals(committedBytes)) throw new FinalizationError("draft_integrity_mismatch");
  const value = parseJsonBytes(committedBytes);
  const schema = validateReceipt(value);
  if (!schema.valid) throw new FinalizationError("schema_invalid");
  const draft = value as DraftReceipt;
  if (draft.repository.binding_status !== "draft" || draft.attestation !== undefined) {
    throw new FinalizationError("draft_required");
  }
  if (!receiptContentDigestMatches(draft, draft.integrity.content_digest)) {
    throw new FinalizationError("draft_integrity_mismatch");
  }
  const draftDigest = computeReceiptContentDigest(draft);
  if (
    draft.privacy.capture_level !== "metadata"
    || draft.privacy.raw_content_included !== false
    || scanContainsCredential(draft)
  ) {
    throw new FinalizationError("privacy_check_failed");
  }
  if (draft.capture.status === "failed") throw new FinalizationError("failed_capture_rejected");
  if (draft.capture.status === "partial" && !options.allowPartial) {
    throw new FinalizationError("partial_capture_rejected");
  }
  if (
    draft.repository.provider !== "github"
    || draft.repository.owner.toLowerCase() !== binding.owner.toLowerCase()
    || draft.repository.name.toLowerCase() !== binding.name.toLowerCase()
  ) {
    throw new FinalizationError("repository_mismatch");
  }

  const checkedOutHead = (await runGitRaw(workspace, ["rev-parse", "HEAD"])).trim();
  if (checkedOutHead !== binding.headSha) throw new FinalizationError("checkout_head_mismatch");
  const requiredCommits = [
    draft.repository.capture_start_sha,
    draft.repository.capture_end_sha,
    binding.headSha,
    binding.baseSha,
  ].filter((sha): sha is string => sha !== undefined);
  for (const sha of requiredCommits) {
    await requireGitSuccess(workspace, ["cat-file", "-e", `${sha}^{commit}`], "git_history_unavailable");
  }
  await requireGitSuccess(
    workspace,
    ["merge-base", "--is-ancestor", draft.repository.capture_start_sha, draft.repository.capture_end_sha],
    "git_ancestry_mismatch",
  );
  await requireGitSuccess(
    workspace,
    ["merge-base", "--is-ancestor", draft.repository.capture_end_sha, binding.headSha],
    "git_ancestry_mismatch",
  );
  if (binding.baseSha) {
    await requireGitSuccess(
      workspace,
      ["merge-base", "--is-ancestor", binding.baseSha, binding.headSha],
      "git_ancestry_mismatch",
    );
  }
  await validateFileEvidence(workspace, draft, inputPath, binding.headSha);

  const repository = {
    ...draft.repository,
    binding_status: "finalized" as const,
    ...(binding.baseSha ? { base_sha: binding.baseSha } : {}),
    head_sha: binding.headSha,
  };
  const receiptWithoutIntegrity = {
    ...draft,
    repository,
    finalization: {
      method: "github_event",
      event: binding.eventName,
      draft_content_digest: draftDigest,
      finalized_at: (options.now ?? (() => new Date()))().toISOString(),
    },
  } as JsonObject;
  delete receiptWithoutIntegrity.integrity;
  const finalized = {
    ...receiptWithoutIntegrity,
    integrity: {
      algorithm: "sha256",
      canonicalization: "RFC8785",
      content_digest: computeReceiptContentDigest(receiptWithoutIntegrity),
    },
  };
  assertReceipt(finalized);
  assertAllowlistedTransition(draft, finalized);
  await writeAtomically(workspace, outputPath, finalized);
  return { outputPath, receipt: finalized };
}

export async function finalizeReceipt(options: FinalizeReceiptOptions): Promise<FinalizeReceiptResult> {
  try {
    return await finalizeReceiptInternal(options);
  } catch (error) {
    if (error instanceof FinalizationError) throw error;
    throw new FinalizationError("internal_error");
  }
}
