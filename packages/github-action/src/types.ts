export type CheckStatus = "pass" | "fail" | "warning" | "not_run";

export type CheckName =
  | "schema"
  | "privacy"
  | "integrity"
  | "repository_binding"
  | "capture_completeness";

export interface ValidationCheck {
  name: CheckName;
  status: CheckStatus;
  reason: string;
}

export interface ValidationReport {
  passed: boolean;
  checks: ValidationCheck[];
  failureCode?: string;
}

export interface GitHubBinding {
  owner: string;
  name: string;
  headSha: string;
  baseSha?: string;
  eventName: "pull_request" | "push" | "workflow_dispatch";
}

export interface ValidationOptions {
  workspace: string;
  receiptPath: string;
  allowPartial: boolean;
  binding: GitHubBinding;
  maxBytes?: number;
}
