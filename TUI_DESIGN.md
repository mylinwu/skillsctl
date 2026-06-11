# skillctl TUI 交互设计草案

skillctl 的 TUI 使用 `@clack/prompts` 做轻量交互，重点支持本地仓库管理、Agent 派发管理和系统诊断。Agent 派发管理采用“扫描当前状态 -> 复选框编辑期望状态 -> 根据前后差异生成变更 -> 确认执行”的模式，适合一次批量管理多个 skills。

---

## 1. 设计目标

skillctl 的 TUI 不是复杂的全屏终端应用，而是一组清晰的命令行交互流程。它要帮助用户完成三件事：

* 管理本地技能仓库：导入、查看、更新、删除 skills。
* 批量管理 Agent 派发状态：在同一个复选框列表里维护某个 Agent 当前应该启用哪些 skills。
* 检查和修复环境问题：路径缺失、链接损坏、权限不足、冲突和过期副本。

设计原则：

* 默认安全：删除、覆盖、替换、批量关闭都必须确认；批量变更需要二次确认。
* 路径透明：创建或删除文件前展示完整路径和派发方式。
* 批量优先：Agent 派发管理以复选框维护期望状态，而不是一次只能改一个 skill。
* 信息分层：主菜单只展示大类，深入后再展示具体操作。
* 保留当前项目体验：支持把 skills 派发到当前项目，并根据 Agent 类型自动选择对应 skills 目录。
* 兼容 `npx skills add` 心智：导入流程支持粘贴或解析 `npx skills add ...` 命令，并复用其 source、skill selection、agent、global、copy 等交互语义。

实现注记：skillctl 会参考并复制或重实现本地 `vercel-labs/skills` 的关键逻辑，源码位置为 `D:\Works\Github\skills`，包括 source 解析、skill discovery、更新逻辑和 Agent path mapping。MVP 不把该项目作为运行时库直接依赖。

---

## 2. 全局交互约定

### 2.1 启动方式

用户输入：

```bash
skillctl
```

如果没有初始化配置，进入首次初始化流程。若已有配置，直接进入主菜单。

### 2.2 通用按键和行为

* 方向键：上下移动选项。
* 空格：在多选复选框列表中切换项的勾选状态。
* Enter：确认当前选择，并生成基于初始勾选状态与最终勾选状态差异的变更预览。
* Ctrl+C：取消当前步骤。
* 搜索类列表支持输入关键字过滤。
* 取消危险操作时，返回上一级菜单，不直接退出程序。
* 每个二级页面底部都提供「返回上一级」。

### 2.3 状态标签

| 状态 | 含义 |
| --- | --- |
| `managed` | 由 skillctl 管理的派发 |
| `local only` | 只存在于 Agent 目录，不在 skillctl 仓库中 |
| `broken` | 链接损坏或目标不存在 |
| `conflict` | 目标路径已有非受管 skill 或名称冲突 |
| `outdated` | copy 模式派发的副本落后于仓库版本 |
| `unknown` | 无法判断来源或状态 |

### 2.4 默认目录和路径策略

* 配置目录固定为 `~/.skillsctl`。
* 配置文件为 `~/.skillsctl/config.json`。
* 本地仓库默认为 `~/.skillsctl/repository`。
* 派发记录默认为 `~/.skillsctl/deployments.json`。
* Codex global skill path 按官方 Codex 文档，默认使用 `~/.codex/skills`，并允许用户在设置中覆盖。

---

## 3. 首次初始化流程

### 3.1 检测无配置

```bash
欢迎使用 skillctl

未检测到配置文件。  
skillctl 会创建一个本地技能仓库，用来集中保存 skills。   
该仓库不会被 Claude、Codex、Cursor 等 Agent 自动读取。
配置目录: ~/.skillsctl
是否现在初始化 skillctl?

● 是，开始初始化` 
○ 否，退出` 
```

### 3.2 确认仓库位置

```bash
请选择本地技能仓库位置:

~/.skillsctl/repository
按 Enter 使用默认值，或输入自定义路径:  

校验规则：

* 如果路径不存在，提示将自动创建。
* 如果路径存在但不是目录，提示错误并要求重新输入。
* 如果路径不可写，提示权限问题并要求重新输入。
```

### 3.3 选择默认派发方式

```bash
请选择默认派发方式:

● symlink  推荐，macOS/Linux 默认方式，更新最方便  
○ copy     复制文件，兼容性最好，但需要手动同步更新  
○ auto     根据系统自动选择，Windows 会优先尝试 symlink/junction/copy  

默认选中：

* macOS/Linux：`symlink`
* Windows：`auto`
```

### 3.4 选择默认启用的 Agents

```bash
请选择要启用的 Agents:

◉ Universal      global: ~/.agents/skills             project: .agents/skills
◉ Claude Code    global: ~/.claude/skills             project: .claude/skills  
◉ Codex          global: ~/.agents/skills             project: .agents/skills  
◯ Cursor         global: ~/.cursor/skills             project: .agents/skills  
◯ Qoder          global: ~/.qoder/skills              project: .qoder/skills  
◯ OpenCode       global: ~/.config/opencode/skills    project: .agents/skills  

提示: 之后可以在设置中添加更多 Agents。  
```

### 3.5 是否扫描现有 skills

```bash
是否扫描已存在的 Agent skills?

● 是，扫描全局路径和当前项目  
○ 否，稍后手动扫描  
```

扫描中：

```bash
正在扫描 Agent skills...
```

扫描完成：

```bash
扫描完成

发现:

* Claude Code global: 6 个 skills
* Codex global: 2 个 skills
* Cursor global: 未发现目录
* 当前项目 .claude/skills: 3 个 skills
* 当前项目 .agents/skills: 1 个 skill

其中 12 个为 local-only skills，可稍后导入到仓库。  

### 3.6 初始化完成

```bash
初始化完成

配置文件: ~/.skillsctl/config.json  
本地仓库: ~/.skillsctl/repository  
派发记录: ~/.skillsctl/deployments.json

接下来你想做什么?
● 进入主菜单  
○ 导入第一个 skill  
○ 退出  
```

---

## 4. 主菜单

```bash
skillctl
本地仓库: \~/.skillsctl/repository
当前项目: D:\\Works\\Github\\my-project

请选择操作类别:

● 📦 仓库技能管理  
○ 🤖 Agent 派发管理  
○ 🩺 系统环境诊断  
○ ⚙️ 系统设置  
○ ❌ 退出  
```

说明：

* 仓库技能管理：管理 source of truth，也就是 `~/.skillsctl/repository`。
* Agent 派发管理：按 Agent 和作用域批量维护技能期望状态。
* 系统环境诊断：检查链接、权限、冲突和路径问题。
* 系统设置：修改仓库路径、默认派发方式、Agent 映射。

---

## 5. 仓库技能管理流程

### 5.1 进入仓库技能管理

```bash
仓库技能管理
本地仓库: \~/.skillsctl/repository

当前仓库中共有 18 个 skills  
已派发: 9 个  
未派发: 9 个  
有更新可用: 2 个

请选择操作:

● 查看仓库 skills  
○ 导入新 skill  
○ 从 npx skills add 命令导入  
○ 更新 skills  
○ 删除仓库 skill  
○ 返回主菜单  
```  

### 5.2 查看仓库 skills

如果 skills 较多，先输入关键词过滤：

```bash
输入关键词过滤 skills，直接 Enter 查看全部:
```

列表：

```bash
请选择一个 skill 查看详情:

● frontend-design       deployed: claude-code(global), codex(project)  
○ pr-review             not deployed  
○ product-manager       deployed: claude-code(project)  
○ api-debugger          outdated copy: cursor(global)  
○ release-notes         not deployed  
○ 返回上一级  
```  

### 5.3 Skill 详情页

```bash
frontend-design

描述:  
用于前端页面设计、UI 细节优化和视觉一致性检查。

来源:  
vercel-labs/agent-skills @ frontend-design

本地路径:  
~/.skillsctl/repository/frontend-design

当前派发:
* Claude Code global: ~/.claude/skills/frontend-design  managed symlink
* Codex project: D:\Works\Github\my-project.agents\skills\frontend-design  managed symlink

请选择操作:

● 启用到 Agent  
○ 更新此 skill  
○ 删除此 skill  
○ 返回仓库列表  
```  

### 5.4 导入新 skill

```bash
请输入 skill 来源:

支持:
* GitHub shorthand: vercel-labs/agent-skills
* GitHub URL: https://github.com/vercel-labs/agent-skills
* Git URL: https://github.com/vercel-labs/agent-skills.git
* 本地路径: ./my-skill 或 D:\Works\skills\my-skill  
```

用户输入：

```bash
vercel-labs/agent-skills
```

解析中：

```bash
正在解析来源...
正在发现 SKILL.md...
```

如果发现多个 skills：

```bash
发现 12 个 skills，请选择要导入的 skills:

◉ frontend-design       Frontend design guidance and UI polish  
◯ pr-review             Pull request review workflow  
◯ release-notes         Generate release notes from git history  
◯ product-manager       Product planning and PRD writing

空格选择，Enter 确认。  
```

导入前确认：

```bash
即将导入 1 个 skill 到本地仓库:

* frontend-design -> ~/.skillsctl/repository/frontend-design

是否继续?

● 导入  
○ 取消  
```

导入成功：

```bash
导入完成

已导入:
* frontend-design

接下来:

● 启用到 Agent  
○ 进入 Agent 派发管理  
○ 继续导入  
○ 返回仓库管理  
```  

### 5.5 从 npx skills add 命令导入

该流程用于兼容用户从 skills.sh 或 README 中复制的命令。skillctl 不直接执行 `npx skills add`，而是解析命令语义，并转换为「导入到本地仓库」和可选的「派发计划」。

```bash
请粘贴 npx skills add 命令:

示例:  
npx skills add vercel-labs/agent-skills --skill frontend-design -a claude-code -g  
```

用户输入：

```bash
npx skills add vercel-labs/agent-skills --skill frontend-design -a claude-code -g
```

解析结果：

```bash
已解析命令:

source: vercel-labs/agent-skills  
skills: frontend-design  
agents: claude-code  
scope: global  
mode: symlink

skillctl 会先导入到本地仓库:  
~/.skillsctl/repository/frontend-design

然后可以选择是否按命令参数继续派发。  
```

询问：

```bash
请选择执行方式:

● 仅导入到本地仓库  
○ 导入后按命令参数派发  
○ 返回编辑命令  
○ 取消  
```

如果命令包含 `--list`：

```bash
检测到 --list 参数。
将只列出该来源中的 skills，不会导入或派发。

是否继续?

● 列出 skills  
○ 取消  
```

如果命令包含 `--all`：

```bash
检测到 --all 参数。
该操作可能导入大量 skills。

发现 48 个 skills。  
建议先手动选择，而不是全部导入。

请选择:

● 手动选择要导入的 skills  
○ 导入全部  
○ 取消  
```  

支持的 `npx skills add` 参数映射：

| npx skills 参数 | skillctl TUI 行为 |
| --- | --- |
| `<source>` | 作为导入来源解析 |
| `--skill` / `-s` | 预选指定 skills |
| `--agent` / `-a` | 作为导入后派发目标候选 |
| `--global` / `-g` | 作为导入后派发 scope |
| `--copy` | 作为派发方式覆盖 |
| `--list` / `-l` | 只发现和展示，不导入 |
| `--all` | 提示风险后允许全选 |
| `--yes` / `-y` | CLI 非交互使用；TUI 中仍展示确认 |

### 5.6 更新 skills

```bash
请选择更新范围:

● 更新所有有来源记录的 skills  
○ 选择要更新的 skills  
○ 仅检查更新，不修改文件  
○ 返回  
```

确认：

```bash
即将检查 15 个 skills 的远程来源。
本地修改不会被自动覆盖。

是否继续?

● 继续  
○ 取消  
```

结果：

```bash
更新完成

* frontend-design: updated
* pr-review: already latest
* product-manager: skipped, local changes detected
* release-notes: failed, remote unavailable

注意:  
1 个 skill 存在本地修改，未自动覆盖。  
```

本地修改处理：

```bash
product-manager 存在本地修改，请选择处理方式:

● 跳过，保留本地修改  
○ 强制覆盖  
○ 查看路径  
```

MVP 不实现自动备份后更新。  
MVP 不实现自动备份后更新。

### 5.7 删除仓库 skill

```bash
请选择要删除的 skill:

● pr-review             not deployed  
○ frontend-design       deployed: 2 targets  
○ product-manager       deployed: 1 target  
○ 返回  
```

未派发时：

```bash
即将从本地仓库删除 pr-review:
\~/.skillsctl/repository/pr-review

此操作不会影响任何 Agent。

是否删除?

○ 删除  
● 取消  
```

已派发时，MVP 建议阻止直接删除：

```bash
frontend-design 当前仍有 2 个受管派发:

* ~/.claude/skills/frontend-design
* D:\Works\Github\my-project.agents\skills\frontend-design

为避免制造 broken links，必须先关闭所有派发，才能删除仓库中的 skill。

请选择操作:

● 去 Agent 派发管理中关闭派发  
○ 返回  
```  

---

## 6. Agent 派发管理流程

### 6.1 进入 Agent 派发管理

```bash
Agent 派发管理

请选择要管理的 Agent:

● Claude Code      detected, 8 skills  
○ Codex            detected, 3 skills  
○ Cursor           not found  
○ OpenCode         not enabled  
○ Universal        detected, 4 skills  
○ 自定义 Agent...  
○ 返回主菜单  
```

说明：

* `detected`：路径存在或扫描到 skills。
* `not found`：配置存在，但路径不存在。
* `not enabled`：内置支持但未启用。

### 6.2 选择作用域

选择 Claude Code 后：

```bash
请选择管理范围:

● 全局: ~/.claude/skills  
○ 当前项目: D:\Works\Github\my-project\.claude\skills  
○ 其他项目路径...  
○ 返回 Agent 列表  
```

选择 Codex 后：

```bash
请选择管理范围:

● 全局: ~/.agents/skills  
○ 当前项目: D:\Works\Github\my-project\.agents\skills  
○ 其他项目路径...  
○ 返回 Agent 列表  
```  

这里要保留当前项目设计：用户选择「当前项目」后，skillctl 根据 Agent 类型自动计算目标 skills 目录。

| Agent | 当前项目 skills 目录 |
| --- | --- |
| Universal | `<project>/.agents/skills` |
| Claude Code | `<project>/.claude/skills` |
| Codex | `<project>/.agents/skills` |
| Cursor | `<project>/.agents/skills` |
| Qoder | `<project>/.qoder/skills` |
| OpenCode | `<project>/.agents/skills` |
| 自定义 Agent | 使用配置中的 project path |

提示文案：

```bash
提示: skillctl 不会修改项目 .gitignore。
如果你不希望项目级 skills 被提交，请自行确认 .gitignore 设置。
```

### 6.3 Agent skill 批量状态列表

进入某个 Agent + scope 后，skillctl 先扫描目标范围，然后根据扫描结果渲染复选框列表：

* 仓库中存在、且目标中已经存在的 skill：默认已勾选。
* 仓库中存在、但目标中不存在的 skill：默认未勾选。
* 用户直接编辑勾选状态。
* 按 Enter 后，skillctl 比较初始勾选状态和最终勾选状态，计算要启用或关闭的 skills。
* `local only`、`broken`、`conflict` 项不进入复选框列表，单独处理。

示例：Claude Code 全局。

```bash
Claude Code 全局 skills
路径: \~/.claude/skills

说明:  
列表基于对目标范围的扫描结果渲染为复选框。  
仓库中的 skills 会被列出:
* 目标中已存在的 skill 默认为已勾选
* 目标中不存在的 skill 默认为未勾选

请选择此 Agent 应启用的 skills:

◉ frontend-design       managed symlink  
◯ pr-review             in repository  
◉ product-manager       managed copy, outdated  
◯ api-debugger          in repository

不可直接勾选:
* [local only] old-commit-helper
* [local only] deploy-script
* [broken] legacy-review

操作:
* 空格切换勾选状态
* Enter 预览变更  
```  

如果用户取消勾选 `frontend-design`，并勾选 `pr-review`、`api-debugger`，预览如下：

```bash
即将应用以下变更
这些变更由复选框初始状态与当前勾选状态的差异计算得出。

将关闭 1 个 skill:
* frontend-design  
  删除: ~/.claude/skills/frontend-design

将启用 2 个 skills:
* pr-review  
  创建: ~/.claude/skills/pr-review -> ~/.skillsctl/repository/pr-review  
  方式: symlink
* api-debugger  
  创建: ~/.claude/skills/api-debugger -> ~/.skillsctl/repository/api-debugger  
  方式: symlink

不会处理:
* local-only skills
* broken links
* conflicts  
```

确认：

```bash
是否继续应用这些变更?

● 继续  
○ 返回修改选择  
○ 取消  
```

执行中：

```bash
正在应用变更...
- 关闭 frontend-design
- 启用 pr-review
- 启用 api-debugger
```

执行结果：

```bash
批量变更完成

成功:
* frontend-design: disabled
* pr-review: enabled
* api-debugger: enabled

失败: 0

提示: 如果 Agent 已经在运行，可能需要重启或刷新后才能看到变化。  
```  

### 6.4 批量管理后的下一步

```bash
接下来:

● 继续管理此 Agent  
○ 处理 local-only / broken / conflict 项  
○ 切换到其他作用域  
○ 返回 Agent 列表  
○ 返回主菜单  
```  

### 6.5 处理 local-only skill

```bash
请选择要处理的 local-only skill:

● old-commit-helper      ~/.claude/skills/old-commit-helper  
○ deploy-script          ~/.claude/skills/deploy-script  
○ 返回  
```

详情：

```bash
old-commit-helper 只存在于 Claude Code 全局目录，不在 skillctl 仓库中。

路径:  
~/.claude/skills/old-commit-helper

请选择操作:

● 导入到本地仓库，保留原文件  
○ 查看路径  
○ 暂不处理  
```

MVP 默认只实现「导入到本地仓库，保留原文件」。后续版本再支持「导入并转换为 skillctl 管理」。

确认：

```bash
即将复制到:
\~/.skillsctl/repository/old-commit-helper

原路径保持不变:  
~/.claude/skills/old-commit-helper

是否继续?

● 导入  
○ 取消  
```  

### 6.6 处理 broken skill

```bash
legacy-review 是一个损坏的链接。

链接位置:  
~/.claude/skills/legacy-review

指向目标:  
~/.skillsctl/repository/legacy-review

问题:  
目标不存在。

请选择操作:

● 删除损坏链接  
○ 查看路径  
○ 取消  
```

确认删除：

```bash
确认删除损坏链接?

~/.claude/skills/legacy-review

○ 删除  
● 取消  
```  

### 6.7 处理 conflict skill

```bash
检测到名称冲突: pr-review

仓库 skill:  
~/.skillsctl/repository/pr-review

Agent 本地 skill:  
~/.claude/skills/pr-review

该 Agent 本地 skill 不是由 skillctl 管理，不能自动覆盖。

请选择操作:

● 跳过，保持现状  
○ 导入现有 skill 到仓库  
○ 查看路径  
```

MVP 不实现自动备份替换。

---

## 7. 系统环境诊断流程

### 7.1 进入 Doctor

```bash
系统环境诊断

请选择诊断范围:

● 快速诊断 推荐  
○ 完整诊断  
○ 仅检查链接  
○ 仅检查 Agent 路径  
○ 仅检查 Windows 链接能力  
○ 返回主菜单  
```  

### 7.2 快速诊断结果

```bash
正在检查配置文件...
正在检查本地仓库...
正在检查 Agent 路径...
正在检查派发链接...
```

结果：

```bash
诊断完成

通过:
* 配置文件存在: ~/.skillsctl/config.json
* 本地仓库可读写: ~/.skillsctl/repository
* Claude Code global 路径正常
* Codex global 路径正常: ~/.agents/skills

发现问题:
* 1 个 broken symlink
* 1 个 copy 派发已过期
* 1 个 local-only skill 与仓库 skill 名称冲突

请选择操作:

● 查看并修复问题  
○ 导出诊断报告  
○ 返回主菜单  
```  

### 7.3 修复问题列表

```bash
请选择要处理的问题:

● broken: ~/.claude/skills/legacy-review  
○ outdated: ~/.cursor/skills/product-manager  
○ conflict: ~/.claude/skills/pr-review  
○ 全部跳过  
○ 返回  
```

### 7.4 过期 copy 修复

```bash
product-manager 的 copy 派发已过期。

仓库版本:  
~/.skillsctl/repository/product-manager

派发位置:  
~/.cursor/skills/product-manager

请选择操作:

● 重新同步 copy  
○ 跳过  
○ 查看路径  
```  

---

## 8. 系统设置流程

### 8.1 进入系统设置

```bash
系统设置

配置文件:  
~/.skillsctl/config.json

请选择设置项:

● 本地仓库位置  
○ 默认派发方式  
○ Agent 配置  
○ 自定义 Agent  
○ 查看当前配置  
○ 返回主菜单  
```  

### 8.2 本地仓库位置

```bash
当前本地仓库位置:
\~/.skillsctl/repository

请选择操作:

● 保持不变  
○ 修改路径  
○ 打开路径  
○ 返回  
```  

修改路径时提醒：

```bash
修改仓库路径不会自动移动已有 skills。
如果要迁移，请先手动移动目录，或后续使用迁移命令。
```

MVP 不实现自动迁移。

### 8.3 默认派发方式

```bash
当前默认派发方式:
symlink

请选择新的默认派发方式:

● symlink  推荐，更新方便  
○ copy     兼容性最好  
○ auto     根据系统自动选择  
○ 返回  
```  

### 8.4 Agent 配置

```bash
Agent 配置

● Claude Code    enabled   global: ~/.claude/skills  
○ Codex          enabled   global: ~/.agents/skills  
○ Cursor         enabled   global: ~/.cursor/skills  
○ OpenCode       disabled  global: ~/.config/opencode/skills  
○ Universal      enabled   global: ~/.agents/skills  
○ 返回  
```

选择 Codex 后：

```bash
Codex

状态: enabled  
全局路径: ~/.agents/skills  
项目路径: .agents/skills  
默认派发方式: inherit

说明:  
Codex global path 默认遵循官方文档。  
如果你的本地 Codex 使用其他路径，可以在这里覆盖。

请选择操作:

● 启用/禁用  
○ 修改全局路径  
○ 修改项目路径  
○ 修改派发方式  
○ 恢复默认配置  
○ 返回  
```  

### 8.5 自定义 Agent

```bash
自定义 Agent

请选择操作:

● 添加自定义 Agent  
○ 查看已有自定义 Agents  
○ 返回  
```

添加流程：

```bash
请输入 Agent ID:
例如: my-agent
```

```bash
请输入显示名称:
例如: My Agent
```

```bash
请输入全局 skills 路径:
例如: \~/.my-agent/skills
```

```bash
请输入项目 skills 相对路径:
例如: .my-agent/skills
```

确认：

```bash
即将添加自定义 Agent:

ID: my-agent  
名称: My Agent  
全局路径: ~/.my-agent/skills  
项目路径: .my-agent/skills

是否保存?

● 保存  
○ 取消  
```  

---

## 9. 退出流程

退出文案：

```bash
已退出 skillctl。
```

如果刚完成重要操作，可以给下一步提示：

```bash
已退出 skillctl。

提示: 如果 Agent 已经在运行，可能需要重启或刷新后才能看到 skills 变化。  
```  

---

## 10. 错误和危险操作文案

### 10.1 权限不足

```bash
无法写入目标目录:
\~/.claude/skills

可能原因:
* 当前用户没有写入权限
* 目录被其他程序占用
* Windows symlink 权限不足

请选择操作:

● 查看修复建议  
○ 改用 copy 模式  
○ 取消  
```

### 10.2 目标已存在

```bash
目标路径已存在:
\~/.claude/skills/frontend-design

该路径不是 skillctl 管理的派发。  
为了避免误删或覆盖，skillctl 不会自动替换它。

请选择操作:

● 跳过  
○ 导入现有 skill 到仓库  
○ 查看路径  
```

### 10.3 批量关闭确认

```bash
请再次确认批量关闭操作

将删除以下 Agent 目录中的受管目标:
* ~/.claude/skills/frontend-design
* ~/.claude/skills/product-manager

不会删除本地仓库中的 skills:
* ~/.skillsctl/repository/frontend-design
* ~/.skillsctl/repository/product-manager

○ 确认关闭  
● 取消  
```

默认选中取消。

---

## 11. MVP 推荐默认值

| 项目 | 默认值 |
| --- | --- |
| 配置目录 | `~/.skillsctl` |
| 配置文件 | `~/.skillsctl/config.json` |
| 本地仓库 | `~/.skillsctl/repository` |
| 派发记录 | `~/.skillsctl/deployments.json` |
| macOS/Linux 默认派发方式 | `symlink` |
| Windows 默认派发方式 | `auto` |
| Windows auto 优先级 | `symlink -> junction -> copy` |
| TUI 技术 | `@clack/prompts`，轻量 prompts，非全屏 TUI |
| Codex global path | `~/.agents/skills`，按官方文档 |
| 项目级派发是否写 `.gitignore` | 不自动写入 |
| local-only 导入默认行为 | copy 到仓库，原文件保留 |
| Agent 派发管理默认模式 | 基于初始扫描状态的批量勾选管理 |

---

## 12. 已确认决策和剩余问题

### 12.1 已确认决策

* 默认配置目录统一为 `~/.skillsctl`。
* MVP 不自动写入 `.gitignore`。
* Codex 全局 skills 路径遵循官方 Codex 文档，默认值为 `~/.agents/skills`，用户可在设置中覆盖。
* skillctl 复制或重实现 `D:\Works\Github\skills` 中的关键逻辑，不作为运行时库直接依赖。
* MVP TUI 使用 `@clack/prompts`，保持轻量交互式 prompts。
* 当前项目派发设计保留，并根据 Agent 类型自动选择项目内 skills 文件夹。
* Agent 派发管理使用初始勾选状态与最终勾选状态的差异来计算变更，而不是基于显式的 on/off 标签。
* 导入技能需要支持解析 `npx skills add ...` 命令，并尽量贴近 vercel-labs/skills 的交互心智。

### 12.2 剩余问题

* npm 包与命令命名及发布方案是否确定为 package `skillctl`、binary `skillctl`、支持 `npx skillctl`？
* MVP 默认启用 Agents 是否最终确定为 Claude Code、Codex、Cursor、Universal `.agents`，OpenCode 仅在检测到时启用？
* Windows auto 策略优先级是否最终确认为 `symlink -> junction -> copy`？
* local-only skill 导入时，MVP 是否只支持 copy 到仓库、原文件保留？
* 更新时遇到本地修改，MVP 是否只支持「跳过」「强制覆盖」「查看路径」？
* 同名冲突时，MVP 是否只支持「跳过」「导入现有 skill 到仓库」「查看路径」？
* 是否在 MVP 支持 `-y / --yes` 非交互模式？
* TUI 列表中 skill description 是否只展示一行摘要，详情页再展示完整 description？
* 自定义 Agent 配置是否需要支持为同一 Agent 指定多个全局路径？
* 当仓库 skill 存在已派发目标时，删除仓库 skill 是否始终阻止，要求先关闭派发？