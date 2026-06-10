export type DeployMode = "symlink" | "junction" | "copy" | "auto";

export type SkillScope =
  | { kind: "global" }
  | { kind: "project"; projectPath: string };

export type SkillStatus =
  | "managed"
  | "local-only"
  | "broken"
  | "conflict"
  | "outdated"
  | "not-deployed"
  | "unknown";

export interface AgentDefinition {
  id: string;
  displayName: string;
  globalPath: string;
  projectPath: string;
  defaultDeployMode?: DeployMode | "inherit";
  enabled: boolean;
}

export interface Config {
  version: 1;
  configDir: string;
  repositoryPath: string;
  deploymentsPath: string;
  defaultDeployMode: DeployMode;
  agents: AgentDefinition[];
}

export interface SkillManifest {
  id: string;
  directoryName: string;
  name: string;
  description: string;
  localPath: string;
  source?: SkillSource;
  hash?: string;
}

export interface SkillSource {
  type: "local" | "github" | "gitlab" | "git" | "well-known" | "unknown";
  value: string;
  url?: string;
  skill?: string;
  ref?: string;
  subpath?: string;
  importedAt?: string;
}

export interface ParsedSource {
  type: "github" | "gitlab" | "git" | "local" | "well-known";
  url: string;
  localPath?: string;
  ref?: string;
  subpath?: string;
  skillFilter?: string;
}

export interface DeploymentRecord {
  id: string;
  skillId: string;
  agentId: string;
  scope: "global" | "project";
  projectPath?: string;
  sourcePath: string;
  targetPath: string;
  mode: Exclude<DeployMode, "auto">;
  fingerprint?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DeploymentRegistry {
  version: 1;
  deployments: DeploymentRecord[];
}

export interface ScanItem {
  skillId: string;
  name: string;
  status: SkillStatus;
  repositoryPath?: string;
  targetPath?: string;
  deployment?: DeploymentRecord;
  message?: string;
}

export interface DoctorIssue {
  id: string;
  severity: "info" | "warning" | "error";
  type:
    | "missing-config"
    | "missing-repository"
    | "missing-agent-path"
    | "broken-link"
    | "outdated-copy"
    | "conflict";
  message: string;
  path?: string;
  fixable: boolean;
}
