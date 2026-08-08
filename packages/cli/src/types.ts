import type {
  CodexCaptureResult,
  CodexCaptureWithPrivateProjection,
  CodexPrivateRunOptions,
  CodexRunOptions,
} from "@agentreceipt/codex-adapter";

import type { SafeCaptureDiagnosticClassification } from "./safe-capture-diagnostic.js";

export interface RepositoryFileChange {
  path: string;
  previousPath?: string;
  change: "added" | "modified" | "deleted" | "renamed";
  additions: number;
  deletions: number;
  lineCountsKnown: boolean;
  beforeDigest?: `sha256:${string}`;
  afterDigest?: `sha256:${string}`;
}

export interface RepositorySnapshot {
  root: string;
  owner: string;
  name: string;
  branch: string;
  headSha: string;
  isClean: boolean;
  limitations: string[];
}

export interface VerificationResult {
  startedAt: string;
  endedAt: string;
  durationMs: number;
  exitCode: number;
}

export interface ActiveSession {
  state_version: "0.1";
  simulation: true;
  receipt_id: string;
  session_id: string;
  started_at: string;
  task: {
    title: string;
    description: string;
  };
  repository: {
    owner: string;
    name: string;
    branch: string;
    capture_start_sha: string;
  };
  limitations: string[];
}

export interface CliDependencies {
  cwd: string;
  environment: NodeJS.ProcessEnv;
  now: () => Date;
  randomUUID: () => string;
  readRepository: (cwd: string) => Promise<RepositorySnapshot>;
  readRepositoryChanges: (root: string, baseSha: string) => Promise<RepositoryFileChange[]>;
  runCodexCapture: (options: CodexRunOptions) => Promise<CodexCaptureResult>;
  runCodexCaptureWithPrivateProjection: (
    options: CodexPrivateRunOptions,
  ) => Promise<CodexCaptureWithPrivateProjection>;
  runVerification: (command: string, cwd: string, now?: () => Date) => Promise<VerificationResult>;
  onSafeCaptureDiagnostic?: (
    classification: SafeCaptureDiagnosticClassification,
  ) => void | Promise<void>;
}
