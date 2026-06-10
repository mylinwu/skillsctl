import { access } from "node:fs/promises";
import { getAgent } from "./agent-registry.js";
import { exists } from "./config.js";
import { scanAgentScope } from "./scanner.js";
import type { Config, DoctorIssue, SkillScope } from "./types.js";

export async function runQuickDoctor(
  config: Config,
  options: { homeDir: string; scopes?: Array<{ agentId: string; scope: SkillScope }> }
) {
  const issues: DoctorIssue[] = [];

  if (!(await exists(config.repositoryPath))) {
    issues.push({
      id: "missing-repository",
      severity: "error",
      type: "missing-repository",
      message: `Repository does not exist: ${config.repositoryPath}`,
      path: config.repositoryPath,
      fixable: true
    });
  } else {
    await access(config.repositoryPath).catch(() => {
      issues.push({
        id: "repository-unreadable",
        severity: "error",
        type: "missing-repository",
        message: `Repository is not accessible: ${config.repositoryPath}`,
        path: config.repositoryPath,
        fixable: false
      });
    });
  }

  const scopes =
    options.scopes ??
    config.agents
      .filter((agent) => agent.enabled)
      .map((agent) => ({ agentId: agent.id, scope: { kind: "global" } as const }));

  for (const scopeConfig of scopes) {
    const agent = getAgent(config, scopeConfig.agentId);
    if (!agent) {
      continue;
    }

    const items = await scanAgentScope(config, scopeConfig.agentId, scopeConfig.scope, {
      homeDir: options.homeDir
    });
    for (const item of items) {
      if (item.status === "broken") {
        issues.push({
          id: `broken:${item.targetPath}`,
          severity: "warning",
          type: "broken-link",
          message: `${agent.displayName}: broken skill ${item.name}`,
          path: item.targetPath,
          fixable: Boolean(item.deployment)
        });
      }
      if (item.status === "outdated") {
        issues.push({
          id: `outdated:${item.targetPath}`,
          severity: "warning",
          type: "outdated-copy",
          message: `${agent.displayName}: copy deployment is outdated for ${item.name}`,
          path: item.targetPath,
          fixable: true
        });
      }
      if (item.status === "conflict") {
        issues.push({
          id: `conflict:${item.targetPath}`,
          severity: "warning",
          type: "conflict",
          message: `${agent.displayName}: unmanaged target conflicts with repository skill ${item.name}`,
          path: item.targetPath,
          fixable: false
        });
      }
    }
  }

  return issues;
}
