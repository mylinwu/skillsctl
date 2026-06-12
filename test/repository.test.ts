import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getDefaultConfig, writeDeploymentRegistry } from "../src/core/config.js";
import {
  checkRepositorySkillUpdate,
  checkRepositorySkillUpdates,
  deleteRepositorySkill,
  importFromSource,
  importLocalSkills,
  listRepositorySkillViews,
  listRepositorySkills,
  updateRepositorySkill
} from "../src/core/repository.js";
import { enableSkill } from "../src/core/deployment.js";
import { getAgent } from "../src/core/agent-registry.js";
import { discoverSkillDirectories, isSubpathSafe, parseSkillDirectory } from "../src/core/skill-parser.js";
import { parseNpxSkillsAdd, parseSource, sanitizeSubpath } from "../src/core/source-resolver.js";
import { makeTempWorkspace } from "./helpers/tmpdir.js";

describe("skill parser and repository", () => {
  it("parses SKILL.md frontmatter and falls back to directory names", async () => {
    const fixtureRoot = join(import.meta.dirname, "fixtures", "skills");

    const skill = await parseSkillDirectory(join(fixtureRoot, "frontend-design"));
    expect(skill.name).toBe("frontend-design");
    expect(skill.description).toBe("Create polished frontend interfaces.");
    expect(skill.hash).toMatch(/^[a-f0-9]{64}$/);

    const fallback = await parseSkillDirectory(join(fixtureRoot, "no-frontmatter"));
    expect(fallback.name).toBe("no-frontmatter");
    expect(fallback.description).toBe("");
  });

  it("discovers one or many skill directories", async () => {
    const fixtureRoot = join(import.meta.dirname, "fixtures", "skills");

    await expect(discoverSkillDirectories(join(fixtureRoot, "frontend-design"))).resolves.toEqual([
      join(fixtureRoot, "frontend-design")
    ]);
    await expect(discoverSkillDirectories(fixtureRoot)).resolves.toHaveLength(2);
  });


  it("discovers catalog layouts and honors safe subpaths", async () => {
    const workspace = await makeTempWorkspace();
    try {
      const catalogSkill = join(workspace.root, "catalog", "skills", ".curated", "deep-skill");
      await mkdir(catalogSkill, { recursive: true });
      await writeFile(join(catalogSkill, "SKILL.md"), "---\nname: deep-skill\ndescription: Deep skill\n---\n");

      const discovered = await discoverSkillDirectories(join(workspace.root, "catalog"));
      expect(discovered).toEqual([catalogSkill]);
      expect(isSubpathSafe(join(workspace.root, "catalog"), "skills/.curated")).toBe(true);
      expect(isSubpathSafe(join(workspace.root, "catalog"), "../outside")).toBe(false);
    } finally {
      await workspace.cleanup();
    }
  });
  it("imports local skills and persists source metadata", async () => {
    const workspace = await makeTempWorkspace();
    try {
      const config = getDefaultConfig({ homeDir: workspace.home, platform: "darwin" });
      const source = join(import.meta.dirname, "fixtures", "skills", "frontend-design");

      const imported = await importLocalSkills(config, source);
      expect(imported).toHaveLength(1);
      expect(imported[0]?.source?.type).toBe("local");
      expect(imported[0]?.source?.sourceHash).toMatch(/^[a-f0-9]{64}$/);

      const listed = await listRepositorySkills(config);
      expect(listed.map((skill) => skill.id)).toEqual(["frontend-design"]);
      expect(listed[0]?.source?.value).toBe(source);
    } finally {
      await workspace.cleanup();
    }
  });

  it("blocks deleting deployed repository skills", async () => {
    const workspace = await makeTempWorkspace();
    try {
      const config = getDefaultConfig({ homeDir: workspace.home, platform: "darwin" });
      const skillPath = join(config.repositoryPath, "frontend-design");
      await mkdir(skillPath, { recursive: true });
      await writeFile(join(skillPath, "SKILL.md"), "---\nname: frontend-design\n---\n");
      await writeDeploymentRegistry(config.deploymentsPath, {
        version: 1,
        deployments: [
          {
            id: "deployment-1",
            skillId: "frontend-design",
            agentId: "claude-code",
            scope: "global",
            sourcePath: skillPath,
            targetPath: join(workspace.home, ".claude", "skills", "frontend-design"),
            mode: "symlink",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }
        ]
      });

      await expect(deleteRepositorySkill(config, "frontend-design")).rejects.toThrow(
        "Cannot delete deployed skill"
      );
    } finally {
      await workspace.cleanup();
    }
  });


  it("imports from parsed local source with skill filters and source metadata", async () => {
    const workspace = await makeTempWorkspace();
    try {
      const config = getDefaultConfig({ homeDir: workspace.home, platform: "darwin" });
      const sourceRoot = join(import.meta.dirname, "fixtures", "skills");

      const imported = await importFromSource(config, sourceRoot, {
        selectedSkillIds: ["frontend-design"],
        cwd: workspace.root
      });

      expect(imported.map((skill) => skill.id)).toEqual(["frontend-design"]);
      const listed = await listRepositorySkills(config);
      expect(listed[0]?.source?.type).toBe("local");
      expect(listed[0]?.source?.url).toBe(sourceRoot);
    } finally {
      await workspace.cleanup();
    }
  });

  it("builds repository skill views with deployment summaries and filtering", async () => {
    const workspace = await makeTempWorkspace();
    try {
      const config = getDefaultConfig({ homeDir: workspace.home, platform: "darwin" });
      const source = join(import.meta.dirname, "fixtures", "skills", "frontend-design");
      const [skill] = await importLocalSkills(config, source);
      const agent = getAgent(config, "claude-code");
      expect(agent).toBeTruthy();

      await enableSkill(config, skill!, agent!, { kind: "global" }, {
        homeDir: workspace.home,
        mode: "copy",
        platform: process.platform === "win32" ? "win32" : "darwin"
      });
      await writeFile(join(skill!.localPath, "extra.txt"), "changed");

      const views = await listRepositorySkillViews(config, { keyword: "polished" });
      expect(views).toHaveLength(1);
      expect(views[0]?.summary).toContain("outdated copy:");
      expect(views[0]?.deployments[0]?.deployment.agentId).toBe("claude-code");
      expect(views[0]?.deployments[0]?.status).toBe("outdated");
    } finally {
      await workspace.cleanup();
    }
  });

  it("updates repository skills from local source and detects local changes", async () => {
    const workspace = await makeTempWorkspace();
    try {
      const config = getDefaultConfig({ homeDir: workspace.home, platform: "darwin" });
      const source = join(workspace.root, "source-skill");
      await mkdir(source, { recursive: true });
      await writeFile(
        join(source, "SKILL.md"),
        "---\nname: source-skill\ndescription: First version\n---\n\nBody A\n"
      );

      const [imported] = await importLocalSkills(config, source);
      expect(imported?.source?.sourceHash).toBeTruthy();

      await writeFile(
        join(source, "SKILL.md"),
        "---\nname: source-skill\ndescription: Updated version\n---\n\nBody B\n"
      );

      const updated = await updateRepositorySkill(config, "source-skill");
      expect(updated.status).toBe("updated");

      const listed = await listRepositorySkills(config);
      expect(listed[0]?.description).toBe("Updated version");

      const latest = await updateRepositorySkill(config, "source-skill");
      expect(latest.status).toBe("already-latest");

      await writeFile(join(listed[0]!.localPath, "LOCAL.md"), "local changes");
      const checked = await checkRepositorySkillUpdate(config, "source-skill");
      expect(checked.status).toBe("local-changes");

      const skipped = await updateRepositorySkill(config, "source-skill");
      expect(skipped.status).toBe("skipped-local-changes");

      const forced = await updateRepositorySkill(config, "source-skill", { force: true });
      expect(forced.status).toBe("updated");
    } finally {
      await workspace.cleanup();
    }
  });

  it("marks upstream-missing when the source skill disappears", async () => {
    const workspace = await makeTempWorkspace();
    try {
      const config = getDefaultConfig({ homeDir: workspace.home, platform: "darwin" });
      const source = join(workspace.root, "missing-source");
      await mkdir(source, { recursive: true });
      await writeFile(join(source, "SKILL.md"), "---\nname: missing-source\n---\n");

      await importLocalSkills(config, source);
      await writeFile(join(source, "README.md"), "no skill anymore");
      await writeFile(join(source, "SKILL.md.bak"), "moved");

      await rm(join(source, "SKILL.md"), { force: true });

      const result = await updateRepositorySkill(config, "missing-source");
      expect(result.status).toBe("missing-upstream-skill");
    } finally {
      await workspace.cleanup();
    }
  });

  it("checks repository updates in batch and finds update-available skills", async () => {
    const workspace = await makeTempWorkspace();
    try {
      const config = getDefaultConfig({ homeDir: workspace.home, platform: "darwin" });
      const sourceA = join(workspace.root, "skill-a");
      const sourceB = join(workspace.root, "skill-b");
      await mkdir(sourceA, { recursive: true });
      await mkdir(sourceB, { recursive: true });
      await writeFile(join(sourceA, "SKILL.md"), "---\nname: skill-a\ndescription: A\n---\n");
      await writeFile(join(sourceB, "SKILL.md"), "---\nname: skill-b\ndescription: B\n---\n");
      await importLocalSkills(config, sourceA);
      await importLocalSkills(config, sourceB);
      await writeFile(join(sourceA, "SKILL.md"), "---\nname: skill-a\ndescription: A2\n---\n");

      const checked = await checkRepositorySkillUpdates(config);
      expect(checked.find((item) => item.skillId === "skill-a")?.status).toBe("update-available");
      expect(checked.find((item) => item.skillId === "skill-b")?.status).toBe("already-latest");
    } finally {
      await workspace.cleanup();
    }
  });
  it("parses npx skills add commands", () => {
    expect(
      parseNpxSkillsAdd("npx skills add vercel-labs/agent-skills --skill frontend-design -a claude-code -g --copy -y")
    ).toMatchObject({
      source: "vercel-labs/agent-skills",
      skills: ["frontend-design"],
      agents: ["claude-code"],
      global: true,
      copy: true,
      yes: true
    });
  });

  it("parses rich source formats and rejects unsafe subpaths", () => {
    expect(parseSource("vercel-labs/skills#main@frontend-design")).toMatchObject({
      type: "github",
      url: "https://github.com/vercel-labs/skills.git",
      ref: "main",
      skillFilter: "frontend-design"
    });
    expect(parseSource("https://github.com/owner/repo/tree/dev/skills/foo")).toMatchObject({
      type: "github",
      ref: "dev",
      subpath: "skills/foo"
    });
    expect(parseSource("gitlab:group/project")).toMatchObject({
      type: "gitlab",
      url: "https://gitlab.com/group/project.git"
    });
    expect(parseSource("https://example.com/skills")).toMatchObject({
      type: "well-known"
    });
    expect(() => sanitizeSubpath("skills/../../etc")).toThrow("Unsafe subpath");
    expect(() => parseSource("owner/repo/../../etc")).toThrow("Unsafe subpath");
  });
});
