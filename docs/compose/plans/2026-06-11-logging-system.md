# Logging System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a file-based logging system with configurable levels and size-based rotation to skillctl

**Architecture:** New `src/platform/logger.ts` module provides a singleton logger with synchronous file writes. Config schema extended with `logging` field. Error handling in TUI/CLI layers updated to log errors before displaying user messages.

**Tech Stack:** Node.js `fs` (sync writes), `zod` (config validation), `vitest` (testing)

---

## File Structure

| File | Action | Purpose |
|------|--------|---------|
| `src/platform/logger.ts` | Create | Logger singleton with rotation logic |
| `src/core/types.ts` | Modify | Add `LoggingConfig` type and `logging` to `Config` |
| `src/core/config.ts` | Modify | Add `logging` schema, defaults, and `logDir` to config |
| `src/bin.ts` | Modify | Initialize logger on startup |
| `src/tui/app.ts` | Modify | Log errors in catch blocks |
| `src/cli/app.ts` | Modify | Log errors in `formatDeployCliError` |
| `test/logger.test.ts` | Create | Unit tests for logger module |
| `test/config.test.ts` | Modify | Test logging config integration |

---

### Task 1: Logger Core Module (TDD)

**Covers:** [S3], [S4], [S5], [S6]

**Files:**
- Create: `src/platform/logger.ts`
- Test: `test/logger.test.ts`

- [ ] **Step 1: Write failing tests for logger**

```typescript
// test/logger.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createLogger, resetLogger, getLogger } from "../src/platform/logger.js";

async function makeTmpDir() {
  return await mkdtemp(join(tmpdir(), "skillctl-log-"));
}

describe("logger", () => {
  let logDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    logDir = await makeTmpDir();
    cleanup = () => rm(logDir, { recursive: true, force: true });
    resetLogger();
  });

  afterEach(async () => {
    resetLogger();
    await cleanup();
  });

  it("returns no-op logger before init", () => {
    const logger = getLogger();
    expect(() => logger.error("test")).not.toThrow();
  });

  it("writes error logs to file", async () => {
    const logger = createLogger({ logDir, level: "error", maxSizeMB: 5, maxFiles: 3 });
    logger.error("test error");

    const content = await readFile(join(logDir, "skillctl.log"), "utf8");
    expect(content).toContain("ERROR");
    expect(content).toContain("test error");
  });

  it("respects log level filter", async () => {
    const logger = createLogger({ logDir, level: "warn", maxSizeMB: 5, maxFiles: 3 });
    logger.debug("should not appear");
    logger.info("should not appear");
    logger.warn("should appear");
    logger.error("should appear");

    const content = await readFile(join(logDir, "skillctl.log"), "utf8");
    expect(content).not.toContain("should not appear");
    expect(content).toContain("should appear");
  });

  it("serializes Error data", async () => {
    const logger = createLogger({ logDir, level: "error", maxSizeMB: 5, maxFiles: 3 });
    logger.error("failed", new Error("EBUSY"));

    const content = await readFile(join(logDir, "skillctl.log"), "utf8");
    expect(content).toContain("EBUSY");
  });

  it("rotates files when size exceeds limit", async () => {
    const logger = createLogger({ logDir, level: "error", maxSizeMB: 0.001, maxFiles: 3 });

    for (let i = 0; i < 100; i++) {
      logger.error(`message ${i}`.padEnd(200, "x"));
    }

    const files = await readdir(logDir);
    expect(files.length).toBeGreaterThan(1);
    expect(files).toContain("skillctl.log");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test test/logger.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement logger module**

```typescript
// src/platform/logger.ts
import { appendFileSync, mkdirSync, renameSync, statSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

export interface Logger {
  error(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  debug(message: string, data?: unknown): void;
}

export interface LoggerOptions {
  logDir: string;
  level: LogLevel;
  maxSizeMB: number;
  maxFiles: number;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4
};

let currentLogger: Logger | null = null;

function formatData(data: unknown): string {
  if (!data) return "";
  if (data instanceof Error) {
    return `\n  stack: ${data.stack ?? data.message}`;
  }
  try {
    return `\n  data: ${JSON.stringify(data)}`;
  } catch {
    return `\n  data: ${String(data)}`;
  }
}

function shouldRotate(filePath: string, maxBytes: number): boolean {
  try {
    const stat = statSync(filePath);
    return stat.size >= maxBytes;
  } catch {
    return false;
  }
}

function rotateFiles(logDir: string, baseName: string, maxFiles: number) {
  const mainPath = join(logDir, baseName);

  for (let i = maxFiles; i >= 1; i--) {
    const current = i === 1 ? mainPath : join(logDir, `${baseName}.${i - 1}`);
    const target = join(logDir, `${baseName}.${i}`);

    if (existsSync(current)) {
      if (i === maxFiles) {
        try { unlinkSync(current); } catch { /* ignore */ }
      } else {
        try { renameSync(current, target); } catch { /* ignore */ }
      }
    }
  }
}

export function createLogger(options: LoggerOptions): Logger {
  mkdirSync(options.logDir, { recursive: true });

  const levelNum = LOG_LEVELS[options.level];
  const maxBytes = options.maxSizeMB * 1024 * 1024;
  const baseName = "skillctl.log";

  function log(level: LogLevel, message: string, data?: unknown) {
    if (LOG_LEVELS[level] < levelNum) return;

    const filePath = join(options.logDir, baseName);

    if (shouldRotate(filePath, maxBytes)) {
      rotateFiles(options.logDir, baseName, options.maxFiles);
    }

    const timestamp = new Date().toISOString();
    const levelTag = level.toUpperCase().padEnd(5);
    const line = `${timestamp} ${levelTag} ${message}${formatData(data)}\n`;

    appendFileSync(filePath, line, "utf8");
  }

  const logger: Logger = {
    error: (msg, data) => log("error", msg, data),
    warn: (msg, data) => log("warn", msg, data),
    info: (msg, data) => log("info", msg, data),
    debug: (msg, data) => log("debug", msg, data)
  };

  currentLogger = logger;
  return logger;
}

const noopLogger: Logger = {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {}
};

export function getLogger(): Logger {
  return currentLogger ?? noopLogger;
}

export function resetLogger() {
  currentLogger = null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test test/logger.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/platform/logger.ts test/logger.test.ts
git commit -m "feat: add logger module with rotation support"
```

---

### Task 2: Config Integration

**Covers:** [S3]

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/core/config.ts`
- Modify: `test/config.test.ts`

- [ ] **Step 1: Add types to `types.ts`**

Add after `DeployMode` type (line 1):

```typescript
export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

export interface LoggingConfig {
  level: LogLevel;
  maxSizeMB: number;
  maxFiles: number;
}
```

Add to `Config` interface (line 25):

```typescript
export interface Config {
  version: 1;
  configDir: string;
  repositoryPath: string;
  deploymentsPath: string;
  defaultDeployMode: DeployMode;
  logging: LoggingConfig;
  agents: AgentDefinition[];
}
```

- [ ] **Step 2: Add schema and defaults to `config.ts`**

Add after `deployModeSchema` (line 8):

```typescript
const logLevelSchema = z.enum(["debug", "info", "warn", "error", "silent"]);

const loggingConfigSchema = z.object({
  level: logLevelSchema,
  maxSizeMB: z.number().positive(),
  maxFiles: z.number().int().positive()
});
```

Add `logging` to `configSchema` (after line 24):

```typescript
export const configSchema = z.object({
  version: z.literal(1),
  configDir: z.string().min(1),
  repositoryPath: z.string().min(1),
  deploymentsPath: z.string().min(1),
  defaultDeployMode: deployModeSchema,
  logging: loggingConfigSchema,
  agents: z.array(agentSchema)
});
```

Add `logging` default to `getDefaultConfig` (after line 62):

```typescript
logging: {
  level: "error",
  maxSizeMB: 5,
  maxFiles: 3
},
```

- [ ] **Step 3: Add failing test for logging config**

Add to `test/config.test.ts`:

```typescript
it("includes logging config with defaults", async () => {
  const workspace = await makeTempWorkspace();
  try {
    await mkdir(workspace.home, { recursive: true });
    const config = await initializeConfig({
      homeDir: workspace.home,
      platform: "darwin"
    });

    expect(config.logging).toEqual({
      level: "error",
      maxSizeMB: 5,
      maxFiles: 3
    });

    const persisted = await readConfig(workspace.home);
    expect(persisted.logging.level).toBe("error");
  } finally {
    await workspace.cleanup();
  }
});
```

- [ ] **Step 4: Run tests to verify new test fails**

Run: `pnpm test test/config.test.ts`
Expected: FAIL (new test fails, existing tests still fail on Windows)

- [ ] **Step 5: Run typecheck to verify types compile**

Run: `pnpm typecheck`
Expected: PASS (or only pre-existing errors)

- [ ] **Step 6: Commit**

```bash
git add src/core/types.ts src/core/config.ts test/config.test.ts
git commit -m "feat: add logging config to Config schema"
```

---

### Task 3: Integration Hooks

**Covers:** [S7]

**Files:**
- Modify: `src/bin.ts`
- Modify: `src/tui/app.ts`
- Modify: `src/cli/app.ts`

- [ ] **Step 1: Initialize logger in `bin.ts`**

Replace `main()` function:

```typescript
async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    await runTui();
    return;
  }

  const result = await runCli({ argv });
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  process.exitCode = result.exitCode;
}
```

With:

```typescript
import { createLogger } from "./platform/logger.js";

async function main() {
  const home = homedir();
  const logDir = join(home, ".skillsctl", "logs");

  let logLevel = "error";
  let maxSizeMB = 5;
  let maxFiles = 3;

  if (await configExists(home)) {
    const config = await readConfig(home);
    logLevel = config.logging.level;
    maxSizeMB = config.logging.maxSizeMB;
    maxFiles = config.logging.maxFiles;
  }

  createLogger({ logDir, level: logLevel as any, maxSizeMB, maxFiles });

  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    await runTui();
    return;
  }

  const result = await runCli({ argv });
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  process.exitCode = result.exitCode;
}
```

Add imports at top of `bin.ts`:

```typescript
import { homedir } from "node:os";
import { join } from "node:path";
import { configExists, readConfig } from "./core/config.js";
```

- [ ] **Step 2: Log errors in `bin.ts` global catch**

Update global catch:

```typescript
main().catch((error: unknown) => {
  if (error instanceof CancellationError) {
    process.exitCode = 0;
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  getLogger().error("Unhandled error", error);
  console.error(`skillctl failed: ${message}`);
  process.exitCode = 1;
});
```

Add import:

```typescript
import { getLogger } from "./platform/logger.js";
```

- [ ] **Step 3: Log errors in `tui/app.ts`**

Update `formatDeployError` to log:

```typescript
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
```

Add import:

```typescript
import { getLogger } from "../platform/logger.js";
```

- [ ] **Step 4: Log errors in `cli/app.ts`**

Update `formatDeployCliError` to log:

```typescript
function formatDeployCliError(err: any, action: string, skillId: string): string {
  getLogger().error(`Deploy ${action} failed: ${skillId}`, err);

  const code = err?.code as string | undefined;
  if (code === "EBUSY" || code === "EPERM" || code === "EACCES") {
    return `Failed to ${action} ${skillId}: target is busy or access denied. Close any program using it and retry.`;
  }
  if (code === "ENOSPC") {
    return `Failed to ${action} ${skillId}: no space left on device.`;
  }
  return `Failed to ${action} ${skillId}: ${err?.message ?? err}`;
}
```

Add import:

```typescript
import { getLogger } from "../platform/logger.js";
```

- [ ] **Step 5: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 6: Run all tests**

Run: `pnpm test`
Expected: Same pass/fail ratio as before (no regressions)

- [ ] **Step 7: Build**

Run: `pnpm build`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/bin.ts src/tui/app.ts src/cli/app.ts
git commit -m "feat: integrate logger into error handling paths"
```

---

### Task 4: Update TODO.md

**Covers:** [S1], [S2]

**Files:**
- Modify: `TODO.md`

- [ ] **Step 1: Add logging section to TODO.md**

Add after "## CLI 交互命令行 (P0)" section:

```markdown
## 日志系统 (P0)
- [x] **日志模块**: `src/platform/logger.ts` 实现单例 logger，支持 debug/info/warn/error/silent 级别。
- [x] **配置集成**: `config.json` 新增 `logging` 字段，默认级别 error，可配置。
- [x] **滚动轮转**: 单文件最大 5MB，保留最近 3 个旧文件。
- [x] **错误记录**: TUI/CLI 层的错误处理统一写入日志文件。
```

- [ ] **Step 2: Commit**

```bash
git add TODO.md
git commit -m "docs: update TODO with logging system status"
```
