import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, link, lstat, mkdir, open, readdir, realpath, rm } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

import { assertReceipt, receiptContentDigestMatches } from "@agentreceipt/schema";

import { CliError } from "./errors.js";
import { controlledGitEnvironment } from "./git.js";

const execFileAsync = promisify(execFile);
export const MAX_PRIVATE_ARTIFACT_BYTES = 1024 * 1024;
const UUID_FILE = "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.json";
const CREDENTIAL_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}\b/,
  /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
];

export type PrivateArtifactKind = "capsule" | "recipe" | "runback_release";
export type PrivateArtifactErrorCode =
  | "unsafe_private_path"
  | "private_artifact_missing"
  | "private_artifact_too_large"
  | "private_artifact_invalid"
  | "private_artifact_exists"
  | "internal_error";

export class PrivateArtifactError extends CliError {
  readonly code: PrivateArtifactErrorCode;

  constructor(code: PrivateArtifactErrorCode) {
    super(`Private artifact operation failed safely (${code}).`);
    this.name = "PrivateArtifactError";
    this.code = code;
  }
}

function pathIsWithin(parent: string, candidate: string): boolean {
  const child = relative(parent, candidate);
  return child === "" || (!child.startsWith("..") && !isAbsolute(child));
}

async function assertSafeExistingDirectories(rootRealPath: string, targetDirectory: string): Promise<void> {
  const relativeTarget = relative(rootRealPath, targetDirectory);
  if (!pathIsWithin(rootRealPath, targetDirectory)) throw new PrivateArtifactError("unsafe_private_path");

  let current = rootRealPath;
  for (const part of relativeTarget.split(sep).filter(Boolean)) {
    current = resolve(current, part);
    const stats = await lstat(current).catch(() => {
      throw new PrivateArtifactError("unsafe_private_path");
    });
    const currentRealPath = await realpath(current).catch(() => {
      throw new PrivateArtifactError("unsafe_private_path");
    });
    if (stats.isSymbolicLink() || !stats.isDirectory() || !pathIsWithin(rootRealPath, currentRealPath)) {
      throw new PrivateArtifactError("unsafe_private_path");
    }
  }
}

function patternFor(kind: PrivateArtifactKind): RegExp {
  switch (kind) {
    case "capsule":
      return new RegExp(`^\\.agentreceipt/private/capsules/${UUID_FILE}$`);
    case "recipe":
      return new RegExp(`^\\.agentreceipt/recipes/${UUID_FILE}$`);
    case "runback_release":
      return new RegExp(`^\\.agentreceipt/private/runback/releases/${UUID_FILE}$`);
  }
}

function directoryFor(kind: PrivateArtifactKind): string {
  switch (kind) {
    case "capsule": return ".agentreceipt/private/capsules";
    case "recipe": return ".agentreceipt/recipes";
    case "runback_release": return ".agentreceipt/private/runback/releases";
  }
}

function assertArtifactPath(path: string, kind: PrivateArtifactKind): void {
  if (
    path.length > 1024
    || path.includes("\\")
    || isAbsolute(path)
    || path.split("/").includes("..")
    || !patternFor(kind).test(path)
  ) {
    throw new PrivateArtifactError("unsafe_private_path");
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function gitText(root: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync(process.env.AGENTRECEIPT_GIT_PATH ?? "git", args, {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 64 * 1024,
      env: controlledGitEnvironment(),
    });
    return stdout;
  } catch {
    throw new PrivateArtifactError("unsafe_private_path");
  }
}

async function gitExit(root: string, args: string[]): Promise<number> {
  try {
    await execFileAsync(process.env.AGENTRECEIPT_GIT_PATH ?? "git", args, {
      cwd: root,
      windowsHide: true,
      maxBuffer: 64 * 1024,
      env: controlledGitEnvironment(),
    });
    return 0;
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "number" ? code : 2;
  }
}

async function ensureSafeDirectories(root: string, artifactPath: string): Promise<void> {
  const rootRealPath = await realpath(root).catch(() => {
    throw new PrivateArtifactError("unsafe_private_path");
  });
  const parent = dirname(resolve(rootRealPath, artifactPath));
  const relativeParent = relative(rootRealPath, parent);
  if (!pathIsWithin(rootRealPath, parent)) throw new PrivateArtifactError("unsafe_private_path");

  let current = rootRealPath;
  for (const part of relativeParent.split(sep).filter(Boolean)) {
    current = resolve(current, part);
    if (!(await exists(current))) await mkdir(current, { mode: 0o700 });
    const stats = await lstat(current).catch(() => {
      throw new PrivateArtifactError("unsafe_private_path");
    });
    const currentRealPath = await realpath(current).catch(() => {
      throw new PrivateArtifactError("unsafe_private_path");
    });
    if (stats.isSymbolicLink() || !stats.isDirectory() || !pathIsWithin(rootRealPath, currentRealPath)) {
      throw new PrivateArtifactError("unsafe_private_path");
    }
  }
}

async function validateNewDestination(
  root: string,
  artifactPath: string,
  kind: PrivateArtifactKind,
): Promise<string> {
  assertArtifactPath(artifactPath, kind);
  const rootRealPath = await realpath(root).catch(() => {
    throw new PrivateArtifactError("unsafe_private_path");
  });
  const destination = resolve(rootRealPath, artifactPath);
  if (!pathIsWithin(rootRealPath, destination)) throw new PrivateArtifactError("unsafe_private_path");
  if (await exists(destination)) throw new PrivateArtifactError("private_artifact_exists");
  if (await gitExit(rootRealPath, ["check-ignore", "-q", "--", artifactPath]) !== 0) {
    throw new PrivateArtifactError("unsafe_private_path");
  }
  if ((await gitText(rootRealPath, ["ls-files", "--stage", "--", artifactPath])).trim() !== "") {
    throw new PrivateArtifactError("unsafe_private_path");
  }
  if ((await gitText(rootRealPath, ["ls-tree", "-z", "HEAD", "--", artifactPath])).length !== 0) {
    throw new PrivateArtifactError("unsafe_private_path");
  }
  await ensureSafeDirectories(rootRealPath, artifactPath);
  return destination;
}

export async function writePrivateJson(
  root: string,
  artifactPath: string,
  kind: PrivateArtifactKind,
  value: unknown,
): Promise<void> {
  let serialized: string;
  try {
    const json = JSON.stringify(value, null, 2);
    if (json === undefined) throw new TypeError("not JSON");
    serialized = `${json}\n`;
  } catch {
    throw new PrivateArtifactError("private_artifact_invalid");
  }
  if (Buffer.byteLength(serialized) > MAX_PRIVATE_ARTIFACT_BYTES) {
    throw new PrivateArtifactError("private_artifact_too_large");
  }
  if (CREDENTIAL_PATTERNS.some((pattern) => pattern.test(serialized))) {
    throw new PrivateArtifactError("private_artifact_invalid");
  }
  const destination = await validateNewDestination(root, artifactPath, kind);
  const temporary = resolve(dirname(destination), `.agentreceipt-${randomUUID()}.tmp`);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(serialized, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await link(temporary, destination);
  } catch (error) {
    if (error instanceof PrivateArtifactError) throw error;
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new PrivateArtifactError("private_artifact_exists");
    }
    throw new PrivateArtifactError("internal_error");
  } finally {
    await handle?.close();
    await rm(temporary, { force: true });
  }
}

export async function readPrivateJson(
  root: string,
  artifactPath: string,
  kind: PrivateArtifactKind,
): Promise<unknown> {
  assertArtifactPath(artifactPath, kind);
  const rootRealPath = await realpath(root).catch(() => {
    throw new PrivateArtifactError("unsafe_private_path");
  });
  const candidate = resolve(rootRealPath, artifactPath);
  if (!pathIsWithin(rootRealPath, candidate)) throw new PrivateArtifactError("unsafe_private_path");
  if (await gitExit(rootRealPath, ["check-ignore", "-q", "--", artifactPath]) !== 0) {
    throw new PrivateArtifactError("unsafe_private_path");
  }
  if ((await gitText(rootRealPath, ["ls-files", "--stage", "--", artifactPath])).trim() !== "") {
    throw new PrivateArtifactError("unsafe_private_path");
  }
  if ((await gitText(rootRealPath, ["ls-tree", "-z", "HEAD", "--", artifactPath])).length !== 0) {
    throw new PrivateArtifactError("unsafe_private_path");
  }

  let stats: Awaited<ReturnType<typeof lstat>>;
  let candidateRealPath: string;
  try {
    [stats, candidateRealPath] = await Promise.all([lstat(candidate), realpath(candidate)]);
  } catch {
    throw new PrivateArtifactError("private_artifact_missing");
  }
  if (
    stats.isSymbolicLink()
    || !stats.isFile()
    || stats.nlink !== 1
    || !pathIsWithin(rootRealPath, candidateRealPath)
  ) {
    throw new PrivateArtifactError("unsafe_private_path");
  }
  await assertSafeExistingDirectories(rootRealPath, dirname(candidate));
  if (stats.size > MAX_PRIVATE_ARTIFACT_BYTES) {
    throw new PrivateArtifactError("private_artifact_too_large");
  }

  const handle = await open(candidateRealPath, "r").catch(() => {
    throw new PrivateArtifactError("private_artifact_missing");
  });
  try {
    const openedStats = await handle.stat();
    if (
      !openedStats.isFile()
      || openedStats.nlink !== 1
      || openedStats.dev !== stats.dev
      || openedStats.ino !== stats.ino
    ) throw new PrivateArtifactError("unsafe_private_path");
    const buffer = Buffer.alloc(MAX_PRIVATE_ARTIFACT_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > MAX_PRIVATE_ARTIFACT_BYTES) {
      throw new PrivateArtifactError("private_artifact_too_large");
    }
    try {
      return JSON.parse(buffer.subarray(0, bytesRead).toString("utf8")) as unknown;
    } catch {
      throw new PrivateArtifactError("private_artifact_invalid");
    }
  } finally {
    await handle.close();
  }
}

export async function listPrivateJson(root: string, kind: PrivateArtifactKind): Promise<unknown[]> {
  const rootRealPath = await realpath(root).catch(() => {
    throw new PrivateArtifactError("unsafe_private_path");
  });
  const relativeDirectory = directoryFor(kind);
  const directory = resolve(rootRealPath, relativeDirectory);
  if (!pathIsWithin(rootRealPath, directory)) throw new PrivateArtifactError("unsafe_private_path");
  if (!(await exists(directory))) return [];
  await assertSafeExistingDirectories(rootRealPath, directory);
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => {
    throw new PrivateArtifactError("unsafe_private_path");
  });
  if (entries.length > 1_000) throw new PrivateArtifactError("private_artifact_too_large");

  const values: unknown[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const artifactPath = `${relativeDirectory}/${entry.name}`;
    if (!entry.isFile() || !patternFor(kind).test(artifactPath)) {
      throw new PrivateArtifactError("unsafe_private_path");
    }
    values.push(await readPrivateJson(rootRealPath, artifactPath, kind));
  }
  return values;
}

export async function sourceReceiptDigestExists(
  root: string,
  expectedDigest: string,
  expectedRepository: {
    owner: string;
    name: string;
    capture_start_sha: string;
    capture_end_sha: string;
  },
): Promise<boolean> {
  if (!/^sha256:[a-f0-9]{64}$/.test(expectedDigest)) return false;
  const rootRealPath = await realpath(root).catch(() => undefined);
  if (!rootRealPath) return false;
  const receiptDirectory = resolve(rootRealPath, ".agentreceipt", "receipts");
  try {
    await assertSafeExistingDirectories(rootRealPath, receiptDirectory);
  } catch {
    return false;
  }

  const entries = await readdir(receiptDirectory, { withFileTypes: true }).catch(() => undefined);
  if (!entries || entries.length > 1_000) return false;
  for (const entry of entries) {
    if (!entry.isFile() || !new RegExp(`^${UUID_FILE}$`).test(entry.name)) continue;
    const candidate = resolve(receiptDirectory, entry.name);
    try {
      const stats = await lstat(candidate);
      const candidateRealPath = await realpath(candidate);
      if (
        stats.isSymbolicLink()
        || !stats.isFile()
        || stats.size > MAX_PRIVATE_ARTIFACT_BYTES
        || !pathIsWithin(rootRealPath, candidateRealPath)
      ) continue;
      const handle = await open(candidateRealPath, "r");
      let value: unknown;
      try {
        const buffer = Buffer.alloc(MAX_PRIVATE_ARTIFACT_BYTES + 1);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        if (bytesRead > MAX_PRIVATE_ARTIFACT_BYTES) continue;
        value = JSON.parse(buffer.subarray(0, bytesRead).toString("utf8")) as unknown;
      } finally {
        await handle.close();
      }
      assertReceipt(value);
      const receipt = value as unknown as {
        integrity: { content_digest: string };
        repository: {
          owner: string;
          name: string;
          capture_start_sha: string;
          capture_end_sha: string;
        };
        capture: { adapter: string; surface: string; status: string };
        verification: { status: string };
      };
      if (
        receipt.integrity.content_digest === expectedDigest
        && receiptContentDigestMatches(value, expectedDigest)
        && receipt.repository.owner.toLowerCase() === expectedRepository.owner.toLowerCase()
        && receipt.repository.name.toLowerCase() === expectedRepository.name.toLowerCase()
        && receipt.repository.capture_start_sha === expectedRepository.capture_start_sha
        && receipt.repository.capture_end_sha === expectedRepository.capture_end_sha
        && receipt.capture.adapter === "agentreceipt-codex-exec"
        && receipt.capture.surface === "codex_exec_jsonl"
        && receipt.capture.status === "complete_for_declared_surface"
        && receipt.verification.status === "passed"
      ) return true;
    } catch {
      // A malformed or unsafe receipt cannot establish the linkage; continue with bounded candidates.
    }
  }
  return false;
}
