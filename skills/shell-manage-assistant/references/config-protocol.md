# ShellManage Assistant Reference

## Config Write Protocol

Use this exact order for any write operation:

1. Read current config text.
2. Parse and validate structure:
   - `commands` is array
   - `presets` is array
   - `settings` exists
3. Generate minimal diff proposal and show user what will change.
4. Ask for explicit confirmation before write.
5. Write config.
6. Re-validate structure after write.
7. Report result with:
   - changed command names
   - unchanged sections
   - rollback hint

Optional helper (path relative to the skill root):

```bash
bash scripts/validate-config-structure.sh --json /path/to/config.yaml
```

`--json` can be placed before or after the config path.

## Command Field Rules

Each new command must follow:

- `name`: unique, short, no duplicate with existing command names
- `command`: full one-line shell command, with `cd <abs-path> && ...`
- `tags`: non-empty array (for example: `[前端]`, `[后端]`, `[运维]`)
- `mode`: default `service`, use `terminal` for interactive sessions (ssh, mysql, tail -f)
- `sshKeyId`: optional, only for SSH command entries
- `webUrl`: optional, for stable local dev URLs

## Safe Validation Gates

- Never write unverified startup commands.
- Use short-running probes for long-running services.
- Skip full test suites during onboarding validation.

## High-Risk Change Confirmation

Always require explicit second confirmation for:

- Overwriting a same-name command
- Deleting commands
- Editing `settings` object

## Structured Response Template

Do not redefine fields here. Always use `references/runtime-protocols.md` as the single response template source (`阶段` / `write_status` / `下一步` / `成功判定` / `回滚`).
