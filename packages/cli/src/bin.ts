#!/usr/bin/env node

import { CliError, executeCli } from "./index.js";

try {
  const output = await executeCli(process.argv.slice(2));
  process.stdout.write(output);
} catch (error) {
  const exitCode = error instanceof CliError ? error.exitCode : 1;
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`AgentReceipt error: ${message}\n`);
  process.exitCode = exitCode;
}
