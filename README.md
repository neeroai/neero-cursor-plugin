# neero-cursor-plugin

Marketplace with one plugin, `neero`, for Cursor and Codex.

| Tool | Install | Manifest it reads |
| ---- | ------- | ----------------- |
| Cursor | **Customize** → **From GitHub Repository** → this repo's URL | `neero/.cursor-plugin/plugin.json` → `mcp.json` (`${CURSOR_PLUGIN_ROOT}`) |
| Codex | `codex plugin marketplace add neeroai/neero-cursor-plugin` + `codex plugin add neero@neero` | `neero/.codex-plugin/plugin.json` → `codex-mcp.json` |

Two MCP files because the root variable differs: Cursor expands `${CURSOR_PLUGIN_ROOT}`, Codex
does not; Codex resolves `cwd: "."` to the plugin root and ships its own node in
`$CODEX_MCP_NODE_PATH` (same pattern as its bundled `code-review` plugin). Codex checks
`.codex-plugin/` before `.cursor-plugin/`. `tool_timeout_sec: 660` outlives the form's 10-min wait.
Codex does not read `rules/`; its equivalent of `ask.mdc` lives in `~/.codex/AGENTS.md`.

| Component | Path | What |
| --------- | ---- | ---- |
| MCP server `cursor-ask` | `neero/mcp.json` → `neero/dist/cursor-ask.mjs` | Tool `ask_questions`: multi-choice form via MCP elicitation. Fallback for the native `AskQuestion`, which is missing in Auto, Grok and Cloud (`Tool not found`) |
| Rule `ask.mdc` | `neero/rules/` | `alwaysApply`. Maps `AskUserQuestion` (Claude Code only) → `AskQuestion` → `ask_questions` → short prose. Covers every skill Cursor loads from `~/.claude/skills` and `~/.agents/skills` without editing them |

## Why the server is bundled and committed

Cursor copies plugins into `~/.cursor/plugins/cache` and runs no `npm install` (none of the
installed plugins carries `node_modules`). A `tsc` build keeps bare imports of
`@modelcontextprotocol/sdk` and `zod`, which die with `ERR_MODULE_NOT_FOUND` without
`node_modules`. `bun build` inlines them: `dist/cursor-ask.mjs` needs only `node`.

`.mjs` on purpose: there is no `package.json` with `"type": "module"` next to it inside the plugin.

## Change the server

```bash
npm ci
npm run typecheck
npm run build      # rewrites neero/dist/cursor-ask.mjs — commit it
npm run smoke      # handshake must answer serverInfo cursor-ask
```

Bump `version` in `neero/.cursor-plugin/plugin.json`, push, then **Refresh** the marketplace in
Customize.

## `ask_questions` contract

`title?` · `questions[1-4]`: `id`, `prompt`, `options[2-6]` `{ id, label }`, `recommendedId?`.
A free-text `notes` field is always added (the picker's "Other"). Blocks up to 10 min. A client
without elicitation gets `isError: true` telling the agent to fall back to prose; it does not hang.

Permissions: `~/.cursor/permissions.json` → `mcpAllowlist` has `*cursor-ask:*`. The leading
wildcard matters: the agent sees a prefixed id, not the literal key.
