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

export const prompts = {
  intro,
  outro,
  note,
  spinner,
  async confirm(message: string, initialValue = true) {
    const value = await confirm({ message, initialValue });
    return handleCancel(value);
  },
  async text(message: string, placeholder?: string, defaultValue?: string) {
    const value = await text({ message, placeholder, defaultValue });
    return handleCancel(value);
  },
  async select<T extends string>(
    message: string,
    options: Option<T>[],
    initialValue?: T
  ) {
    const value = await select({ message, options, initialValue });
    return handleCancel(value) as T;
  },
  async multiselect<T extends string>(
    message: string,
    options: Option<T>[],
    required = false,
    initialValues?: T[]
  ) {
    const value = await multiselect({
      message,
      options,
      required,
      initialValues
    });
    return handleCancel(value) as T[];
  }
};

export class CancellationError extends Error {
  constructor() {
    super("已取消。");
    this.name = "CancellationError";
  }
}

function handleCancel<T>(value: T | symbol): T {
  if (isCancel(value)) {
    cancel("已取消。");
    throw new CancellationError();
  }
  return value;
}
