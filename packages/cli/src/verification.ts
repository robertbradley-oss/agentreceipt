import { spawn } from "node:child_process";

import type { VerificationResult } from "./types.js";

export async function runVerification(
  command: string,
  cwd: string,
  now: () => Date = () => new Date(),
): Promise<VerificationResult> {
  const started = now();
  const child = spawn(command, {
    cwd,
    shell: true,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  // Verification output can contain source, paths, or credentials. Drain it without retaining it.
  child.stdout?.on("data", () => undefined);
  child.stderr?.on("data", () => undefined);

  const exitCode = await new Promise<number>((resolve) => {
    child.once("close", (code) => resolve(code ?? 1));
    child.once("error", () => resolve(1));
  });
  const ended = now();

  return {
    startedAt: started.toISOString(),
    endedAt: ended.toISOString(),
    durationMs: Math.max(0, ended.getTime() - started.getTime()),
    exitCode,
  };
}
