# Logging System Design Spec

## [S1] Problem

skillctl 在运行时遇到的错误（如 EBUSY、EPERM）直接抛出或打印到 stderr 后程序退出，无法事后排查。需要一个日志系统将错误持久化到文件，支持级别配置和滚动轮转。

## [S2] Requirements

- 日志写入 `~/.skillsctl/logs/skillctl.log`
- 默认级别 `error`，可通过 `config.json` 的 `logging.level` 配置
- 支持级别：`debug` | `info` | `warn` | `error` | `silent`
- 单文件最大 5MB，保留最近 3 个旧文件（共 ~20MB）
- 零外部依赖，自行实现
- 同步写入，确保进程异常退出不丢日志

## [S3] Module Structure

新增 `src/platform/logger.ts`，导出单例 logger。

配置集成到现有 `~/.skillsctl/config.json`：

```json
{
  "logging": {
    "level": "error",
    "maxSizeMB": 5,
    "maxFiles": 3
  }
}
```

## [S4] Logger API

```typescript
type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

interface Logger {
  error(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  debug(message: string, data?: unknown): void;
}

function initLogger(options: {
  logDir: string;
  level: LogLevel;
  maxSizeMB: number;
  maxFiles: number;
}): Logger;

function getLogger(): Logger;
```

- `data` 参数可选，传入 Error 对象或任意上下文对象
- 未初始化时 `getLogger()` 返回静默 no-op logger

## [S5] Log Format

每行一条日志：

```
2026-06-11T12:00:00.000Z ERROR enableSkill EBUSY: resource busy or locked
  stack: Error: EBUSY...
  data: { "target": "~/.agents/skills/brainstorming" }
```

- ISO 时间戳 + 级别 + 消息
- 可选 stack trace 和 data 对象缩进显示

## [S6] Rotation Logic

写入前检查当前文件大小，若写入后会超过 `maxSizeMB`：

1. 删除最旧文件 `skillctl.log.{maxFiles}`
2. 重命名 `{n}` → `{n+1}`，从最旧开始
3. 当前文件 → `skillctl.log.1`
4. 创建新的 `skillctl.log`

## [S7] Integration Points

**初始化**：`bin.ts` 的 `main()` 中，TUI/CLI 启动前调用 `initLogger`

**日志记录点**：
- `tui/app.ts` — `formatDeployError` catch 块中写日志
- `cli/app.ts` — `formatDeployCliError` catch 块中写日志
- `bin.ts` — 全局 catch 中记录未捕获异常

**原则**：日志记录在错误处理最外层，底层 core 模块只 throw 不 log
