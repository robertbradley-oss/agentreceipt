import type {
  CodexParameterInput,
  CodexPrivateActionCandidate,
  CodexPrivateCommandShape,
  CodexPrivateIneligibilityReason,
  CodexPrivateProjection,
  CodexPrivateProjectionParameter,
} from "./types.js";

const PARAMETER_NAME = /^[A-Z][A-Z0-9_]{0,63}$/;
const SAFE_REPOSITORY_PATH = /^(?!-)(?!(?:\.git|\.agentreceipt|\.agents|\.codex-scope)(?:\/|$))(?!~)(?![A-Za-z]:)(?!.*(?:^|\/)\.{1,2}(?:\/|$))[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;
const GIT_HASH_OBJECT = /^git hash-object --no-filters ([A-Za-z0-9._/-]+)$/;
const EMBEDDED_GIT_HASH_OBJECT = /git hash-object --no-filters ([A-Za-z0-9._/-]+)/;
const CREDENTIAL_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}\b/,
  /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeParameters(inputs: CodexParameterInput[]): CodexPrivateProjectionParameter[] {
  const parameters = inputs.map((input) => {
    if (!PARAMETER_NAME.test(input.name) || input.value.length === 0) {
      throw new TypeError("Invalid private projection parameter declaration.");
    }
    if (input.sensitivity === "secret") {
      if (!PARAMETER_NAME.test(input.source_environment) || !PARAMETER_NAME.test(input.target_environment)) {
        throw new TypeError("Invalid secret environment declaration.");
      }
      return {
        name: input.name,
        sensitivity: "secret" as const,
        source_environment: input.source_environment,
        target_environment: input.target_environment,
      };
    }
    return { name: input.name, sensitivity: "public" as const };
  });
  const names = parameters.map((parameter) => parameter.name);
  const secretParameters = parameters.filter(
    (parameter): parameter is Extract<CodexPrivateProjectionParameter, { sensitivity: "secret" }> => (
      parameter.sensitivity === "secret"
    ),
  );
  if (
    new Set(names).size !== names.length
    || new Set(secretParameters.map((parameter) => parameter.source_environment)).size !== secretParameters.length
    || new Set(secretParameters.map((parameter) => parameter.target_environment)).size !== secretParameters.length
  ) throw new TypeError("Invalid private projection parameter declaration.");
  return parameters;
}

function containsCredential(value: string): boolean {
  return CREDENTIAL_PATTERNS.some((pattern) => pattern.test(value));
}

function commandShape(command: string): CodexPrivateCommandShape {
  const direct = command.match(GIT_HASH_OBJECT);
  if (direct?.[1] && SAFE_REPOSITORY_PATH.test(direct[1])) return "direct_allowlisted";
  const embedded = command.match(EMBEDDED_GIT_HASH_OBJECT);
  if (
    embedded?.[1]
    && embedded[0] !== command
    && SAFE_REPOSITORY_PATH.test(embedded[1])
  ) return "allowlisted_command_embedded";
  return "unsupported";
}

export class CodexPrivateProjectionCapture {
  readonly #inputs: CodexParameterInput[];
  readonly #parameters: CodexPrivateProjectionParameter[];
  readonly #actions: CodexPrivateActionCandidate[] = [];
  readonly #pending = new Map<string, { command: string; startedAt: number }>();
  readonly #commandShapes = new Set<CodexPrivateCommandShape>();
  readonly #ineligibilityReasons = new Set<CodexPrivateIneligibilityReason>();
  #unsupported = false;
  #secretMaterialDetected = false;
  #turnFailed = false;
  #malformed = 0;
  #threadStarted = false;
  #turnStarted = false;
  #turnCompleted = false;
  #terminal = false;

  constructor(inputs: CodexParameterInput[] = []) {
    this.#inputs = inputs.map((input) => ({ ...input }));
    this.#parameters = safeParameters(inputs);
  }

  ingest(line: string, observedAt = new Date()): void {
    if (!line.trim()) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch {
      this.#malformed += 1;
      return;
    }
    if (!isRecord(parsed) || typeof parsed.type !== "string") {
      this.#malformed += 1;
      return;
    }

    if (parsed.type === "thread.started") {
      if (this.#threadStarted || this.#turnStarted || this.#terminal) this.#malformed += 1;
      else this.#threadStarted = true;
      return;
    }
    if (parsed.type === "turn.started") {
      if (!this.#threadStarted || this.#turnStarted || this.#terminal) this.#malformed += 1;
      else this.#turnStarted = true;
      return;
    }
    if (parsed.type === "turn.completed") {
      if (!this.#turnStarted || this.#terminal || this.#pending.size > 0) this.#malformed += 1;
      else {
        this.#turnCompleted = true;
        this.#terminal = true;
      }
      return;
    }
    if (parsed.type === "turn.failed" || parsed.type === "error") {
      this.#turnFailed = true;
      this.#terminal = true;
      return;
    }
    if (parsed.type !== "item.started" && parsed.type !== "item.completed") {
      this.#unsupported = true;
      this.#ineligibilityReasons.add("unknown_event");
      return;
    }
    if (!this.#turnStarted || this.#terminal) {
      this.#malformed += 1;
      return;
    }
    if (!isRecord(parsed.item) || typeof parsed.item.type !== "string") {
      this.#malformed += 1;
      return;
    }

    const item = parsed.item;
    if (item.type === "agent_message" || item.type === "reasoning") return;
    if (item.type !== "command_execution") {
      this.#unsupported = true;
      this.#ineligibilityReasons.add("unsupported_item");
      return;
    }

    const rawId = typeof item.id === "string" ? item.id : "";
    const command = typeof item.command === "string" ? item.command : "";
    if (!rawId || !command) {
      this.#malformed += 1;
      return;
    }
    if (containsCredential(command)) this.#secretMaterialDetected = true;
    for (const input of this.#inputs) {
      if (input.sensitivity === "secret" && command.includes(input.value)) {
        this.#secretMaterialDetected = true;
      }
    }
    const shape = commandShape(command);
    this.#commandShapes.add(shape);

    if (parsed.type === "item.started") {
      if (this.#pending.has(rawId)) {
        this.#malformed += 1;
        return;
      }
      this.#pending.set(rawId, { command, startedAt: observedAt.getTime() });
      return;
    }
    const pending = this.#pending.get(rawId);
    this.#pending.delete(rawId);
    if (!pending || pending.command !== command) {
      this.#malformed += 1;
      return;
    }

    const match = command.match(GIT_HASH_OBJECT);
    const filePath = match?.[1];
    if (!filePath || match?.[0] !== command || !SAFE_REPOSITORY_PATH.test(filePath)) {
      this.#unsupported = true;
      this.#ineligibilityReasons.add(
        shape === "allowlisted_command_embedded"
          ? "allowlisted_command_embedded"
          : "unsupported_command_shape",
      );
      return;
    }

    let fileArgument = filePath;
    const publicMatch = this.#inputs.find((input) => input.sensitivity === "public" && input.value === filePath);
    if (publicMatch) fileArgument = `{{param.${publicMatch.name}}}`;
    const exitCode = typeof item.exit_code === "number" ? item.exit_code : 1;
    this.#actions.push({
      sequence: this.#actions.length,
      kind: "process",
      cwd: ".",
      executable: "git",
      arguments: ["hash-object", "--no-filters", fileArgument],
      environment_names: [],
      file_paths: [filePath],
      read_only: true,
      classifier_version: "0.1",
      expected_exit_code: 0,
      observed_exit_code: exitCode,
      duration_ms: Math.max(0, observedAt.getTime() - pending.startedAt),
    });
  }

  finish(): CodexPrivateProjection {
    const publicNamesUsed = new Set(this.#actions.flatMap((action) => action.arguments
      .map((argument) => argument.match(/^\{\{param\.([A-Z][A-Z0-9_]{0,63})\}\}$/)?.[1])
      .filter((name): name is string => name !== undefined)));
    const secretTargetsUsed = new Set(this.#actions.flatMap((action) => action.environment_names));
    const everyParameterUsed = this.#parameters.every((parameter) => (
      parameter.sensitivity === "public"
        ? publicNamesUsed.has(parameter.name)
        : secretTargetsUsed.has(parameter.target_environment)
    ));
    const lifecycleComplete = this.#pending.size === 0
      && this.#threadStarted
      && this.#turnStarted
      && this.#turnCompleted;
    const everyCommandSucceeded = this.#actions.every((action) => action.observed_exit_code === 0);
    const reasons = new Set(this.#ineligibilityReasons);
    if (this.#malformed > 0) reasons.add("malformed_record");
    if (!lifecycleComplete) reasons.add("lifecycle_incomplete");
    if (this.#turnFailed) reasons.add("turn_failed");
    if (this.#secretMaterialDetected) reasons.add("secret_material");
    if (!everyParameterUsed) reasons.add("parameter_unused");
    if (!everyCommandSucceeded) reasons.add("command_failed");
    if (this.#actions.length === 0) reasons.add("no_action");
    return {
      parameters: this.#parameters.map((parameter) => ({ ...parameter })),
      actions: this.#actions.map((action) => ({
        ...action,
        arguments: [...action.arguments],
        environment_names: [...action.environment_names],
        file_paths: [...action.file_paths],
      })),
      structurally_eligible: !this.#unsupported
        && !this.#secretMaterialDetected
        && this.#malformed === 0
        && lifecycleComplete
        && this.#actions.length > 0
        && everyParameterUsed
        && everyCommandSucceeded,
      unsupported_material: this.#unsupported,
      secret_material_detected: this.#secretMaterialDetected,
      malformed_records: this.#malformed,
      pending_items: this.#pending.size,
      diagnostic: {
        command_shapes: [...this.#commandShapes].sort(),
        ineligibility_reasons: [...reasons].sort(),
        action_count: this.#actions.length,
      },
    };
  }
}
