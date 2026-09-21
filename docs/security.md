# Security & Operational Safety

EVE drives real browsers, spawns MCP server processes, and writes report
files. All of these are **user-authorized operations** — none is safe to run
against untrusted inputs merely because the evaluator itself is well-behaved.
This document states the trust boundaries and what EVE enforces vs. what the
deployment must provide.

## Browser execution

EVE navigates arbitrary URLs in Playwright/Puppeteer/Selenium. At the EVE
layer:

- `SessionOptions.allowedHosts` restricts http(s) navigation to listed
  domains **and their subdomains** (`example.com` covers
  `app.example.com`, never `example.com.evil.com` — the match requires a
  dot boundary or full equality). Enforced on the start URL (before any
  browser opens) and every cognition-chosen `navigate`. Non-http(s) targets
  (`mock:`, `about:`) are offline fixtures, not network navigation, and
  pass. Omit it (default) and navigation is unrestricted — suitable for
  local/dev targets only.
- Every adapter uses an isolated browser instance per session and closes it in
  a `finally` (a crash never leaks the browser process).
- Native dialogs are record-then-dismiss by default
  (`nativeDialogAction: "dismiss"`); opt into `"accept"` only for flows whose
  task explicitly requires acceptance.

Not provided by EVE (deployment concerns — use containers for untrusted apps):

- network egress allowlists, download restrictions, filesystem restrictions,
  CPU/memory/time quotas. Run untrusted targets containerized with egress
  control; treat EVE's browser the way you would any automated browsing.

## MCP stdio execution

`connectMcpServer(target)` spawns a LOCAL PROCESS with the caller's
environment for non-HTTP targets — **execute-with-user-authorized-code
semantics**. Only connect to commands the operator explicitly authorized
(config file, CLI flag). Tokenization never uses a shell; stderr is inherited
so server diagnostics stay distinguishable from protocol traffic; callers own
timeouts and `close()` cleanup. Evaluating an untrusted MCP server means
executing its code — sandbox that accordingly.

`eve-mcp` (the server EVE itself exposes) only runs the tools the operator
invokes; it does not itself spawn arbitrary commands.

## File output

- Report writers (`reporting/writeReports`) use FIXED filenames
  (`report.html/md/json`) joined under a traversal-checked output dir
  (`safeJoin`) — page content (URLs, titles) never becomes a path segment, so
  traversal via application content is impossible.
- `FileMemoryStore` persists atomically (tmp-file + rename): a crash during
  persistence cannot corrupt the store. Writes through one instance are
  mutex-serialized; CROSS-PROCESS concurrent writers are last-writer-wins at
  document granularity — use SQLite/a database for multi-process population
  runs.
- No uncontrolled output growth guards: long sessions with screenshots can
  produce large galleries — cap `maxSteps`/screenshot capture in CI.
