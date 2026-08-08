import { type ComponentCatalog, normalizeNeed, parametersFor } from "./catalog.js";
import type {
  NormalizedNeed,
  RailPlan,
  RailStep,
  RunRequest,
  StructuredIntent,
} from "./types.js";
import { assert, normalizeToken, unique } from "./utils.js";

export interface NeedSplitter {
  split(intent: StructuredIntent): NormalizedNeed[];
}

/** Safe default boundary between an agent/LLM intent and deterministic planning. */
export class StructuredNeedSplitter implements NeedSplitter {
  split(intent: StructuredIntent): NormalizedNeed[] {
    assert(intent && typeof intent === "object", "Preflight intent must be structured");
    assert(intent.needs.length > 0, "Preflight intent requires needs");
    return intent.needs.map(normalizeNeed);
  }
}

interface PlannerOptions {
  catalog: ComponentCatalog;
  splitter?: NeedSplitter;
  minScore?: number;
}

export class PreflightPlanner {
  readonly #catalog: ComponentCatalog;
  readonly #splitter: NeedSplitter;
  readonly #minScore: number;

  constructor(options: PlannerOptions) {
    assert(options.catalog, "PreflightPlanner requires a component catalog");
    this.#catalog = options.catalog;
    this.#splitter = options.splitter ?? new StructuredNeedSplitter();
    this.#minScore = options.minScore ?? 0.58;
    assert(this.#minScore >= 0 && this.#minScore <= 1, "minScore must be between 0 and 1");
  }

  plan(request: RunRequest): RailPlan {
    assert(request.intent, "A run request requires an intent");
    const needs = orderNeeds(this.#splitter.split(request.intent));
    const initialArtifacts = unique((request.initialArtifacts ?? []).map(normalizeToken));
    const availableArtifacts = new Set(initialArtifacts);
    const completedNeeds = new Set<string>();
    const rail: RailStep[] = [];
    const gaps: RailPlan["gaps"] = [];

    for (const need of needs) {
      const missingDependencies = need.dependsOn.filter((dependency) => !completedNeeds.has(dependency));
      const missingInputs = need.inputs.filter((input) => !availableArtifacts.has(input));
      if (missingDependencies.length > 0 || missingInputs.length > 0) {
        gaps.push({ need, reason: "unmet_prerequisite", missingDependencies, missingInputs });
        continue;
      }

      const ranked = this.#catalog
        .rank(need, request.policy)
        .filter((candidate) => candidate.component.inputs.every((input) => availableArtifacts.has(input)));
      const minimumScore = need.minScore ?? this.#minScore;
      const confident = ranked.filter((candidate) => candidate.score >= minimumScore);
      const providedParameters = {
        ...(request.parameters ?? {}),
        ...(request.parametersByNeed?.[need.id] ?? {}),
      };
      const winner = confident.find((candidate) => (
        candidate.component.requiredParameterKeys.every((key) => Object.hasOwn(providedParameters, key))
      ));
      if (!winner) {
        const missingParameters = confident[0]?.component.requiredParameterKeys
          .filter((key) => !Object.hasOwn(providedParameters, key));
        gaps.push({
          need,
          reason: ranked.length === 0
            ? "no_policy_safe_candidate"
            : confident.length === 0
              ? "low_confidence"
              : "missing_parameters",
          ...(missingParameters && missingParameters.length > 0 ? { missingParameters } : {}),
          bestCandidate: ranked[0]
            ? { componentId: ranked[0].component.id, score: ranked[0].score }
            : null,
        });
        continue;
      }

      const parameters = {
        ...parametersFor(winner.component, request.parameters),
        ...parametersFor(winner.component, request.parametersByNeed?.[need.id]),
      };
      const guard: RailStep["guard"] = winner.component.mutates
        ? { type: "write", scopes: [...winner.component.requiredScopes], approved: true }
        : { type: "read_only", approved: true };
      rail.push({
        position: rail.length + 1,
        needId: need.id,
        directive: winner.component.description,
        componentId: winner.component.id,
        function: winner.component.function,
        tool: winner.component.tool,
        parameters,
        score: winner.score,
        scoreBreakdown: winner.breakdown,
        evidence: winner.evidence,
        guard,
        produces: [...winner.component.outputs],
      });
      winner.component.outputs.forEach((output) => availableArtifacts.add(output));
      completedNeeds.add(need.id);
    }

    return {
      schemaVersion: 1,
      status: gaps.length === 0 ? "covered" : rail.length === 0 ? "uncovered" : "partial",
      intentId: normalizeToken(request.intent.id ?? "run"),
      rail,
      gaps,
      coverage: Number((rail.length / needs.length).toFixed(4)),
      initialArtifacts,
      finalArtifacts: [...availableArtifacts].sort(),
    };
  }
}

function orderNeeds(needs: NormalizedNeed[]): NormalizedNeed[] {
  const byId = new Map(needs.map((need) => [need.id, need]));
  assert(byId.size === needs.length, "Preflight need ids must be unique");
  for (const need of needs) {
    for (const dependency of need.dependsOn) {
      assert(byId.has(dependency), `Need ${need.id} depends on unknown need ${dependency}`);
    }
  }

  const ordered: NormalizedNeed[] = [];
  const temporary = new Set<string>();
  const permanent = new Set<string>();
  const visit = (need: NormalizedNeed): void => {
    if (permanent.has(need.id)) return;
    assert(!temporary.has(need.id), `Preflight needs contain a cycle at ${need.id}`);
    temporary.add(need.id);
    for (const dependency of need.dependsOn) visit(byId.get(dependency)!);
    temporary.delete(need.id);
    permanent.add(need.id);
    ordered.push(need);
  };
  needs.forEach(visit);
  return ordered;
}
