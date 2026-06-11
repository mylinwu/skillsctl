import { isAbsolute, normalize, resolve } from "node:path";
import type { ParsedSource } from "./types.js";
export interface ParsedNpxSkillsAdd {
  source?: string;
  skills: string[];
  agents: string[];
  global: boolean;
  copy: boolean;
  list: boolean;
  all: boolean;
  yes: boolean;
}

const SOURCE_ALIASES: Record<string, string> = {
  "coinbase/agentWallet": "coinbase/agentic-wallet-skills"
};

export function parseSource(input: string, options: { cwd?: string } = {}): ParsedSource {
  if (isLocalPath(input)) {
    const localPath = resolve(options.cwd ?? process.cwd(), input);
    return { type: "local", url: localPath, localPath };
  }

  const fragment = parseFragmentRef(input);
  input = SOURCE_ALIASES[fragment.inputWithoutFragment] ?? fragment.inputWithoutFragment;

  const githubPrefix = input.match(/^github:(.+)$/);
  if (githubPrefix) {
    return parseSource(appendFragmentRef(githubPrefix[1]!, fragment.ref, fragment.skillFilter), options);
  }

  const gitlabPrefix = input.match(/^gitlab:(.+)$/);
  if (gitlabPrefix) {
    return parseSource(
      appendFragmentRef(`https://gitlab.com/${gitlabPrefix[1]!}`, fragment.ref, fragment.skillFilter),
      options
    );
  }

  const githubTreeWithPath = input.match(/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/(.+)/);
  if (githubTreeWithPath) {
    const [, owner, repo, ref, subpath] = githubTreeWithPath;
    return {
      type: "github",
      url: `https://github.com/${owner}/${repo!.replace(/\.git$/, "")}.git`,
      ref: ref || fragment.ref,
      subpath: sanitizeSubpath(subpath!)
    };
  }

  const githubTree = input.match(/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)$/);
  if (githubTree) {
    const [, owner, repo, ref] = githubTree;
    return {
      type: "github",
      url: `https://github.com/${owner}/${repo!.replace(/\.git$/, "")}.git`,
      ref: ref || fragment.ref,
      ...(fragment.skillFilter ? { skillFilter: fragment.skillFilter } : {})
    };
  }

  const githubRepo = input.match(/github\.com\/([^/]+)\/([^/#?]+)/);
  if (githubRepo) {
    const [, owner, repo] = githubRepo;
    return {
      type: "github",
      url: `https://github.com/${owner}/${repo!.replace(/\.git$/, "")}.git`,
      ...(fragment.ref ? { ref: fragment.ref } : {}),
      ...(fragment.skillFilter ? { skillFilter: fragment.skillFilter } : {})
    };
  }

  const gitlabTreeWithPath = input.match(/^(https?):\/\/([^/]+)\/(.+?)\/-\/tree\/([^/]+)\/(.+)/);
  if (gitlabTreeWithPath) {
    const [, protocol, hostname, repoPath, ref, subpath] = gitlabTreeWithPath;
    if (hostname !== "github.com") {
      return {
        type: "gitlab",
        url: `${protocol}://${hostname}/${repoPath!.replace(/\.git$/, "")}.git`,
        ref: ref || fragment.ref,
        subpath: sanitizeSubpath(subpath!)
      };
    }
  }

  const gitlabTree = input.match(/^(https?):\/\/([^/]+)\/(.+?)\/-\/tree\/([^/]+)$/);
  if (gitlabTree) {
    const [, protocol, hostname, repoPath, ref] = gitlabTree;
    if (hostname !== "github.com") {
      return {
        type: "gitlab",
        url: `${protocol}://${hostname}/${repoPath!.replace(/\.git$/, "")}.git`,
        ref: ref || fragment.ref
      };
    }
  }

  const gitlabRepo = input.match(/gitlab\.com\/(.+?)(?:\.git)?\/?$/);
  if (gitlabRepo && gitlabRepo[1]?.includes("/")) {
    return {
      type: "gitlab",
      url: `https://gitlab.com/${gitlabRepo[1].replace(/\.git$/, "")}.git`,
      ...(fragment.ref ? { ref: fragment.ref } : {})
    };
  }

  const atSkill = input.match(/^([^/]+)\/([^/@]+)@(.+)$/);
  if (atSkill && !input.includes(":") && !input.startsWith(".") && !input.startsWith("/")) {
    const [, owner, repo, skillFilter] = atSkill;
    return {
      type: "github",
      url: `https://github.com/${owner}/${repo}.git`,
      ...(fragment.ref ? { ref: fragment.ref } : {}),
      skillFilter: fragment.skillFilter || skillFilter
    };
  }

  const shorthand = input.match(/^([^/]+)\/([^/]+)(?:\/(.+?))?\/?$/);
  if (shorthand && !input.includes(":") && !input.startsWith(".") && !input.startsWith("/")) {
    const [, owner, repo, subpath] = shorthand;
    return {
      type: "github",
      url: `https://github.com/${owner}/${repo}.git`,
      ...(fragment.ref ? { ref: fragment.ref } : {}),
      ...(subpath ? { subpath: sanitizeSubpath(subpath) } : {}),
      ...(fragment.skillFilter ? { skillFilter: fragment.skillFilter } : {})
    };
  }

  if (isWellKnownUrl(input)) {
    return { type: "well-known", url: input };
  }

  return {
    type: "git",
    url: input,
    ...(fragment.ref ? { ref: fragment.ref } : {})
  };
}

export function sanitizeSubpath(subpath: string) {
  const normalized = normalize(subpath).replace(/\\/g, "/");
  for (const segment of normalized.split("/")) {
    if (segment === "..") {
      throw new Error(`Unsafe subpath: "${subpath}" contains path traversal segments.`);
    }
  }
  return subpath;
}

function isLocalPath(input: string) {
  return (
    isAbsolute(input) ||
    input.startsWith("./") ||
    input.startsWith("../") ||
    input === "." ||
    input === ".." ||
    /^[a-zA-Z]:[/\\]/.test(input)
  );
}

function parseFragmentRef(input: string) {
  const hashIndex = input.indexOf("#");
  if (hashIndex < 0) {
    return { inputWithoutFragment: input };
  }

  const inputWithoutFragment = input.slice(0, hashIndex);
  const fragment = input.slice(hashIndex + 1);
  if (!fragment || !looksLikeGitSource(inputWithoutFragment)) {
    return { inputWithoutFragment: input };
  }

  const atIndex = fragment.indexOf("@");
  if (atIndex === -1) {
    return { inputWithoutFragment, ref: decode(fragment) };
  }

  const ref = fragment.slice(0, atIndex);
  const skillFilter = fragment.slice(atIndex + 1);
  return {
    inputWithoutFragment,
    ref: ref ? decode(ref) : undefined,
    skillFilter: skillFilter ? decode(skillFilter) : undefined
  };
}

function appendFragmentRef(input: string, ref?: string, skillFilter?: string) {
  if (!ref) {
    return input;
  }
  return `${input}#${ref}${skillFilter ? `@${skillFilter}` : ""}`;
}

function decode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function looksLikeGitSource(input: string) {
  if (input.startsWith("github:") || input.startsWith("gitlab:") || input.startsWith("git@")) {
    return true;
  }
  if (/^ssh:\/\/.+\.git(?:$|[/?])/i.test(input)) {
    return true;
  }
  if (/^https?:\/\/.+\.git(?:$|[/?])/i.test(input)) {
    return true;
  }
  if (input.startsWith("http://") || input.startsWith("https://")) {
    try {
      const parsed = new URL(input);
      if (parsed.hostname === "github.com") {
        return /^\/[^/]+\/[^/]+(?:\.git)?(?:\/tree\/[^/]+(?:\/.*)?)?\/?$/.test(parsed.pathname);
      }
      if (parsed.hostname === "gitlab.com") {
        return /^\/.+?\/[^/]+(?:\.git)?(?:\/-\/tree\/[^/]+(?:\/.*)?)?\/?$/.test(parsed.pathname);
      }
    } catch {
      return false;
    }
  }
  return !input.includes(":") && !input.startsWith(".") && !input.startsWith("/") && /^([^/]+)\/([^/]+)(?:\/(.+)|@(.+))?$/.test(input);
}

function isWellKnownUrl(input: string) {
  if (!input.startsWith("http://") && !input.startsWith("https://")) {
    return false;
  }
  try {
    const parsed = new URL(input);
    return !["github.com", "gitlab.com", "raw.githubusercontent.com"].includes(parsed.hostname) && !input.endsWith(".git");
  } catch {
    return false;
  }
}

export function parseNpxSkillsAdd(command: string): ParsedNpxSkillsAdd {
  const tokens = tokenize(command);
  const start = tokens[0] === "npx" && tokens[1] === "skills" && tokens[2] === "add" ? 3 : 0;
  const result: ParsedNpxSkillsAdd = {
    skills: [],
    agents: [],
    global: false,
    copy: false,
    list: false,
    all: false,
    yes: false
  };

  for (let index = start; index < tokens.length; index += 1) {
    const token = tokens[index];
    switch (token) {
      case "--skill":
      case "-s":
        result.skills.push(requireValue(tokens, ++index, token));
        break;
      case "--agent":
      case "-a":
        result.agents.push(requireValue(tokens, ++index, token));
        break;
      case "--global":
      case "-g":
        result.global = true;
        break;
      case "--copy":
        result.copy = true;
        break;
      case "--list":
      case "-l":
        result.list = true;
        break;
      case "--all":
        result.all = true;
        break;
      case "--yes":
      case "-y":
        result.yes = true;
        break;
      default:
        if (!token.startsWith("-") && !result.source) {
          result.source = token;
        }
        break;
    }
  }

  return result;
}

function requireValue(tokens: string[], index: number, flag: string) {
  const value = tokens[index];
  if (!value || value.startsWith("-")) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function tokenize(input: string) {
  const tokens: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(input))) {
    tokens.push(match[1] ?? match[2] ?? match[3]);
  }
  return tokens;
}
