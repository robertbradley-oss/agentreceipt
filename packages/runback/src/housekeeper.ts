import type {
  ComponentFunction,
  ComponentProfile,
  ComponentRisk,
  EvidenceOutcome,
  EvidenceReceipt,
  RawTraceComponent,
  TraceSubmission,
} from "./types.js";
import { assert, normalizeToken, unique } from "./utils.js";

const FUNCTIONS = new Set<ComponentFunction>(["observe", "transform", "act", "verify", "recover"]);
const RISKS = new Set<ComponentRisk>(["none", "read", "reversible_write", "destructive_write"]);
const OUTCOMES = new Set<EvidenceOutcome>(["success", "failure", "blocked"]);
const SAFE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const SAFE_PARAMETER_KEY = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

const FUNCTION_SIGNALS: ReadonlyArray<readonly [ComponentFunction, RegExp]> = [
  ["recover", /rollback|restore|revert|undo|recover/],
  ["verify", /assert|check|lint|test|validate|verify|inspect_result/],
  ["act", /apply|create|delete|edit|move|patch|publish|remove|rename|update|write/],
  ["observe", /discover|find|list|load|read|search|status|fetch|get|inspect/],
  ["transform", /compile|convert|format|parse|render|summarize|transform/],
];

/** Converts raw tool events into task-agnostic component profiles. */
export class Housekeeper {
  classify(component: RawTraceComponent): ComponentFunction {
    if (component.function !== undefined) {
      assert(FUNCTIONS.has(component.function), `Unsupported component function: ${String(component.function)}`);
    }
    if (component.function && FUNCTIONS.has(component.function)) return component.function;
    if (component.mutates === true || String(component.risk ?? "").includes("write")) return "act";

    const signal = [component.capability, component.operation, component.tool]
      .filter((value): value is string => Boolean(value))
      .join(" ")
      .toLowerCase();
    for (const [kind, pattern] of FUNCTION_SIGNALS) {
      if (pattern.test(signal)) return kind;
    }
    return "transform";
  }

  normalizeComponent(component: RawTraceComponent): ComponentProfile {
    assert(component && typeof component === "object", "A trace component must be an object");
    assert(component.tool, "A trace component requires a tool");
    assert(component.capability || component.operation, "A trace component requires a capability or operation");

    const fn = this.classify(component);
    const capability = normalizeToken(component.capability ?? component.operation ?? "");
    const tool = normalizeToken(component.tool);
    assert(capability.length > 0, "A component capability must contain a safe token");
    assert(tool.length > 0, "A component tool must contain a safe token");
    const functionalMutation = fn === "act" || fn === "recover";
    if (component.mutates !== undefined) {
      assert(
        component.mutates === functionalMutation,
        `Component function ${fn} conflicts with mutates=${String(component.mutates)}`,
      );
    }
    const mutates = functionalMutation;
    const defaultRisk: ComponentRisk = mutates
      ? "reversible_write"
      : fn === "observe" ? "read" : "none";
    const risk = component.risk ?? defaultRisk;
    assert(RISKS.has(risk), `Unsupported component risk: ${risk}`);
    assert(
      mutates ? risk === "reversible_write" || risk === "destructive_write" : risk === "none" || risk === "read",
      `Component function ${fn} conflicts with risk=${risk}`,
    );

    const parameterKeys = unique(component.parameterKeys);
    const requiredParameterKeys = unique(component.requiredParameterKeys ?? parameterKeys);
    assert(parameterKeys.every((key) => SAFE_PARAMETER_KEY.test(key)), "Component parameter keys must be safe names");
    assert(
      requiredParameterKeys.every((key) => parameterKeys.includes(key)),
      "Required parameter keys must be included in parameterKeys",
    );

    const profile: ComponentProfile = {
      id: "",
      key: "",
      function: fn,
      capability,
      aliases: unique((component.aliases ?? []).map(normalizeToken)),
      tool,
      description: component.description ?? `${fn} ${capability}`,
      inputs: unique((component.inputs ?? []).map(normalizeToken)),
      outputs: unique((component.outputs ?? []).map(normalizeToken)),
      parameterKeys,
      requiredParameterKeys,
      requiredScopes: unique(component.requiredScopes),
      risk,
      mutates,
      version: component.version ?? "1",
    };
    const identityDigest = createHash("sha256").update(JSON.stringify({
      function: profile.function,
      capability: profile.capability,
      aliases: profile.aliases,
      tool: profile.tool,
      description: profile.description,
      version: profile.version,
      inputs: profile.inputs,
      outputs: profile.outputs,
      parameterKeys: profile.parameterKeys,
      requiredParameterKeys: profile.requiredParameterKeys,
      requiredScopes: profile.requiredScopes,
      risk: profile.risk,
      mutates: profile.mutates,
    })).digest("hex");
    profile.key = `sha256:${identityDigest}`;
    profile.id = `${fn}_${capability}_${tool}_${identityDigest.slice(0, 12)}`;
    return profile;
  }

  normalizeReceipt(
    trace: Pick<TraceSubmission, "traceRef" | "observedAt">,
    component: RawTraceComponent,
    index: number,
    now: () => Date,
  ): EvidenceReceipt {
    assert(SAFE_REFERENCE.test(trace.traceRef), "A traceRef must be an opaque safe reference");
    const observedAt = component.observedAt ?? trace.observedAt ?? now().toISOString();
    const outcome = component.outcome ?? "success";
    assert(OUTCOMES.has(outcome), `Unsupported outcome: ${outcome}`);
    const parsedObservedAt = new Date(observedAt);
    assert(!Number.isNaN(parsedObservedAt.getTime()), "Receipt observedAt must be a valid timestamp");
    assert(
      component.durationMs === undefined || (Number.isFinite(component.durationMs) && component.durationMs >= 0),
      "Receipt durationMs must be a nonnegative finite number",
    );

    return {
      id: normalizeToken(component.receiptId ?? `${trace.traceRef}_${index}_${observedAt}`),
      traceRef: trace.traceRef,
      outcome,
      observedAt: parsedObservedAt.toISOString(),
      durationMs: component.durationMs ?? null,
    };
  }
}
import { createHash } from "node:crypto";
