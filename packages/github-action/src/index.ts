import * as core from "@actions/core";
import { appendFile } from "node:fs/promises";

import { bindingFromEnvironment } from "./context.js";
import { SafeValidationError } from "./errors.js";
import { renderSafeSummary } from "./summary.js";
import type { ValidationReport } from "./types.js";
import { executeValidation } from "./validate.js";

function fatalReport(): ValidationReport {
  return {
    passed: false,
    failureCode: "invalid_github_context",
    checks: [
      { name: "schema", status: "not_run", reason: "GitHub context validation failed safely." },
      { name: "privacy", status: "not_run", reason: "GitHub context validation failed safely." },
      { name: "integrity", status: "not_run", reason: "GitHub context validation failed safely." },
      { name: "finalization", status: "not_run", reason: "GitHub context validation failed safely." },
      { name: "repository_binding", status: "not_run", reason: "GitHub context validation failed safely." },
      { name: "capture_completeness", status: "not_run", reason: "GitHub context validation failed safely." },
    ],
  };
}

function parseAllowPartial(value: string): boolean {
  if (value === "true") return true;
  if (value === "false" || value === "") return false;
  throw new SafeValidationError("invalid_input");
}

async function writeSummary(report: ValidationReport): Promise<void> {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) {
    return;
  }
  await appendFile(summaryPath, renderSafeSummary(report), { encoding: "utf8" });
}

async function run(): Promise<void> {
  let report: ValidationReport;
  try {
    const workspace = process.env.GITHUB_WORKSPACE;
    if (!workspace) {
      throw new SafeValidationError("invalid_github_context");
    }
    const binding = await bindingFromEnvironment();
    report = await executeValidation({
      workspace,
      receiptPath: core.getInput("receipt-path", { required: true }),
      allowPartial: parseAllowPartial(core.getInput("allow-partial")),
      binding,
    });
  } catch {
    report = fatalReport();
  }

  try {
    await writeSummary(report);
  } catch {
    report = fatalReport();
  }

  core.setOutput("result", report.passed ? "pass" : "fail");
  if (report.checks.some((entry) => entry.status === "warning")) {
    core.warning("AgentReceipt accepted a partial capture by explicit opt-in.");
  }
  if (!report.passed) {
    core.setFailed("AgentReceipt validation failed. See the step summary for safe check results.");
  } else {
    core.info("AgentReceipt validation passed.");
  }
}

void run();
