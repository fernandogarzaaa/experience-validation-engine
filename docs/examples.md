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
| `learning-across-sessions.ts` | Phase 2: an operator learns an app over 5 sessions (7→5 steps) + learning curve |
| `ai-panel.ts` | Phase 2: design critic + forecast + moderator + PM backlog + dev tickets |
| `behavioral-regression.ts` | Phase 2: catch a UX regression that keeps functional tests green |
| `collaborative-workflow.ts` | Phase 2: multi-operator handoff / approval chain |
| `population-study.ts` | Phase 3: simulate a population of 40 operators → aggregate study + research dataset (JSON/CSV/MD) |
| `moderated-study.ts` | Phase 3: a 6-specialist AI research panel + moderator → an executive report with a ship verdict |
| `product-intelligence.ts` | Phase 3: infer personas, workflows, business goals, feature importance, friction, and drop-off causes |
| `continuous-regression.ts` | Phase 3: trend experience across three builds (bad → average → excellent) and flag regressions |
| `application-map.ts` | Phase 3: autonomously explore an app → screens, navigation graph (Mermaid), IA, hubs, dead-ends |
| `predictive-ux.ts` | Phase 3: predict abandonment / confusion / support / a11y rates with confidence intervals |

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

# --- Phase 2 ---

# Full enhanced cognition + utility decisions + the AI panel
eve run https://staging.example.com --persona first-time-user --cognitive --utility --panel

# A German accountant using the product (profession overlay + locale)
eve run https://staging.example.com --persona office-worker --profession accountant --culture de-DE

# Learn across runs: run this repeatedly and watch steps/time drop
eve run https://staging.example.com --remember .eve-memory.json --seed 1 --goal "sign up"

# Validate the instrument against known-quality apps (CI-friendly exit code)
eve benchmark

# --- Phase 3 ---

# Population usability study: 50 varied operators → aggregate stats + dataset
eve study mock: --size 50 --seed 7 --out .eve-output/study

# ...plus the AI-moderated research panel and a ship verdict
eve study mock: --size 50 --seed 7 --panel

# A population attempting a specific task, mixing professions
eve study https://staging.example.com --goal "sign up" \
  --professions accountant,designer --size 60 --out .eve-output/study

# Discover the profession and culture catalogs
eve professions
eve cultures
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
