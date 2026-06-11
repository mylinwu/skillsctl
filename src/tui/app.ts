import { homedir } from "node:os";
import { join } from "node:path";
import { getAgent, resolveAgentTargetPath, upsertAgent } from "../core/agent-registry.js";
import {
  configExists,
  initializeConfig,
  readConfig,
  writeConfig
} from "../core/config.js";
import { enableSkill, disableSkill } from "../core/deployment.js";
import { runQuickDoctor } from "../core/doctor.js";
import { deleteRepositorySkill, importFromSource, listRepositorySkills } from "../core/repository.js";
import { scanAgentScope } from "../core/scanner.js";
import { parseNpxSkillsAdd } from "../core/source-resolver.js";
import type { Config, DeployMode, SkillScope } from "../core/types.js";
import { getLogger } from "../platform/logger.js";
import { displayPath, resolveUserPath } from "../platform/path.js";
import { planAgentToggleChanges } from "./change-plan.js";
import { CancellationError, prompts } from "./prompt-adapter.js";

export interface TuiOptions {
  homeDir?: string;
  cwd?: string;
  platform?: NodeJS.Platform;
}

type MainAction = "repository" | "agents" | "doctor" | "settings" | "exit";

export async function runTui(options: TuiOptions = {}) {
  const homeDir = options.homeDir ?? homedir();
  const cwd = options.cwd ?? process.cwd();
  const platform = options.platform ?? process.platform;

  prompts.intro("skillctl");

  let config: Config;
  if (!(await configExists(homeDir))) {
    config = await initializeFlow({ homeDir, cwd, platform });
  } else {
    config = await readConfig(homeDir);
  }

  let exit = false;
  while (!exit) {
    const action = await prompts.select<MainAction>(
      `本地仓库: ${displayPath(config.repositoryPath, { homeDir })}\n当前项目: ${cwd}\n\n请选择操作类别`,
      [
        { value: "repository", label: "📦 仓库技能管理" },
        { value: "agents", label: "🤖 Agent 派发管理" },
        { value: "doctor", label: "🩺 系统环境诊断" },
        { value: "settings", label: "⚙️ 系统设置" },
        { value: "exit", label: "❌ 退出" }
      ]
    );

    switch (action) {
      case "repository":
        await repositoryFlow(config, { homeDir, cwd });
        break;
      case "agents":
        await agentsFlow(config, { homeDir, cwd, platform });
        break;
      case "doctor":
        await doctorFlow(config, { homeDir });
        break;
      case "settings":
        config = await settingsFlow(config, { homeDir });
        break;
      case "exit":
        exit = true;
        break;
    }
  }

  prompts.outro("已退出 skillctl。");
}

async function initializeFlow(options: Required<TuiOptions>) {
  const shouldInit = await prompts.confirm(
    "未检测到配置文件。skillctl 会创建一个不会被 Agent 自动读取的本地技能仓库。是否现在初始化？",
    true
  );
  if (!shouldInit) {
    prompts.outro("已退出 skillctl。");
    throw new CancellationError();
  }

  const defaultRepositoryPath = join(options.homeDir, ".skillsctl", "repository");
  const repositoryInput = await prompts.text(
    "请选择本地技能仓库位置",
    defaultRepositoryPath,
    defaultRepositoryPath
  );
  const deployMode = await prompts.select<DeployMode>(
    "请选择默认派发方式",
    [
      { value: "symlink", label: "symlink", hint: "macOS/Linux 推荐，更新方便" },
      { value: "copy", label: "copy", hint: "兼容性最好，但需要手动同步" },
      { value: "auto", label: "auto", hint: "根据系统自动选择" }
    ],
    options.platform === "win32" ? "auto" : "symlink"
  );
  const enabledAgentIds = await prompts.multiselect<string>(
    "请选择要启用的 Agents",
    [
      { value: "universal", label: "Universal", hint: "~/.agents/skills" },
      { value: "claude-code", label: "Claude Code", hint: "~/.claude/skills" },
      { value: "codex", label: "Codex", hint: "~/.agents/skills" },
      { value: "cursor", label: "Cursor", hint: "~/.cursor/skills" },
      { value: "qoder", label: "Qoder", hint: "~/.qoder/skills" },
      { value: "opencode", label: "OpenCode", hint: "~/.config/opencode/skills" }
    ],
    true,
    ["universal", "claude-code", "codex"]
  );

  const spin = prompts.spinner();
  spin.start("正在初始化 skillctl...");
  const config = await initializeConfig({
    homeDir: options.homeDir,
    platform: options.platform,
    repositoryPath: resolveUserPath(repositoryInput, options),
    defaultDeployMode: deployMode,
    enabledAgentIds
  });
  spin.stop("初始化完成");

  prompts.note(
    [
      `配置文件: ${displayPath(join(config.configDir, "config.json"), options)}`,
      `本地仓库: ${displayPath(config.repositoryPath, options)}`,
      `派发记录: ${displayPath(config.deploymentsPath, options)}`
    ].join("\n"),
    "初始化完成"
  );

  return config;
}

async function repositoryFlow(config: Config, options: { homeDir: string; cwd: string }) {
  const action = await prompts.select<"list" | "import-local" | "parse-npx" | "delete" | "back">(
    "仓库技能管理",
    [
      { value: "list", label: "查看仓库 skills" },
      { value: "import-local", label: "导入新 skill（本地路径 / GitHub / Git URL）" },
      { value: "parse-npx", label: "从 npx skills add 命令解析并导入" },
      { value: "delete", label: "删除仓库 skill" },
      { value: "back", label: "返回主菜单" }
    ]
  );

  if (action === "back") {
    return;
  }

  if (action === "list") {
    const skills = await listRepositorySkills(config);
    prompts.note(
      skills.length
        ? skills
            .map((skill) => `${skill.name} — ${skill.description || "无描述"}\n  ${displayPath(skill.localPath, options)}`)
            .join("\n\n")
        : "仓库中还没有 skills。",
      "仓库 skills"
    );
    return;
  }

  if (action === "import-local") {
    const sourcePath = await prompts.text("请输入 skill 来源", "vercel-labs/skills -- 或 ./my-skill");
    const skillFilter = await prompts.text("可选：指定 skill 名称或目录名，直接 Enter 导入全部发现的 skills", "");
    const spin = prompts.spinner();
    spin.start("正在导入...");
    const imported = await importFromSource(config, sourcePath, {
      cwd: options.cwd,
      selectedSkillIds: skillFilter.trim() ? [skillFilter.trim()] : undefined
    });
    spin.stop("导入完成");
    prompts.note(imported.map((skill) => `* ${skill.name}`).join("\n") || "没有导入任何 skill。", "已导入");
    return;
  }

  if (action === "parse-npx") {
    const command = await prompts.text(
      "请粘贴 npx skills add 命令",
      "npx skills add vercel-labs/agent-skills --skill frontend-design -a claude-code -g"
    );
    const parsed = parseNpxSkillsAdd(command);
    prompts.note(
      [
        `source: ${parsed.source ?? "(未识别)"}`,
        `skills: ${parsed.skills.join(", ") || "(未指定，导入全部发现项)"}`,
        `agents: ${parsed.agents.join(", ") || "(未指定)"}`,
        `scope: ${parsed.global ? "global" : "project/unspecified"}`,
        `mode: ${parsed.copy ? "copy" : config.defaultDeployMode}`
      ].join("\n"),
      "解析结果"
    );
    if (parsed.source && (await prompts.confirm("是否按解析结果导入到本地仓库？", true))) {
      const spin = prompts.spinner();
      spin.start("正在导入...");
      const imported = await importFromSource(config, parsed.source, {
        cwd: options.cwd,
        selectedSkillIds: parsed.skills.length > 0 ? parsed.skills : undefined
      });
      spin.stop("导入完成");
      prompts.note(imported.map((skill) => `* ${skill.name}`).join("\n") || "没有导入任何 skill。", "已导入");
    }
    return;
  }

  const skills = await listRepositorySkills(config);
  if (skills.length === 0) {
    prompts.note("仓库中还没有 skills。", "无法删除");
    return;
  }
  const skillId = await prompts.select(
    "请选择要删除的 skill",
    skills.map((skill) => ({ value: skill.id, label: skill.name }))
  );
  const confirmed = await prompts.confirm("确认删除？已派发的 skill 会被阻止删除。", false);
  if (confirmed) {
    await deleteRepositorySkill(config, skillId);
    prompts.note(skillId, "已删除");
  }
}

async function agentsFlow(
  config: Config,
  options: { homeDir: string; cwd: string; platform: NodeJS.Platform }
) {
  const agents = config.agents.filter((agent) => agent.enabled);
  if (agents.length === 0) {
    prompts.note("没有启用的 Agent，请先到系统设置启用。", "Agent 派发管理");
    return;
  }

  const agentId = await prompts.select(
    "请选择要管理的 Agent",
    agents.map((agent) => ({
      value: agent.id,
      label: agent.displayName,
      hint: displayPath(resolveAgentTargetPath(agent, { kind: "global" }, options), options)
    }))
  );
  const agent = getAgent(config, agentId)!;
  const scopeChoice = await prompts.select<"global" | "project" | "back">(
    "请选择管理范围",
    [
      {
        value: "global",
        label: `全局: ${displayPath(resolveAgentTargetPath(agent, { kind: "global" }, options), options)}`
      },
      {
        value: "project",
        label: `当前项目: ${resolveAgentTargetPath(agent, { kind: "project", projectPath: options.cwd }, options)}`
      },
      { value: "back", label: "返回 Agent 列表" }
    ]
  );
  if (scopeChoice === "back") {
    return;
  }

  const scope: SkillScope =
    scopeChoice === "global" ? { kind: "global" } : { kind: "project", projectPath: options.cwd };
  const items = await scanAgentScope(config, agentId, scope, { homeDir: options.homeDir });
  const manageable = items.filter((item) => ["managed", "outdated", "not-deployed"].includes(item.status));
  if (manageable.length === 0) {
    prompts.note("仓库中还没有可管理的 skills，或当前只有 local-only/conflict/broken 项。", "无可管理项");
    return;
  }

  const initiallyEnabled = manageable
    .filter((item) => item.status === "managed" || item.status === "outdated")
    .map((item) => item.skillId);
  const selected = await prompts.multiselect(
    "请选择此 Agent 应启用的 skills",
    manageable.map((item) => ({
      value: item.skillId,
      label: item.name,
      hint: item.status
    })),
    false,
    initiallyEnabled
  );

  const { toEnable, toDisable } = planAgentToggleChanges(manageable, selected);

  prompts.note(
    [
      `将启用 ${toEnable.length} 个 skill:`,
      ...toEnable.map((item) => `* ${item.name} -> ${item.targetPath}`),
      "",
      `将关闭 ${toDisable.length} 个 skill:`,
      ...toDisable.map((item) => `* ${item.name} 删除 ${item.targetPath}`),
      "",
      "不会自动处理 local-only、broken、conflict 项。"
    ].join("\n"),
    "变更预览"
  );

  if (!(await prompts.confirm("是否继续应用这些变更？", true))) {
    return;
  }

  const repositorySkills = await listRepositorySkills(config);
  let enabled = 0;
  let disabled = 0;
  const errors: string[] = [];

  for (const item of toDisable) {
    try {
      await disableSkill(config, item.deployment!);
      disabled++;
    } catch (err: any) {
      const msg = formatDeployError(err, "禁用", item.name, item.targetPath ?? "");
      errors.push(msg);
    }
  }
  for (const item of toEnable) {
    const skill = repositorySkills.find((candidate) => candidate.id === item.skillId);
    if (skill) {
      try {
        await enableSkill(config, skill, agent, scope, {
          homeDir: options.homeDir,
          platform: options.platform
        });
        enabled++;
      } catch (err: any) {
        const msg = formatDeployError(err, "启用", item.name, item.targetPath ?? "");
        errors.push(msg);
      }
    }
  }

  if (errors.length > 0) {
    prompts.note(
      [
        `成功: 启用 ${enabled}, 禁用 ${disabled}`,
        "",
        `失败 ${errors.length} 项:`,
        ...errors
      ].join("\n"),
      "批量变更完成（部分失败）"
    );
  } else {
    prompts.note(
      [`enabled: ${enabled}`, `disabled: ${disabled}`].join("\n"),
      "批量变更完成"
    );
  }
}

async function doctorFlow(config: Config, options: { homeDir: string }) {
  const spin = prompts.spinner();
  spin.start("正在检查配置、仓库和 Agent 路径...");
  const issues = await runQuickDoctor(config, { homeDir: options.homeDir });
  spin.stop("诊断完成");
  prompts.note(
    issues.length
      ? issues.map((issue) => `${issue.severity} ${issue.type}: ${issue.message}\n  ${issue.path ?? ""}`).join("\n\n")
      : "未发现问题。",
    "Doctor"
  );
}

async function settingsFlow(config: Config, options: { homeDir: string }) {
  const action = await prompts.select<"show" | "deploy-mode" | "toggle-agent" | "custom-agent" | "back">(
    "系统设置",
    [
      { value: "show", label: "查看当前配置" },
      { value: "deploy-mode", label: "修改默认派发方式" },
      { value: "toggle-agent", label: "启用/禁用 Agent" },
      { value: "custom-agent", label: "添加自定义 Agent" },
      { value: "back", label: "返回主菜单" }
    ]
  );

  if (action === "back") {
    return config;
  }
  if (action === "show") {
    prompts.note(JSON.stringify(config, null, 2), "当前配置");
    return config;
  }
  if (action === "deploy-mode") {
    const defaultDeployMode = await prompts.select<DeployMode>(
      "请选择新的默认派发方式",
      [
        { value: "symlink", label: "symlink" },
        { value: "copy", label: "copy" },
        { value: "auto", label: "auto" }
      ],
      config.defaultDeployMode
    );
    const next = { ...config, defaultDeployMode };
    await writeConfig(next);
    return next;
  }
  if (action === "toggle-agent") {
    const agentId = await prompts.select(
      "请选择 Agent",
      config.agents.map((agent) => ({
        value: agent.id,
        label: agent.displayName,
        hint: agent.enabled ? "enabled" : "disabled"
      }))
    );
    const next = {
      ...config,
      agents: config.agents.map((agent) =>
        agent.id === agentId ? { ...agent, enabled: !agent.enabled } : agent
      )
    };
    await writeConfig(next);
    return next;
  }

  const id = await prompts.text("请输入 Agent ID", "my-agent");
  const displayName = await prompts.text("请输入显示名称", "My Agent");
  const globalPath = await prompts.text("请输入全局 skills 路径", "~/.my-agent/skills");
  const projectPath = await prompts.text("请输入项目 skills 相对路径", ".my-agent/skills");
  const next = upsertAgent(config, {
    id,
    displayName,
    globalPath,
    projectPath,
    defaultDeployMode: "inherit",
    enabled: true
  });
  await writeConfig(next);
  prompts.note(`${displayName} (${id})`, "已添加自定义 Agent");
  return next;
}

function formatDeployError(err: any, action: string, skillName: string, targetPath: string): string {
  getLogger().error(`Deploy ${action} failed: ${skillName}`, err);

  const code = err?.code as string | undefined;
  if (code === "EBUSY" || code === "EPERM" || code === "EACCES") {
    return `* ${skillName}: ${action}失败 — 目标被占用或无权限 (${targetPath})`;
  }
  if (code === "ENOSPC") {
    return `* ${skillName}: ${action}失败 — 磁盘空间不足`;
  }
  return `* ${skillName}: ${action}失败 — ${err?.message ?? err}`;
}
