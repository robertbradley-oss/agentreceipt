import type { ValidationReport } from "./types.js";

const LABELS = {
  schema: "Schema and semantics",
  privacy: "Privacy rules",
  integrity: "Integrity digest",
  repository_binding: "Repository and commit binding",
  capture_completeness: "Capture completeness",
} as const;

const STATUS = {
  pass: "PASS",
  fail: "FAIL",
  warning: "WARNING",
  not_run: "NOT RUN",
} as const;

function escapeMarkdownCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\r", " ").replaceAll("\n", " ");
}

export function renderSafeSummary(report: ValidationReport): string {
  const rows = report.checks.map((entry) => (
    `| ${LABELS[entry.name]} | ${STATUS[entry.status]} | ${escapeMarkdownCell(entry.reason)} |`
  ));

  return [
    "# AgentReceipt validation",
    "",
    `**Result: ${report.passed ? "PASS" : "FAIL"}**`,
    "",
    "| Check | Status | Safe result |",
    "| --- | --- | --- |",
    ...rows,
    "",
    "> This validates receipt evidence and GitHub binding. It does not determine code quality or prove that unobserved work did not occur.",
    "",
  ].join("\n");
}
