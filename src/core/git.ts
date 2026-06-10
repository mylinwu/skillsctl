import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export class GitCloneError extends Error {
  constructor(
    message: string,
    readonly url: string
  ) {
    super(message);
    this.name = "GitCloneError";
  }
}

export async function cloneRepo(url: string, ref?: string) {
  const tempDir = await mkdtemp(join(tmpdir(), "skillctl-"));
  const args = ["clone", "--depth", "1"];
  if (ref) {
    args.push("--branch", ref);
  }
  args.push(url, tempDir);

  try {
    await execFileAsync("git", args, {
      timeout: 300_000,
      maxBuffer: 10 * 1024 * 1024,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GIT_LFS_SKIP_SMUDGE: "1"
      }
    });
    return tempDir;
  } catch (error) {
    await cleanupTempDir(tempDir);
    const message = error instanceof Error ? error.message : String(error);
    throw new GitCloneError(`Failed to clone ${url}: ${message}`, url);
  }
}

export async function cleanupTempDir(path: string) {
  await rm(path, { recursive: true, force: true }).catch(() => undefined);
}
