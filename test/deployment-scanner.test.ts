import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getAgent } from "../src/core/agent-registry.js";
import { getDefaultConfig, readDeploymentRegistry, writeDeploymentRegistry } from "../src/core/config.js";
import { disableSkill, enableSkill, resolveDeployMode } from "../src/core/deployment.js";
import { runQuickDoctor } from "../src/core/doctor.js";
import { importLocalSkills } from "../src/core/repository.js";
import { scanAgentScope } from "../src/core/scanner.js";
import { makeTempWorkspace } from "./helpers/tmpdir.js";

describe("deployment, scanner, and doctor", () => {
  it("resolves auto deploy mode by platform", () => {
    expect(resolveDeployMode("auto", { platform: "darwin" })).toBe("symlink");
    expect(resolveDeployMode("auto", { platform: "win32" })).toBe("junction");
  });

  it("enables and disables a managed symlink without touching unmanaged targets", async () => {
    const workspace = await makeTempWorkspace();
    try {
      const config = getDefaultConfig({ homeDir: workspace.home, platform: "darwin" });
      const [skill] = await importLocalSkills(config, join(import.meta.dirname, "fixtures", "skills", "frontend-design"));
      const agent = getAgent(config, "claude-code");
      expect(agent).toBeDefined();

      const deployment = await enableSkill(config, skill!, agent!, { kind: "global" }, {
        homeDir: workspace.home,
        mode: "symlink",
        platform: "darwin"
      });
      expect((await readDeploymentRegistry(config.deploymentsPath)).deployments).toHaveLength(1);

      const scanned = await scanAgentScope(config, "claude-code", { kind: "global" }, { homeDir: workspace.home });
      expect(scanned.find((item) => item.skillId === "frontend-design")?.status).toBe("managed");

      await disableSkill(config, deployment);
      expect((await readDeploymentRegistry(config.deploymentsPath)).deployments).toHaveLength(0);

      const targetRoot = join(workspace.home, ".claude", "skills");
      await mkdir(join(targetRoot, "frontend-design"), { recursive: true });
      await expect(enableSkill(config, skill!, agent!, { kind: "global" }, {
        homeDir: workspace.home,
        mode: "symlink",
        platform: "darwin"
      })).rejects.toThrow("not managed");
    } finally {
      await workspace.cleanup();
    }
  });

  it("detects local-only, conflict, broken, and outdated statuses", async () => {
    const workspace = await makeTempWorkspace();
    try {
      const config = getDefaultConfig({ homeDir: workspace.home, platform: "darwin" });
      const [skill] = await importLocalSkills(config, join(import.meta.dirname, "fixtures", "skills", "frontend-design"));
      const agent = getAgent(config, "claude-code")!;
      const targetRoot = join(workspace.home, ".claude", "skills");

      await mkdir(join(targetRoot, "frontend-design"), { recursive: true });
      await mkdir(join(targetRoot, "local-helper"), { recursive: true });
      await writeFile(join(targetRoot, "local-helper", "SKILL.md"), "---\nname: local-helper\n---\n");
      const conflictScan = await scanAgentScope(config, agent.id, { kind: "global" }, { homeDir: workspace.home });
      expect(conflictScan.find((item) => item.skillId === "frontend-design")?.status).toBe("conflict");
      expect(conflictScan.find((item) => item.skillId === "local-helper")?.status).toBe("local-only");

      await rm(join(targetRoot, "frontend-design"), { recursive: true, force: true });
      const deployment = await enableSkill(config, skill!, agent, { kind: "global" }, {
        homeDir: workspace.home,
        mode: "copy",
        platform: "darwin"
      });
      await writeFile(join(skill!.localPath, "extra.txt"), "changed");
      const outdatedScan = await scanAgentScope(config, agent.id, { kind: "global" }, { homeDir: workspace.home });
      expect(outdatedScan.find((item) => item.skillId === "frontend-design")?.status).toBe("outdated");

      await rm(deployment.targetPath, { recursive: true, force: true });
      const brokenScan = await scanAgentScope(config, agent.id, { kind: "global" }, { homeDir: workspace.home });
      expect(brokenScan.find((item) => item.skillId === "frontend-design")?.status).toBe("broken");

      const issues = await runQuickDoctor(config, {
        homeDir: workspace.home,
        scopes: [{ agentId: agent.id, scope: { kind: "global" } }]
      });
      expect(issues.some((issue) => issue.type === "broken-link")).toBe(true);
    } finally {
      await workspace.cleanup();
    }
  });

  it("does not disable records that are no longer present in the registry", async () => {
    const workspace = await makeTempWorkspace();
    try {
      const config = getDefaultConfig({ homeDir: workspace.home, platform: "darwin" });
      await writeDeploymentRegistry(config.deploymentsPath, { version: 1, deployments: [] });

      await expect(
        disableSkill(config, {
          id: "missing",
          skillId: "frontend-design",
          agentId: "claude-code",
          scope: "global",
          sourcePath: "/missing/source",
          targetPath: "/missing/target",
          mode: "symlink",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        })
      ).rejects.toThrow("not managed");
    } finally {
      await workspace.cleanup();
    }
  });
});
