# Component runback contract v0.1

## Purpose

AgentReceipt must not treat an entire historical run as the reusable unit. A run often contains a mixture of broadly useful observation, transformation, action, verification, and recovery work. Replaying the whole run couples reuse to an old task and increases both mismatch and write risk.

The component runback layer therefore dismantles submitted traces into task-agnostic component profiles and small evidence receipts. A deterministic preflight planner can use those components to assemble an optimized rail for a new run.

## Storage boundary

The catalog retains:

- normalized function, capability, tool, artifact, parameter-key, scope, risk, and version metadata;
- evidence outcome, timestamp, duration, and opaque trace reference;
- aggregate evidence from equivalent components observed in unrelated traces.

The catalog does not retain the full run, task prompt, reasoning, command output, parameter values, or source content. Trace references are evidence pointers, not replay authority.

Equivalent identity covers the complete executable contract: function, capability and aliases, tool, directive, version, input and output artifacts, allowed and required parameter keys, required scopes, mutation status, and risk. A semantic difference in any of those fields produces a different component. Identity is stored as a SHA-256 digest so catalog keys do not duplicate directive text.

Evidence receipt IDs are opaque digests and catalog snapshots are sorted by component identity. Releases therefore retain neither the source action sequence nor a replayable full-run envelope. Re-ingesting the same receipt is idempotent; a conflicting receipt with the same ID fails closed. Blocked-only or failure-only evidence cannot become a selectable component.

Every release also carries a SHA-256 content digest over its component snapshot. Loading rechecks that digest and then independently reconstructs every profile and evidence receipt through the current normalizer. The digest provides internal consistency and corruption detection, not external authenticity or proof that the evidence is true.

## Functional classification

Every component has one function:

- `observe`: bounded discovery or reading;
- `transform`: non-mutating conversion;
- `act`: a state-changing operation;
- `verify`: an assertion or check;
- `recover`: an explicit restoration operation.

The housekeeper accepts an explicit function or deterministically classifies common tool and operation signals. Equivalent profiles share a stable key and aggregate evidence without reconstructing their source runs.

## Preflight needs and rails

The default preflight boundary accepts a structured intent containing functional needs. An application may use an LLM to propose those needs, but the result receives no authority until the deterministic planner validates dependencies, artifacts, policy, score, and scope.

For each need, all compatible catalog components compete regardless of the task that produced them. Task or prompt similarity is intentionally absent from scoring. The score combines capability match, artifact fit, Bayesian-smoothed reliability, evidence diversity across distinct traces, freshness, and scope fit.

A selected rail step contains only a directive, normalized tool identity, allow-listed replay parameters, score evidence, produced artifacts, and guard metadata. A gap remains explicit when prerequisites are missing, policy excludes all candidates, or confidence is insufficient.

Coverage is exact rather than suggestive. A component is ineligible when it cannot produce every requested output, cannot satisfy the need's scope contract, or requires an unavailable input artifact. A confident component with missing required replay parameters produces a `missing_parameters` gap instead of a nominally covered step.

## AgentReceipt local integration

After `agentreceipt learn` validates the private capsule, source-receipt linkage, and canonical recipe, it decomposes the observed process and verification actions. The resulting component release is written beneath:

```text
.agentreceipt/private/runback/releases/<release-id>.json
```

The path is required to be repository-local, ignored, untracked, new, and free of link or traversal indirection. Releases contain normalized component metadata and evidence only; they contain no prompt, source path value, command output, parameter value, or recipe action sequence.

`agentreceipt runback <request.json> [--param NAME=VALUE]` reads a bounded, regular, repository-local request file. Its v0.1 shape is:

```json
{
  "schemaVersion": 1,
  "intent": {
    "id": "hash-and-verify",
    "needs": [
      {
        "id": "hash",
        "function": "observe",
        "capability": "hash_repository_file",
        "inputs": ["repository_file"],
        "outputs": ["git_blob_digest"],
        "requiredScopes": ["repository:read"],
        "maxRisk": "read"
      }
    ]
  },
  "initialArtifacts": ["repository_file"],
  "allowedScopes": ["repository:read"]
}
```

Preflight loads every valid private local release, revalidates component identities and evidence, globally scores compatible components, and prints a redacted summary. It prints parameter names but never values. The command performs no component tool call, recipe replay, model call, network request, publication, or catalog promotion.

## Write boundary

The runback package plans but does not execute. A mutating component is ineligible unless the request:

1. permits its declared risk level;
2. enables writes;
3. allows every required scope; and
4. explicitly approves every required write scope.

Execution remains the responsibility of a separately guarded adapter. Selection never grants permission to execute, publish, or share a component.

The v0.1 AgentReceipt CLI is stricter than the library boundary: it always sets `allowWrites` to false and supplies no approved write scopes. Write-capable rail planning and execution are therefore unavailable through `agentreceipt runback`.
