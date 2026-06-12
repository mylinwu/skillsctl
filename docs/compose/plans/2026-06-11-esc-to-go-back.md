# ESC to Go Back Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pressing ESC at any sub-menu returns to the previous menu level; Ctrl+C always hard-exits the app.

**Architecture:** Modify `prompt-adapter.ts` to intercept Ctrl+C at stdin level (so @clack only sees ESC as cancel), change `handleCancel` to return a `BACK` sentinel instead of throwing. Add `isBack` guards in `app.ts` to return early from sub-flows.

**Tech Stack:** @clack/prompts, Node.js stdin raw mode

---

### Task 1: Modify prompt-adapter.ts — BACK sentinel + Ctrl+C interceptor

**Files:**

- Modify: `src/tui/prompt-adapter.ts`

- [ ] **Step 1: Add BACK symbol, isBack helper, and Ctrl+C interceptor**

Replace the entire file with:

```typescript
import {
  cancel,
  confirm,
  intro,
  isCancel,
  multiselect,
  note,
  outro,
  select,
  spinner,
  text
} from "@clack/prompts";
import type { Option } from "@clack/prompts";

export const BACK = Symbol("BACK");
export type BackSentinel = typeof BACK;

export function isBack(value: unknown): value is BackSentinel {
  return value === BACK;
}

let ctrlCInterceptorInstalled = false;

function installCtrlCInterceptor() {
  if (ctrlCInterceptorInstalled || !process.stdin.isTTY) return;
  process.stdin.prependListener("data", (data: Buffer) => {
    if (data.length === 1 && data[0] === 0x03) {
      process.exit(0);
    }
  });
  ctrlCInterceptorInstalled = true;
}

export const prompts = {
  intro,
  outro,
  note,
  spinner,
  async confirm(message: string, initialValue = true) {
    installCtrlCInterceptor();
    const value = await confirm({ message, initialValue });
    return handleCancel(value);
  },
  async text(message: string, placeholder?: string, defaultValue?: string) {
    installCtrlCInterceptor();
    const value = await text({ message, placeholder, defaultValue });
    return handleCancel(value);
  },
  async select<T extends string>(
    message: string,
    options: Option<T>[],
    initialValue?: T
  ) {
    installCtrlCInterceptor();
    const value = await select({ message, options, initialValue });
    return handleCancel(value) as T | BackSentinel;
  },
  async multiselect<T extends string>(
    message: string,
    options: Option<T>[],
    required = false,
    initialValues?: T[]
  ) {
    installCtrlCInterceptor();
    const value = await multiselect({
      message,
      options,
      required,
      initialValues
    });
    return handleCancel(value) as T[] | BackSentinel;
  }
};

export class CancellationError extends Error {
  constructor() {
    super("已取消。");
    this.name = "CancellationError";
  }
}

function handleCancel<T>(value: T | symbol): T | BackSentinel {
  if (isCancel(value)) {
    return BACK;
  }
  return value;
}
```

- [ ] **Step 2: Run typecheck to verify**

Run: `pnpm typecheck`
Expected: No errors

---

### Task 2: Modify app.ts — Add isBack guards

**Files:**

- Modify: `src/tui/app.ts`

- [ ] **Step 1: Update imports**

Change line 19 from:

```typescript
import { CancellationError, prompts } from "./prompt-adapter.js";
```

to:

```typescript
import { isBack, prompts } from "./prompt-adapter.js";
```

- [ ] **Step 2: Add isBack guard for initializeFlow in runTui**

Change lines 37-41 from:

```typescript
  if (!(await configExists(homeDir))) {
    config = await initializeFlow({ homeDir, cwd, platform });
  } else {
    config = await readConfig(homeDir);
  }
```

to:

```typescript
  if (!(await configExists(homeDir))) {
    const result = await initializeFlow({ homeDir, cwd, platform });
    if (isBack(result)) return;
    config = result;
  } else {
    config = await readConfig(homeDir);
  }
```

- [ ] **Step 3: Add isBack guard for main menu select**

Change lines 56-72 from:

```typescript
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
```

to:

```typescript
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
```

- [ ] **Step 4: Add isBack guards in initializeFlow**

Change the function to return `Config | BackSentinel`. Add isBack checks after each prompt:

After line 82 (`if (!shouldInit)` block), no change needed — that path explicitly throws.

Add guard after line 93 (repositoryInput):

```typescript
  const repositoryInput = await prompts.text(
    "请选择本地技能仓库位置",
    defaultRepositoryPath,
    defaultRepositoryPath
  );
  if (isBack(repositoryInput)) return BACK;
```

Add guard after line 102 (deployMode):

```typescript
  const deployMode = await prompts.select<DeployMode>(...);
  if (isBack(deployMode)) return BACK;
```

Add guard after line 115 (enabledAgentIds):

```typescript
  const enabledAgentIds = await prompts.multiselect<string>(...);
  if (isBack(enabledAgentIds)) return BACK;
```

Import BACK at the top (already imported via `isBack` from prompt-adapter, but need to also import `BACK` and `BackSentinel`):

```typescript
import { BACK, isBack, prompts } from "./prompt-adapter.js";
import type { BackSentinel } from "./prompt-adapter.js";
```

- [ ] **Step 5: Add isBack guards in repositoryFlow**

After line 150 (action select), add guard:

```typescript
  if (isBack(action)) return;
```

After line 170 (sourcePath text), add guard:

```typescript
  const sourcePath = await prompts.text("请输入 skill 来源", "vercel-labs/skills -- 或 ./my-skill");
  if (isBack(sourcePath)) return;
```

After line 171 (skillFilter text), add guard:

```typescript
  const skillFilter = await prompts.text("可选：指定 skill 名称或目录名，直接 Enter 导入全部发现的 skills", "");
  if (isBack(skillFilter)) return;
```

After line 184 (command text), add guard:

```typescript
  const command = await prompts.text(...);
  if (isBack(command)) return;
```

After line 199 (confirm), add guard:

```typescript
  if (parsed.source && (await prompts.confirm("是否按解析结果导入到本地仓库？", true))) {
```

Change to:

```typescript
  const shouldImport = await prompts.confirm("是否按解析结果导入到本地仓库？", true);
  if (isBack(shouldImport)) return;
  if (parsed.source && shouldImport) {
```

After line 217 (skillId select), add guard:

```typescript
  const skillId = await prompts.select(...);
  if (isBack(skillId)) return;
```

After line 221 (confirm), add guard:

```typescript
  const confirmed = await prompts.confirm("确认删除？已派发的 skill 会被阻止删除。", false);
  if (isBack(confirmed)) return;
```

- [ ] **Step 6: Add isBack guards in agentsFlow**

After line 238 (agentId select), add guard:

```typescript
  const agentId = await prompts.select(...);
  if (isBack(agentId)) return;
```

After line 260 (scopeChoice select), the existing `scopeChoice === "back"` check already handles return. Add isBack guard before it:

```typescript
  if (isBack(scopeChoice)) return;
```

After line 277 (selected multiselect), add guard:

```typescript
  const selected = await prompts.multiselect(...);
  if (isBack(selected)) return;
```

After line 303 (confirm), add guard:

```typescript
  const shouldApply = await prompts.confirm("是否继续应用这些变更？", true);
  if (isBack(shouldApply)) return;
  if (!shouldApply) return;
```

- [ ] **Step 7: Add isBack guards in settingsFlow**

After line 378 (action select), add guard:

```typescript
  if (isBack(action)) return config;
```

After line 395 (defaultDeployMode select), add guard:

```typescript
  const defaultDeployMode = await prompts.select<DeployMode>(...);
  if (isBack(defaultDeployMode)) return config;
```

After line 409 (agentId select), add guard:

```typescript
  const agentId = await prompts.select(...);
  if (isBack(agentId)) return config;
```

After lines 420-423 (custom agent text inputs), add guards after each:

```typescript
  const id = await prompts.text("请输入 Agent ID", "my-agent");
  if (isBack(id)) return config;
  const displayName = await prompts.text("请输入显示名称", "My Agent");
  if (isBack(displayName)) return config;
  const globalPath = await prompts.text("请输入全局 skills 路径", "~/.my-agent/skills");
  if (isBack(globalPath)) return config;
  const projectPath = await prompts.text("请输入项目 skills 相对路径", ".my-agent/skills");
  if (isBack(projectPath)) return config;
```

- [ ] **Step 8: Remove unused CancellationError import from app.ts**

The `CancellationError` import was removed in Step 1. Verify it's not used elsewhere in app.ts (it's not — it was only imported for the type, never thrown in app.ts).

- [ ] **Step 9: Run typecheck**

Run: `pnpm typecheck`
Expected: No errors

- [ ] **Step 10: Run tests**

Run: `pnpm test`
Expected: All tests pass

- [ ] **Step 11: Manual smoke test**

Run: `pnpm dev`
Verify:

1. At main menu, press ESC → app exits cleanly
2. Enter "技能管理", press ESC → returns to main menu
3. Enter "系统设置", press ESC → returns to main menu
4. At any prompt, press Ctrl+C → app exits immediately
5. Navigate through sub-menus normally with Enter → works as before

---

### Task 3: Update TODO.md

**Files:**

- Modify: `TODO.md`

- [ ] **Step 1: Add ESC navigation entry**

Add under "## TUI 交互界面 (P1)" after the existing entries:

```markdown
- [x] **ESC 返回上一级**: 在任意子菜单按 ESC 返回上一级，主菜单按 ESC 退出；Ctrl+C 始终硬退出。
```
