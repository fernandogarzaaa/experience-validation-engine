# Examples

All examples live in `examples/` and run with `npx tsx <file>`. The first
four are fully offline (mock adapter).

| Example | Shows |
|---|---|
| `basic-run.ts` | Complete offline session + all three report formats |
| `custom-persona.ts` | `definePersona()` for a domain-specific user |
| `compare-personas.ts` | Same app, four personas — who does your product fail? |
| `custom-plugin.ts` | A tone-of-voice plugin reporting persona-relative findings |
| `real-browser.ts` | Playwright against a live URL with screenshots |

## CLI recipes

```bash
# Offline demo — watch a curious explorer roam the mock app
eve run mock: --persona curious-explorer --steps 30

# Signup funnel health, reproducibly
eve run https://staging.example.com \
  --persona first-time-user \
  --goal "sign up for an account" --seed 7

# Would an impatient user survive your dashboard?
eve run https://staging.example.com --persona impatient-user --minutes 3

# Accessibility session (keyboard-only operator + a11y plugin findings)
eve run https://staging.example.com --persona accessibility-user

# Watch it live in a real window at human-ish speed
eve run https://staging.example.com --headed --persona elderly-user

# Full config file, LLM critique enabled
eve run --config eve.config.example.yaml --llm-critic
```

## CI gate

```yaml
# .github/workflows/experience.yml (in YOUR product repo)
- run: npx playwright install --with-deps chromium
- run: |
    npx eve run https://staging.example.com \
      --persona first-time-user \
      --goal "sign up for an account" \
      --seed 7 --quiet
  # exit code 1 on critical findings (incl. abandonment) fails the job
- uses: actions/upload-artifact@v4
  with: { name: eve-report, path: .eve-output/ }
```
