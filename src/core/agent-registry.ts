import { join } from "node:path";
import type { AgentDefinition, Config, SkillScope } from "./types.js";
import { expandHome } from "../platform/path.js";

function getCodexGlobalPath(): string {
  const codeHome = process.env.CODEX_HOME?.trim();
  return codeHome ? `${codeHome}/skills` : "~/.codex/skills";
}

export function getBuiltInAgents(): AgentDefinition[] {
  return [
    {
      id: "universal",
      displayName: "Universal",
      globalPath: "~/.agents/skills",
      projectPath: ".agents/skills",
      defaultDeployMode: "inherit",
      enabled: true
    },
    {
      id: "claude-code",
      displayName: "Claude Code",
      globalPath: "~/.claude/skills",
      projectPath: ".claude/skills",
      defaultDeployMode: "inherit",
      enabled: true
    },
    {
      id: "codex",
      displayName: "Codex",
      globalPath: getCodexGlobalPath(),
      projectPath: ".agents/skills",
      defaultDeployMode: "inherit",
      enabled: true
    },
    {
      id: "cursor",
      displayName: "Cursor",
      globalPath: "~/.cursor/skills",
      projectPath: ".agents/skills",
      defaultDeployMode: "inherit",
      enabled: false
    },
    {
      id: "qoder",
      displayName: "Qoder",
      globalPath: "~/.qoder/skills",
      projectPath: ".qoder/skills",
      defaultDeployMode: "inherit",
      enabled: false
    },
    {
      id: "opencode",
      displayName: "OpenCode",
      globalPath: "~/.config/opencode/skills",
      projectPath: ".agents/skills",
      defaultDeployMode: "inherit",
      enabled: false
    },
    {
      id: "warp",
      displayName: "Warp",
      globalPath: "~/.agents/skills",
      projectPath: ".agents/skills",
      defaultDeployMode: "inherit",
      enabled: false
    },
    {
      id: "gemini-cli",
      displayName: "Gemini CLI",
      globalPath: "~/.gemini/skills",
      projectPath: ".agents/skills",
      defaultDeployMode: "inherit",
      enabled: false
    },
    {
      id: "goose",
      displayName: "Goose",
      globalPath: "~/.config/goose/skills",
      projectPath: ".goose/skills",
      defaultDeployMode: "inherit",
      enabled: false
    },
    {
      id: "windsurf",
      displayName: "Windsurf",
      globalPath: "~/.codeium/windsurf/skills",
      projectPath: ".windsurf/skills",
      defaultDeployMode: "inherit",
      enabled: false
    },
    {
      id: "zed",
      displayName: "Zed",
      globalPath: "~/.agents/skills",
      projectPath: ".agents/skills",
      defaultDeployMode: "inherit",
      enabled: false
    },
    {
      id: "qwen-code",
      displayName: "Qwen Code",
      globalPath: "~/.qwen/skills",
      projectPath: ".qwen/skills",
      defaultDeployMode: "inherit",
      enabled: false
    },
    {
      id: "cline",
      displayName: "Cline",
      globalPath: "~/.agents/skills",
      projectPath: ".agents/skills",
      defaultDeployMode: "inherit",
      enabled: false
    },
    {
      id: "roo",
      displayName: "Roo Code",
      globalPath: "~/.roo/skills",
      projectPath: ".roo/skills",
      defaultDeployMode: "inherit",
      enabled: false
    }
  ];
}

export const BUILT_IN_AGENTS: AgentDefinition[] = getBuiltInAgents();

export function getAgent(config: Config, agentId: string) {
  return config.agents.find((agent) => agent.id === agentId);
}

export function resolveAgentTargetPath(
  agent: AgentDefinition,
  scope: SkillScope,
  options: { homeDir: string }
) {
  if (scope.kind === "global") {
    return expandHome(agent.globalPath, options);
  }
  return join(scope.projectPath, agent.projectPath);
}

export function upsertAgent(config: Config, agent: AgentDefinition): Config {
  const nextAgents = config.agents.filter((item) => item.id !== agent.id);
  nextAgents.push(agent);
  return { ...config, agents: nextAgents };
}
