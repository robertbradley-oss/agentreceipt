export type ComponentFunction = "observe" | "transform" | "act" | "verify" | "recover";

export type ComponentRisk = "none" | "read" | "reversible_write" | "destructive_write";

export type EvidenceOutcome = "success" | "failure" | "blocked";

export interface RawTraceComponent {
  id?: string;
  receiptId?: string;
  tool: string;
  operation?: string;
  capability?: string;
  description?: string;
  function?: ComponentFunction;
  aliases?: readonly string[];
  inputs?: readonly string[];
  outputs?: readonly string[];
  parameterKeys?: readonly string[];
  requiredParameterKeys?: readonly string[];
  requiredScopes?: readonly string[];
  risk?: ComponentRisk;
  mutates?: boolean;
  version?: string;
  outcome?: EvidenceOutcome;
  observedAt?: string;
  durationMs?: number;
}

export interface TraceSubmission {
  traceRef: string;
  observedAt?: string;
  components: readonly RawTraceComponent[];
}

export interface EvidenceReceipt {
  id: string;
  traceRef: string;
  outcome: EvidenceOutcome;
  observedAt: string;
  durationMs: number | null;
}

export interface ComponentProfile {
  id: string;
  key: string;
  function: ComponentFunction;
  capability: string;
  aliases: string[];
  tool: string;
  description: string;
  inputs: string[];
  outputs: string[];
  parameterKeys: string[];
  requiredParameterKeys: string[];
  requiredScopes: string[];
  risk: ComponentRisk;
  mutates: boolean;
  version: string;
}

export interface CatalogComponent extends ComponentProfile {
  createdAt: string;
  updatedAt: string;
  evidence: EvidenceReceipt[];
}

export interface CatalogSnapshot {
  schemaVersion: 1;
  components: CatalogComponent[];
  integrity: {
    algorithm: "sha256";
    contentDigest: `sha256:${string}`;
  };
}

export interface FunctionalNeed {
  id: string;
  function: ComponentFunction;
  capability: string;
  aliases?: readonly string[];
  inputs?: readonly string[];
  outputs?: readonly string[];
  dependsOn?: readonly string[];
  requiredScopes?: readonly string[];
  maxRisk?: ComponentRisk;
  minScore?: number;
}

export interface NormalizedNeed {
  id: string;
  function: ComponentFunction;
  capability: string;
  aliases: string[];
  inputs: string[];
  outputs: string[];
  dependsOn: string[];
  requiredScopes: string[];
  maxRisk: ComponentRisk;
  minScore?: number;
}

export interface ScoringPolicy {
  allowWrites?: boolean;
  allowedScopes?: readonly string[];
  approvedWriteScopes?: readonly string[];
}

export interface ScoreBreakdown {
  capability: number;
  artifacts: number;
  reliability: number;
  evidenceDiversity: number;
  freshness: number;
  scopeFit: number;
}

export interface RankedComponent {
  component: CatalogComponent;
  score: number;
  breakdown: ScoreBreakdown;
  evidence: {
    attempts: number;
    successes: number;
    distinctTraces: number;
  };
}

export interface StructuredIntent {
  id?: string;
  goal?: string;
  needs: readonly FunctionalNeed[];
}

export interface RunRequest {
  intent: StructuredIntent;
  initialArtifacts?: readonly string[];
  policy?: ScoringPolicy;
  parameters?: Readonly<Record<string, unknown>>;
  parametersByNeed?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

export interface RailStep {
  position: number;
  needId: string;
  directive: string;
  componentId: string;
  function: ComponentFunction;
  tool: string;
  parameters: Record<string, unknown>;
  score: number;
  scoreBreakdown: ScoreBreakdown;
  evidence: RankedComponent["evidence"];
  guard:
    | { type: "read_only"; approved: true }
    | { type: "write"; scopes: string[]; approved: true };
  produces: string[];
}

export interface CoverageGap {
  need: NormalizedNeed;
  reason:
    | "unmet_prerequisite"
    | "no_policy_safe_candidate"
    | "low_confidence"
    | "missing_parameters";
  missingDependencies?: string[];
  missingInputs?: string[];
  missingParameters?: string[];
  bestCandidate?: { componentId: string; score: number } | null;
}

export interface RailPlan {
  schemaVersion: 1;
  status: "covered" | "partial" | "uncovered";
  intentId: string;
  rail: RailStep[];
  gaps: CoverageGap[];
  coverage: number;
  initialArtifacts: string[];
  finalArtifacts: string[];
}
