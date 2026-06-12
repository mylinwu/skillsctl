#!/usr/bin/env node
import { homedir } from "node:os";
import { join } from "node:path";
import { runCli } from "./cli/app.js";
import { configExists, readConfig } from "./core/config.js";
import { initLogger, getLogger } from "./platform/logger.js";
import { CancellationError } from "./tui/prompt-adapter.js";
import { runTui } from "./tui/app.js";

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

  initLogger({ logDir, level: logLevel as any, maxSizeMB, maxFiles });

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

main().catch((error: unknown) => {
  if (error instanceof CancellationError) {
    process.exitCode = 0;
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  getLogger().error("Unhandled error", error);
  console.error(`skillsctl failed: ${message}`);
  process.exitCode = 1;
});
