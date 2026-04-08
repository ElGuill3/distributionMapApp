# Skill Registry — distributionMapApp

**Generated**: 2026-04-07
**Mode**: engram (no openspec/)

---

## Project Skills

No custom project-level skills detected.

---

## User-Level Skills (from `~/.config/opencode/skills/`)

| Skill | Status | Trigger |
|-------|--------|---------|
| `branch-pr` | ✅ Available | PR creation workflow |
| `go-testing` | ✅ Available | Go tests, Bubbletea TUI |
| `issue-creation` | ✅ Available | GitHub issue creation |
| `judgment-day` | ✅ Available | Parallel adversarial review |
| `sdd-apply` | ✅ Available | Implement SDD tasks |
| `sdd-archive` | ✅ Available | Archive completed changes |
| `sdd-design` | ✅ Available | Technical design documents |
| `sdd-explore` | ✅ Available | Investigate ideas/features |
| `sdd-init` | ✅ Available | Initialize SDD context |
| `sdd-onboard` | ✅ Available | Guided SDD walkthrough |
| `sdd-propose` | ✅ Available | Create change proposals |
| `sdd-spec` | ✅ Available | Write specifications |
| `sdd-tasks` | ✅ Available | Break down into tasks |
| `sdd-verify` | ✅ Available | Validate implementation |
| `skill-creator` | ✅ Available | Create new skills |
| `skill-registry` | ✅ Available | Update skill registry |

**Skipped**: `_shared` (internal), `sdd-*` (SDD framework skills)

---

## Auto-Load Rules

| Context Detected | Skill to Load |
|------------------|---------------|
| Go tests, Bubbletea TUI | `go-testing` |
| Creating new AI skills | `skill-creator` |
| SDD phases (init, explore, propose, spec, design, tasks, apply, verify, archive) | Corresponding `sdd-*` skill |

---

## Project Conventions

- **Agent config**: `~/.config/opencode/AGENTS.md` (user-level)
- **Language**: Spanish (project), Rioplatense (agent personality)
- **Testing**: pytest with Arrange→Act→Assert pattern
- **Python style**: absolute imports, Google-style docstrings, Spanish error messages
- **TypeScript**: strict mode, ES modules, node10 resolution

---

*Regenerate with*: `skill-registry` or `update skills`