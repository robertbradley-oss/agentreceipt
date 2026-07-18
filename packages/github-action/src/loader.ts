import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import { SafeValidationError } from "./errors.js";

export const DEFAULT_MAX_RECEIPT_BYTES = 1024 * 1024;

function pathIsWithin(parent: string, candidate: string): boolean {
  const child = relative(parent, candidate);
  return child === "" || (!child.startsWith("..") && !isAbsolute(child));
}

async function boundedRead(path: string, maxBytes: number): Promise<string> {
  let handle;

  try {
    handle = await open(path, "r");
    const stats = await handle.stat();
    if (!stats.isFile()) {
      throw new SafeValidationError("not_a_file");
    }
    if (stats.size > maxBytes) {
      throw new SafeValidationError("receipt_too_large");
    }

    const buffer = Buffer.alloc(maxBytes + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > maxBytes) {
      throw new SafeValidationError("receipt_too_large");
    }

    return buffer.subarray(0, bytesRead).toString("utf8");
  } catch (error) {
    if (error instanceof SafeValidationError) {
      throw error;
    }
    throw new SafeValidationError("receipt_missing");
  } finally {
    await handle?.close();
  }
}

export async function loadReceiptJson(
  workspace: string,
  inputPath: string,
  maxBytes = DEFAULT_MAX_RECEIPT_BYTES,
): Promise<unknown> {
  if (workspace.trim() === "" || inputPath.trim() === "" || maxBytes < 1 || isAbsolute(inputPath)) {
    throw new SafeValidationError("invalid_input");
  }

  const workspacePath = resolve(workspace);
  const candidatePath = resolve(workspacePath, inputPath);

  if (!pathIsWithin(workspacePath, candidatePath)) {
    throw new SafeValidationError("path_outside_workspace");
  }

  let workspaceRealPath: string;
  let candidateStats;
  let candidateRealPath: string;

  try {
    [workspaceRealPath, candidateStats, candidateRealPath] = await Promise.all([
      realpath(workspacePath),
      lstat(candidatePath),
      realpath(candidatePath),
    ]);
  } catch {
    throw new SafeValidationError("receipt_missing");
  }

  if (candidateStats.isSymbolicLink()) {
    throw new SafeValidationError("link_not_allowed");
  }
  if (!candidateStats.isFile()) {
    throw new SafeValidationError("not_a_file");
  }
  if (!pathIsWithin(workspaceRealPath, candidateRealPath)) {
    throw new SafeValidationError("link_not_allowed");
  }

  const content = await boundedRead(candidateRealPath, maxBytes);

  try {
    return JSON.parse(content) as unknown;
  } catch {
    throw new SafeValidationError("malformed_json");
  }
}
