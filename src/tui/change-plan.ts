import type { ScanItem } from "../core/types.js";

export interface AgentTogglePlan {
  toEnable: ScanItem[];
  toDisable: ScanItem[];
}

export function planAgentToggleChanges(items: ScanItem[], selectedSkillIds: string[]): AgentTogglePlan {
  const selected = new Set(selectedSkillIds);
  const manageable = items.filter((item) => ["managed", "outdated", "not-deployed", "broken"].includes(item.status));
  const initiallyEnabled = new Set(
    manageable
      .filter((item) => item.status === "managed" || item.status === "outdated")
      .map((item) => item.skillId)
  );

  return {
    toEnable: manageable.filter((item) => selected.has(item.skillId) && !initiallyEnabled.has(item.skillId)),
    toDisable: manageable.filter(
      (item) => !selected.has(item.skillId) && initiallyEnabled.has(item.skillId) && Boolean(item.deployment)
    )
  };
}
