import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join, normalize, resolve, sep } from "node:path";
import { parseDocument } from "yaml";
import type { SkillManifest, SkillSource } from "./types.js";
import { hashDirectory } from "../platform/hash.js";
import { exists } from "./config.js";

export async function parseSkillDirectory(
  skillPath: string,
  options: { source?: SkillSource } = {}
): Promise<SkillManifest> {
  const skillFile = join(skillPath, "SKILL.md");
  if (!(await exists(skillFile))) {
    throw new Error(`Missing SKILL.md in ${skillPath}`);
  }

  const content = await readFile(skillFile, "utf8");
  const frontmatter = parseFrontmatter(content);
  const directoryName = basename(skillPath);
  const name = stringOrUndefined(frontmatter.name) ?? directoryName;
  const description = stringOrUndefined(frontmatter.description) ?? "";

  return {
    id: directoryName,
    directoryName,
    name,
    description,
    localPath: skillPath,
    source: options.source,
    hash: await hashDirectory(skillPath)
  };
}

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "__pycache__"]);
const PRIORITY_SKILL_DIRS = [
  "skills",
  "skills/.curated",
  "skills/.experimental",
  "skills/.system",
  ".agents/skills",
  ".claude/skills",
  ".codex/skills",
  ".cursor/skills",
  ".opencode/skills",
  ".qoder/skills"
];

export async function discoverSkillDirectories(
  root: string,
  options: { subpath?: string; fullDepth?: boolean } = {}
) {
  const rootStat = await stat(root);
  if (!rootStat.isDirectory()) {
    throw new Error(`Expected directory: ${root}`);
  }
  if (options.subpath && !isSubpathSafe(root, options.subpath)) {
    throw new Error(`Invalid subpath: "${options.subpath}" resolves outside the source directory.`);
  }

  const searchPath = options.subpath ? join(root, options.subpath) : root;
  const skills = new Set<string>();

  if (await exists(join(searchPath, "SKILL.md"))) {
    skills.add(searchPath);
    if (!options.fullDepth) {
      return [...skills];
    }
  }

  for (const dir of [searchPath, ...PRIORITY_SKILL_DIRS.map((item) => join(searchPath, item))]) {
    await discoverOneOrTwoLevels(dir, skills);
  }

  if (skills.size === 0 || options.fullDepth) {
    for (const dir of await findSkillDirs(searchPath)) {
      skills.add(dir);
    }
  }

  return [...skills].sort();
}

export function parseFrontmatter(content: string): Record<string, unknown> {
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) {
    return {};
  }

  const normalized = content.replace(/\r\n/g, "\n");
  const end = normalized.indexOf("\n---\n", 4);
  if (end === -1) {
    return {};
  }

  const raw = normalized.slice(4, end);
  const parsed = parseDocument(raw).toJSON();
  return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
}

export function skillMetadataPath(skillPath: string) {
  return join(skillPath, ".skillsctl.json");
}

export function getSkillIdFromPath(skillPath: string) {
  return basename(skillPath);
}

export function isSubpathSafe(basePath: string, subpath: string) {
  const normalizedBase = normalize(resolve(basePath));
  const normalizedTarget = normalize(resolve(join(basePath, subpath)));
  return normalizedTarget.startsWith(normalizedBase + sep) || normalizedTarget === normalizedBase;
}

async function discoverOneOrTwoLevels(dir: string, skills: Set<string>) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) {
      continue;
    }
    const child = join(dir, entry.name);
    if (await exists(join(child, "SKILL.md"))) {
      skills.add(child);
      continue;
    }

    const grandEntries = await readdir(child, { withFileTypes: true }).catch(() => []);
    for (const grandEntry of grandEntries) {
      if (!grandEntry.isDirectory() || SKIP_DIRS.has(grandEntry.name)) {
        continue;
      }
      const grandChild = join(child, grandEntry.name);
      if (await exists(join(grandChild, "SKILL.md"))) {
        skills.add(grandChild);
      }
    }
  }
}

async function findSkillDirs(dir: string, depth = 0, maxDepth = 5): Promise<string[]> {
  if (depth > maxDepth) {
    return [];
  }
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const current = (await exists(join(dir, "SKILL.md"))) ? [dir] : [];
  const children = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && !SKIP_DIRS.has(entry.name))
      .map((entry) => findSkillDirs(join(dir, entry.name), depth + 1, maxDepth))
  );
  return [...current, ...children.flat()];
}

function stringOrUndefined(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}
