import { execFile } from "node:child_process";
import { basename, isAbsolute } from "node:path";
import { promisify } from "node:util";

import { CliError } from "./errors.js";
import type { RepositoryFileChange, RepositorySnapshot } from "./types.js";

const execFileAsync = promisify(execFile);

async function runGitRaw(cwd: string, args: string[]): Promise<string> {
  const gitExecutable = process.env.AGENTRECEIPT_GIT_PATH ?? "git";

  try {
    const { stdout } = await execFileAsync(gitExecutable, args, {
      cwd,
      encoding: "utf8",
      windowsHide: true,
    });
    return stdout;
  } catch {
    throw new CliError(
      `Could not run git ${args.join(" ")}. Ensure Git is installed and this repository has at least one commit.`,
    );
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
      });
      continue;
    }

    const path = fields[index++];
    if (!path) {
      throw new CliError("Git returned an incomplete changed-file record.");
    }
    changes.push({ path: safeRepositoryPath(path), change: changeFromStatus(status) });
  }

  return changes;
}

function isAgentReceiptStorage(path: string): boolean {
  const normalized = path.replaceAll("\\", "/");
  return normalized === ".agentreceipt" || normalized.startsWith(".agentreceipt/");
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
    await runGitRaw(root, ["diff", "--name-status", "-z", "--find-renames", baseSha, "--"]),
  );
  const untracked = (await runGitRaw(root, ["ls-files", "--others", "--exclude-standard", "-z"]))
    .split("\0")
    .filter(Boolean)
    .filter((path) => !isAgentReceiptStorage(path))
    .map((path) => ({
      path: safeRepositoryPath(path),
      change: "added" as const,
    }));

  const byPath = new Map<string, RepositoryFileChange>();
  for (const change of [...tracked, ...untracked]) {
    byPath.set(change.path, change);
  }
  return [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path));
}
