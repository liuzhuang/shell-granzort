# Knowledge Root Resolution

Skill behavior and product knowledge both live in `skills/shell-manage-assistant/`.

## Resolution Order

Apply in order; stop at the first match:

1. **Skill-local references** — `<skill-root>/references/distribution-manifest.yaml`

## Helper Script

Path is relative to the skill root (the directory containing `SKILL.md`):

```bash
bash scripts/resolve-knowledge-root.sh --json
```

Verify install integrity (fails if any required file is missing):

```bash
bash scripts/resolve-knowledge-root.sh --verify --json
```

Exit codes: `0` = found (and complete under `--verify`), `1` = not found or missing files, `2` = usage error.

Requires `bash` and `ruby` (both preinstalled on macOS).

## Required Files Under Knowledge Root

| File | Location |
|------|----------|
| `distribution-manifest.yaml` | `references/distribution-manifest.yaml` |
| `install-and-upgrade.md` | `references/install-and-upgrade.md` |
| `config-schema.md` | `references/config-schema.md` |
| `config-workflow.md` | `references/config-workflow.md` |
| `command-recipes.md` | `references/command-recipes.md` |
| `troubleshooting.md` | `references/troubleshooting.md` |
| `runtime-protocols.md` | `references/runtime-protocols.md` |
| `acceptance-cases.md` | `references/acceptance-cases.md` |
| `talk-track.md` | `references/talk-track.md` |
