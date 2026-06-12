import { cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
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
import type {
  Config,
  ParsedSource,
  DeploymentRecord,
  RepositorySkillCheckResult,
  RepositorySkillDeploymentSummary,
  RepositorySkillUpdateResult,
  RepositorySkillView,
  SkillManifest,
  SkillSource
} from "./types.js";
import { parseSource } from "./source-resolver.js";
import { hashDirectory } from "../platform/hash.js";
import { isCopyOutdated } from "./deployment.js";

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

export async function listRepositorySkillViews(
  config: Config,
  options: { keyword?: string } = {}
): Promise<RepositorySkillView[]> {
  const [skills, registry] = await Promise.all([
    listRepositorySkills(config),
    readDeploymentRegistry(config.deploymentsPath)
  ]);
  const needle = options.keyword?.trim().toLowerCase();
  const views = await Promise.all(
    skills.map(async (skill) => {
      const deployments = await summarizeSkillDeployments(skill, registry.deployments);
      return {
        skill,
        deployments,
        summary: formatRepositorySkillSummary(deployments)
      } satisfies RepositorySkillView;
    })
  );

  return views
    .filter((view) => {
      if (!needle) return true;
      return [
        view.skill.id,
        view.skill.name,
        view.skill.description,
        view.skill.source?.value
      ]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(needle));
    })
    .sort((a, b) => a.skill.name.localeCompare(b.skill.name));
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
    const sourceBase: SkillSource =
      options.source ?? {
        type: "local",
        value: sourcePath,
        skill: id,
        importedAt: new Date().toISOString()
      };
    const source: SkillSource = {
      ...sourceBase,
      sourceHash: await hashDirectory(targetPath)
    };
    await writeMetadata(targetPath, { source });
    imported.push(await parseSkillDirectory(targetPath, { source }));
  }

  return imported;
}

export async function updateRepositorySkill(
  config: Config,
  skillId: string,
  options: { force?: boolean } = {}
): Promise<RepositorySkillUpdateResult> {
  const skill = await findRepositorySkillById(config, skillId);
  if (!skill.source || !["local", "github", "gitlab", "git"].includes(skill.source.type)) {
    return {
      skillId: skill.id,
      name: skill.name,
      localPath: skill.localPath,
      status: "unsupported-source",
      message: "This skill does not have an updatable source."
    };
  }

  const currentHash = await hashDirectory(skill.localPath);
  const baselineHash = skill.source.sourceHash;
  const hasLocalChanges = Boolean(baselineHash && baselineHash !== currentHash);

  let tempDir: string | undefined;
  try {
    const sourceRoot = await resolveUpdateSourceRoot(skill.source);
    tempDir = sourceRoot.cleanupPath;
    const upstreamSkillPath = await findUpstreamSkillPath(sourceRoot.rootPath, skill);
    if (!upstreamSkillPath) {
      return {
        skillId: skill.id,
        name: skill.name,
        localPath: skill.localPath,
        status: "missing-upstream-skill",
        message: "Skill no longer exists in its upstream source."
      };
    }

    const upstreamHash = await hashDirectory(upstreamSkillPath);
    if (upstreamHash === currentHash) {
      if (!baselineHash || baselineHash !== upstreamHash) {
        await writeMetadata(skill.localPath, {
          source: { ...skill.source, sourceHash: upstreamHash }
        });
      }
      return {
        skillId: skill.id,
        name: skill.name,
        localPath: skill.localPath,
        status: "already-latest"
      };
    }

    if (hasLocalChanges && !options.force) {
      return {
        skillId: skill.id,
        name: skill.name,
        localPath: skill.localPath,
        status: "skipped-local-changes",
        message: "Local changes detected."
      };
    }

    await replaceRepositorySkill(skill.localPath, upstreamSkillPath);
    await writeMetadata(skill.localPath, {
      source: { ...skill.source, sourceHash: upstreamHash }
    });
    return {
      skillId: skill.id,
      name: skill.name,
      localPath: skill.localPath,
      status: "updated"
    };
  } catch (error) {
    return {
      skillId: skill.id,
      name: skill.name,
      localPath: skill.localPath,
      status: "failed",
      message: error instanceof Error ? error.message : String(error)
    };
  } finally {
    if (tempDir) {
      await cleanupTempDir(tempDir);
    }
  }
}

export async function checkRepositorySkillUpdate(
  config: Config,
  skillId: string
): Promise<RepositorySkillCheckResult> {
  const skill = await findRepositorySkillById(config, skillId);
  if (!skill.source || !["local", "github", "gitlab", "git"].includes(skill.source.type)) {
    return {
      skillId: skill.id,
      name: skill.name,
      localPath: skill.localPath,
      status: "unsupported-source",
      message: "This skill does not have an updatable source."
    };
  }

  const currentHash = await hashDirectory(skill.localPath);
  const baselineHash = skill.source.sourceHash;
  const hasLocalChanges = Boolean(baselineHash && baselineHash !== currentHash);

  let tempDir: string | undefined;
  try {
    const sourceRoot = await resolveUpdateSourceRoot(skill.source);
    tempDir = sourceRoot.cleanupPath;
    const upstreamSkillPath = await findUpstreamSkillPath(sourceRoot.rootPath, skill);
    if (!upstreamSkillPath) {
      return {
        skillId: skill.id,
        name: skill.name,
        localPath: skill.localPath,
        status: "missing-upstream-skill",
        message: "Skill no longer exists in its upstream source."
      };
    }

    const upstreamHash = await hashDirectory(upstreamSkillPath);
    if (upstreamHash === currentHash) {
      return {
        skillId: skill.id,
        name: skill.name,
        localPath: skill.localPath,
        status: "already-latest"
      };
    }

    if (hasLocalChanges) {
      return {
        skillId: skill.id,
        name: skill.name,
        localPath: skill.localPath,
        status: "local-changes",
        message: "Local changes detected."
      };
    }

    return {
      skillId: skill.id,
      name: skill.name,
      localPath: skill.localPath,
      status: "update-available"
    };
  } catch (error) {
    return {
      skillId: skill.id,
      name: skill.name,
      localPath: skill.localPath,
      status: "failed",
      message: error instanceof Error ? error.message : String(error)
    };
  } finally {
    if (tempDir) {
      await cleanupTempDir(tempDir);
    }
  }
}

export async function checkRepositorySkillUpdates(
  config: Config,
  options: { skillIds?: string[] } = {}
): Promise<RepositorySkillCheckResult[]> {
  const skills = await listRepositorySkills(config);
  const selected = options.skillIds?.length
    ? skills.filter((skill) => options.skillIds!.includes(skill.id) || options.skillIds!.includes(skill.name))
    : skills;
  return Promise.all(selected.map((skill) => checkRepositorySkillUpdate(config, skill.id)));
}

export async function updateRepositorySkills(
  config: Config,
  options: { skillIds?: string[]; force?: boolean } = {}
): Promise<RepositorySkillUpdateResult[]> {
  const skills = await listRepositorySkills(config);
  const selected = options.skillIds?.length
    ? skills.filter((skill) => options.skillIds!.includes(skill.id) || options.skillIds!.includes(skill.name))
    : skills;
  return Promise.all(selected.map((skill) => updateRepositorySkill(config, skill.id, options)));
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
  importedAt: z.string().optional(),
  sourceHash: z.string().optional()
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

async function summarizeSkillDeployments(skill: SkillManifest, deployments: DeploymentRecord[]) {
  const matched = deployments.filter((deployment) => deployment.skillId === skill.id);
  const summaries: RepositorySkillDeploymentSummary[] = [];
  for (const deployment of matched) {
    summaries.push({
      deployment,
      status: (await isCopyOutdated(deployment)) ? "outdated" : "managed"
    });
  }
  return summaries;
}

function formatRepositorySkillSummary(deployments: RepositorySkillDeploymentSummary[]) {
  if (deployments.length === 0) {
    return "not deployed";
  }
  const outdated = deployments.filter((item) => item.status === "outdated");
  if (outdated.length > 0) {
    return `outdated copy: ${formatDeploymentTargets(outdated)}`;
  }
  return `deployed: ${formatDeploymentTargets(deployments)}`;
}

function formatDeploymentTargets(deployments: RepositorySkillDeploymentSummary[]) {
  return deployments
    .map((item) => `${item.deployment.agentId}(${item.deployment.scope})`)
    .join(", ");
}

async function findRepositorySkillById(config: Config, skillId: string) {
  const skills = await listRepositorySkills(config);
  const skill = skills.find((item) => item.id === skillId || item.name === skillId);
  if (!skill) {
    throw new Error(`Skill not found: ${skillId}`);
  }
  return skill;
}

async function resolveUpdateSourceRoot(source: SkillSource) {
  if (source.type === "local") {
    const rootPath = source.url ?? source.value;
    return { rootPath, cleanupPath: undefined };
  }
  const tempDir = await cloneRepo(source.url ?? source.value, source.ref);
  return { rootPath: tempDir, cleanupPath: tempDir };
}

async function findUpstreamSkillPath(rootPath: string, skill: SkillManifest) {
  const selectedSkillIds = skill.source?.skill
    ? skill.source.skill.split(",").map((item) => item.trim()).filter(Boolean)
    : [skill.id, skill.name];
  const discovered = await discoverSkillDirectories(rootPath, { subpath: skill.source?.subpath });
  for (const skillPath of discovered) {
    const parsed = await parseSkillDirectory(skillPath);
    if (
      parsed.id === skill.id ||
      parsed.name === skill.name ||
      selectedSkillIds.includes(parsed.id) ||
      selectedSkillIds.includes(parsed.name)
    ) {
      return skillPath;
    }
  }
  return undefined;
}

async function replaceRepositorySkill(targetPath: string, upstreamSkillPath: string) {
  const tempPath = `${targetPath}.tmp`;
  await rm(tempPath, { recursive: true, force: true }).catch(() => undefined);
  await cp(upstreamSkillPath, tempPath, { recursive: true, dereference: false });
  await rm(targetPath, { recursive: true, force: true });
  await rename(tempPath, targetPath);
}
