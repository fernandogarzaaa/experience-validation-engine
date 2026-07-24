# Using EVE inside your AI assistant

EVE ships an **MCP server** (`eve-mcp`) so you can drive it from any
AI platform that speaks the [Model Context Protocol](https://modelcontextprotocol.io):
Claude Desktop, Claude Code, OpenAI Codex, Cursor, Windsurf, VS Code Copilot,
and more. One server, every client.

Once connected, your assistant gains six tools:

| Tool | What it does |
|---|---|
| `eve_run_session` | Simulate a persona using a web app; returns a scored, evidence-backed experience report |
| `eve_run_usability_study` | Simulate a **population** of varied operators; returns aggregate stats, segments, heatmap, and a research dataset |
| `eve_run_user_study` | Population **+ an AI research panel** (6 specialists + moderator); returns an executive report with a ship verdict |
| `eve_product_report` | Infer **product intelligence** — personas, business goals, critical workflows, feature importance, friction, drop-off causes |
| `eve_compare_builds` | Trend experience across a series of **builds**; flags improvements and regressions per metric |
| `eve_application_map` | Autonomously explore a URL → an **application map** (screens, nav graph, IA, hubs, dead-ends) |
| `eve_predict_ux` | Predict abandonment / confusion / support / a11y rates with **confidence intervals** |
| `eve_twin_session` | Run a session as a persistent, evolving **digital twin** (created on first use, loaded thereafter) |
| `eve_calibrate` | Score EVE's **realism** against anonymized human traces (similarity + correlations) |
| `eve_multimodal_scan` | Perceive **visual cues** (icons, charts, loading, toasts) and flag unlabeled visuals |
| `eve_list_personas` | List the built-in personas |
| `eve_list_professions` | List professional overlays (doctor, accountant, …) |
| `eve_list_cultures` | List cultural profiles / locales |
| `eve_benchmark` | Validate EVE against known-quality reference apps (offline) |
| `eve_get_report` | Read a full written report back |

Try it with no setup: ask your assistant to *"run an EVE session against `mock:`
as a first-time user"* — `mock:` is EVE's built-in offline demo app and needs
no browser.

## The command

Every client below runs the same server. Two ways to launch it:

- **Published (recommended)** — no clone, no build:
  ```
  npx -y experience-validation-engine eve-mcp
  ```
- **From a local checkout** — after `npm install && npm run build` in this repo:
  ```
  node /absolute/path/to/experience-validation-engine/bin/eve-mcp.js
  ```

Real URLs need a browser backend once (`npx playwright install chromium`).
The `mock:` app needs nothing.

---

## Claude Code

**Quickest — the CLI:**
```bash
claude mcp add eve -- npx -y experience-validation-engine eve-mcp
```

**Or as an installable plugin** (also bundles the `/eve` skill). This repo is a
plugin marketplace:
```
/plugin marketplace add fernandogarzaaa/experience-validation-engine
/plugin install eve
```

**Or project-scoped** — this repo already contains a committed
[`.mcp.json`](../.mcp.json); open the repo in Claude Code and approve the
`eve` server. For your own project, add an `.mcp.json` with the published
command above.

## Claude Desktop

Edit `claude_desktop_config.json` (Settings → Developer → Edit Config):
```json
{
  "mcpServers": {
    "eve": {
      "command": "npx",
      "args": ["-y", "experience-validation-engine", "eve-mcp"]
    }
  }
}
```
Restart Claude Desktop; EVE's tools appear in the tools menu.

## OpenAI Codex

Add to `~/.codex/config.toml`:
```toml
[mcp_servers.eve]
command = "npx"
args = ["-y", "experience-validation-engine", "eve-mcp"]
```

## Cursor

Create `.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (global):
```json
{
  "mcpServers": {
    "eve": {
      "command": "npx",
      "args": ["-y", "experience-validation-engine", "eve-mcp"]
    }
  }
}
```

## Windsurf

Edit `~/.codeium/windsurf/mcp_config.json`:
```json
{
  "mcpServers": {
    "eve": {
      "command": "npx",
      "args": ["-y", "experience-validation-engine", "eve-mcp"]
    }
  }
}
```

## VS Code (Copilot / agent mode)

Create `.vscode/mcp.json`:
```json
{
  "servers": {
    "eve": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "experience-validation-engine", "eve-mcp"]
    }
  }
}
```

## Any other MCP client

Point it at a **stdio** server with command `npx` and args
`["-y", "experience-validation-engine", "eve-mcp"]` (or the local
`node …/bin/eve-mcp.js`). Set `EVE_MCP_DEBUG=1` in the server's environment to
send progress logs to stderr.

---

## Notes

- **Transport:** stdio only — the client launches EVE as a subprocess. Nothing
  is written to stdout except the MCP protocol; diagnostics go to stderr.
- **Reproducibility:** always pass a `seed` to `eve_run_session` so reruns are
  comparable.
- **Offline first:** `eve_run_session` with `url: "mock:"` and `eve_benchmark`
  run with no browser and no network — ideal for a first demo or CI.
- **Reports:** `eve_run_session` writes `report.html` / `report.md` /
  `report.json` to its `output_dir`; `eve_get_report` reads them back.
- **Embedding:** the server is also importable — `import { createServer } from
  "experience-validation-engine/mcp"` — to mount alongside your own tools.
