#!/usr/bin/env node
import { runCli } from "./cli/app.js";
import { CancellationError } from "./tui/prompt-adapter.js";
import { runTui } from "./tui/app.js";
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

main().catch((error: unknown) => {
  if (error instanceof CancellationError) {
    process.exitCode = 0;
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  console.error(`skillctl failed: ${message}`);
  process.exitCode = 1;
});
