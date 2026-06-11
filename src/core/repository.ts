import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { z } from "zod";
import { basename, join } from "node:path";
import {
  assertWritableDirectory,
  exists,
  readDeploymentRegistry
} from "./config.js";
import { cleanupTempDir, cloneRepo } from "./git.js";
import {
  discoverSkillDirectories,
  parseSkillDirectory,
  skillMetadataPath
} from "./skill-parser.js";
import type { Config, ParsedSource, SkillManifest, SkillSource } from "./types.js";
import { parseSource } from "./source-resolver.js";

export async function ensureRepository(config: Config) {
  await assertWritableDirectory(config.repositoryPath);
}

export async function importFromSource(
  config: Config,
  sourceInput: string,
  options: { selectedSkillIds?: string[]; cwd?: string } = {}
) {
  const parsed = parseSource(sourceInput, { cwd: options.cwd });
  return importParsedSource(config, parsed, sourceInput, options);
}

export async function importParsedSource(
  config: Config,
  parsed: ParsedSource,
  sourceInput: string,
  options: { selectedSkillIds?: string[] } = {}
) {
  if (parsed.type === "well-known") {
    throw new Error("Well-known source import is not supported in this MVP.");
  }

  const selectedSkillIds =
    options.selectedSkillIds ?? (parsed.skillFilter ? [parsed.skillFilter] : undefined);
  const source: SkillSource = {
    type: parsed.type,
    value: sourceInput,
    url: parsed.url,
    ref: parsed.ref,
    subpath: parsed.subpath,
    skill: selectedSkillIds?.join(","),
    importedAt: new Date().toISOString()
  };

  if (parsed.type === "local") {
    return importLocalSkills(config, parsed.localPath ?? parsed.url, {
      selectedSkillIds,
      subpath: parsed.subpath,
      source
    });
  }

  const tempDir = await cloneRepo(parsed.url, parsed.ref);
  try {
    return await importLocalSkills(config, tempDir, {
      selectedSkillIds,
      subpath: parsed.subpath,
      source
    });
  } finally {
    await cleanupTempDir(tempDir);
  }
}

export async function listRepositorySkills(config: Config): Promise<SkillManifest[]> {
  await ensureRepository(config);
  const skillPaths = await discoverSkillDirectories(config.repositoryPath);
  const skills = await Promise.all(skillPaths.map((skillPath) => readRepositorySkill(skillPath)));
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

export async function readRepositorySkill(skillPath: string) {
  const metadata = await readMetadata(skillPath);
  return parseSkillDirectory(skillPath, {
    source: metadata?.source
  });
}

export async function importLocalSkills(
  config: Config,
  sourcePath: string,
  options: { selectedSkillIds?: string[]; subpath?: string; source?: SkillSource } = {}
) {
  await ensureRepository(config);
  const skillPaths = await discoverSkillDirectories(sourcePath, { subpath: options.subpath });
  const selected = new Set(options.selectedSkillIds);
  const imported: SkillManifest[] = [];

  for (const skillPath of skillPaths) {
    const preview = await parseSkillDirectory(skillPath);
    const id = preview.id;
    if (selected.size > 0 && !selected.has(id) && !selected.has(preview.name)) {
      continue;
    }

    const targetPath = join(config.repositoryPath, id);
    if (await exists(targetPath)) {
      throw new Error(
        `Skill already exists in repository: ${id}. ` +
        `Delete it first with the delete command, then re-import.`
      );
    }

    await cp(skillPath, targetPath, { recursive: true, dereference: false });
    const source: SkillSource =
      options.source ?? {
        type: "local",
        value: sourcePath,
        skill: id,
        importedAt: new Date().toISOString()
      };
    await writeMetadata(targetPath, { source });
    imported.push(await parseSkillDirectory(targetPath, { source }));
  }

  return imported;
}

export async function deleteRepositorySkill(config: Config, skillId: string) {
  const registry = await readDeploymentRegistry(config.deploymentsPath);
  const activeDeployments = registry.deployments.filter((deployment) => deployment.skillId === skillId);
  if (activeDeployments.length > 0) {
    throw new Error(`Cannot delete deployed skill: ${skillId}`);
  }

  const skillPath = join(config.repositoryPath, skillId);
  if (!(await exists(skillPath))) {
    throw new Error(`Skill not found: ${skillId}`);
  }

  await rm(skillPath, { recursive: true, force: false });
}

const skillSourceSchema = z.object({
  type: z.enum(["local", "github", "gitlab", "git", "well-known", "unknown"]),
  value: z.string(),
  url: z.string().optional(),
  skill: z.string().optional(),
  ref: z.string().optional(),
  subpath: z.string().optional(),
  importedAt: z.string().optional()
});

const metadataSchema = z.object({
  source: skillSourceSchema.optional()
});

async function readMetadata(skillPath: string): Promise<{ source?: SkillSource } | undefined> {
  const metadataPath = skillMetadataPath(skillPath);
  if (!(await exists(metadataPath))) {
    return undefined;
  }
  const raw = JSON.parse(await readFile(metadataPath, "utf8"));
  return metadataSchema.parse(raw);
}

async function writeMetadata(skillPath: string, metadata: { source: SkillSource }) {
  await mkdir(skillPath, { recursive: true });
  await writeFile(skillMetadataPath(skillPath), `${JSON.stringify(metadata, null, 2)}\n`);
}
