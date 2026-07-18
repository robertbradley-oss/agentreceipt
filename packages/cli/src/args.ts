import { CliError } from "./errors.js";

export interface ParsedArguments {
  command: string | undefined;
  positionals: string[];
  options: Map<string, string | true>;
}

export function parseArguments(args: string[]): ParsedArguments {
  const [command, ...rest] = args;
  const positionals: string[] = [];
  const options = new Map<string, string | true>();

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
      options.set(name, value);
      continue;
    }

    const name = argument.slice(2);
    const next = rest[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      options.set(name, next);
      index += 1;
    } else {
      options.set(name, true);
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

export function rejectUnknownOptions(parsed: ParsedArguments, allowed: string[]): void {
  for (const name of parsed.options.keys()) {
    if (!allowed.includes(name)) {
      throw new CliError("Unknown option.", 2);
    }
  }
}
