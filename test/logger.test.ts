import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initLogger, resetLogger, getLogger } from "../src/platform/logger.js";

async function makeTmpDir() {
  return await mkdtemp(join(tmpdir(), "skillsctl-log-"));
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
    const logger = initLogger({ logDir, level: "error", maxSizeMB: 5, maxFiles: 3 });
    logger.error("test error");

    const content = await readFile(join(logDir, "skillsctl.log"), "utf8");
    expect(content).toContain("ERROR");
    expect(content).toContain("test error");
  });

  it("respects log level filter", async () => {
    const logger = initLogger({ logDir, level: "warn", maxSizeMB: 5, maxFiles: 3 });
    logger.debug("should not appear");
    logger.info("should not appear");
    logger.warn("should appear");
    logger.error("should appear");

    const content = await readFile(join(logDir, "skillsctl.log"), "utf8");
    expect(content).not.toContain("should not appear");
    expect(content).toContain("should appear");
  });

  it("serializes Error data", async () => {
    const logger = initLogger({ logDir, level: "error", maxSizeMB: 5, maxFiles: 3 });
    logger.error("failed", new Error("EBUSY"));

    const content = await readFile(join(logDir, "skillsctl.log"), "utf8");
    expect(content).toContain("EBUSY");
  });

  it("serializes object data", async () => {
    const logger = initLogger({ logDir, level: "info", maxSizeMB: 5, maxFiles: 3 });
    logger.info("context", { target: "~/.agents/skills/brainstorming" });

    const content = await readFile(join(logDir, "skillsctl.log"), "utf8");
    expect(content).toContain("brainstorming");
  });

  it("rotates files when size exceeds limit", async () => {
    const logger = initLogger({ logDir, level: "error", maxSizeMB: 0.001, maxFiles: 3 });

    for (let i = 0; i < 100; i++) {
      logger.error(`message ${i}`.padEnd(200, "x"));
    }

    const files = await readdir(logDir);
    expect(files.length).toBeGreaterThan(1);
    expect(files).toContain("skillsctl.log");
  });
});
