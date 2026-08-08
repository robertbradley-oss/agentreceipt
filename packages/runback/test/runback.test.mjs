import test from "node:test";
import assert from "node:assert/strict";
import {
  ComponentCatalog,
  Housekeeper,
  PreflightPlanner,
} from "../dist/src/index.js";

const NOW = "2026-08-06T20:00:00.000Z";
const now = () => new Date(NOW);

function observation(overrides = {}) {
  return {
    tool: "workspace.search",
    operation: "search",
    capability: "map_project",
    description: "Map the project",
    inputs: ["workspace"],
    outputs: ["project_map"],
    parameterKeys: ["root", "query"],
    requiredScopes: ["workspace:read"],
    risk: "read",
    outcome: "success",
    ...overrides,
  };
}

test("housekeeper classifies components by function", () => {
  const housekeeper = new Housekeeper();
  assert.equal(housekeeper.classify(observation()), "observe");
  assert.equal(housekeeper.classify(observation({ operation: "edit", mutates: true })), "act");
  assert.equal(housekeeper.classify(observation({ operation: "test", capability: "verify_change" })), "verify");
});

test("catalog stores component evidence instead of full runs", () => {
  const catalog = new ComponentCatalog({ now });
  catalog.submitTrace({
    traceRef: "task-a-trace",
    components: [observation()],
  });
  const snapshot = catalog.snapshot();
  assert.equal(snapshot.components.length, 1);
  assert.equal(snapshot.components[0].evidence[0].traceRef, "task-a-trace");
  assert.equal("runs" in snapshot, false);
});

test("equivalent components aggregate evidence across unrelated traces", () => {
  const catalog = new ComponentCatalog({ now });
  catalog.submitTrace({ traceRef: "docs-task", components: [observation()] });
  catalog.submitTrace({ traceRef: "billing-task", components: [observation()] });
  assert.equal(catalog.components().length, 1);
  assert.equal(catalog.components()[0].evidence.length, 2);
});

test("task-agnostic scoring favors stronger cross-trace evidence", () => {
  const catalog = new ComponentCatalog({ now });
  catalog.submitTrace({ traceRef: "same-task", components: [observation({ tool: "slow.search" })] });
  for (let index = 0; index < 4; index += 1) {
    catalog.submitTrace({
      traceRef: `unrelated-${index}`,
      components: [observation({ tool: "proven.search" })],
    });
  }
  const ranked = catalog.rank({
    id: "orient",
    function: "observe",
    capability: "map_project",
    inputs: ["workspace"],
    outputs: ["project_map"],
    maxRisk: "read",
  }, { allowedScopes: ["workspace:read"] });
  assert.equal(ranked[0].component.tool, "proven_search");
  assert.equal("taskSimilarity" in ranked[0].breakdown, false);
});

test("preflight returns a dependency-ordered, parameter-safe rail", () => {
  const catalog = new ComponentCatalog({ now });
  catalog.submitTrace({
    traceRef: "trace-1",
    components: [
      observation(),
      {
        tool: "workspace.patch",
        operation: "edit",
        capability: "apply_patch",
        inputs: ["project_map"],
        outputs: ["changed_workspace"],
        parameterKeys: ["patch"],
        requiredScopes: ["workspace:write"],
        risk: "reversible_write",
        outcome: "success",
      },
    ],
  });
  const planner = new PreflightPlanner({ catalog, minScore: 0.45 });
  const result = planner.plan({
    intent: {
      id: "change",
      needs: [
        {
          id: "edit",
          function: "act",
          capability: "apply_patch",
          dependsOn: ["orient"],
          inputs: ["project_map"],
          outputs: ["changed_workspace"],
          maxRisk: "reversible_write",
        },
        {
          id: "orient",
          function: "observe",
          capability: "map_project",
          inputs: ["workspace"],
          outputs: ["project_map"],
          maxRisk: "read",
        },
      ],
    },
    initialArtifacts: ["workspace"],
    policy: {
      allowWrites: true,
      allowedScopes: ["workspace:read", "workspace:write"],
      approvedWriteScopes: ["workspace:write"],
    },
    parameters: { root: ".", query: "planner", secret: "must-not-replay" },
    parametersByNeed: { edit: { patch: "safe patch" } },
  });
  assert.equal(result.status, "covered");
  assert.deepEqual(result.rail.map((step) => step.needId), ["orient", "edit"]);
  assert.deepEqual(result.rail[0].parameters, { query: "planner", root: "." });
  assert.deepEqual(result.rail[1].parameters, { patch: "safe patch" });
  assert.equal(result.rail[1].guard.type, "write");
});

test("write components are excluded without explicit policy approval", () => {
  const catalog = new ComponentCatalog({ now });
  catalog.submitTrace({
    traceRef: "trace-1",
    components: [observation({
      tool: "workspace.patch",
      operation: "edit",
      capability: "apply_patch",
      inputs: ["workspace"],
      outputs: ["changed_workspace"],
      requiredScopes: ["workspace:write"],
      risk: "reversible_write",
    })],
  });
  const result = new PreflightPlanner({ catalog, minScore: 0 }).plan({
    intent: {
      needs: [{
        id: "edit",
        function: "act",
        capability: "apply_patch",
        inputs: ["workspace"],
        maxRisk: "reversible_write",
      }],
    },
    initialArtifacts: ["workspace"],
    policy: { allowedScopes: ["workspace:write"] },
  });
  assert.equal(result.status, "uncovered");
  assert.equal(result.gaps[0].reason, "no_policy_safe_candidate");
});

test("component identity keeps different artifact and scope contracts separate", () => {
  const catalog = new ComponentCatalog({ now });
  catalog.submitTrace({
    traceRef: "trace-contract-a",
    components: [observation({
      receiptId: "receipt-contract-a",
      outputs: ["project_map"],
      requiredScopes: ["workspace:read"],
    })],
  });
  catalog.submitTrace({
    traceRef: "trace-contract-b",
    components: [observation({
      receiptId: "receipt-contract-b",
      outputs: ["dependency_map"],
      requiredScopes: ["dependency-index:read"],
    })],
  });

  const components = catalog.components();
  assert.equal(components.length, 2);
  assert.notEqual(components[0].key, components[1].key);
  assert.notEqual(components[0].id, components[1].id);
});

test("duplicate receipts are idempotent and conflicting duplicates fail closed", () => {
  const catalog = new ComponentCatalog({ now });
  const trace = {
    traceRef: "trace-deduplicate",
    components: [observation({ receiptId: "receipt-deduplicate" })],
  };
  catalog.submitTrace(trace);
  catalog.submitTrace(trace);
  assert.equal(catalog.components()[0].evidence.length, 1);
  assert.throws(() => catalog.submitTrace({
    traceRef: trace.traceRef,
    components: [observation({ receiptId: "receipt-deduplicate", outcome: "failure" })],
  }), /conflicts with existing evidence/);
});

test("blocked-only evidence is never eligible for a rail", () => {
  const catalog = new ComponentCatalog({ now });
  catalog.submitTrace({
    traceRef: "trace-blocked",
    components: [observation({ outcome: "blocked" })],
  });
  const ranked = catalog.rank({
    id: "orient",
    function: "observe",
    capability: "map_project",
    inputs: ["workspace"],
    outputs: ["project_map"],
    maxRisk: "read",
  }, { allowedScopes: ["workspace:read"] });
  assert.deepEqual(ranked, []);
});

test("catalog snapshots are revalidated rather than trusted", () => {
  const catalog = new ComponentCatalog({ now });
  catalog.submitTrace({ traceRef: "trace-snapshot", components: [observation()] });
  const snapshot = catalog.snapshot();
  snapshot.components[0].key = "tampered:key";
  assert.throws(() => new ComponentCatalog({ snapshot, now }), /integrity is invalid/);
});

test("preflight requires requested outputs and all required replay parameters", () => {
  const catalog = new ComponentCatalog({ now });
  catalog.submitTrace({
    traceRef: "trace-output-contract",
    components: [observation()],
  });
  const planner = new PreflightPlanner({ catalog, minScore: 0 });
  const baseRequest = {
    intent: {
      needs: [{
        id: "orient",
        function: "observe",
        capability: "map_project",
        inputs: ["workspace"],
        outputs: ["project_map"],
        maxRisk: "read",
      }],
    },
    initialArtifacts: ["workspace"],
    policy: { allowedScopes: ["workspace:read"] },
  };

  const missingParameters = planner.plan(baseRequest);
  assert.equal(missingParameters.status, "uncovered");
  assert.equal(missingParameters.gaps[0].reason, "missing_parameters");
  assert.deepEqual(missingParameters.gaps[0].missingParameters, ["query", "root"]);

  const wrongOutput = planner.plan({
    ...baseRequest,
    intent: {
      needs: [{
        ...baseRequest.intent.needs[0],
        outputs: ["dependency_map"],
      }],
    },
    parameters: { query: "catalog", root: "." },
  });
  assert.equal(wrongOutput.status, "uncovered");
  assert.equal(wrongOutput.gaps[0].reason, "no_policy_safe_candidate");
});
