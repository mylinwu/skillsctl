import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  configExists,
  getConfigPath,
  getDefaultConfig,
  initializeConfig,
  readConfig,
  readDeploymentRegistry
} from "../src/core/config.js";
import { makeTempWorkspace } from "./helpers/tmpdir.js";

describe("config", () => {
  it("builds macOS defaults under ~/.skillctl", () => {
    const config = getDefaultConfig({
      homeDir: "/tmp/home",
      platform: "darwin"
    });

    expect(config.configDir).toBe("/tmp/home/.skillctl");
    expect(config.repositoryPath).toBe("/tmp/home/.skillctl/repository");
    expect(config.deploymentsPath).toBe("/tmp/home/.skillctl/deployments.json");
    expect(config.defaultDeployMode).toBe("symlink");
    expect(config.agents.some((agent) => agent.id === "claude-code")).toBe(true);
    expect(config.agents.find((agent) => agent.id === "codex")?.globalPath).toBe("~/.codex/skills");
    expect(config.agents.some((agent) => agent.id === "warp")).toBe(true);
  });

  it("initializes config, repository, and empty deployments registry", async () => {
    const workspace = await makeTempWorkspace();
    try {
      await mkdir(workspace.home, { recursive: true });

      expect(await configExists(workspace.home)).toBe(false);

      const config = await initializeConfig({
        homeDir: workspace.home,
        platform: "darwin",
        enabledAgentIds: ["claude-code", "codex"]
      });

      expect(await configExists(workspace.home)).toBe(true);
      expect(config.agents.find((agent) => agent.id === "cursor")?.enabled).toBe(false);

      const persisted = await readConfig(workspace.home);
      expect(persisted.repositoryPath).toBe(config.repositoryPath);

      const registry = await readDeploymentRegistry(config.deploymentsPath);
      expect(registry.deployments).toEqual([]);
    } finally {
      await workspace.cleanup();
    }
  });

  it("uses the documented config path", () => {
    expect(getConfigPath("/Users/example")).toBe(join("/Users/example", ".skillctl", "config.json"));
  });
});
