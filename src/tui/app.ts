import { homedir } from "node:os";
import { join } from "node:path";
import { getAgent, resolveAgentTargetPath, upsertAgent } from "../core/agent-registry.js";
import {
  configExists,
  initializeConfig,
  readConfig,
  writeConfig
} from "../core/config.js";
import { enableSkill, disableSkill, scanBrokenDeployments, pruneBrokenDeployments } from "../core/deployment.js";
import { runQuickDoctor } from "../core/doctor.js";
import {
  checkRepositorySkillUpdates,
  deleteRepositorySkill,
  importFromSource,
  listRepositorySkills,
  listRepositorySkillViews,
  updateRepositorySkill
} from "../core/repository.js";
import { scanAgentScope } from "../core/scanner.js";
import { parseNpxSkillsAdd } from "../core/source-resolver.js";
import type {
  BrokenDeployment,
  Config,
  DeployMode,
  RepositorySkillCheckResult,
  RepositorySkillUpdateResult,
  RepositorySkillView,
  ScanItem,
  SkillManifest,
  SkillScope
} from "../core/types.js";
import { getLogger } from "../platform/logger.js";
import { displayPath, resolveUserPath } from "../platform/path.js";
import { planAgentToggleChanges } from "./change-plan.js";
import { BACK, isBack, prompts } from "./prompt-adapter.js";

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

  prompts.intro("skillsctl");

  let config: Config;
  if (!(await configExists(homeDir))) {
    const result = await initializeFlow({ homeDir, cwd, platform });
    if (isBack(result)) return;
    config = result;
  } else {
    config = await readConfig(homeDir);
  }

  let exit = false;
  while (!exit) {
    const action = await prompts.select<MainAction>(
      `本地仓库: ${displayPath(config.repositoryPath, { homeDir })}\n当前项目: ${cwd}\n\n请选择操作类别`,
      [
        { value: "repository", label: "📦 技能管理" },
        { value: "agents", label: "🤖 Agent 派发管理" },
        { value: "doctor", label: "🩺 系统环境诊断" },
        { value: "settings", label: "⚙️ 系统设置" },
        { value: "exit", label: "❌ 退出" }
      ]
    );

    if (isBack(action)) break;

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
      case "settings": {
        const result = await settingsFlow(config, { homeDir });
        if (!isBack(result)) config = result;
        break;
      }
      case "exit":
        exit = true;
        break;
    }
  }

  prompts.outro("已退出 skillsctl。");
}

async function initializeFlow(options: Required<TuiOptions>) {
  const shouldInit = await prompts.confirm(
    "未检测到配置文件。skillsctl 会创建一个不会被 Agent 自动读取的本地技能仓库。是否现在初始化？",
    true
  );
  if (isBack(shouldInit) || !shouldInit) {
    prompts.outro("已退出 skillsctl。");
    return BACK;
  }

  const defaultRepositoryPath = join(options.homeDir, ".skillsctl", "repository");
  const repositoryInput = await prompts.text(
    "请选择本地技能仓库位置",
    defaultRepositoryPath,
    defaultRepositoryPath
  );
  if (isBack(repositoryInput)) return BACK;

  const deployMode = await prompts.select<DeployMode>(
    "请选择默认派发方式",
    [
      { value: "symlink", label: "symlink", hint: "macOS/Linux 推荐，更新方便" },
      { value: "copy", label: "copy", hint: "兼容性最好，但需要手动同步" },
      { value: "auto", label: "auto", hint: "根据系统自动选择" }
    ],
    options.platform === "win32" ? "auto" : "symlink"
  );
  if (isBack(deployMode)) return BACK;

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
  if (isBack(enabledAgentIds)) return BACK;

  const spin = prompts.spinner();
  spin.start("正在初始化 skillsctl...");
  const config = await initializeConfig({
    homeDir: options.homeDir,
    platform: options.platform,
    repositoryPath: resolveUserPath(repositoryInput as string, options),
    defaultDeployMode: deployMode as DeployMode,
    enabledAgentIds: enabledAgentIds as string[]
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
  const action = await prompts.select<"list" | "check-updates" | "import-local" | "parse-npx" | "scan-clean" | "delete" | "back">(
    "技能管理",
    [
      { value: "list", label: "查看仓库 skills" },
      { value: "check-updates", label: "检查技能更新" },
      { value: "import-local", label: "导入新 skill（本地路径 / GitHub / Git URL）" },
      { value: "parse-npx", label: "从 npx skills add 命令解析并导入" },
      { value: "scan-clean", label: "扫描配置" },
      { value: "delete", label: "删除仓库 skill" },
      { value: "back", label: "返回主菜单" }
    ]
  );

  if (isBack(action) || action === "back") {
    return;
  }

  if (action === "list") {
    await browseRepositorySkills(config, options);
    return;
  }

  if (action === "check-updates") {
    await checkUpdatesFlow(config, options);
    return;
  }

  if (action === "import-local") {
    const sourcePath = await prompts.text("请输入 skill 来源", "vercel-labs/skills -- 或 ./my-skill");
    if (isBack(sourcePath)) return;
    const skillFilter = await prompts.text("可选：指定 skill 名称或目录名，直接 Enter 导入全部发现的 skills", "");
    if (isBack(skillFilter)) return;
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
    if (isBack(command)) return;
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
    const shouldImport = await prompts.confirm("是否按解析结果导入到本地仓库？", true);
    if (isBack(shouldImport)) return;
    if (parsed.source && shouldImport) {
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

  if (action === "scan-clean") {
    await scanCleanFlow(config, options);
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
  if (isBack(skillId)) return;
  const confirmed = await prompts.confirm("确认删除？已派发的 skill 会被阻止删除。", false);
  if (isBack(confirmed)) return;
  if (confirmed) {
    await deleteRepositorySkill(config, skillId);
    prompts.note(skillId, "已删除");
  }
}

async function scanCleanFlow(config: Config, options: { homeDir: string; cwd: string }) {
  const spin = prompts.spinner();
  spin.start("正在扫描派发记录...");
  const broken = await scanBrokenDeployments(config);
  spin.stop("扫描完成");

  if (broken.length === 0) {
    prompts.note("所有派发记录均正常，无需清理。", "扫描结果");
    return;
  }

  const reasonLabels: Record<string, string> = {
    "target-missing": "目标已删除",
    "broken-link": "链接已损坏"
  };

  const lines = broken.map((item) => {
    const d = item.deployment;
    const type = item.isLink ? "link" : d.mode;
    const reason = reasonLabels[item.reason] ?? item.reason;
    return `• ${d.skillId} [${d.agentId}/${d.scope}] ${reason} (${type})\n  ${displayPath(d.targetPath, options)}`;
  });

  prompts.note(
    [`发现 ${broken.length} 条失效派发记录：`, "", ...lines].join("\n"),
    "扫描结果"
  );

  const confirmed = await prompts.confirm("是否清理这些失效记录？", true);
  if (isBack(confirmed) || !confirmed) return;

  const result = await pruneBrokenDeployments(config, broken);
  prompts.note(
    [
      `已移除 ${result.pruned} 条派发记录`,
      result.cleanedLinks > 0 ? `已清理 ${result.cleanedLinks} 个残留链接文件` : ""
    ].filter(Boolean).join("\n"),
    "清理完成"
  );
}

async function checkUpdatesFlow(config: Config, options: { homeDir: string; cwd: string }) {
  const spin = prompts.spinner();
  spin.start("正在检查所有技能的更新情况...");
  const results = await checkRepositorySkillUpdates(config);
  spin.stop("检查完成");

  const updatable = results.filter((item) => item.status === "update-available");
  const blocked = results.filter((item) => item.status !== "update-available" && item.status !== "already-latest");

  if (updatable.length === 0) {
    const lines = blocked.length
      ? blocked.map((item) => `* ${item.skillId}: ${formatCheckStatus(item)}`)
      : ["所有技能都已经是最新版本。"];
    prompts.note(lines.join("\n"), "检查结果");
    return;
  }

  if (blocked.length > 0) {
    prompts.note(
      blocked.map((item) => `* ${item.skillId}: ${formatCheckStatus(item)}`).join("\n"),
      "以下技能未纳入本次更新"
    );
  }

  const selected = await prompts.multiselect(
    "发现以下技能有更新，默认全选。请选择要更新的技能",
    updatable.map((item) => ({
      value: item.skillId,
      label: item.name,
      hint: formatCheckStatus(item)
    })),
    false,
    updatable.map((item) => item.skillId)
  );
  if (isBack(selected) || selected.length === 0) {
    return;
  }

  const confirmed = await prompts.confirm(`确认批量更新 ${selected.length} 个技能？`, true);
  if (isBack(confirmed) || !confirmed) {
    return;
  }

  const updateSpin = prompts.spinner();
  updateSpin.start("正在批量更新技能...");
  const updated = await Promise.all(selected.map((skillId) => updateRepositorySkill(config, skillId)));
  updateSpin.stop("批量更新完成");

  prompts.note(updated.map((item) => `* ${item.skillId}: ${formatUpdateResult(item, options)}`).join("\n"), "更新结果");
}

async function browseRepositorySkills(config: Config, options: { homeDir: string; cwd: string }) {
  while (true) {
    const keyword = await prompts.text("输入关键词过滤 skills，直接 Enter 查看全部", "");
    if (isBack(keyword)) return;

    const views = await listRepositorySkillViews(config, { keyword });
    if (views.length === 0) {
      prompts.note("没有匹配的 skills。", "仓库 skills");
      continue;
    }

    const skillId = await prompts.select<string | "back">(
      "请选择一个 skill 查看详情",
      [
        ...views.map((view) => ({
          value: view.skill.id,
          label: view.skill.name,
          hint: view.summary
        })),
        { value: "back", label: "返回上一级", hint: "返回仓库管理" }
      ]
    );
    if (isBack(skillId) || skillId === "back") {
      return;
    }

    const selected = views.find((view) => view.skill.id === skillId);
    if (!selected) {
      continue;
    }
    await showRepositorySkillDetail(config, selected, options);
  }
}

async function showRepositorySkillDetail(
  config: Config,
  initialView: RepositorySkillView,
  options: { homeDir: string; cwd: string }
) {
  let current = initialView;

  while (true) {
    prompts.note(formatRepositorySkillDetail(current, options), current.skill.name);

    const action = await prompts.select<"enable" | "update" | "delete" | "back">(
      "请选择操作",
      [
        { value: "enable", label: "启用到 Agent" },
        { value: "update", label: "更新此 skill" },
        { value: "delete", label: "删除此 skill" },
        { value: "back", label: "返回仓库列表" }
      ]
    );
    if (isBack(action) || action === "back") {
      return;
    }

    if (action === "enable") {
      await enableRepositorySkillFromDetail(config, current.skill, options);
    } else if (action === "update") {
      await updateRepositorySkillFromDetail(config, current.skill, options);
    } else if (action === "delete") {
      const deleted = await deleteRepositorySkillFromDetail(config, current.skill.id);
      if (deleted) {
        return;
      }
    }

    const refreshed = await listRepositorySkillViews(config);
    const nextView = refreshed.find((view) => view.skill.id === current.skill.id);
    if (!nextView) {
      return;
    }
    current = nextView;
  }
}

async function enableRepositorySkillFromDetail(
  config: Config,
  skill: SkillManifest,
  options: { homeDir: string; cwd: string }
) {
  const agents = config.agents.filter((agent) => agent.enabled);
  if (agents.length === 0) {
    prompts.note("没有启用的 Agent，请先到系统设置启用。", "无法启用");
    return;
  }

  const agentId = await prompts.select(
    "请选择目标 Agent",
    agents.map((agent) => ({
      value: agent.id,
      label: agent.displayName,
      hint: displayPath(resolveAgentTargetPath(agent, { kind: "global" }, options), options)
    }))
  );
  if (isBack(agentId)) return;

  const agent = getAgent(config, agentId)!;
  const scopeChoice = await prompts.select<"global" | "project">(
    "请选择启用范围",
    [
      {
        value: "global",
        label: `全局: ${displayPath(resolveAgentTargetPath(agent, { kind: "global" }, options), options)}`
      },
      {
        value: "project",
        label: `当前项目: ${resolveAgentTargetPath(agent, { kind: "project", projectPath: options.cwd }, options)}`
      }
    ]
  );
  if (isBack(scopeChoice)) return;

  const scope: SkillScope =
    scopeChoice === "global" ? { kind: "global" } : { kind: "project", projectPath: options.cwd };

  try {
    const deployment = await enableSkill(config, skill, agent, scope, {
      homeDir: options.homeDir,
      platform: process.platform
    });
    prompts.note(
      [
        `Agent: ${agent.displayName}`,
        `范围: ${deployment.scope}`,
        `目标: ${displayPath(deployment.targetPath, options)}`,
        `模式: ${deployment.mode}`
      ].join("\n"),
      "启用完成"
    );
  } catch (err: any) {
    prompts.note(formatDeployError(err, "启用", skill.name, skill.localPath), "启用失败");
  }
}

async function updateRepositorySkillFromDetail(
  config: Config,
  skill: SkillManifest,
  options: { homeDir: string; cwd: string }
) {
  let result = await updateRepositorySkill(config, skill.id);
  if (result.status === "skipped-local-changes") {
    const choice = await prompts.select<"skip" | "force" | "view">(
      `${skill.name} 存在本地修改，请选择处理方式`,
      [
        { value: "skip", label: "跳过，保留本地修改" },
        { value: "force", label: "强制覆盖" },
        { value: "view", label: "查看路径" }
      ]
    );
    if (isBack(choice) || choice === "skip") {
      prompts.note(formatUpdateResult(result, options), "更新结果");
      return;
    }
    if (choice === "view") {
      prompts.note(displayPath(skill.localPath, options), "本地路径");
      return;
    }
    result = await updateRepositorySkill(config, skill.id, { force: true });
  }

  prompts.note(formatUpdateResult(result, options), "更新结果");
}

async function deleteRepositorySkillFromDetail(config: Config, skillId: string) {
  const confirmed = await prompts.confirm("确认删除？已派发的 skill 会被阻止删除。", false);
  if (isBack(confirmed) || !confirmed) {
    return false;
  }

  try {
    await deleteRepositorySkill(config, skillId);
    prompts.note(skillId, "已删除");
    return true;
  } catch (err: any) {
    prompts.note(err?.message ?? String(err), "删除失败");
    return false;
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
  if (isBack(agentId)) return;

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
  if (isBack(scopeChoice) || scopeChoice === "back") {
    return;
  }

  const scope: SkillScope =
    scopeChoice === "global" ? { kind: "global" } : { kind: "project", projectPath: options.cwd };
  const items = await scanAgentScope(config, agentId, scope, { homeDir: options.homeDir });
  const manageable = items.filter((item) => ["managed", "outdated", "not-deployed", "broken"].includes(item.status));
  const unmanageable = items.filter((item) => ["local-only", "conflict"].includes(item.status));

  // 展示不可操作项的分组信息
  if (unmanageable.length > 0) {
    displayUnmanageableItems(unmanageable);
  }

  if (manageable.length === 0) {
    if (unmanageable.length === 0) {
      prompts.note("仓库中还没有可管理的 skills。", "无可管理项");
    }
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
  if (isBack(selected)) return;

  const { toEnable, toDisable } = planAgentToggleChanges(manageable, selected);

  prompts.note(
    [
      `将启用 ${toEnable.length} 个 skill:`,
      ...toEnable.map((item) => `* ${item.name} -> ${item.targetPath}`),
      "",
      `将关闭 ${toDisable.length} 个 skill:`,
      ...toDisable.map((item) => `* ${item.name} 删除 ${item.targetPath}`),
      "",
      "不会自动处理 local-only、conflict 项。"
    ].join("\n"),
    "变更预览"
  );

  const shouldApply = await prompts.confirm("是否继续应用这些变更？", true);
  if (isBack(shouldApply)) return;
  if (!shouldApply) return;

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

  if (isBack(action) || action === "back") {
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
    if (isBack(defaultDeployMode)) return config;
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
    if (isBack(agentId)) return config;
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
  if (isBack(id)) return config;
  const displayName = await prompts.text("请输入显示名称", "My Agent");
  if (isBack(displayName)) return config;
  const globalPath = await prompts.text("请输入全局 skills 路径", "~/.my-agent/skills");
  if (isBack(globalPath)) return config;
  const projectPath = await prompts.text("请输入项目 skills 相对路径", ".my-agent/skills");
  if (isBack(projectPath)) return config;
  const next = upsertAgent(config, {
    id: id as string,
    displayName: displayName as string,
    globalPath: globalPath as string,
    projectPath: projectPath as string,
    defaultDeployMode: "inherit",
    enabled: true
  });
  await writeConfig(next);
  prompts.note(`${displayName} (${id})`, "已添加自定义 Agent");
  return next;
}

function displayUnmanageableItems(items: ScanItem[]) {
  const groups: Record<string, ScanItem[]> = {};
  for (const item of items) {
    const key = item.status;
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  }

  const statusLabels: Record<string, string> = {
    "local-only": "仅本地（不在仓库中）",
    conflict: "冲突（目标存在但未由 skillsctl 管理）"
  };

  const lines: string[] = [];
  for (const [status, group] of Object.entries(groups)) {
    lines.push(`[${statusLabels[status] ?? status}] (${group.length})`);
    for (const item of group) {
      const detail = item.message ? ` — ${item.message}` : "";
      lines.push(`  • ${item.name}${detail}`);
    }
    lines.push("");
  }

  prompts.note(lines.join("\n").trimEnd(), "以下技能不可操作");
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

function formatRepositorySkillDetail(
  view: RepositorySkillView,
  options: { homeDir: string; cwd: string }
) {
  const deployments = view.deployments.length
    ? view.deployments
        .map((item) => {
          const target = displayPath(item.deployment.targetPath, options);
          return `* ${item.deployment.agentId} ${item.deployment.scope}: ${target}  ${item.status} ${item.deployment.mode}`;
        })
        .join("\n")
    : "not deployed";

  return [
    "描述:",
    view.skill.description || "无描述",
    "",
    "来源:",
    view.skill.source?.value ?? "unknown",
    "",
    "本地路径:",
    displayPath(view.skill.localPath, options),
    "",
    "当前派发:",
    deployments
  ].join("\n");
}

function formatUpdateResult(
  result: RepositorySkillUpdateResult,
  options: { homeDir: string; cwd: string }
) {
  switch (result.status) {
    case "updated":
      return `${result.skillId}: updated`;
    case "already-latest":
      return `${result.skillId}: already latest`;
    case "skipped-local-changes":
      return `${result.skillId}: skipped, local changes detected`;
    case "unsupported-source":
      return `${result.skillId}: unsupported source`;
    case "missing-upstream-skill":
      return `${result.skillId}: failed, upstream skill missing`;
    case "failed":
      return `${result.skillId}: failed, ${result.message ?? "unknown error"}\n${displayPath(result.localPath, options)}`;
  }
}

function formatCheckStatus(result: RepositorySkillCheckResult) {
  switch (result.status) {
    case "update-available":
      return "有可用更新";
    case "already-latest":
      return "已是最新";
    case "local-changes":
      return "存在本地修改";
    case "unsupported-source":
      return "缺少可更新来源";
    case "missing-upstream-skill":
      return "上游技能已不存在";
    case "failed":
      return result.message ? `检查失败 - ${result.message}` : "检查失败";
  }
}
