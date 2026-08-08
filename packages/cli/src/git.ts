import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, open, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

import { CliError } from "./errors.js";
import type { RepositoryFileChange, RepositorySnapshot } from "./types.js";

const execFileAsync = promisify(execFile);

export function controlledGitEnvironment(environment: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const controlled: NodeJS.ProcessEnv = {
    GIT_TERMINAL_PROMPT: "0",
    GIT_NO_LAZY_FETCH: "1",
  };
  for (const name of [
    "PATH", "Path", "PATHEXT", "SystemRoot", "COMSPEC", "TEMP", "TMP", "HOME",
    "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "LANG", "LC_ALL",
  ]) {
    if (environment[name] !== undefined) controlled[name] = environment[name];
  }
  return controlled;
}

async function runGitRaw(cwd: string, args: string[]): Promise<string> {
  const gitExecutable = process.env.AGENTRECEIPT_GIT_PATH ?? "git";

  try {
    const { stdout } = await execFileAsync(gitExecutable, args, {
      cwd,
      encoding: "utf8",
      windowsHide: true,
      env: controlledGitEnvironment(),
    });
    return stdout;
  } catch {
    throw new CliError("Could not inspect the Git repository safely.");
  }
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  return (await runGitRaw(cwd, args)).trim();
}

function safeRepositoryPath(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  if (
    !normalized
    || isAbsolute(path)
    || normalized.startsWith("/")
    || /^[A-Za-z]:/.test(normalized)
    || normalized.split("/").includes("..")
  ) {
    throw new CliError("Git reported a path outside the repository boundary.");
  }
  return normalized;
}

function changeFromStatus(status: string): RepositoryFileChange["change"] {
  if (status.startsWith("A")) return "added";
  if (status.startsWith("D")) return "deleted";
  if (status.startsWith("R") || status.startsWith("C")) return "renamed";
  return "modified";
}

function parseNameStatus(raw: string): RepositoryFileChange[] {
  const fields = raw.split("\0");
  const changes: RepositoryFileChange[] = [];
  let index = 0;

  while (index < fields.length && fields[index]) {
    const status = fields[index++]!;
    if (status.startsWith("R") || status.startsWith("C")) {
      const previousPath = fields[index++];
      const path = fields[index++];
      if (!previousPath || !path) {
        throw new CliError("Git returned an incomplete rename record.");
      }
      changes.push({
        path: safeRepositoryPath(path),
        previousPath: safeRepositoryPath(previousPath),
        change: "renamed",
        additions: 0,
        deletions: 0,
        lineCountsKnown: false,
      });
      continue;
    }

    const path = fields[index++];
    if (!path) {
      throw new CliError("Git returned an incomplete changed-file record.");
    }
    changes.push({
      path: safeRepositoryPath(path),
      change: changeFromStatus(status),
      additions: 0,
      deletions: 0,
      lineCountsKnown: false,
    });
  }

  return changes;
}

function isAgentReceiptStorage(path: string): boolean {
  const normalized = path.replaceAll("\\", "/");
  return normalized === ".agentreceipt" || normalized.startsWith(".agentreceipt/");
}

function pathIsWithin(parent: string, candidate: string): boolean {
  const child = relative(parent, candidate);
  return child === "" || (!child.startsWith("..") && !isAbsolute(child));
}

async function hashWorkingTreeFile(root: string, repositoryPath: string): Promise<`sha256:${string}`> {
  const safePath = safeRepositoryPath(repositoryPath);
  const rootRealPath = await realpath(root);
  const candidatePath = resolve(rootRealPath, safePath);
  const relativeParent = relative(rootRealPath, dirname(candidatePath));
  let current = rootRealPath;
  for (const part of relativeParent.split(sep).filter(Boolean)) {
    current = resolve(current, part);
    const directoryStats = await lstat(current);
    const directoryRealPath = await realpath(current);
    if (
      directoryStats.isSymbolicLink()
      || !directoryStats.isDirectory()
      || !pathIsWithin(rootRealPath, directoryRealPath)
    ) throw new CliError("A changed file could not be hashed safely.");
  }
  const candidateStats = await lstat(candidatePath);
  const candidateRealPath = await realpath(candidatePath);

  if (candidateStats.isSymbolicLink() || !candidateStats.isFile() || !pathIsWithin(rootRealPath, candidateRealPath)) {
    throw new CliError("A changed file could not be hashed safely.");
  }

  const handle = await open(candidateRealPath, "r");
  try {
    const openedStats = await handle.stat();
    if (!openedStats.isFile()) {
      throw new CliError("A changed file could not be hashed safely.");
    }

    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let position = 0;
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    return `sha256:${hash.digest("hex")}`;
  } finally {
    await handle.close();
  }
}

export async function hashRepositoryFile(
  root: string,
  repositoryPath: string,
): Promise<`sha256:${string}`> {
  return hashWorkingTreeFile(root, repositoryPath);
}

export async function isTrackedRepositoryFile(root: string, repositoryPath: string): Promise<boolean> {
  const safePath = safeRepositoryPath(repositoryPath);
  try {
    return await runGitRaw(root, ["ls-files", "--error-unmatch", "-z", "--", safePath]) === `${safePath}\0`;
  } catch {
    return false;
  }
}

export async function readGitExecutableVersion(root: string): Promise<string> {
  const gitExecutable = process.env.AGENTRECEIPT_GIT_PATH ?? "git";
  try {
    const { stdout } = await execFileAsync(gitExecutable, ["--version"], {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 4096,
      env: controlledGitEnvironment(),
    });
    const version = stdout.trim();
    if (!/^git version [0-9A-Za-z.+() -]{1,80}$/.test(version)) {
      throw new Error("unsafe version");
    }
    return version;
  } catch {
    throw new CliError("Could not fingerprint the required executable safely.");
  }
}

async function hashGitBlob(root: string, commitSha: string, repositoryPath: string): Promise<`sha256:${string}`> {
  const safePath = safeRepositoryPath(repositoryPath);
  const record = await runGitRaw(root, ["ls-tree", "-z", commitSha, "--", safePath]);
  const tab = record.indexOf("\t");
  const nul = record.indexOf("\0", tab + 1);
  if (tab < 0 || nul < 0 || record.slice(tab + 1, nul) !== safePath) {
    throw new CliError("A required Git blob is unavailable.");
  }

  const [mode, type, objectId] = record.slice(0, tab).split(" ");
  if (!mode || type !== "blob" || !objectId || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(objectId)) {
    throw new CliError("A required Git blob is unavailable.");
  }

  const gitExecutable = process.env.AGENTRECEIPT_GIT_PATH ?? "git";
  const child = spawn(gitExecutable, ["cat-file", "blob", objectId], {
    cwd: root,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: controlledGitEnvironment(),
  });
  const hash = createHash("sha256");
  child.stdout.on("data", (chunk: Buffer) => hash.update(chunk));
  child.stderr.on("data", () => undefined);
  const exitCode = await new Promise<number>((resolveExit) => {
    child.once("close", (code) => resolveExit(code ?? 1));
    child.once("error", () => resolveExit(1));
  });
  if (exitCode !== 0) {
    throw new CliError("A required Git blob is unavailable.");
  }
  return `sha256:${hash.digest("hex")}`;
}

async function enrichChange(
  root: string,
  baseSha: string,
  change: RepositoryFileChange,
): Promise<RepositoryFileChange> {
  const beforePath = change.change === "renamed" ? change.previousPath : change.path;
  const beforeDigest = change.change === "added" || !beforePath
    ? undefined
    : await hashGitBlob(root, baseSha, beforePath);
  const afterDigest = change.change === "deleted"
    ? undefined
    : await hashWorkingTreeFile(root, change.path);

  return {
    ...change,
    additions: 0,
    deletions: 0,
    lineCountsKnown: false,
    ...(beforeDigest ? { beforeDigest } : {}),
    ...(afterDigest ? { afterDigest } : {}),
  };
}

function worktreeIsClean(raw: string): boolean {
  const fields = raw.split("\0");
  let index = 0;
  while (index < fields.length && fields[index]) {
    const record = fields[index++]!;
    const status = record.slice(0, 2);
    const path = record.slice(3);
    if (status.includes("R") || status.includes("C")) {
      index += 1;
    }
    if (status === "??" && isAgentReceiptStorage(path)) {
      continue;
    }
    return false;
  }
  return true;
}

function parseGitHubRemote(remote: string): { owner: string; name: string } | undefined {
  const match = remote.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (!match?.[1] || !match[2]) {
    return undefined;
  }

  return {
    owner: match[1],
    name: match[2],
  };
}

export async function readRepository(cwd: string): Promise<RepositorySnapshot> {
  const root = await runGit(cwd, ["rev-parse", "--show-toplevel"]);
  const headSha = await runGit(root, ["rev-parse", "HEAD"]);
  const branch = (await runGit(root, ["branch", "--show-current"])) || "detached-head";
  const limitations: string[] = [];
  const isClean = worktreeIsClean(
    await runGitRaw(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
  );
  let remote = "";

  try {
    remote = await runGit(root, ["config", "--get", "remote.origin.url"]);
  } catch {
    limitations.push("No GitHub origin remote was detected; local repository identity was used.");
  }

  const parsedRemote = parseGitHubRemote(remote);

  if (!parsedRemote && remote) {
    limitations.push("The origin remote is not a recognized GitHub URL; local repository identity was used.");
  }

  return {
    root,
    owner: parsedRemote?.owner ?? "local",
    name: parsedRemote?.name ?? basename(root),
    branch,
    headSha,
    isClean,
    limitations,
  };
}

export async function readRepositoryChanges(root: string, baseSha: string): Promise<RepositoryFileChange[]> {
  const tracked = parseNameStatus(
    await runGitRaw(root, [
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--name-status",
      "-z",
      "--find-renames",
      baseSha,
      "--",
    ]),
  );
  const untracked = (await runGitRaw(root, ["ls-files", "--others", "--exclude-standard", "-z"]))
    .split("\0")
    .filter(Boolean)
    .filter((path) => !isAgentReceiptStorage(path))
    .map((path) => ({
      path: safeRepositoryPath(path),
      change: "added" as const,
      additions: 0,
      deletions: 0,
      lineCountsKnown: false,
    }));

  const byPath = new Map<string, RepositoryFileChange>();
  for (const change of [...tracked, ...untracked]) {
    byPath.set(change.path, {
      ...change,
      additions: change.additions ?? 0,
      deletions: change.deletions ?? 0,
      lineCountsKnown: change.lineCountsKnown ?? false,
    });
  }
  const sorted = [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path));
  return Promise.all(sorted.map((change) => enrichChange(root, baseSha, change)));
}
