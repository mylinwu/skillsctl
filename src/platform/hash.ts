import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join, relative } from "node:path";

const SKIP_FILES = new Set([".skillctl.json"]);

export async function hashDirectory(root: string) {
  const hash = createHash("sha256");
  const files = await listFiles(root);

  for (const file of files.sort()) {
    hash.update(relative(root, file));
    hash.update(await readFile(file));
  }

  return hash.digest("hex");
}

async function listFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (SKIP_FILES.has(entry.name)) {
      continue;
    }
    const fullPath = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(fullPath)));
    } else if (entry.isFile()) {
      files.push(fullPath);
    } else if (entry.isSymbolicLink()) {
      const linkStat = await stat(fullPath).catch(() => undefined);
      if (linkStat?.isFile()) {
        files.push(fullPath);
      }
    }
  }

  return files;
}
