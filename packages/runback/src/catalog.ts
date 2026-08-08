import { Housekeeper } from "./housekeeper.js";
import type {
  CatalogComponent,
  CatalogSnapshot,
  ComponentRisk,
  EvidenceReceipt,
  FunctionalNeed,
  NormalizedNeed,
  RankedComponent,
  RawTraceComponent,
  ScoreBreakdown,
  ScoringPolicy,
  TraceSubmission,
} from "./types.js";
import { assert, clamp, normalizeToken, overlapScore, riskValue, round, unique } from "./utils.js";

const SCORE_WEIGHTS: Readonly<Record<keyof ScoreBreakdown, number>> = Object.freeze({
  capability: 0.3,
  artifacts: 0.18,
  reliability: 0.25,
  evidenceDiversity: 0.12,
  freshness: 0.05,
  scopeFit: 0.1,
});

interface CatalogOptions {
  housekeeper?: Housekeeper;
  snapshot?: CatalogSnapshot;
  now?: () => Date;
}

export class ComponentCatalog {
  readonly #entries = new Map<string, CatalogComponent>();
  readonly #receiptOwners = new Map<string, string>();
  readonly #housekeeper: Housekeeper;
  readonly #now: () => Date;

  constructor(options: CatalogOptions = {}) {
    this.#housekeeper = options.housekeeper ?? new Housekeeper();
    this.#now = options.now ?? (() => new Date());
    if (options.snapshot !== undefined) this.#loadSnapshot(options.snapshot);
  }

  mergeSnapshot(snapshot: CatalogSnapshot): void {
    this.#loadSnapshot(snapshot);
  }

  #loadSnapshot(snapshot: CatalogSnapshot): void {
    assert(snapshot && snapshot.schemaVersion === 1, "Unsupported catalog snapshot");
    assert(Array.isArray(snapshot.components), "A catalog snapshot requires components");
    assert(
      snapshot.integrity?.algorithm === "sha256"
        && /^sha256:[a-f0-9]{64}$/.test(snapshot.integrity.contentDigest)
        && snapshot.integrity.contentDigest === snapshotDigest(snapshot.components),
      "Catalog snapshot integrity is invalid",
    );
    for (const entry of snapshot.components) {
      assert(entry && typeof entry === "object", "Catalog components must be objects");
      assert(Array.isArray(entry.evidence) && entry.evidence.length > 0, "Catalog components require evidence");
      const raw: RawTraceComponent = {
        tool: entry.tool,
        capability: entry.capability,
        description: entry.description,
        function: entry.function,
        aliases: entry.aliases,
        inputs: entry.inputs,
        outputs: entry.outputs,
        parameterKeys: entry.parameterKeys,
        requiredParameterKeys: entry.requiredParameterKeys,
        requiredScopes: entry.requiredScopes,
        risk: entry.risk,
        mutates: entry.mutates,
        version: entry.version,
      };
      const normalized = this.#housekeeper.normalizeComponent(raw);
      assert(normalized.key === entry.key && normalized.id === entry.id, "Catalog component identity is invalid");
      const evidence = [...entry.evidence].sort((left, right) => left.observedAt.localeCompare(right.observedAt));
      for (const receipt of evidence) {
        this.submitTrace({
          traceRef: receipt.traceRef,
          observedAt: receipt.observedAt,
          components: [{
            ...raw,
            receiptId: receipt.id,
            outcome: receipt.outcome,
            ...(receipt.durationMs === null ? {} : { durationMs: receipt.durationMs }),
          }],
        });
      }
    }
  }

  /** Dismantles a trace immediately. Neither the run nor its task prose is persisted. */
  submitTrace(trace: TraceSubmission): string[] {
    assert(trace.traceRef, "A traceRef is required");
    assert(trace.components.length > 0, "A trace requires components");
    const accepted: string[] = [];

    trace.components.forEach((raw, index) => {
      const profile = this.#housekeeper.normalizeComponent(raw);
      const receipt = this.#housekeeper.normalizeReceipt(trace, raw, index, this.#now);
      const owner = this.#receiptOwners.get(receipt.id);
      assert(owner === undefined || owner === profile.key, `Receipt ${receipt.id} belongs to another component`);
      const current = this.#entries.get(profile.key);
      if (current) {
        const duplicate = current.evidence.find((evidence) => evidence.id === receipt.id);
        if (duplicate) {
          assert(JSON.stringify(duplicate) === JSON.stringify(receipt), `Receipt ${receipt.id} conflicts with existing evidence`);
          accepted.push(current.id);
          return;
        }
        current.evidence.push(receipt);
        current.createdAt = current.createdAt < receipt.observedAt ? current.createdAt : receipt.observedAt;
        current.updatedAt = current.updatedAt > receipt.observedAt ? current.updatedAt : receipt.observedAt;
        current.aliases = unique([...current.aliases, ...profile.aliases]);
        this.#receiptOwners.set(receipt.id, profile.key);
        accepted.push(current.id);
        return;
      }
      const entry: CatalogComponent = {
        ...profile,
        createdAt: receipt.observedAt,
        updatedAt: receipt.observedAt,
        evidence: [receipt],
      };
      this.#entries.set(profile.key, entry);
      this.#receiptOwners.set(receipt.id, profile.key);
      accepted.push(entry.id);
    });
    return accepted;
  }

  recordUse(componentId: string, receipt: RawTraceComponent & { traceRef: string }): void {
    const entry = [...this.#entries.values()].find((candidate) => candidate.id === componentId);
    assert(entry, `Unknown component: ${componentId}`);
    const normalized = this.#housekeeper.normalizeReceipt(
      { traceRef: receipt.traceRef, ...(receipt.observedAt ? { observedAt: receipt.observedAt } : {}) },
      receipt,
      entry.evidence.length,
      this.#now,
    );
    const owner = this.#receiptOwners.get(normalized.id);
    assert(owner === undefined || owner === entry.key, `Receipt ${normalized.id} belongs to another component`);
    const duplicate = entry.evidence.find((evidence) => evidence.id === normalized.id);
    if (duplicate) {
      assert(JSON.stringify(duplicate) === JSON.stringify(normalized), `Receipt ${normalized.id} conflicts with existing evidence`);
      return;
    }
    entry.evidence.push(normalized);
    entry.createdAt = entry.createdAt < normalized.observedAt ? entry.createdAt : normalized.observedAt;
    entry.updatedAt = entry.updatedAt > normalized.observedAt ? entry.updatedAt : normalized.observedAt;
    this.#receiptOwners.set(normalized.id, entry.key);
  }

  components(functionName?: NormalizedNeed["function"]): CatalogComponent[] {
    const components = [...this.#entries.values()];
    return components
      .filter((entry) => functionName === undefined || entry.function === functionName)
      .map((entry) => structuredClone(entry));
  }

  rank(need: FunctionalNeed | NormalizedNeed, policy: ScoringPolicy = {}): RankedComponent[] {
    const normalizedNeed = normalizeNeed(need);
    return this.components(normalizedNeed.function)
      .map((component) => scoreComponent(component, normalizedNeed, policy, this.#now()))
      .filter((candidate): candidate is RankedComponent => candidate !== null)
      .sort((left, right) => right.score - left.score || left.component.id.localeCompare(right.component.id));
  }

  snapshot(): CatalogSnapshot {
    const components = this.components().map((component) => ({
      ...component,
      evidence: [...component.evidence].sort((left, right) => left.id.localeCompare(right.id)),
    }));
    const sortedComponents = components.sort((left, right) => left.key.localeCompare(right.key));
    return {
      schemaVersion: 1,
      components: sortedComponents,
      integrity: {
        algorithm: "sha256",
        contentDigest: snapshotDigest(sortedComponents),
      },
    };
  }
}

function snapshotDigest(components: CatalogComponent[]): `sha256:${string}` {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify({ schemaVersion: 1, components }))
    .digest("hex")}`;
}

export function normalizeNeed(need: FunctionalNeed | NormalizedNeed): NormalizedNeed {
  assert(need.id, "Each preflight need requires an id");
  assert(need.function, `Need ${need.id} requires a function`);
  assert(need.capability, `Need ${need.id} requires a capability`);
  const normalized: NormalizedNeed = {
    id: normalizeToken(need.id),
    function: need.function,
    capability: normalizeToken(need.capability),
    aliases: unique((need.aliases ?? []).map(normalizeToken)),
    inputs: unique((need.inputs ?? []).map(normalizeToken)),
    outputs: unique((need.outputs ?? []).map(normalizeToken)),
    dependsOn: unique((need.dependsOn ?? []).map(normalizeToken)),
    requiredScopes: unique(need.requiredScopes),
    maxRisk: need.maxRisk ?? "read",
  };
  if (need.minScore !== undefined) {
    assert(Number.isFinite(need.minScore) && need.minScore >= 0 && need.minScore <= 1, "minScore must be between 0 and 1");
    normalized.minScore = need.minScore;
  }
  return normalized;
}

export function scoreComponent(
  component: CatalogComponent,
  need: NormalizedNeed,
  policy: ScoringPolicy,
  now: Date = new Date(),
): RankedComponent | null {
  const capabilityExact = component.capability === need.capability;
  const capabilityAlias = component.aliases.includes(need.capability)
    || need.aliases.some((alias) => alias === component.capability || component.aliases.includes(alias));
  if (!capabilityExact && !capabilityAlias) return null;
  if (riskValue(component.risk) > riskValue(need.maxRisk)) return null;
  if (need.outputs.some((output) => !component.outputs.includes(output))) return null;
  if (need.requiredScopes.some((scope) => !component.requiredScopes.includes(scope))) return null;

  const allowedScopes = new Set(policy.allowedScopes ?? []);
  if (component.requiredScopes.some((scope) => !allowedScopes.has(scope))) return null;
  if (component.mutates && policy.allowWrites !== true) return null;
  const approvedWriteScopes = new Set(policy.approvedWriteScopes ?? []);
  if (component.mutates && component.requiredScopes.some((scope) => !approvedWriteScopes.has(scope))) {
    return null;
  }

  const attempts = component.evidence.filter((receipt) => receipt.outcome !== "blocked").length;
  const successes = component.evidence.filter((receipt) => receipt.outcome === "success").length;
  if (successes === 0) return null;
  const posteriorSuccess = (successes + 1) / (attempts + 2);
  const confidence = 1 - Math.exp(-attempts / 4);
  const reliability = posteriorSuccess * (0.6 + 0.4 * confidence);
  const attemptedEvidence = component.evidence.filter((receipt) => receipt.outcome !== "blocked");
  const distinctTraces = new Set(attemptedEvidence.map((receipt) => receipt.traceRef)).size;
  const evidenceDiversity = clamp(distinctTraces / 5);
  const updatedAt = new Date(component.updatedAt).getTime();
  const ageDays = Number.isNaN(updatedAt) ? Number.POSITIVE_INFINITY : Math.max(0, (now.getTime() - updatedAt) / 86_400_000);
  const freshness = Math.exp(-ageDays / 90);
  const artifacts = (
    overlapScore(component.inputs, need.inputs) + overlapScore(component.outputs, need.outputs)
  ) / 2;
  const scopeFit = need.requiredScopes.length === 0
    ? 1
    : need.requiredScopes.every((scope) => component.requiredScopes.includes(scope)) ? 1 : 0;
  const breakdown: ScoreBreakdown = {
    capability: capabilityExact ? 1 : 0.82,
    artifacts: round(artifacts),
    reliability: round(reliability),
    evidenceDiversity: round(evidenceDiversity),
    freshness: round(freshness),
    scopeFit,
  };
  const score = (Object.keys(SCORE_WEIGHTS) as Array<keyof ScoreBreakdown>)
    .reduce((total, name) => total + breakdown[name] * SCORE_WEIGHTS[name], 0);
  return {
    component,
    score: round(score),
    breakdown,
    evidence: { attempts, successes, distinctTraces },
  };
}

export function parametersFor(
  component: CatalogComponent,
  provided: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return Object.fromEntries(
    component.parameterKeys
      .filter((key) => Object.hasOwn(provided, key))
      .map((key) => [key, provided[key]]),
  );
}

export type { ComponentRisk, EvidenceReceipt };
import { createHash } from "node:crypto";
