# skillctl MVP PRD

### TL;DR

skillctl 是一个本地 Agent Skills 管理工具，通过 CLI + TUI 的方式，把散落在 Claude Code、Codex、Cursor、OpenCode 等不同工具目录下的 skills 统一管理起来。它提供一个不会被 Agent 自动读取的本地技能仓库，并支持将技能通过 symlink、copy 或 Windows 友好链接方式派发到指定 Agent 的全局或项目目录中；关闭时删除派发链接，从而减少上下文污染和技能回收成本。

---

## 目标

### 业务目标

* 在 2-3 周内完成一个可自用的 MVP，覆盖本地仓库、Agent 扫描、技能启停、导入和更新能力。
* 以 vercel-labs/skills 的能力为基础，减少重复造轮子，快速验证「本地仓库 + 派发控制台」这个差异化方向。
* 为后续开源打基础，形成清晰的命令设计、配置格式和扩展 Agent 机制。
* 支持主流 Agent 的默认路径，同时允许用户通过设置扩展自定义 Agent。
* 在 macOS 和 Windows 上都能稳定工作，尤其处理好 Windows 下 symlink 权限问题。

### 用户目标

* 用户可以把所有 skills 放在一个独立本地仓库中，不会被 Claude、Codex、Cursor 等 Agent 自动读取。
* 用户可以一眼看到某个 skill 当前被派发到了哪些 Agent、哪些项目或全局目录。
* 用户可以在 App / Agent 视角下看到仓库 skills 和应用本地独有 skills，并通过开关快速启用或关闭。
* 用户可以通过关闭开关删除 skill 派发链接，不需要手动去各个隐藏目录清理。
* 用户可以从远程仓库导入和更新 skills，尽量复用 `npx skills` 的下载、发现、更新逻辑。

### 非目标

* MVP 不实现 profile/session 技能组能力，只保留数据结构和命令命名上的扩展空间。
* MVP 不做 GUI 桌面应用，只做 CLI + TUI。
* MVP 不尝试替代 skills.sh 的公共 registry 或搜索目录，优先复用/参考其能力。
* MVP 不覆盖所有 67+ Agent 的深度行为差异，只内置常见路径映射，并支持用户自定义扩展。

---

## 用户故事

### 重度多 Agent 用户

* 作为一个多 Agent 用户，我希望把所有 skills 都保存在一个本地仓库里，这样即使从某个 Agent 里移除 skill，也不会丢失它。
* 作为一个多 Agent 用户，我希望可以为 Claude Code、Codex、Cursor 等工具快速打开或关闭某个 skill，这样每个任务的上下文都能保持干净。
* 作为一个多 Agent 用户，我希望看到某个 skill 当前被哪些 Agent 使用，这样我可以快速理解和清理自己的工作环境。
* 作为一个跨设备用户，我希望 skillctl 同时支持 Windows 和 macOS，这样我可以在不同机器上使用一致的工作流。

### AI Coding 工作流构建者

* 作为一个 AI Coding 工作流构建者，我希望可以从 GitHub 或本地路径导入 skills，这样我可以快速测试新的 Agent 工作流。
* 作为一个 AI Coding 工作流构建者，我希望可以从原始来源更新已导入的 skills，这样本地仓库可以保持最新。
* 作为一个 AI Coding 工作流构建者，我希望可以检查某个应用自己拥有的本地 skills，这样我可以把有价值的技能迁移回统一仓库。

### 开源用户 / 未来贡献者

* 作为一个开源用户，我希望可以在配置里添加自定义 Agent 路径映射，这样 skillctl 可以适配我常用的 AI 工具。
* 作为一个贡献者，我希望项目有简单清晰的核心抽象，这样新增 Agent 支持会更容易。

---

## 功能需求

### 本地 Skill 仓库（优先级：P0）

* 仓库初始化：skillctl 创建一个本地技能仓库目录，默认使用 \~/.skillsctl/repository，且配置默认存放于 \~/.skillsctl（例如配置文件为 \~/.skillsctl/config.json）。
* 仓库列表：用户可以列出本地仓库中的所有 skills，并看到名称、描述、来源、版本/hash、派发状态等元数据。
* 仓库导入：用户可以从本地路径、GitHub shorthand、Git URL，或其他 vercel-labs/skills 支持的 source format 导入 skills。
* 仓库删除：用户可以在确认后从本地仓库删除某个 skill；如果该 skill 当前已派发，需要给出安全提醒。

### Skill 派发和开关（优先级：P0）

* 启用 skill：用户可以把仓库中的某个 skill 启用到指定 Agent 和指定作用域，例如全局或当前项目。
* 关闭 skill：用户可以通过删除目标 Agent 目录中的 symlink、junction 或已复制的受管目录来关闭 skill。
* 派发方式：默认使用 symlink；Windows 使用更合理的可用策略，例如在 symlink 不可用时使用 junction 或 copy fallback。
* 派发记录：skillctl 记录每一次受管派发，避免误删用户自己创建的本地 skills。
* 安全删除：skillctl 只会自动删除自己创建或能安全验证的目标；其他情况必须明确询问用户。

### Agent 发现和配置（优先级：P0）

* 内置 Agent 映射：skillctl 内置基于 `npx skills` 默认支持 Agents 的路径映射。
* 自定义 Agent 配置：用户可以在设置中新增或覆盖 Agent 定义，包括全局路径、项目路径、显示名称和派发方式。
* 自动扫描：skillctl 可以扫描已知 Agent 的全局路径和项目 skill 路径，检测已有 skills。
* 手动配置路径：当自动扫描不完整或不准确时，用户可以手动配置具体 Agent 路径。

### CLI 交互（优先级：P0）

* `skillctl init`：初始化配置和本地仓库。
* `skillctl repo list`：列出本地仓库中的 skills。
* `skillctl import <source>`：从远程或本地来源导入 skills。
* `skillctl update [skill]`：从来源更新一个或多个已导入 skills。
* `skillctl enable <skill> --agent <agent> --global|--project <path>`：派发一个 skill。
* `skillctl disable <skill> --agent <agent> --global|--project <path>`：移除一个受管派发。
* `skillctl app list`：列出已配置或已检测到的 Agents。
* `skillctl app <agent> list`：展示某个 Agent 目标路径中可见的 skills。
* `skillctl doctor`：检查 broken links、缺失路径、权限问题、重复名称和 Windows 链接能力。
* `skillctl config`：查看或编辑关键设置。

### TUI 交互界面（优先级：P1）

* 启动 TUI：运行 `skillctl` 或 `skillctl manage` 打开交互式界面。
* 先检查是否有初始化过，如果没有初始化过要先进入初始化流程。
* 仓库视图：展示仓库 skills，以及每个 skill 被派发到了哪里。
* Agent 视图：在一个可开关列表中展示所有仓库 skills 和 Agent 本地独有 skills。
* 设置视图：允许配置仓库路径、默认派发方式、Agent 路径和自定义 Agent 映射。
* Doctor 视图：展示环境问题和建议修复动作。

### 远程更新支持（优先级：P1）

* 来源追踪：导入的 skills 存储 source URL/path、选择的 skill 名称、branch/ref/commit（如可用）以及最后更新时间。
* 更新命令：skillctl 参考 `npx skills update` 的行为更新本地仓库副本。
* copy 派发刷新：如果某个 skill 通过 copy 模式派发，skillctl 可以检测已派发副本是否过期，并提供重新同步。
* symlink 派发刷新：如果通过 symlink 或 junction 派发，只要本地仓库副本更新，目标 Agent 目录会自动反映最新内容。

### App 本地 Skill 处理（优先级：P1）

* local-only 检测：skillctl 识别 Agent 目标路径中存在、但不由 skillctl 管理的 skills。
* local-only 展示：TUI 将这些 skills 标记为 `local only`，而不是当作普通仓库受管 skills。
* 导入本地 skill：用户可以把某个 app-local skill 导入到统一仓库。
* 冲突检测：当仓库 skill 和 Agent 本地 skill 共享相同目录名或 frontmatter name 时，skillctl 需要给出警告。

### 未来扩展：Profiles（优先级：P2）

* 数据模型预留：配置结构后续可以支持 profiles，每个 profile 包含一组按 Agent 和作用域组织的 skills。
* MVP 不做 UI：MVP 不实现 profile 创建、应用和清理命令。

---

## 用户体验

### 入口和首次使用体验

* 用户从命令行安装或运行 skillctl。
* 首次运行时，skillctl 检测到没有配置，并引导用户初始化。
* 初始化流程询问：
  * 本地 skill 仓库应该放在哪里？
  * 默认派发方式是什么？
  * 要启用哪些已知 Agents？
  * 是否自动扫描全局路径和当前项目？
* 初始化完成后，用户进入 TUI 首页，可以看到几个快捷动作：
  * 导入 skill
  * 管理仓库
  * 管理 Agent skills
  * 运行 doctor
  * 打开设置

### 核心体验

步骤 1：导入一个 skill

* 用户运行 `skillctl import vercel-labs/agent-skills --skill frontend-design`，或在 TUI 中选择导入。
* skillctl 解析 source，发现可用的 `SKILL.md`，如果存在多个 skills，就让用户选择一个或多个。
* skillctl 把选中的 skill 复制进本地仓库，并记录来源元数据。
* 成功后展示 skill 名称、本地路径和下一步建议，例如启用到某个 Agent。

步骤 2：查看仓库状态

* 用户打开仓库视图。
* 每个 skill item 展示名称、短描述、来源、更新状态和派发标签。
* 标签示例：`claude-code global`、`codex project`、`not deployed`、`copy outdated`。
* 用户可以按已派发/未派发、Agent 或搜索关键词过滤。

步骤 3：为某个 Agent 启用 skill

* 用户选择一个 skill 并点击启用。
* skillctl 询问 Agent 和作用域：全局或项目。
* 如果选择项目作用域，用户可以使用当前目录或输入项目路径。
* skillctl 在缺失时创建所需目标文件夹。
* skillctl 根据有效派发模式创建 symlink、junction 或 copy。
* 成功状态清楚说明 skill 被派发到了哪里。

步骤 4：从 Agent 视角管理 skills

* 用户打开 `Claude Code Global` 或其他 Agent 目标。
* TUI 同时展示仓库 skills 和 local-only skills。
* 仓库 skills 有开关：
  * 开：存在受管派发。
  * 关：skill 在仓库中，但没有派发到当前目标。
* local-only skills 会被标记，并提供导入到仓库或保留原样等操作。

步骤 5：关闭 skill

* 用户在 Agent 视图里关掉某个 skill，或运行 `skillctl disable frontend-design --agent claude-code --global`。
* skillctl 检查派发记录和目标路径。
* 如果安全，删除对应的 symlink、junction 或 copy。
* 如果不安全，操作前向用户确认。
* 成功后确认该 skill 已从目标 Agent 移除，但 skill 本体仍保留在本地仓库中。

步骤 6：更新 skills

* 用户运行 `skillctl update`，或在 TUI 中选择更新。
* skillctl 检查来源元数据并拉取最新版本。
* 对 symlink/junction 派发，无需额外动作。
* 对 copy 派发，skillctl 标记已派发副本可能过期，并提供重新同步。

### 高级功能和边界情况

* Broken symlink 或 junction：
  * Doctor 检测到后，提供删除或重新链接选项。
* 目标路径已经存在：
  * 如果是受管目标且安全，则更新它。
  * 如果是非受管目标，则警告并提供备份、导入、跳过或明确覆盖。
* Windows symlink 权限不可用：
  * 优先对目录使用 junction。
  * 如果 junction 不合适，则 fallback 到 copy。
  * 在 TUI 中清楚解释不同方式的取舍。
* skill 名称重复：
  * 同时展示目录名和 frontmatter name。
  * 提醒用户不同 Agent 可能使用不同规则解析命令名。
* 远程来源不可用：
  * 保留当前本地副本不变。
  * 展示最后一次成功更新时间和错误详情。

### UI/UX 亮点

* CLI 语言友好，成功和失败信息清晰，不做静默破坏性操作。
* TUI 优先保持简单：仓库、Agents、设置、Doctor 四个核心视图。
* 使用一致的状态标签：managed、local only、broken、outdated、conflict、not deployed。
* 在创建或删除 skill 目录前，始终展示准确的文件系统路径。
* 不要一开始用 67+ Agents 淹没用户；优先展示已检测或已启用的 Agents，其余放在设置里。
* Windows 用户在 symlink 创建受阻时，需要看到可执行的修复建议。

---

## 用户叙事

武经常在 Claude Code、Codex 和 Cursor 之间切换。做前端任务时，他会临时启用 frontend-design、visual-regression、ui-review 这些 skills；做产品文档时，又想切到 product-manager 和 prd-writer。但是这些 skills 分别散落在 `.claude/skills`、`.agents/skills`、全局目录和项目目录里。任务结束后，他经常忘记清理，下一次开一个完全无关的任务时，Agent 仍然能看到那些 skills，既污染上下文，也可能误触发。

skillctl 把所有 skills 先放进一个独立的本地仓库。这个仓库不会被任何 Agent 自动读取，只有当武明确打开开关时，skillctl 才会把某个 skill 通过 symlink、junction 或 copy 派发到指定 Agent 的目标目录。武可以从仓库视角看到每个 skill 被哪些 Agent 使用，也可以从 Claude Code 或 Codex 视角看到当前可用和本地独有的 skills。

当任务结束时，武只需要在 TUI 里关掉开关，skillctl 就会删除对应派发链接，但 skill 本体仍然安全地留在仓库里。这样，他既能快速复用技能，又能保持每个任务环境干净、可控。

---

## 成功指标

### 用户指标

* 首次初始化完成率：80% 以上用户可以不看文档完成 `skillctl init`。
* 首个 skill 启用时间：从安装到成功派发第一个 skill 控制在 3 分钟以内。
* 清理信心：用户能够通过 `skillctl doctor` 或 TUI 明确看到没有 broken links 或误删风险。
* 重复使用：自用阶段每周至少使用 3 次以上，覆盖真实 Claude/Codex/Cursor 工作流。

### 业务指标

* 开源前，自用 MVP 能稳定管理至少 3 个主流 Agent 和 20+ 本地 skills。
* 开源后首月获得早期用户反馈，目标是 20+ GitHub stars 或 5+ issues/feature requests。
* 至少 3 个用户贡献自定义 Agent mapping 或路径修正。

### 技术指标

* enable/disable 操作成功率达到 99%，不误删 unmanaged local skills。
* 仓库扫描在 100 个 skills 内完成时间小于 1 秒，普通磁盘环境下可接受。
* Windows、macOS 至少各通过一组手动 E2E 测试。
* Doctor 能检测主要问题：broken links、missing targets、permission errors、duplicate names、copy outdated。

### 追踪计划

* 本地优先，不默认上传 telemetry。
* 可选匿名 telemetry 后续再做，MVP 只记录本地 debug log。
* 本地事件可用于调试：
  * `init_started` / `init_completed`
  * `skill_imported`
  * `skill_enabled`
  * `skill_disabled`
  * `skill_updated`
  * `doctor_run`
  * `link_strategy_failed`
  * `conflict_detected`

---

## 技术考虑

### 技术需求

* CLI 命令层：命令解析、参数校验、帮助信息、非交互模式支持。
* TUI 交互层（MVP）：使用 @clack/prompts 实现交互式菜单、列表、多选、确认弹窗和状态标签的轻量交互体验。
* Skill 仓库管理器：本地仓库结构、导入、删除、更新、metadata 维护。
* Source resolver：参考 vercel-labs/skills 实现 GitHub shorthand、Git URL、本地路径等 source formats，但以复制/重实现为主。
* Skill discovery parser：扫描 SKILL.md，解析 YAML frontmatter，读取 name、description、metadata。
* Agent registry：内置 Agent path mapping（参考 npx skills 与官方文档），并支持用户自定义 Agent。
* Deployment manager：symlink、junction、copy、unlink、safe deletion、hash/fingerprint。
* Scanner / doctor：扫描目标目录，识别 managed、local-only、broken、conflict、outdated。

### 集成点

* 工程实现时需参考 D:\\Works\\Github\\skills 源码，但实现策略为：复制或重实现关键逻辑（download、discovery、update、Agent path mapping），而不是直接将该项目作为库依赖。当前 PRD 不假设可以直接把该项目作为库依赖，需要在技术调研阶段确认代码模块化程度和 license/exports 情况。
* Agent Skills open standard：SKILL.md + YAML frontmatter。
* Claude Code：.claude/skills/、\~/.claude/skills/。
* Codex：默认 global skill path 按官方 Codex 文档为准，用户可在设置中覆盖。
* Cursor / .agents compatible tools：.agents/skills/、\~/.cursor/skills/ 等。

### 数据存储和隐私

* 本地配置默认使用 \~/.skillsctl/config.json。
* 本地仓库存储在配置指定路径，默认建议 \~/.skillsctl/repository。
* 派发状态存储在 \~/.skillsctl/deployments.json。
* 不默认上传任何用户路径、skill 内容或 usage 数据。如果未来加入 telemetry，必须默认关闭或首次明确询问。

### 可扩展性和性能

* MVP 目标是个人本地使用，技能数量假设为 10-200 个。
* 扫描时避免递归整个 home 目录，只扫描已知 Agent path 和用户配置路径。
* 对 copy 模式使用 hash/fingerprint 判断过期，避免每次完整深度 diff。
* TUI 列表需要支持搜索和过滤，避免 100+ skills 时难以操作。

### 潜在挑战

* Windows symlink 权限、junction 语义和 copy fallback 需要单独测试。
* 不同 Agent 对 skill directory name 与 frontmatter name 的解释不同，可能导致命令名不一致。
* Codex global path 在官方文档和 `npx skills` README 中可能存在差异，必须实测并允许用户覆盖。
* 复用 `vercel-labs/skills` 代码时可能遇到内部 API 不稳定，需要设计 adapter 层。
* 删除操作必须非常保守，避免误删用户已有本地 skills。
* 远程更新可能引发本地修改冲突，需要先以安全简单策略处理：检测变更并提示用户，而不是自动覆盖。

---

## 里程碑和推进顺序

### 项目估算

中等规模：2-4 周完成一个强自用 MVP。

### 团队规模和构成

小团队：1-2 人。

* 1 名全栈/CLI 工程师，同时负责产品决策。
* 可选 1 名设计/产品协作者，用于 TUI 流程 review 和开源 README 打磨。

### 建议阶段

阶段 1：核心调研和项目骨架（2-3 天）

* 关键交付物：
  * 阅读 `D:\Works\Github\skills` 源码，识别可复用模块或逻辑。
  * 确认 Claude Code、Codex、Cursor、OpenCode 的 Agent path mappings。
  * 创建 CLI 骨架，包含 `init`、`repo list`、`doctor` 占位命令。
  * 定义 config、repository metadata 和 deployment registry schema。
* 依赖：
  * 能访问本地 vercel-labs/skills 源码。
  * 如条件允许，准备 Windows 和 macOS 手动测试环境。

阶段 2：仓库和导入 MVP（3-5 天）

* 关键交付物：
  * 本地仓库初始化。
  * 从本地路径和 GitHub/Git source 导入。
  * Skill discovery 和 frontmatter 解析。
  * 仓库列表和删除命令。
  * 基础 source metadata 追踪。
* 依赖：
  * 已确认 `vercel-labs/skills` 的 source resolver 参考方案。

阶段 3：派发开关 MVP（4-6 天）

* 关键交付物：
  * 内置 Agent registry 和用户配置覆盖。
  * 支持 global 和 project scope 的 enable/disable 命令。
  * macOS/Linux 下的 symlink。
  * Windows junction/copy fallback 策略。
  * Deployment registry 和安全删除逻辑。
  * 基础扫描能力，区分 managed 和 local-only skills。
* 依赖：
  * 完成不同操作系统文件系统行为测试。

阶段 4：TUI 和 Doctor（4-6 天）

* 关键交付物：
  * `skillctl manage` TUI 首页。
  * 带派发标签的仓库视图。
  * 带开关和 local-only 标签的 Agent 视图。
  * 设置视图，支持仓库路径、默认模式、Agent 路径配置。
  * Doctor 检查 broken links、权限问题、重复名称、过期 copy。
* 依赖：
  * 前面阶段的核心命令已稳定。

阶段 5：更新和打磨（3-5 天）

* 关键交付物：
  * 基于 source metadata 的 `skillctl update`。
  * copy 派发过期检测和重新同步。
  * 更好的错误信息和确认流程。
  * README、使用示例、自用 dogfooding checklist。
  * 为未来开源发布准备 issue list。
* 依赖：
  * 已完成导入和 source metadata 能力。

---

## 待确认问题

## 决策

* 默认配置目录使用 \~/.skillsctl。
* 项目级 deployment 不会自动写入 .gitignore；MVP 不会提供自动修改 .gitignore 的功能，始终提示并由用户决定。
* Codex global skill path 默认遵循官方 Codex 文档说明，若实测结果不同，允许用户覆盖。
* 不直接将 vercel-labs/skills 作为库依赖；在工程实现阶段从 D:\\Works\\Github\\skills 中复制或重实现关键逻辑（包括 download、discovery、update 和 agent path mapping）。
* TUI MVP 技术选型：使用 @clack/prompts 作为轻量交互方案。
