import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

export interface RuntimePaths {
  homeDir?: string;
  cwd?: string;
}

export function expandHome(input: string, paths: RuntimePaths = {}) {
  const home = paths.homeDir ?? homedir();
  if (input === "~") {
    return home;
  }
  if (input.startsWith("~/")) {
    return join(home, input.slice(2));
  }
  return input;
}

export function resolveUserPath(input: string, paths: RuntimePaths = {}) {
  const expanded = expandHome(input, paths);
  if (isAbsolute(expanded)) {
    return expanded;
  }
  return resolve(paths.cwd ?? process.cwd(), expanded);
}

export function displayPath(input: string, paths: RuntimePaths = {}) {
  const home = paths.homeDir ?? homedir();
  if (input === home) {
    return "~";
  }
  if (input.startsWith(`${home}/`)) {
    return `~/${input.slice(home.length + 1)}`;
  }
  return input;
}
