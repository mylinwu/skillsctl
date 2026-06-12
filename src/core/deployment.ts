import { cp, lstat, mkdir, readlink, rm, symlink } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  exists,
  readDeploymentRegistry,
  writeDeploymentRegistry
} from "./config.js";
import type {
  AgentDefinition,
  BrokenDeployment,
  Config,
  DeploymentRecord,
  DeployMode,
  SkillManifest,
  SkillScope
} from "./types.js";
import { resolveAgentTargetPath } from "./agent-registry.js";
import { hashDirectory } from "../platform/hash.js";

export async function enableSkill(
  config: Config,
  skill: SkillManifest,
  agent: AgentDefinition,
  scope: SkillScope,
  options: { homeDir: string; mode?: DeployMode; platform?: NodeJS.Platform }
) {
  const targetRoot = resolveAgentTargetPath(agent, scope, { homeDir: options.homeDir });
  const targetPath = join(targetRoot, skill.directoryName);
  const mode = resolveDeployMode(options.mode ?? agent.defaultDeployMode ?? config.defaultDeployMode, {
    platform: options.platform ?? process.platform
  });

  await mkdir(targetRoot, { recursive: true });

  if (await exists(targetPath)) {
    const existing = await findDeploymentByTarget(config, targetPath);
    if (!existing) {
      throw new Error(`Target already exists and is not managed: ${targetPath}`);
    }
    await rm(targetPath, { recursive: true, force: true });
  }

  if (mode === "copy") {
    await cp(skill.localPath, targetPath, { recursive: true, dereference: false });
  } else {
    // junction is only meaningful on Windows; resolveDeployMode should
    // already map it away on other platforms, but guard defensively here.
    const symlinkType = mode === "junction" ? "junction" : "dir";
    await symlink(skill.localPath, targetPath, symlinkType);
  }

  const now = new Date().toISOString();
  const record: DeploymentRecord = {
    id: randomUUID(),
    skillId: skill.id,
    agentId: agent.id,
    scope: scope.kind,
    projectPath: scope.kind === "project" ? scope.projectPath : undefined,
    sourcePath: skill.localPath,
    targetPath,
    mode,
    fingerprint: mode === "copy" ? await hashDirectory(skill.localPath) : undefined,
    createdAt: now,
    updatedAt: now
  };

  const registry = await readDeploymentRegistry(config.deploymentsPath);
  registry.deployments = registry.deployments.filter(
    (deployment) => deployment.targetPath !== targetPath
  );
  registry.deployments.push(record);
  await writeDeploymentRegistry(config.deploymentsPath, registry);

  return record;
}

export async function disableSkill(config: Config, deployment: DeploymentRecord) {
  const current = await findDeploymentByTarget(config, deployment.targetPath);
  if (!current) {
    throw new Error(`Deployment is not managed: ${deployment.targetPath}`);
  }

  if (await exists(deployment.targetPath)) {
    await assertTargetIsSafeToRemove(deployment);
    await rm(deployment.targetPath, { recursive: true, force: true });
  }

  const registry = await readDeploymentRegistry(config.deploymentsPath);
  registry.deployments = registry.deployments.filter((item) => item.id !== deployment.id);
  await writeDeploymentRegistry(config.deploymentsPath, registry);
}

export async function findDeploymentByTarget(config: Config, targetPath: string) {
  const registry = await readDeploymentRegistry(config.deploymentsPath);
  return registry.deployments.find((deployment) => deployment.targetPath === targetPath);
}

export function resolveDeployMode(
  mode: DeployMode | "inherit",
  options: { platform: NodeJS.Platform }
): Exclude<DeployMode, "auto"> {
  if (mode === "inherit" || mode === "auto") {
    return options.platform === "win32" ? "junction" : "symlink";
  }
  return mode;
}

export async function isCopyOutdated(deployment: DeploymentRecord) {
  if (deployment.mode !== "copy" || !deployment.fingerprint) {
    return false;
  }
  if (!(await exists(deployment.sourcePath)) || !(await exists(deployment.targetPath))) {
    return false;
  }
  return (await hashDirectory(deployment.sourcePath)) !== deployment.fingerprint;
}

export function targetPathForSkill(targetRoot: string, skillId: string) {
  return join(targetRoot, basename(skillId));
}

export async function scanBrokenDeployments(config: Config): Promise<BrokenDeployment[]> {
  const registry = await readDeploymentRegistry(config.deploymentsPath);
  const broken: BrokenDeployment[] = [];

  for (const deployment of registry.deployments) {
    const entry = await lstat(deployment.targetPath).catch(() => undefined);

    if (!entry) {
      // Target path does not exist at all
      broken.push({ deployment, reason: "target-missing", isLink: false });
      continue;
    }

    if (entry.isSymbolicLink()) {
      // Link exists — check whether it points to a valid target
      const linkTarget = await readlink(deployment.targetPath).catch(() => undefined);
      if (!linkTarget || !(await exists(linkTarget))) {
        broken.push({ deployment, reason: "broken-link", isLink: true });
      }
    }
    // For non-link entries (copy, junction on Windows reported as dir),
    // entry existing means the deployment is intact.
  }

  return broken;
}

export async function pruneBrokenDeployments(
  config: Config,
  targets: BrokenDeployment[]
): Promise<{ pruned: number; cleanedLinks: number }> {
  if (targets.length === 0) {
    return { pruned: 0, cleanedLinks: 0 };
  }

  const idsToRemove = new Set(targets.map((item) => item.deployment.id));
  let cleanedLinks = 0;

  // Remove broken symlink/junction files that still linger on disk
  for (const item of targets) {
    if (item.isLink && item.reason === "broken-link") {
      try {
        await rm(item.deployment.targetPath, { force: true });
        cleanedLinks++;
      } catch {
        // Best-effort cleanup; ignore failures
      }
    }
  }

  const registry = await readDeploymentRegistry(config.deploymentsPath);
  registry.deployments = registry.deployments.filter((item) => !idsToRemove.has(item.id));
  await writeDeploymentRegistry(config.deploymentsPath, registry);

  return { pruned: idsToRemove.size, cleanedLinks };
}

async function assertTargetIsSafeToRemove(deployment: DeploymentRecord) {
  const target = await lstat(deployment.targetPath);
  if (deployment.mode === "copy") {
    return;
  }
  if (!target.isSymbolicLink()) {
    throw new Error(`Refusing to remove non-link managed target: ${deployment.targetPath}`);
  }
  const linkTarget = await readlink(deployment.targetPath);
  if (resolve(linkTarget) !== resolve(deployment.sourcePath)) {
    throw new Error(`Refusing to remove link with unexpected target: ${deployment.targetPath}`);
  }
}
