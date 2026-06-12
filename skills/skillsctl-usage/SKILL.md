---
name: skillsctl-usage
description: Use when users need to manage agent skills via the skillsctl CLI - installing, listing, enabling, disabling, or diagnosing skills across multiple AI agents like Claude Code, Codex, Cursor, and others
---

# Skillsctl Usage Guide

## Overview

skillsctl is a CLI tool for managing AI agent skills across multiple agents (Claude Code, Codex, Cursor, Qoder, OpenCode, Warp, Goose, Windsurf, Zed, Qwen Code, Cline, Roo Code). It provides a centralized repository for skills with deployment to agent directories via symlink, junction, or copy.

## When to Use

- User wants to install skills from local paths or Git repositories
- User needs to enable/disable skills for specific agents
- User wants to list available skills or diagnose agent setups
- User asks about managing skills across multiple AI coding agents

## Quick Reference

| Command | Purpose | Example |
|---------|---------|---------|
| `skillsctl init` | Initialize configuration | `skillsctl init --mode junction` |
| `skillsctl repo list` | List all skills in repository | `skillsctl repo list` |
| `skillsctl import <source>` | Import skills from path or Git | `skillsctl import owner/repo` |
| `skillsctl enable <skill>` | Deploy skill to agent | `skillsctl enable my-skill --agent claude --global` |
| `skillsctl disable <skill>` | Remove skill from agent | `skillsctl disable my-skill --agent claude --global` |
| `skillsctl app list` | List configured agents | `skillsctl app list` |
| `skillsctl doctor` | Diagnose issues | `skillsctl doctor` |
| `skillsctl config` | Show current config | `skillsctl config` |

## Core Workflows

### 1. First-Time Setup

```bash
# Initialize with default settings
skillsctl init

# Initialize with specific options
skillsctl init --repository ~/my-skills --mode junction --agents claude,codex
```

### 2. Import Skills

```bash
# Import from local directory
skillsctl import /path/to/skills

# Import from GitHub shorthand
skillsctl import owner/repo

# Import from GitHub with prefix
skillsctl import github:owner/repo

# Import from Git URL (GitHub, GitLab, or generic)
skillsctl import https://github.com/owner/repo.git
skillsctl import https://gitlab.com/owner/repo.git

# Import from GitLab with prefix
skillsctl import gitlab:owner/repo

# Import specific branch or tag
skillsctl import owner/repo#v1.0
skillsctl import owner/repo#main

# Import specific skill from a specific branch
skillsctl import owner/repo#main@skill-name

# Import specific skill from source
skillsctl import owner/repo --skill specific-skill-id

# Import from subpath within a repository
skillsctl import owner/repo/subpath
```

### 3. Enable/Disable Skills

```bash
# Enable skill globally for an agent
skillsctl enable skill-name --agent claude --global

# Enable skill for a specific project
skillsctl enable skill-name --agent codex --project /path/to/project

# Disable skill
skillsctl disable skill-name --agent claude --global
```

### 4. Diagnose Issues

```bash
# Run quick diagnosis
skillsctl doctor
```

## Agent IDs

| Agent | ID | Global Path | Project Path |
|-------|-----|-------------|--------------|
| Universal | `universal` | `~/.agents/skills/` | `<project>/.agents/skills/` |
| Claude Code | `claude` | `~/.claude/skills/` | `<project>/.claude/skills/` |
| Codex | `codex` | `~/.codex/skills/` | `<project>/.codex/skills/` |
| Cursor | `cursor` | `~/.cursor/skills/` | `<project>/.cursor/skills/` |
| Qoder | `qoder` | `~/.qoder/skills/` | `<project>/.qoder/skills/` |
| OpenCode | `opencode` | `~/.opencode/skills/` | `<project>/.opencode/skills/` |
| Warp | `warp` | `~/.warp/skills/` | `<project>/.warp/skills/` |
| Goose | `goose` | `~/.goose/skills/` | `<project>/.goose/skills/` |
| Windsurf | `windsurf` | `~/.windsurf/skills/` | `<project>/.windsurf/skills/` |
| Zed | `zed` | `~/.zed/skills/` | `<project>/.zed/skills/` |
| Qwen Code | `qwen` | `~/.qwen/skills/` | `<project>/.qwen/skills/` |
| Cline | `cline` | `~/.cline/skills/` | `<project>/.cline/skills/` |
| Roo Code | `roo` | `~/.roo/skills/` | `<project>/.roo/skills/` |

## Deploy Modes

| Mode | Description | Use Case |
|------|-------------|----------|
| `symlink` | Symbolic link (default on Unix) | Best for development, reflects changes immediately |
| `junction` | Directory junction (default on Windows) | Windows without admin privileges |
| `copy` | Copy files | When symlinks not supported, creates independent copies |
| `auto` | Choose best mode automatically | Recommended for most users |

## Common Mistakes

### Missing Required Flags

```bash
# ❌ Missing --agent flag
skillsctl enable my-skill --global

# ✅ Correct
skillsctl enable my-skill --agent claude --global
```

### Missing Scope

```bash
# ❌ Missing scope
skillsctl enable my-skill --agent claude

# ✅ Correct
skillsctl enable my-skill --agent claude --global
skillsctl enable my-skill --agent claude --project ./my-project
```

### Unknown Agent ID

```bash
# ❌ Invalid agent ID
skillsctl enable my-skill --agent invalid-agent --global

# ✅ Check available agents first
skillsctl app list
skillsctl enable my-skill --agent claude --global
```

## Configuration Files

- Config: `~/.skillsctl/config.json`
- Repository: `~/.skillsctl/repository/`
- Deployments: `~/.skillsctl/deployments.json`
- Logs: `~/.skillsctl/logs/`

## TUI Mode

Running `skillsctl` without arguments opens the interactive TUI:

```bash
skillsctl
```

TUI provides:

- Repository skill management with filtering
- Agent deployment management with batch operations
- System diagnostics
- Configuration settings

## Real-World Impact

- **Centralized management**: One repository for skills across all agents
- **Safe deployment**: Validates before overwriting existing non-managed files
- **Cross-platform**: Works on Windows, macOS, and Linux
- **Conflict detection**: Warns when repository skills conflict with local agent skills
