import { open } from "node:fs/promises";

import { SafeValidationError } from "./errors.js";
import type { GitHubBinding } from "./types.js";

const MAX_EVENT_BYTES = 1024 * 1024;
const SHA_PATTERN = /^[a-f0-9]{40,64}$/;
const REPOSITORY_PATTERN = /^([A-Za-z0-9_.-]{1,100})\/([A-Za-z0-9_.-]{1,100})$/;

type EventObject = Record<string, unknown>;

function objectAt(value: unknown, key: string): EventObject | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const entry = (value as EventObject)[key];
  return entry !== null && typeof entry === "object" && !Array.isArray(entry)
    ? entry as EventObject
    : undefined;
}

function stringAt(value: unknown, key: string): string | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const entry = (value as EventObject)[key];
  return typeof entry === "string" ? entry : undefined;
}

async function readEvent(path: string): Promise<unknown> {
  let handle;
  try {
    handle = await open(path, "r");
    const stats = await handle.stat();
    if (!stats.isFile() || stats.size > MAX_EVENT_BYTES) {
      throw new SafeValidationError("invalid_github_context");
    }
    const buffer = Buffer.alloc(MAX_EVENT_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > MAX_EVENT_BYTES) {
      throw new SafeValidationError("invalid_github_context");
    }
    return JSON.parse(buffer.subarray(0, bytesRead).toString("utf8")) as unknown;
  } catch (error) {
    if (error instanceof SafeValidationError) {
      throw error;
    }
    throw new SafeValidationError("invalid_github_context");
  } finally {
    await handle?.close();
  }
}

export async function bindingFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<GitHubBinding> {
  const eventName = environment.GITHUB_EVENT_NAME;
  const repositoryMatch = environment.GITHUB_REPOSITORY?.match(REPOSITORY_PATTERN);
  const eventPath = environment.GITHUB_EVENT_PATH;
  const githubSha = environment.GITHUB_SHA;

  if (!repositoryMatch || !eventPath || !githubSha || !SHA_PATTERN.test(githubSha)) {
    throw new SafeValidationError("invalid_github_context");
  }

  const event = await readEvent(eventPath);
  const owner = repositoryMatch[1] as string;
  const name = repositoryMatch[2] as string;

  if (eventName === "pull_request") {
    const pullRequest = objectAt(event, "pull_request");
    const headSha = stringAt(objectAt(pullRequest, "head"), "sha");
    const baseSha = stringAt(objectAt(pullRequest, "base"), "sha");
    if (!headSha || !baseSha || !SHA_PATTERN.test(headSha) || !SHA_PATTERN.test(baseSha)) {
      throw new SafeValidationError("invalid_github_context");
    }
    return { owner, name, eventName, headSha, baseSha };
  }

  if (eventName === "push") {
    const before = stringAt(event, "before");
    const baseSha = before && SHA_PATTERN.test(before) && !/^0+$/.test(before) ? before : undefined;
    return {
      owner,
      name,
      eventName,
      headSha: githubSha,
      ...(baseSha === undefined ? {} : { baseSha }),
    };
  }

  if (eventName === "workflow_dispatch") {
    return { owner, name, eventName, headSha: githubSha };
  }

  throw new SafeValidationError("unsupported_event");
}
