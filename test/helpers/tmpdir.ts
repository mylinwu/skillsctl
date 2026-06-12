import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

export async function makeTempWorkspace(prefix = "skillsctl-") {
  const root = await mkdtemp(join(tmpdir(), prefix));
  const home = join(root, "home");
  const project = join(root, "project");

  return {
    root,
    home,
    project,
    async cleanup() {
      await rm(root, { recursive: true, force: true });
    }
  };
}
