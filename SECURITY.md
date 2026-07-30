# Security policy

## Reporting a vulnerability

Report privately through
[GitHub security advisories](https://github.com/fernandogarzaaa/experience-validation-engine/security/advisories/new).
Please do not open a public issue for a vulnerability.

Include what you would need to reproduce it yourself: version, adapter, and
a minimal case. You should get an initial response within a week.

## Supported versions

The latest published minor release receives security fixes. EVE is pre-1.0,
so older minors are not patched — upgrade first, then report if the issue
persists.

## Scope notes

A few things about EVE's design are worth knowing before reporting:

- **EVE drives a real browser against whatever URL you point it at.** It is
  a testing tool, and it executes the target application's JavaScript in a
  normal browser context. Point it at applications you trust, or run it in
  the container image where that context is isolated.
- **The perception script runs inside the target page.** It reads rendered
  content and returns it. Treat any application EVE inspects as capable of
  influencing what appears in a report.
- **Reports can contain whatever was on screen.** If a persona types into a
  form, or the app displays real data, it lands in `report.md`, the JSON
  output, and any captured screenshots. Do not publish reports from runs
  against production data without reading them first.
- **The MCP server speaks stdio and executes locally.** It exposes EVE's
  capabilities — including navigating to URLs — to whatever agent it is
  wired into. Configure it the way you would any local tool server.

## Automated scanning

CI runs CodeQL on every push and pull request plus weekly, and fails the
build on high or critical advisories in production dependencies. Dev-tooling
advisories are reported without blocking, since they gate on upstream
release schedules and do not ship to users. Dependabot opens weekly
dependency PRs.
