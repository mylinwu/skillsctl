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

let escFilterInstalled = false;

function installEscFilter() {
  if (escFilterInstalled || !process.stdin.isTTY) return;
  const originalEmit = process.stdin.emit;
  process.stdin.emit = function (this: typeof process.stdin, event: string, ...args: any[]) {
    if (event === "data" && args[0] instanceof Buffer) {
      const data = args[0] as Buffer;
      if (data.length === 1 && data[0] === 0x1b) {
        return true;
      }
    }
    return originalEmit.apply(this, arguments as unknown as Parameters<typeof originalEmit>);
  } as typeof process.stdin.emit;
  escFilterInstalled = true;
}

export const prompts = {
  intro,
  outro,
  note,
  spinner,
  async confirm(message: string, initialValue = true) {
    installEscFilter();
    const value = await confirm({ message, initialValue });
    return handleCancel(value);
  },
  async text(message: string, placeholder?: string, defaultValue?: string) {
    installEscFilter();
    const value = await text({ message, placeholder, defaultValue });
    return handleCancel(value);
  },
  async select<T extends string>(
    message: string,
    options: Option<T>[],
    initialValue?: T
  ) {
    installEscFilter();
    const value = await select({ message, options, initialValue });
    return handleCancel(value) as T | BackSentinel;
  },
  async multiselect<T extends string>(
    message: string,
    options: Option<T>[],
    required = false,
    initialValues?: T[]
  ) {
    installEscFilter();
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
