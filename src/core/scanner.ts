import { lstat, readdir, readlink } from "node:fs/promises";
import { basename, join } from "node:path";
import { getAgent, resolveAgentTargetPath } from "./agent-registry.js";
import { exists, readDeploymentRegistry } from "./config.js";
import { isCopyOutdated, targetPathForSkill } from "./deployment.js";
import { listRepositorySkills } from "./repository.js";
import type { Config, ScanItem, SkillScope } from "./types.js";

export async function scanAgentScope(
  config: Config,
  agentId: string,
  scope: SkillScope,
  options: { homeDir: string }
): Promise<ScanItem[]> {
  const agent = getAgent(config, agentId);
  if (!agent) {
    throw new Error(`Unknown agent: ${agentId}`);
  }

  const targetRoot = resolveAgentTargetPath(agent, scope, options);
  const repositorySkills = await listRepositorySkills(config);
  const registry = await readDeploymentRegistry(config.deploymentsPath);
  const targetEntries = await readTargetEntries(targetRoot);
  const items: ScanItem[] = [];

  for (const skill of repositorySkills) {
    const targetPath = targetPathForSkill(targetRoot, skill.id);
    const deployment = registry.deployments.find((item) => item.targetPath === targetPath);
    const hasTarget = targetEntries.has(skill.id);

    if (deployment) {
      const targetExists = await exists(targetPath);
      if (!targetExists) {
        items.push({
          skillId: skill.id,
          name: skill.name,
          status: "broken",
          repositoryPath: skill.localPath,
          targetPath,
          deployment,
          message: "Managed deployment target is missing."
        });
      } else if (await isCopyOutdated(deployment)) {
        items.push({
          skillId: skill.id,
          name: skill.name,
          status: "outdated",
          repositoryPath: skill.localPath,
          targetPath,
          deployment
        });
      } else {
        items.push({
          skillId: skill.id,
          name: skill.name,
          status: "managed",
          repositoryPath: skill.localPath,
          targetPath,
          deployment
        });
      }
      continue;
    }

    if (hasTarget) {
      items.push({
        skillId: skill.id,
        name: skill.name,
        status: "conflict",
        repositoryPath: skill.localPath,
        targetPath,
        message: "Target exists but is not managed by skillsctl."
      });
    } else {
      items.push({
        skillId: skill.id,
        name: skill.name,
        status: "not-deployed",
        repositoryPath: skill.localPath,
        targetPath
      });
    }
  }

  const repositoryIds = new Set(repositorySkills.map((skill) => skill.id));
  for (const entry of targetEntries) {
    if (!repositoryIds.has(entry)) {
      const targetPath = join(targetRoot, entry);
      items.push({
        skillId: entry,
        name: entry,
        status: (await isBrokenLink(targetPath)) ? "broken" : "local-only",
        targetPath
      });
    }
  }

  return items.sort((a, b) => a.name.localeCompare(b.name));
}

async function readTargetEntries(targetRoot: string) {
  if (!(await exists(targetRoot))) {
    return new Set<string>();
  }
  const entries = await readdir(targetRoot, { withFileTypes: true });
  return new Set(
    entries
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .map((entry) => entry.name)
  );
}

async function isBrokenLink(path: string) {
  const entry = await lstat(path).catch(() => undefined);
  if (!entry?.isSymbolicLink()) {
    return false;
  }
  const target = await readlink(path).catch(() => undefined);
  return target ? !(await exists(target)) : true;
}
