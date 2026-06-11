import { homedir } from "node:os";
import { getAgent, resolveAgentTargetPath } from "../core/agent-registry.js";
import {
  configExists,
  initializeConfig,
  readConfig
} from "../core/config.js";
import { disableSkill, enableSkill } from "../core/deployment.js";
import { runQuickDoctor } from "../core/doctor.js";
import { importFromSource, listRepositorySkills } from "../core/repository.js";
import { scanAgentScope } from "../core/scanner.js";
import type { Config, DeploymentRecord, DeployMode, SkillManifest, SkillScope } from "../core/types.js";
import { getLogger } from "../platform/logger.js";
import { displayPath, resolveUserPath } from "../platform/path.js";
import { getFlag, getFlags, hasFlag, parseArgs } from "./args.js";

export interface CliOptions {
  argv: string[];
  homeDir?: string;
  cwd?: string;
  platform?: NodeJS.Platform;
}

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface Runtime {
  homeDir: string;
  cwd: string;
  platform: NodeJS.Platform;
}

export async function runCli(options: CliOptions): Promise<CliResult> {
  const runtime: Runtime = {
    homeDir: options.homeDir ?? homedir(),
    cwd: options.cwd ?? process.cwd(),
    platform: options.platform ?? process.platform
  };

  try {
    const parsed = parseArgs(options.argv);
    if (parsed.command.length === 0 || hasFlag(parsed.flags, "help")) {
      return ok(helpText());
    }

    const [command, subcommand, nested] = parsed.command;
    if (command === "init") {
      return await handleInit(parsed.flags, runtime);
    }
    if (!isKnownCommand(command)) {
      return fail(`Unknown command: ${parsed.command.join(" ")}`);
    }

    if (!(await configExists(runtime.homeDir))) {
      return fail("Config not found. Run `skillctl init` first.");
    }

    const config = await readConfig(runtime.homeDir);
    switch (command) {
      case "repo":
        if (subcommand === "list") {
          return await handleRepoList(config, runtime);
        }
        break;
      case "import":
        return await handleImport(config, parsed.command.slice(1), parsed.flags, runtime);
      case "update":
        return fail(
          `skillctl update${subcommand ? ` ${subcommand}` : ""} is not implemented yet.`
        );
      case "enable":
        return await handleEnable(config, subcommand, parsed.flags, runtime);
      case "disable":
        return await handleDisable(config, subcommand, parsed.flags, runtime);
      case "app":
        if (subcommand === "list") {
          return handleAppList(config, runtime);
        }
        if (nested === "list") {
          return await handleAppScopeList(config, subcommand, parsed.flags, runtime);
        }
        break;
      case "doctor":
        return await handleDoctor(config, runtime);
      case "config":
        return ok(`${JSON.stringify(config, null, 2)}\n`);
    }

    return fail(`Unknown command: ${parsed.command.join(" ")}`);
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

async function handleInit(flags: Map<string, string[]>, runtime: Runtime) {
  const repositoryInput = getFlag(flags, "repository");
  const mode = getFlag(flags, "mode") as DeployMode | undefined;
  const agents = getFlag(flags, "agents");
  const enabledAgentIds = agents
    ?.split(",")
    .map((agent) => agent.trim())
    .filter(Boolean);

  const config = await initializeConfig({
    homeDir: runtime.homeDir,
    platform: runtime.platform,
    repositoryPath: repositoryInput
      ? resolveUserPath(repositoryInput, { homeDir: runtime.homeDir, cwd: runtime.cwd })
      : undefined,
    defaultDeployMode: mode,
    enabledAgentIds
  });

  return ok(
    [
      "Initialized skillctl.",
      `Config: ${displayPath(`${config.configDir}/config.json`, runtime)}`,
      `Repository: ${displayPath(config.repositoryPath, runtime)}`,
      `Deployments: ${displayPath(config.deploymentsPath, runtime)}`
    ].join("\n") + "\n"
  );
}

async function handleRepoList(config: Config, runtime: Runtime) {
  const skills = await listRepositorySkills(config);
  if (skills.length === 0) {
    return ok("No skills in repository.\n");
  }

  return ok(
    skills
      .map((skill) =>
        [
          `${skill.id} — ${skill.description || "No description"}`,
          `  name: ${skill.name}`,
          `  path: ${displayPath(skill.localPath, runtime)}`,
          skill.source?.value ? `  source: ${skill.source.value}` : undefined
        ]
          .filter(Boolean)
          .join("\n")
      )
      .join("\n\n") + "\n"
  );
}

async function handleImport(
  config: Config,
  positionals: string[],
  flags: Map<string, string[]>,
  runtime: Runtime
) {
  const source = positionals[0];
  if (!source) {
    throw new Error("Missing import source.");
  }

  const selectedSkillIds = getFlags(flags, "skill");
  const imported = await importFromSource(config, source, {
    cwd: runtime.cwd,
    selectedSkillIds: selectedSkillIds.length > 0 ? selectedSkillIds : undefined
  });

  return ok(
    [`Imported ${imported.length} ${imported.length === 1 ? "skill" : "skills"}.`]
      .concat(imported.map((skill) => `- ${skill.id} (${skill.name})`))
      .join("\n") + "\n"
  );
}

async function handleEnable(
  config: Config,
  skillId: string | undefined,
  flags: Map<string, string[]>,
  runtime: Runtime
) {
  if (!skillId) {
    throw new Error("Missing skill id.");
  }

  const agentId = requireFlag(flags, "agent");
  const agent = getAgent(config, agentId);
  if (!agent) {
    throw new Error(`Unknown agent: ${agentId}`);
  }

  const scope = parseScope(flags, runtime);
  const skill = await findRepositorySkill(config, skillId);
  const mode = getFlag(flags, "mode") as DeployMode | undefined;
  let deployment: DeploymentRecord;
  try {
    deployment = await enableSkill(config, skill, agent, scope, {
      homeDir: runtime.homeDir,
      mode,
      platform: runtime.platform
    });
  } catch (err: any) {
    return fail(formatDeployCliError(err, "enable", skillId));
  }

  return ok(
    [
      `Enabled ${skill.id}.`,
      `Agent: ${agent.id}`,
      `Scope: ${deployment.scope}`,
      `Target: ${displayPath(deployment.targetPath, runtime)}`,
      `Mode: ${deployment.mode}`
    ].join("\n") + "\n"
  );
}

async function handleDisable(
  config: Config,
  skillId: string | undefined,
  flags: Map<string, string[]>,
  runtime: Runtime
) {
  if (!skillId) {
    throw new Error("Missing skill id.");
  }

  const agentId = requireFlag(flags, "agent");
  const scope = parseScope(flags, runtime);
  const items = await scanAgentScope(config, agentId, scope, { homeDir: runtime.homeDir });
  const item = items.find((candidate) => candidate.skillId === skillId || candidate.name === skillId);
  if (!item?.deployment) {
    throw new Error(`Managed deployment not found for skill: ${skillId}`);
  }

  try {
    await disableSkill(config, item.deployment);
  } catch (err: any) {
    return fail(formatDeployCliError(err, "disable", skillId));
  }
  return ok(`Disabled ${item.skillId}.\n`);
}

function handleAppList(config: Config, runtime: Runtime) {
  return ok(
    config.agents
      .map((agent) =>
        [
          `${agent.id} — ${agent.displayName} (${agent.enabled ? "enabled" : "disabled"})`,
          `  global: ${displayPath(resolveAgentTargetPath(agent, { kind: "global" }, runtime), runtime)}`,
          `  project: ${agent.projectPath}`
        ].join("\n")
      )
      .join("\n\n") + "\n"
  );
}

async function handleAppScopeList(
  config: Config,
  agentId: string | undefined,
  flags: Map<string, string[]>,
  runtime: Runtime
) {
  if (!agentId) {
    throw new Error("Missing agent id.");
  }

  const scope = hasFlag(flags, "project") || hasFlag(flags, "global")
    ? parseScope(flags, runtime)
    : ({ kind: "global" } as const);
  const items = await scanAgentScope(config, agentId, scope, { homeDir: runtime.homeDir });
  if (items.length === 0) {
    return ok("No skills found.\n");
  }

  return ok(
    items
      .map((item) =>
        [
          `${item.skillId} — ${item.status}`,
          `  name: ${item.name}`,
          item.targetPath ? `  target: ${displayPath(item.targetPath, runtime)}` : undefined,
          item.message ? `  message: ${item.message}` : undefined
        ]
          .filter(Boolean)
          .join("\n")
      )
      .join("\n\n") + "\n"
  );
}

async function handleDoctor(config: Config, runtime: Runtime) {
  const issues = await runQuickDoctor(config, { homeDir: runtime.homeDir });
  if (issues.length === 0) {
    return ok("No issues found.\n");
  }

  return ok(
    issues
      .map((issue) =>
        [
          `${issue.severity} ${issue.type}: ${issue.message}`,
          issue.path ? `  path: ${displayPath(issue.path, runtime)}` : undefined,
          `  fixable: ${issue.fixable ? "yes" : "no"}`
        ]
          .filter(Boolean)
          .join("\n")
      )
      .join("\n\n") + "\n"
  );
}

async function findRepositorySkill(config: Config, skillId: string): Promise<SkillManifest> {
  const skills = await listRepositorySkills(config);
  const skill = skills.find((candidate) => candidate.id === skillId || candidate.name === skillId);
  if (!skill) {
    throw new Error(`Skill not found: ${skillId}`);
  }
  return skill;
}

function parseScope(flags: Map<string, string[]>, runtime: Runtime): SkillScope {
  const isGlobal = hasFlag(flags, "global");
  const projectPath = getFlag(flags, "project");
  if (isGlobal && projectPath) {
    throw new Error("Use only one scope: --global or --project <path>.");
  }
  if (isGlobal) {
    return { kind: "global" };
  }
  if (projectPath) {
    return {
      kind: "project",
      projectPath: resolveUserPath(projectPath, { homeDir: runtime.homeDir, cwd: runtime.cwd })
    };
  }
  throw new Error("Missing scope. Use --global or --project <path>.");
}

function requireFlag(flags: Map<string, string[]>, name: string) {
  const value = getFlag(flags, name);
  if (!value) {
    throw new Error(`Missing required flag: --${name}`);
  }
  return value;
}

function formatDeployCliError(err: any, action: string, skillId: string): string {
  getLogger().error(`Deploy ${action} failed: ${skillId}`, err);

  const code = err?.code as string | undefined;
  if (code === "EBUSY" || code === "EPERM" || code === "EACCES") {
    return `Failed to ${action} ${skillId}: target is busy or access denied. Close any program using it and retry.`;
  }
  if (code === "ENOSPC") {
    return `Failed to ${action} ${skillId}: no space left on device.`;
  }
  return `Failed to ${action} ${skillId}: ${err?.message ?? err}`;
}

function ok(stdout: string): CliResult {
  return { exitCode: 0, stdout, stderr: "" };
}

function fail(stderr: string): CliResult {
  return { exitCode: 1, stdout: "", stderr: `${stderr}\n` };
}

function isKnownCommand(command: string | undefined) {
  return ["repo", "import", "update", "enable", "disable", "app", "doctor", "config"].includes(
    command ?? ""
  );
}

function helpText() {
  return [
    "skillctl",
    "",
    "Commands:",
    "  skillctl init [--repository <path>] [--mode <symlink|junction|copy|auto>] [--agents <ids>]",
    "  skillctl repo list",
    "  skillctl import <source> [--skill <id>]",
    "  skillctl update [skill]",
    "  skillctl enable <skill> --agent <agent> (--global | --project <path>) [--mode <mode>]",
    "  skillctl disable <skill> --agent <agent> (--global | --project <path>)",
    "  skillctl app list",
    "  skillctl app <agent> list [--global | --project <path>]",
    "  skillctl doctor",
    "  skillctl config"
  ].join("\n") + "\n";
}
