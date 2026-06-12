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
  silent: 4,
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
    const s = statSync(filePath);
    return s.size >= maxBytes;
  } catch {
    return false;
  }
}

function rotateFiles(logDir: string, baseName: string, maxFiles: number) {
  const mainPath = join(logDir, baseName);

  for (let i = maxFiles; i >= 2; i--) {
    const source = join(logDir, `${baseName}.${i - 1}`);
    const target = join(logDir, `${baseName}.${i}`);

    if (existsSync(target)) {
      try { unlinkSync(target); } catch { /* ignore */ }
    }
    if (existsSync(source)) {
      try { renameSync(source, target); } catch { /* ignore */ }
    }
  }

  if (existsSync(mainPath)) {
    try { renameSync(mainPath, join(logDir, `${baseName}.1`)); } catch { /* ignore */ }
  }
}

export function initLogger(options: LoggerOptions): Logger {
  mkdirSync(options.logDir, { recursive: true });

  const levelNum = LOG_LEVELS[options.level];
  const maxBytes = options.maxSizeMB * 1024 * 1024;
  const baseName = "skillsctl.log";

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
    debug: (msg, data) => log("debug", msg, data),
  };

  currentLogger = logger;
  return logger;
}

const noopLogger: Logger = {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
};

export function getLogger(): Logger {
  return currentLogger ?? noopLogger;
}

export function resetLogger() {
  currentLogger = null;
}
