import { CliError } from "./errors.js";

export interface ParsedArguments {
  command: string | undefined;
  positionals: string[];
  options: Map<string, string | true | Array<string | true>>;
}

function addOption(
  options: ParsedArguments["options"],
  name: string,
  value: string | true,
): void {
  const existing = options.get(name);
  if (existing === undefined) {
    options.set(name, value);
  } else if (Array.isArray(existing)) {
    existing.push(value);
  } else {
    options.set(name, [existing, value]);
  }
}

export function parseArguments(args: string[]): ParsedArguments {
  const [command, ...rest] = args;
  const positionals: string[] = [];
  const options: ParsedArguments["options"] = new Map();

  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index]!;

    if (!argument.startsWith("--")) {
      positionals.push(argument);
      continue;
    }

    const equalsIndex = argument.indexOf("=");
    if (equalsIndex !== -1) {
      const name = argument.slice(2, equalsIndex);
      const value = argument.slice(equalsIndex + 1);
      if (!name || !value) {
        throw new CliError("Invalid option syntax.", 2);
      }
      addOption(options, name, value);
      continue;
    }

    const name = argument.slice(2);
    const next = rest[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      addOption(options, name, next);
      index += 1;
    } else {
      addOption(options, name, true);
    }
  }

  return { command, positionals, options };
}

export function stringOption(
  parsed: ParsedArguments,
  name: string,
  options: { required?: boolean; fallback?: string } = {},
): string | undefined {
  const value = parsed.options.get(name);
  if (Array.isArray(value)) {
    throw new CliError(`--${name} may be provided only once.`, 2);
  }
  if (value === true) {
    throw new CliError(`--${name} requires a value.`, 2);
  }
  if (value === undefined) {
    if (options.required) {
      throw new CliError(`Missing required option --${name}.`, 2);
    }
    return options.fallback;
  }
  return value;
}

export function stringOptions(parsed: ParsedArguments, name: string): string[] {
  const value = parsed.options.get(name);
  if (value === undefined) return [];
  const values = Array.isArray(value) ? value : [value];
  if (values.some((entry) => entry === true)) {
    throw new CliError(`--${name} requires a value.`, 2);
  }
  return values as string[];
}

export function rejectUnknownOptions(parsed: ParsedArguments, allowed: string[]): void {
  for (const name of parsed.options.keys()) {
    if (!allowed.includes(name)) {
      throw new CliError("Unknown option.", 2);
    }
  }
}
