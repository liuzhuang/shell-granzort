# Runtime Profiles

## Cursor IDE Profile

- Prefer file-aware operations and explicit file paths.
- For config changes:
  - show proposed diff summary first
  - request confirmation
  - then write and re-check
- If user asks conceptual questions only, avoid write actions.

## CC Profile

- Keep responses terminal-friendly and concise.
- Prefer copy-ready command blocks for install and diagnostics.
- If filesystem context is missing, ask for:
  - project absolute path
  - config file path
- For config updates, clearly mark:
  - "planned change" before write
  - "applied change" after write

## Shared Minimum Capability Contract

Both runtimes must provide:

1. Next executable step
2. Success criteria
3. Rollback option
4. Explicit write status (`not written` or `written`)
