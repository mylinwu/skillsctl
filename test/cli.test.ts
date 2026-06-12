import { lstat, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readConfig, readDeploymentRegistry } from "../src/core/config.js";
import { runCli } from "../src/cli/app.js";
import { makeTempWorkspace } from "./helpers/tmpdir.js";

describe("CLI", () => {
  it("initializes config and prints created paths", async () => {
    const workspace = await makeTempWorkspace();
    try {
      const result = await runCli({
        argv: ["init", "--agents", "claude-code,codex"],
        homeDir: workspace.home,
        cwd: workspace.project,
        platform: "darwin"
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Initialized skillsctl");
      expect(result.stdout).toContain("Repository:");

      const config = await readConfig(workspace.home);
      expect(config.agents.find((agent) => agent.id === "claude-code")?.enabled).toBe(true);
      expect(config.agents.find((agent) => agent.id === "cursor")?.enabled).toBe(false);
      await expect(readDeploymentRegistry(config.deploymentsPath)).resolves.toMatchObject({
        deployments: []
      });
    } finally {
      await workspace.cleanup();
    }
  });

  it("imports local skills and lists repository entries", async () => {
    const workspace = await makeTempWorkspace();
    try {
      await runCli({
        argv: ["init"],
        homeDir: workspace.home,
        cwd: workspace.project,
        platform: "darwin"
      });

      const importResult = await runCli({
        argv: ["import", join(import.meta.dirname, "fixtures", "skills"), "--skill", "frontend-design"],
        homeDir: workspace.home,
        cwd: workspace.project,
        platform: "darwin"
      });
      expect(importResult.exitCode).toBe(0);
      expect(importResult.stdout).toContain("Imported 1 skill");
      expect(importResult.stdout).toContain("frontend-design");

      const listResult = await runCli({
        argv: ["repo", "list"],
        homeDir: workspace.home,
        cwd: workspace.project,
        platform: "darwin"
      });
      expect(listResult.exitCode).toBe(0);
      expect(listResult.stdout).toContain("frontend-design");
      expect(listResult.stdout).toContain("Create polished frontend interfaces.");
    } finally {
      await workspace.cleanup();
    }
  });

  it("enables, scans, and disables a managed skill", async () => {
    const workspace = await makeTempWorkspace();
    try {
      await runCli({
        argv: ["init", "--agents", "claude-code"],
        homeDir: workspace.home,
        cwd: workspace.project,
        platform: "darwin"
      });
      await runCli({
        argv: ["import", join(import.meta.dirname, "fixtures", "skills", "frontend-design")],
        homeDir: workspace.home,
        cwd: workspace.project,
        platform: "darwin"
      });

      const enableResult = await runCli({
        argv: [
          "enable",
          "frontend-design",
          "--agent",
          "claude-code",
          "--global",
          "--mode",
          process.platform === "win32" ? "junction" : "symlink"
        ],
        homeDir: workspace.home,
        cwd: workspace.project,
        platform: "darwin"
      });
      expect(enableResult.exitCode).toBe(0);
      expect(enableResult.stdout).toContain("Enabled frontend-design");

      const target = join(workspace.home, ".claude", "skills", "frontend-design");
      await expect(lstat(target)).resolves.toMatchObject({ isSymbolicLink: expect.any(Function) });

      const scanResult = await runCli({
        argv: ["app", "claude-code", "list"],
        homeDir: workspace.home,
        cwd: workspace.project,
        platform: "darwin"
      });
      expect(scanResult.stdout).toContain("managed");
      expect(scanResult.stdout).toContain("frontend-design");

      const disableResult = await runCli({
        argv: ["disable", "frontend-design", "--agent", "claude-code", "--global"],
        homeDir: workspace.home,
        cwd: workspace.project,
        platform: "darwin"
      });
      expect(disableResult.exitCode).toBe(0);
      expect(disableResult.stdout).toContain("Disabled frontend-design");

      const config = await readConfig(workspace.home);
      expect((await readDeploymentRegistry(config.deploymentsPath)).deployments).toHaveLength(0);
    } finally {
      await workspace.cleanup();
    }
  });

  it("prints app list, doctor results, and config", async () => {
    const workspace = await makeTempWorkspace();
    try {
      await runCli({
        argv: ["init", "--agents", "claude-code,codex"],
        homeDir: workspace.home,
        cwd: workspace.project,
        platform: "darwin"
      });

      const appList = await runCli({
        argv: ["app", "list"],
        homeDir: workspace.home,
        cwd: workspace.project,
        platform: "darwin"
      });
      expect(appList.stdout).toContain("claude-code");
      expect(appList.stdout).toContain("codex");

      const doctor = await runCli({
        argv: ["doctor"],
        homeDir: workspace.home,
        cwd: workspace.project,
        platform: "darwin"
      });
      expect(doctor.exitCode).toBe(0);
      expect(doctor.stdout).toContain("No issues found.");

      const config = await runCli({
        argv: ["config"],
        homeDir: workspace.home,
        cwd: workspace.project,
        platform: "darwin"
      });
      expect(config.stdout).toContain("\"repositoryPath\"");
      expect(config.stdout).toContain("\"deploymentsPath\"");
    } finally {
      await workspace.cleanup();
    }
  });

  it("updates repository skills and reports clear errors", async () => {
    const workspace = await makeTempWorkspace();
    try {
      const missingConfig = await runCli({
        argv: ["repo", "list"],
        homeDir: workspace.home,
        cwd: workspace.project,
        platform: "darwin"
      });
      expect(missingConfig.exitCode).toBe(1);
      expect(missingConfig.stderr).toContain("Run `skillsctl init` first.");

      const unknown = await runCli({
        argv: ["unknown"],
        homeDir: workspace.home,
        cwd: workspace.project,
        platform: "darwin"
      });
      expect(unknown.exitCode).toBe(1);
      expect(unknown.stderr).toContain("Unknown command");

      await runCli({
        argv: ["init"],
        homeDir: workspace.home,
        cwd: workspace.project,
        platform: "darwin"
      });
      const source = join(workspace.root, "source-skill");
      await mkdir(source, { recursive: true });
      await writeFile(join(source, "SKILL.md"), "---\nname: source-skill\ndescription: A\n---\n");
      await runCli({
        argv: ["import", source],
        homeDir: workspace.home,
        cwd: workspace.project,
        platform: "darwin"
      });
      await writeFile(join(source, "SKILL.md"), "---\nname: source-skill\ndescription: B\n---\n");
      const update = await runCli({
        argv: ["update", "source-skill"],
        homeDir: workspace.home,
        cwd: workspace.project,
        platform: "darwin"
      });
      expect(update.exitCode).toBe(0);
      expect(update.stdout).toContain("source-skill: updated");

      const missingSkill = await runCli({
        argv: ["update", "missing-skill"],
        homeDir: workspace.home,
        cwd: workspace.project,
        platform: "darwin"
      });
      expect(missingSkill.exitCode).toBe(1);
      expect(missingSkill.stderr).toContain("Skill not found");
    } finally {
      await workspace.cleanup();
    }
  });
});
