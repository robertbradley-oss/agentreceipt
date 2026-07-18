import type { AgentReceipt } from "@agentreceipt/schema";

interface ReceiptView {
  receipt_id: string;
  task: { title: string; description: string };
  session: { status: string; started_at: string; ended_at: string };
  repository: {
    owner: string;
    name: string;
    branch: string;
    binding_status: "draft" | "finalized";
    base_sha?: string;
    head_sha?: string;
  };
  capture: { source: string; surface?: string; status?: string; limitations?: string[] };
  events: unknown[];
  files: Array<{
    path: string;
    change: string;
    additions: number;
    deletions: number;
    line_counts_known?: boolean;
  }>;
  verification: {
    status: string;
    tests: { passed: number; failed: number; skipped: number };
  };
  integrity?: { content_digest: string };
}

export function formatReceipt(receipt: AgentReceipt): string {
  const view = receipt as unknown as ReceiptView;
  const simulated = view.capture.source === "simulated";
  const heading = simulated
    ? "SIMULATED RECEIPT — NOT AGENT OBSERVATION"
    : view.capture.status === "complete_for_declared_surface"
      ? "CODEX RECEIPT — COMPLETE FOR DECLARED SURFACE"
      : view.capture.status === "failed"
        ? "FAILED CODEX RECEIPT"
        : "PARTIAL CODEX RECEIPT";
  const lines = [
    heading,
    "=".repeat(heading.length),
    `Task:       ${view.task.title}`,
    `Status:     ${view.verification.status}`,
    `Capture:    ${view.capture.status?.replaceAll("_", " ") ?? "unspecified"}`,
    `Surface:    ${view.capture.surface ?? view.capture.source}`,
    `Repository: ${view.repository.owner}/${view.repository.name} (${view.repository.branch})`,
    `Binding:    ${view.repository.binding_status}`,
    `Receipt:    ${view.receipt_id}`,
    `Events:     ${view.events.length}`,
    `Tests:      ${view.verification.tests.passed} passed, ${view.verification.tests.failed} failed, ${view.verification.tests.skipped} skipped`,
    "",
    "Files:",
    ...view.files.map((file) => `  ${file.change.padEnd(8)} ${file.path}${
      file.line_counts_known === false
        ? "  (line counts unavailable)"
        : `  +${file.additions} -${file.deletions}`
    }`),
  ];

  if (view.capture.limitations?.length) {
    lines.push("", "Limitations:", ...view.capture.limitations.map((limitation) => `  - ${limitation}`));
  }

  if (view.integrity) {
    lines.push("", `Content digest: ${view.integrity.content_digest}`);
  }

  return `${lines.join("\n")}\n`;
}
