# skillctl MVP TODO

本文档清点 skillctl 控制台管理工具的 MVP 功能状态。

## 本地 Skill 仓库 (P0)

- [x] **仓库初始化**: 创建 `~/.skillsctl/repository` 与配置文件 `~/.skillsctl/config.json`。
- [x] **仓库列表**: TUI & 核心支持列出仓库所有 skills，并展示名称、描述和来源。
- [x] **本地路径导入**: 递归扫描 `SKILL.md`，解析 YAML frontmatter 并复制到仓库，记录来源元数据。
- [x] **远程 Git 导入**: 支持 GitHub shorthand (`owner/repo`)、GitHub/GitLab/Git URL 并克隆导入。
- [x] **安全删除**: 从仓库中删除某个 skill，当该 skill 存在已派发记录时，拦截直接删除，提示用户前往 Agent 管理中先关闭派发。

## Skill 派发和开关 (P0)

- [x] **启用 skill (enable)**:
  - 自动处理全局或项目级作用域的目标。
  - 根据系统和偏好支持 `symlink` / `junction` / `copy`。
  - 创建前安全校验：如果目标已存在且不由 skillctl 管理，拒绝覆盖，防止误删。
- [x] **关闭 skill (disable)**:
  - 检查部署记录。
  - 安全删除已派发的目标（验证 symlink 指向或 copy 来源）。
  - 更新 deployments registry。
- [x] **Windows 派发兼容**: 默认将 symlink fallback 到 junction (对目录)，不具备权限时支持 copy 回退。

## Agent 发现和配置 (P0)

- [x] **内置 Agent 映射**: 预置 Universal、Claude Code、Codex、Cursor、Qoder、OpenCode、Warp、Goose、Windsurf、Zed、Qwen Code、Cline、Roo Code 的路径。
- [x] **作用域支持**: 支持全局全局目录，及在当前项目内根据 Agent 类型自动计算项目级 skills 路径。
- [x] **自动扫描能力**: 扫描目标 Agent 目录中可见的 skills，与仓库、部署记录进行状态合并。

## TUI 交互界面 (P1)

- [x] **首次初始化流程**: 拦截未配置用户，依次确认仓库路径、派发模式、启用 Agents，引导至主菜单。
- [x] **主菜单**: 组织“仓库技能管理”、“Agent 派发管理”、“系统环境诊断”、“系统设置”和“退出”。
- [x] **仓库管理视图**: 支持列出、多选/单选过滤、本地及远程来源导入、删除未派发项。
- [x] **从 npx 命令导入**: 支持解析 `npx skills add ...`，将其转换为受管导入或派发。
- [x] **Agent 派发管理**:
  - “扫描 -> 批量复选框更改 -> 计算 diff -> 预览路径 -> 确认并批量应用”。
  - 将 `local-only`（非受管本地技能）隔离出批量开关列表。
- [x] **系统诊断 (Doctor) 视图**: 快速检测路径权限、损坏链接（broken link）、过期副本（outdated copy）。
- [x] **系统设置视图**: 支持修改配置仓库路径、默认派发模式、启用/禁用 Agent、查看当前底层 JSON 状态。
- [x] **Ctrl+C 返回上一级**: ESC 已禁用，Ctrl+C 在子菜单返回上一级，主菜单退出。

## 远程更新支持 (P1)

- [x] **来源追踪**: 导入的 skill 在 `.skillsctl.json` 中保存 type、value、url、ref、subpath、skill、importedAt 等元数据。
- [x] **Copy 派发刷新 (过低优先级，MVP 仅保留核心指标)**: Doctor 可识别由 copy 模式派发的目录在仓库内容被修改（Hash 发生改变）时，将其标记为 `outdated` 并提示在 Doctor 视图中重新同步。
- [ ] **远程拉取更新 (Unfinished)**: 从原始 Git / GitHub 重新 fetch 最新的 skills 分支，由于 MVP 策略偏安全，更新时发现本地修改只做跳过、覆盖和查看，该拉取更新命令接口在核心层已留空/待补充。

## App 本地 Skill 处理 (P1)

- [x] **Local-only 检测**: 识别存在于 Agent 目录但不被 `deployments.json` 记录的本地技能。
- [x] **Local-only 导入 (Unfinished)**: 计划提供在 Agent 视图里把 unmanaged 本地技能复制到受管仓库的选项。当前界面入口已预留，由于复制和权限规则细节，实际写入待完成。
- [x] **冲突检测**: TUI 识别并警告当仓库 skill 与 Agent 本地 unmanaged 技能存在同名冲突。

## CLI 交互命令行 (P0)

- [x] **完整子命令支持**:
  - `skillctl init`
  - `skillctl repo list`
  - `skillctl import <source>`
  - `skillctl update [skill]`（命令入口已提供；远程拉取更新核心能力仍按“远程更新支持”章节标记为 Unfinished）
  - `skillctl enable <skill> --agent <agent> --global|--project <path>`
  - `skillctl disable <skill> --agent <agent> --global|--project <path>`
  - `skillctl app list`
  - `skillctl app <agent> list`
  - `skillctl doctor`
  - `skillctl config`
  - *注：CLI 层已新增轻量参数解析和路由，复用核心层接口；无参数运行仍进入 TUI。*

## 未来扩展 (P2)

- [ ] **Profiles 技能组支持 (Unfinished)**: 在数据结构和元数据层面预留 Profiles 的模型扩展空间，MVP 阶段暂不做 UI 交互。

## 日志系统 (Logging)

- [x] **Logger 模块**: `src/platform/logger.ts` 导出单例 logger（`initLogger`、`getLogger`、`resetLogger`）。
- [x] **配置集成**: `Config` 类型和 schema 新增 `logging` 字段（level、maxSizeMB、maxFiles），默认值 `error`/`5`/`3`。
- [x] **集成钩子**: bin.ts 入口初始化 logger，TUI/CLI 错误捕获接入 logger。
- [x] **日志文件管理**: 日志目录 `~/.skillsctl/logs/`，滚动轮转（5MB × 3 份）。
