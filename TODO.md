# skillsctl MVP TODO

本文档清点 skillsctl 控制台管理工具的 MVP 功能状态。

## 本地 Skill 仓库 (P0)

- [x] **仓库初始化**: 创建 `~/.skillsctl/repository` 与配置文件 `~/.skillsctl/config.json`。
- [x] **仓库列表**: TUI & 核心支持列出仓库所有 skills，并展示名称、描述和来源。
- [x] **本地路径导入**: 递归扫描 `SKILL.md`，解析 YAML frontmatter 并复制到仓库，记录来源元数据。
- [x] **远程 Git 导入**: 支持 GitHub shorthand (`owner/repo`)、GitHub/GitLab/Git URL 并克隆导入。
- [x] **安全删除**: 从仓库中删除某个 skill，当该 skill 存在已派发记录时，拦截直接删除，提示用户前往 Agent 管理中先关闭派发。
- [x] **扫描配置**: 仓库管理菜单新增“扫描配置”功能，检查 `deployments.json` 中目标已丢失的条目（区分链接损坏与目标完全删除），支持预览后一键清理失效记录和残留链接文件。

## Skill 派发和开关 (P0)

- [x] **启用 skill (enable)**:
  - 自动处理全局或项目级作用域的目标。
  - 根据系统和偏好支持 `symlink` / `junction` / `copy`。
  - 创建前安全校验：如果目标已存在且不由 skillsctl 管理，拒绝覆盖，防止误删。
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
- [x] **主菜单**: 组织“技能管理”、“Agent 派发管理”、“系统环境诊断”、“系统设置”和“退出”。
- [x] **仓库管理视图**: 支持关键词过滤、仓库列表状态摘要、skill 详情页、本地及远程来源导入、详情页内启用/更新/删除交互，以及“检查更新 -> 默认全选可更新项 -> 批量更新”流程。
- [x] **从 npx 命令导入**: 支持解析 `npx skills add ...`，将其转换为受管导入或派发。
- [x] **Agent 派发管理**:
  - “扫描 -> 批量复选框更改 -> 计算 diff -> 预览路径 -> 确认并批量应用”。
  - 将 `local-only`、`conflict` 项隔离出批量开关列表，并在复选框前以分组信息展示这些不可操作项。`broken` 项纳入可操作列表，支持重新部署修复。
- [x] **系统诊断 (Doctor) 视图**: 快速检测路径权限、损坏链接（broken link）、过期副本（outdated copy）。
- [x] **系统设置视图**: 支持修改配置仓库路径、默认派发模式、启用/禁用 Agent、查看当前底层 JSON 状态。
- [x] **Ctrl+C 返回上一级**: ESC 已禁用，Ctrl+C 在子菜单返回上一级，主菜单退出。

## 远程更新支持 (P1)

- [x] **来源追踪**: 导入的 skill 在 `.skillsctl.json` 中保存 type、value、url、ref、subpath、skill、importedAt 等元数据。
- [x] **Copy 派发刷新 (过低优先级，MVP 仅保留核心指标)**: Doctor 可识别由 copy 模式派发的目录在仓库内容被修改（Hash 发生改变）时，将其标记为 `outdated` 并提示在 Doctor 视图中重新同步。
- [x] **远程拉取更新**: 支持按来源重新读取本地路径或重新 clone Git/GitHub/GitLab 来源，比较来源 hash 后更新仓库 skill；本地修改默认跳过，TUI 可选择强制覆盖或查看路径；不提供自动备份。

## App 本地 Skill 处理 (P1)

- [x] **Local-only 检测**: 识别存在于 Agent 目录但不被 `deployments.json` 记录的本地技能。
- [x] **Local-only 导入 (Unfinished)**: 计划提供在 Agent 视图里把 unmanaged 本地技能复制到受管仓库的选项。当前界面入口已预留，由于复制和权限规则细节，实际写入待完成。
- [x] **冲突检测**: TUI 识别并警告当仓库 skill 与 Agent 本地 unmanaged 技能存在同名冲突。

## CLI 交互命令行 (P0)

- [x] **完整子命令支持**:
  - `skillsctl init`
  - `skillsctl repo list`
  - `skillsctl import <source>`
  - `skillsctl update [skill]`（命令入口已提供；远程拉取更新核心能力仍按“远程更新支持”章节标记为 Unfinished）
  - `skillsctl enable <skill> --agent <agent> --global|--project <path>`
  - `skillsctl disable <skill> --agent <agent> --global|--project <path>`
  - `skillsctl app list`
  - `skillsctl app <agent> list`
  - `skillsctl doctor`
  - `skillsctl config`
  - *注：CLI 层已新增轻量参数解析和路由，复用核心层接口；无参数运行仍进入 TUI。*

## 未来扩展 (P2)

- [ ] **Profiles 技能组支持 (Unfinished)**: 在数据结构和元数据层面预留 Profiles 的模型扩展空间，MVP 阶段暂不做 UI 交互。

## 日志系统 (Logging)

- [x] **Logger 模块**: `src/platform/logger.ts` 导出单例 logger（`initLogger`、`getLogger`、`resetLogger`）。
- [x] **配置集成**: `Config` 类型和 schema 新增 `logging` 字段（level、maxSizeMB、maxFiles），默认值 `error`/`5`/`3`。
- [x] **集成钩子**: bin.ts 入口初始化 logger，TUI/CLI 错误捕获接入 logger。
- [x] **日志文件管理**: 日志目录 `~/.skillsctl/logs/`，滚动轮转（5MB × 3 份）。
