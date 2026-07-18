import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, parse, relative, resolve } from "node:path";

import { CliError } from "./errors.js";
import type { ActiveSession } from "./types.js";

const storeName = ".agentreceipt";

export function storePath(root: string): string {
  return join(root, storeName);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function findStoreRoot(cwd: string): Promise<string> {
  let current = resolve(cwd);
  const filesystemRoot = parse(current).root;

  while (true) {
    if (await exists(storePath(current))) {
      return current;
    }
    if (current === filesystemRoot) {
      break;
    }
    current = dirname(current);
  }

  throw new CliError("No AgentReceipt session was found. Run `agentreceipt start --title \"...\"` first.");
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    throw new CliError(`Could not read ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function writeJson(path: string, value: unknown, exclusive = false): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const json = `${JSON.stringify(value, null, 2)}\n`;

  if (!exclusive) {
    const temporaryPath = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, json, { encoding: "utf8", flag: "wx" });
      await rename(temporaryPath, path);
      return;
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }

  try {
    await writeFile(path, json, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new CliError("A recording is already active. Finish it before starting another one.");
    }
    throw error;
  }
}

export async function createActiveSession(root: string, session: ActiveSession): Promise<void> {
  await writeJson(join(storePath(root), "current.json"), session, true);
}

export async function readActiveSession(root: string): Promise<ActiveSession> {
  const path = join(storePath(root), "current.json");
  if (!(await exists(path))) {
    throw new CliError("No recording is active. Run `agentreceipt start --title \"...\"` first.");
  }
  return (await readJson(path)) as ActiveSession;
}

export async function finishActiveSession(root: string, session: ActiveSession, receipt: unknown): Promise<string> {
  const relativeReceiptPath = join("receipts", `${session.receipt_id}.json`);
  const receiptPath = join(storePath(root), relativeReceiptPath);
  await writeJson(receiptPath, receipt);
  await writeJson(join(storePath(root), "latest.json"), {
    receipt_path: relativeReceiptPath.replaceAll("\\", "/"),
  });

  const archivePath = join(storePath(root), "sessions", `${session.session_id}.json`);
  await mkdir(dirname(archivePath), { recursive: true });
  await rename(join(storePath(root), "current.json"), archivePath);
  return receiptPath;
}

export async function writeCompletedReceipt(root: string, receiptId: string, receipt: unknown): Promise<string> {
  const relativeReceiptPath = join("receipts", `${receiptId}.json`);
  const receiptPath = join(storePath(root), relativeReceiptPath);
  await writeJson(receiptPath, receipt);
  await writeJson(join(storePath(root), "latest.json"), {
    receipt_path: relativeReceiptPath.replaceAll("\\", "/"),
  });
  return receiptPath;
}

export async function readLatestReceipt(root: string): Promise<unknown> {
  const base = storePath(root);
  const pointer = (await readJson(join(base, "latest.json"))) as { receipt_path?: unknown };

  if (typeof pointer.receipt_path !== "string") {
    throw new CliError("The latest receipt pointer is invalid.");
  }

  const receiptPath = resolve(base, pointer.receipt_path);
  const relativePath = relative(resolve(base), receiptPath);
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new CliError("The latest receipt pointer escapes the AgentReceipt directory.");
  }

  return readJson(receiptPath);
}

export async function readReceiptFile(path: string): Promise<unknown> {
  return readJson(path);
}

export async function hasLatestReceipt(root: string): Promise<boolean> {
  return exists(join(storePath(root), "latest.json"));
}
