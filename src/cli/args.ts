export interface ParsedArgs {
  command: string[];
  flags: Map<string, string[]>;
}

const VALUE_FLAGS = new Set([
  "agent",
  "agents",
  "mode",
  "project",
  "repository",
  "skill"
]);

const BOOLEAN_FLAGS = new Set(["global", "help", "json"]);

export function parseArgs(argv: string[]): ParsedArgs {
  const command: string[] = [];
  const flags = new Map<string, string[]>();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (!token.startsWith("--")) {
      command.push(token);
      continue;
    }

    const [rawName, inlineValue] = token.slice(2).split("=", 2);
    const name = rawName ?? "";
    if (!name) {
      throw new Error(`Invalid flag: ${token}`);
    }

    if (BOOLEAN_FLAGS.has(name)) {
      addFlag(flags, name, inlineValue ?? "true");
      continue;
    }

    if (!VALUE_FLAGS.has(name)) {
      throw new Error(`Unknown flag: --${name}`);
    }

    const value = inlineValue ?? argv[++index];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for --${name}`);
    }
    addFlag(flags, name, value);
  }

  return { command, flags };
}

export function getFlag(flags: Map<string, string[]>, name: string) {
  return flags.get(name)?.at(-1);
}

export function getFlags(flags: Map<string, string[]>, name: string) {
  return flags.get(name) ?? [];
}

export function hasFlag(flags: Map<string, string[]>, name: string) {
  return flags.has(name);
}

function addFlag(flags: Map<string, string[]>, name: string, value: string) {
  const existing = flags.get(name) ?? [];
  existing.push(value);
  flags.set(name, existing);
}
