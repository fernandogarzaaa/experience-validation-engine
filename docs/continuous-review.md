# Continuous review

Every pull request gets an automated code review, run by this repository's
own CI rather than by a third-party bot.

## Why this exists

The conversational adapter ([#30](https://github.com/fernandogarzaaa/experience-validation-engine/pull/30))
was a 3,500-line change that reached "all checks green" with **no external
review at all**:

- **Codex** had exhausted its usage limits for code reviews.
- **CodeRabbit** does not auto-review repositories with fewer than ten stars.

A review run by hand afterwards found seven real bugs. Two of them made EVE
report the opposite of the truth:

- Goal-success signals were matched against *all* visible text, and half a
  chat window is the operator's own typing — so a person asking about a
  refund satisfied the signal `refund`, and a bot that never helped was
  reported as `goal-achieved`.
- The `conversation.recovery` score read `admittedMisses > 0 ? 0.2 : 0.4`,
  scoring a bot that says "sorry, I didn't follow that" *below* one that
  bluffs — backwards from the entire premise of the dimension.

Green CI said nothing about either. Both would have shipped.

The lesson is not "run more bots". It is that review coverage which depends
on someone else's quota, pricing tier or star count is not coverage. This
job runs on the repository's own credentials, on every pull request.

## What it does

`.github/workflows/claude-code-review.yml` runs the `code-review` skill on
each pull request — when it is opened, updated, reopened, or marked ready
for review — and posts findings on the PR: inline where the problem is, or a
single summary comment when there is nothing to say.

It reviews the same way a careful reviewer would: correctness bugs first,
then reuse, simplification and efficiency.

## What it deliberately is not

**A merge gate.** The job carries `continue-on-error: true`, so a missing
secret, a rate limit or an API outage can never block a merge. This mirrors
the advisory step in the audit job: a check that cannot run should cost
nothing, while a check that runs should be read.

If you later want it to gate, remove `continue-on-error` — but understand
what you are buying. A review that blocks merges on an outage trains people
to bypass it, and a bypassed review is worth less than an advisory one.

**A substitute for reading the diff.** It found seven bugs on #30; it also
does not know what the change was *for*. Two reviewers with different blind
spots beat either alone.

## Setup

Two steps, both requiring repository admin, and neither performable from a
pull request:

1. Install the [Claude GitHub App](https://github.com/apps/claude) on the
   repository.
2. Add an authentication secret:
   - `ANTHROPIC_API_KEY` — a key from the [Claude Console](https://platform.claude.com), or
   - `CLAUDE_CODE_OAUTH_TOKEN` — from `claude setup-token`, which bills a
     Pro/Max/Team subscription instead of the API.

   The workflow passes `anthropic_api_key` by default. For a subscription
   token, change that line to
   `claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}`.

Until the secret exists the job runs, fails, and is ignored — by design, so
adding the workflow never turns anyone's CI red.

## Cost

Each run consumes GitHub Actions minutes and either API tokens or
subscription usage, in proportion to the size of the diff. Two controls are
already in place: `concurrency` cancels the review of a superseded head
rather than reviewing code that no longer exists, and `timeout-minutes: 20`
bounds a runaway run. Drafts are skipped.

## Alternative

Anthropic also offers [Code Review](https://code.claude.com/docs/en/code-review),
which reviews every pull request with no workflow file to maintain. It is
the lower-effort option; this workflow is the one that lives in version
control, where its prompt, triggers and model are reviewable like any other
code.
