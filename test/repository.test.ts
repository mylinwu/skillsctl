import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getDefaultConfig, writeDeploymentRegistry } from "../src/core/config.js";
import { deleteRepositorySkill, importFromSource, importLocalSkills, listRepositorySkills } from "../src/core/repository.js";
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
