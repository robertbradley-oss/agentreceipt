import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { runCodexCapture } from "@agentreceipt/codex-adapter";
import { assertReceipt, type AgentReceipt } from "@agentreceipt/schema";

import { parseArguments, rejectUnknownOptions, stringOption } from "./args.js";
import { createCodexReceipt } from "./codex.js";
import { CliError } from "./errors.js";
import { formatReceipt } from "./format.js";
import { readRepository, readRepositoryChanges } from "./git.js";
import { createSimulatedReceipt } from "./simulation.js";
import {
  createActiveSession,
  findStoreRoot,
  finishActiveSession,
  hasLatestReceipt,
  readActiveSession,
  readLatestReceipt,
  readReceiptFile,
  writeCompletedReceipt,
} from "./storage.js";
import type { ActiveSession, CliDependencies } from "./types.js";
import { runVerification } from "./verification.js";

const helpText = `AgentReceipt CLI

Usage:
  agentreceipt start --title <title> [--description <text>]
  agentreceipt finish [--result pass|fail] [--file <relative-path>] [--tests <count>]
  agentreceipt codex --title <title> --prompt <text> [--description <text>] [--sandbox read-only|workspace-write] [--verify <command>]
  agentreceipt inspect [receipt.json] [--json]

Commands:
  start    Begin a simulated recording in the current Git repository.
  finish   Generate and validate a simulated receipt, then archive the session.
  codex    Run one wrapped Codex exec JSONL session and create a privacy-safe receipt.
  inspect  Show the active session or the latest completed receipt.

The start/finish workflow remains simulated. The codex command requires a clean Git worktree,
discards prompts, messages, reasoning, commands, and command output before persistence, and
never claims capture beyond the wrapped Codex JSONL surface.
`;

function defaultDependencies(): CliDependencies {
  return {
    cwd: process.cwd(),
    now: () => new Date(),
    randomUUID,
    readRepository,
    readRepositoryChanges,
    runCodexCapture,
    runVerification,
  };
}

function withDependencies(overrides: Partial<CliDependencies>): CliDependencies {
  return { ...defaultDependencies(), ...overrides };
}

function requireNoPositionals(positionals: string[], command: string): void {
  if (positionals.length > 0) {
    throw new CliError(`${command} does not accept positional arguments.`, 2);
  }
}

async function startCommand(
  parsed: ReturnType<typeof parseArguments>,
  dependencies: CliDependencies,
): Promise<string> {
  rejectUnknownOptions(parsed, ["title", "description"]);
  requireNoPositionals(parsed.positionals, "start");
  const title = stringOption(parsed, "title", { required: true })!;
  const description = stringOption(parsed, "description", { fallback: title })!;

  if (title.length > 160) {
    throw new CliError("--title must be 160 characters or fewer.", 2);
  }

  const repository = await dependencies.readRepository(dependencies.cwd);
  const startedAt = dependencies.now().toISOString();
  const session: ActiveSession = {
    state_version: "0.1",
    simulation: true,
    receipt_id: dependencies.randomUUID(),
    session_id: dependencies.randomUUID(),
    started_at: startedAt,
    task: { title, description },
    repository: {
      owner: repository.owner,
      name: repository.name,
      branch: repository.branch,
      base_sha: repository.headSha,
    },
    limitations: [
      "This session uses generated events and is not connected to Codex.",
      ...repository.limitations,
    ],
  };

  await createActiveSession(repository.root, session);
  return [
    "Started a simulated AgentReceipt recording.",
    `Task: ${title}`,
    `Session: ${session.session_id}`,
    "Run `agentreceipt finish` to generate the receipt.",
    "",
  ].join("\n");
}

function parseTestCount(value: string | undefined): number {
  const parsed = Number(value ?? "12");
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100000) {
    throw new CliError("--tests must be an integer between 1 and 100000.", 2);
  }
  return parsed;
}

async function finishCommand(
  parsed: ReturnType<typeof parseArguments>,
  dependencies: CliDependencies,
): Promise<string> {
  rejectUnknownOptions(parsed, ["result", "file", "tests"]);
  requireNoPositionals(parsed.positionals, "finish");
  const result = stringOption(parsed, "result", { fallback: "pass" });
  const filePath = stringOption(parsed, "file", { fallback: "src/simulated-change.ts" })!;
  const testCount = parseTestCount(stringOption(parsed, "tests"));

  if (result !== "pass" && result !== "fail") {
    throw new CliError("--result must be either pass or fail.", 2);
  }

  const root = await findStoreRoot(dependencies.cwd);
  const session = await readActiveSession(root);
  const repository = await dependencies.readRepository(root);
  const receipt = createSimulatedReceipt(session, repository, {
    endedAt: dependencies.now(),
    filePath,
    result,
    testCount,
  });
  const receiptPath = await finishActiveSession(root, session, receipt);

  return [
    "Finished the simulated AgentReceipt recording.",
    `Result: ${result}`,
    `Receipt: ${receiptPath}`,
    "Run `agentreceipt inspect` to view the summary.",
    "",
  ].join("\n");
}

async function codexCommand(
  parsed: ReturnType<typeof parseArguments>,
  dependencies: CliDependencies,
): Promise<string> {
  rejectUnknownOptions(parsed, ["title", "description", "prompt", "sandbox", "verify"]);
  requireNoPositionals(parsed.positionals, "codex");
  const title = stringOption(parsed, "title", { required: true })!;
  const description = stringOption(parsed, "description", { fallback: title })!;
  const prompt = stringOption(parsed, "prompt", { required: true })!;
  const sandbox = stringOption(parsed, "sandbox", { fallback: "read-only" })!;
  const verificationCommand = stringOption(parsed, "verify");

  if (title.length > 160) {
    throw new CliError("--title must be 160 characters or fewer.", 2);
  }
  if (description.length > 4000) {
    throw new CliError("--description must be 4000 characters or fewer.", 2);
  }
  if (prompt.length > 32000) {
    throw new CliError("--prompt must be 32000 characters or fewer.", 2);
  }
  if (sandbox !== "read-only" && sandbox !== "workspace-write") {
    throw new CliError("--sandbox must be either read-only or workspace-write.", 2);
  }

  const repositoryBefore = await dependencies.readRepository(dependencies.cwd);
  if (repositoryBefore.isClean === false) {
    throw new CliError(
      "The codex command requires a clean Git worktree so changes can be attributed honestly. Commit or stash existing work first.",
    );
  }

  const startedAt = dependencies.now();
  const capture = await dependencies.runCodexCapture({
    cwd: repositoryBefore.root,
    prompt,
    sandbox,
    now: dependencies.now,
  });
  const verification = verificationCommand
    ? await dependencies.runVerification(verificationCommand, repositoryBefore.root, dependencies.now)
    : undefined;

  const gitLimitations: string[] = [];
  let repositoryAfter = repositoryBefore;
  try {
    repositoryAfter = await dependencies.readRepository(repositoryBefore.root);
  } catch {
    gitLimitations.push("The final Git repository state could not be read; the starting state was retained.");
  }

  let changes: Awaited<ReturnType<CliDependencies["readRepositoryChanges"]>> = [];
  try {
    changes = await dependencies.readRepositoryChanges(repositoryBefore.root, repositoryBefore.headSha);
  } catch {
    gitLimitations.push("The changed-file summary could not be collected independently.");
  }

  const endedAt = dependencies.now();
  const receiptId = dependencies.randomUUID();
  const receipt = createCodexReceipt({
    receiptId,
    sessionId: dependencies.randomUUID(),
    title,
    description,
    startedAt,
    endedAt,
    repositoryBefore,
    repositoryAfter,
    changes,
    capture,
    ...(verification ? { verification } : {}),
    additionalLimitations: gitLimitations,
  });
  const receiptPath = await writeCompletedReceipt(repositoryBefore.root, receiptId, receipt);
  const view = receipt as unknown as { capture: { status: string } };

  return [
    "Captured a wrapped Codex AgentReceipt.",
    `Capture: ${view.capture.status.replaceAll("_", " ")}`,
    `Receipt: ${receiptPath}`,
    "Run `agentreceipt inspect` to view the evidence and limitations.",
    "",
  ].join("\n");
}

function formatActiveSession(session: ActiveSession): string {
  return [
    "SIMULATED RECORDING ACTIVE",
    "==========================",
    `Task:    ${session.task.title}`,
    `Session: ${session.session_id}`,
    `Started: ${session.started_at}`,
    "",
    "Run `agentreceipt finish` to generate a simulated receipt.",
    "",
  ].join("\n");
}

async function inspectCommand(
  parsed: ReturnType<typeof parseArguments>,
  dependencies: CliDependencies,
): Promise<string> {
  rejectUnknownOptions(parsed, ["json"]);
  if (parsed.positionals.length > 1) {
    throw new CliError("inspect accepts at most one receipt path.", 2);
  }
  const jsonOption = parsed.options.get("json");
  if (jsonOption !== undefined && jsonOption !== true) {
    throw new CliError("--json does not accept a value.", 2);
  }

  let value: unknown;
  if (parsed.positionals[0]) {
    value = await readReceiptFile(resolve(dependencies.cwd, parsed.positionals[0]));
  } else {
    const root = await findStoreRoot(dependencies.cwd);
    if (!(await hasLatestReceipt(root))) {
      return formatActiveSession(await readActiveSession(root));
    }
    value = await readLatestReceipt(root);
  }

  assertReceipt(value);
  return jsonOption === true
    ? `${JSON.stringify(value, null, 2)}\n`
    : formatReceipt(value as AgentReceipt);
}

export async function executeCli(
  args: string[],
  overrides: Partial<CliDependencies> = {},
): Promise<string> {
  const parsed = parseArguments(args);
  const dependencies = withDependencies(overrides);

  switch (parsed.command) {
    case undefined:
    case "help":
    case "--help":
    case "-h":
      return helpText;
    case "start":
      return startCommand(parsed, dependencies);
    case "finish":
      return finishCommand(parsed, dependencies);
    case "codex":
      return codexCommand(parsed, dependencies);
    case "inspect":
      return inspectCommand(parsed, dependencies);
    default:
      throw new CliError(`Unknown command: ${parsed.command}\n\n${helpText}`, 2);
  }
}

export { CliError } from "./errors.js";
export { readRepository, readRepositoryChanges } from "./git.js";
export { runVerification } from "./verification.js";
export type {
  CliDependencies,
  RepositoryFileChange,
  RepositorySnapshot,
  VerificationResult,
} from "./types.js";
