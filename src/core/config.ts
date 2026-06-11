import { constants } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { getBuiltInAgents } from "./agent-registry.js";
import type { Config, DeployMode, DeploymentRegistry } from "./types.js";

const deployModeSchema = z.enum(["symlink", "junction", "copy", "auto"]);

const logLevelSchema = z.enum(["debug", "info", "warn", "error", "silent"]);

const loggingConfigSchema = z.object({
  level: logLevelSchema,
  maxSizeMB: z.number().positive(),
  maxFiles: z.number().int().positive()
});

const agentSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  globalPath: z.string().min(1),
  projectPath: z.string().min(1),
  defaultDeployMode: z.union([deployModeSchema, z.literal("inherit")]).optional(),
  enabled: z.boolean()
});

export const configSchema = z.object({
  version: z.literal(1),
  configDir: z.string().min(1),
  repositoryPath: z.string().min(1),
  deploymentsPath: z.string().min(1),
  defaultDeployMode: deployModeSchema,
  logging: loggingConfigSchema.default({ level: "error", maxSizeMB: 5, maxFiles: 3 }),
  agents: z.array(agentSchema)
});

export const deploymentRegistrySchema = z.object({
  version: z.literal(1),
  deployments: z.array(
    z.object({
      id: z.string(),
      skillId: z.string(),
      agentId: z.string(),
      scope: z.enum(["global", "project"]),
      projectPath: z.string().optional(),
      sourcePath: z.string(),
      targetPath: z.string(),
      mode: z.enum(["symlink", "junction", "copy"]),
      fingerprint: z.string().optional(),
      createdAt: z.string(),
      updatedAt: z.string()
    })
  )
});

export interface ConfigPathsOptions {
  homeDir: string;
  platform?: NodeJS.Platform;
}

export function getDefaultConfig(options: ConfigPathsOptions): Config {
  const configDir = join(options.homeDir, ".skillsctl");
  const defaultDeployMode: DeployMode =
    (options.platform ?? process.platform) === "win32" ? "auto" : "symlink";

  return {
    version: 1,
    configDir,
    repositoryPath: join(configDir, "repository"),
    deploymentsPath: join(configDir, "deployments.json"),
    defaultDeployMode,
    logging: {
      level: "error",
      maxSizeMB: 5,
      maxFiles: 3
    },
    agents: getBuiltInAgents()
  };
}

export function getConfigPath(homeDir: string) {
  return join(homeDir, ".skillsctl", "config.json");
}

export async function configExists(homeDir: string) {
  return exists(getConfigPath(homeDir));
}

export async function readConfig(homeDir: string) {
  const raw = await readFile(getConfigPath(homeDir), "utf8");
  return configSchema.parse(JSON.parse(raw));
}

export async function writeConfig(config: Config) {
  const configPath = join(config.configDir, "config.json");
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

export async function initializeConfig(
  options: ConfigPathsOptions & {
    repositoryPath?: string;
    defaultDeployMode?: DeployMode;
    enabledAgentIds?: string[];
  }
) {
  const config = getDefaultConfig(options);
  const enabledAgentIds = new Set(options.enabledAgentIds);
  const finalConfig: Config = {
    ...config,
    repositoryPath: options.repositoryPath ?? config.repositoryPath,
    defaultDeployMode: options.defaultDeployMode ?? config.defaultDeployMode,
    agents:
      options.enabledAgentIds === undefined
        ? config.agents
        : config.agents.map((agent) => ({
            ...agent,
            enabled: enabledAgentIds.has(agent.id)
          }))
  };

  await mkdir(finalConfig.repositoryPath, { recursive: true });
  await writeConfig(finalConfig);
  await writeDeploymentRegistry(finalConfig.deploymentsPath, {
    version: 1,
    deployments: []
  });

  return finalConfig;
}

export async function readDeploymentRegistry(path: string): Promise<DeploymentRegistry> {
  if (!(await exists(path))) {
    return { version: 1, deployments: [] };
  }
  const raw = await readFile(path, "utf8");
  return deploymentRegistrySchema.parse(JSON.parse(raw));
}

export async function writeDeploymentRegistry(path: string, registry: DeploymentRegistry) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(registry, null, 2)}\n`);
}

export async function assertWritableDirectory(path: string) {
  await mkdir(path, { recursive: true });
  await access(path, constants.R_OK | constants.W_OK);
}

export async function exists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
