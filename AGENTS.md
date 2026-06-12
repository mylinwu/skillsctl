# AGENTS.md

本文档为开发 skillsctl 应用的 AI Agent 提供核心规则与架构指导。

## 核心开发规则（硬性门槛）

### 1. 每次新增/修改功能后，必须检查并更新 TODO.md 状态
- 无论是完成了某个未完成（`[ ]`）的功能，还是在现有功能上做了增强。
- 必须保证 `TODO.md` 中的状态标签、说明与实际代码行为完全对齐。
- 不要在没有更新 `TODO.md` 的情况下宣告功能完成。

### 2. 测试驱动开发 (TDD)
- 所有核心业务逻辑（`src/core` 下的 config、parser、repository、deployment、scanner、doctor、source-resolver）必须包含对应的单元测试，存放在 `test` 目录。
- 文件系统测试严禁修改真实用户的 `~/.skillsctl` 或真实系统的 Agent 目录，必须通过 `test/helpers/tmpdir.ts` 的 `makeTempWorkspace` 创建隔离临时目录。

### 3. TUI 与服务解耦
- `@clack/prompts` 流程应当只在 `src/tui` 下维护，只负责：
  - 组织交互步骤
  - 接收用户输入与多选
  - 调用 `src/core` 提供的无状态纯函数服务
  - 呈现变更预览与 note/outro 反馈
- 所有的业务检查（如冲突、依赖记录、路径安全性、哈希校验、Git 克隆等）全部在 `src/core` 实现，方便编写纯单元测试。

---

## 项目架构

```
src/
├── bin.ts                 # CLI 入口，处理全局错误和配置状态检测
├── index.ts               # 导出 API 核心
├── core/
│   ├── types.ts           # 核心数据模型与类型声明
│   ├── config.ts          # ~/.skillsctl 基础配置与 deployments 读写
│   ├── skill-parser.ts    # 解析 SKILL.md、isSubpathSafe 以及 discover 逻辑
│   ├── source-resolver.ts # 解析 Git Shorthand/URL, 命令解析 (npx skills add)
│   ├── git.ts             # git clone --depth 1 支持
│   ├── repository.ts      # 本地仓库管理 (导入、列表、删除拦截)
│   ├── deployment.ts      # 文件系统 symlink/junction/copy 写入，安全 disable
│   ├── scanner.ts         # 扫描合并 managed/local-only/broken/conflict/outdated
│   └── doctor.ts          # 快速/完整环境问题诊断
├── platform/
│   ├── path.ts            # 用户路径解析与规范
│   └── hash.ts            # 目录哈希
└── tui/
    ├── app.ts             # TUI 控制台核心，组织首次初始化与二级子菜单
    ├── change-plan.ts     # TUI 批量启用/禁用状态 diff 计算 helper
    └── prompt-adapter.ts  # Clack prompt 适配层与 Ctrl+C 取消拦截
```

## 测试规范

```bash
# 运行单元测试
pnpm test

# 检查类型约束
pnpm typecheck

# 生产环境打包
pnpm build
```
