import { execFile, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { promisify } from "node:util";

import { CodexJsonlCapture } from "./parser.js";
import { CodexPrivateProjectionCapture } from "./capsule.js";
import type {
  CodexCaptureResult,
  CodexCaptureWithPrivateProjection,
  CodexPrivateRunOptions,
  CodexRunOptions,
} from "./types.js";

const execFileAsync = promisify(execFile);

async function readCliVersion(
  executable: string,
  argsPrefix: string[],
  cwd: string,
): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(executable, [...argsPrefix, "--version"], {
      cwd,
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 4096,
    });
    const match = stdout.trim().match(/^codex-cli\s+([0-9A-Za-z.+-]+)$/);
    return match?.[1];
  } catch {
    return undefined;
  }
}

async function runCapture(
  options: CodexRunOptions,
  privateProjection?: CodexPrivateProjectionCapture,
): Promise<CodexCaptureWithPrivateProjection | { capture: CodexCaptureResult }> {
  const executable = options.executable ?? process.env.AGENTRECEIPT_CODEX_PATH ?? "codex";
  const argsPrefix = options.executableArgsPrefix ?? [];
  const now = options.now ?? (() => new Date());
  const parser = new CodexJsonlCapture();
  const cliVersion = await readCliVersion(executable, argsPrefix, options.cwd);

  const child = spawn(
    executable,
    [
      ...argsPrefix,
      "exec",
      "--json",
      "--ephemeral",
      "--ignore-user-config",
      "--ignore-rules",
      "--sandbox",
      options.sandbox,
      "-",
    ],
    {
      cwd: options.cwd,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );

  // Send the prompt over stdin so it does not appear in the child process command line.
  child.stdin?.on("error", () => undefined);
  child.stdin?.end(options.prompt);

  let spawnFailed = false;
  child.once("error", () => {
    spawnFailed = true;
  });

  // Codex progress output may contain sensitive content. Drain it without retaining or logging it.
  child.stderr?.on("data", () => undefined);

  if (child.stdout) {
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    for await (const line of lines) {
      const observedAt = now();
      parser.ingest(line, observedAt);
      privateProjection?.ingest(line, observedAt);
    }
  }

  const exitCode = await new Promise<number>((resolve) => {
    if (child.exitCode !== null) {
      resolve(child.exitCode);
      return;
    }
    child.once("close", (code) => resolve(code ?? 1));
    child.once("error", () => resolve(1));
  });

  const result = parser.finish(spawnFailed ? 1 : exitCode, cliVersion);
  if (spawnFailed) {
    result.limitations.push("The Codex executable could not be started.");
  }
  return {
    capture: result,
    ...(privateProjection ? { private_projection: privateProjection.finish() } : {}),
  };
}

export async function runCodexCapture(options: CodexRunOptions): Promise<CodexCaptureResult> {
  return (await runCapture(options)).capture;
}

export async function runCodexCaptureWithPrivateProjection(
  options: CodexPrivateRunOptions,
): Promise<CodexCaptureWithPrivateProjection> {
  return await runCapture(
    options,
    new CodexPrivateProjectionCapture(options.parameters ?? []),
  ) as CodexCaptureWithPrivateProjection;
}
