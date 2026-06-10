import { planAgentToggleChanges } from "../src/tui/change-plan.js";
import type { ScanItem } from "../src/core/types.js";

describe("TUI change planning", () => {
  it("builds enable/disable changes from scan state and selected ids", () => {
    const items: ScanItem[] = [
      {
        skillId: "enabled-skill",
        name: "enabled-skill",
        status: "managed",
        deployment: {
          id: "deployment-1",
          skillId: "enabled-skill",
          agentId: "claude-code",
          scope: "global",
          sourcePath: "/repo/enabled-skill",
          targetPath: "/target/enabled-skill",
          mode: "symlink",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z"
        }
      },
      {
        skillId: "new-skill",
        name: "new-skill",
        status: "not-deployed"
      },
      {
        skillId: "local-only",
        name: "local-only",
        status: "local-only"
      }
    ];

    const plan = planAgentToggleChanges(items, ["new-skill"]);

    expect(plan.toEnable.map((item) => item.skillId)).toEqual(["new-skill"]);
    expect(plan.toDisable.map((item) => item.skillId)).toEqual(["enabled-skill"]);
  });
});
