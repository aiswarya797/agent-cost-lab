# Agent Cost Lab

Agent Cost Lab reports local cost-hygiene checks that are useful before and during agent sessions.

## audit

`audit` is a local, one-pass check of repository instruction and workflow files to surface startup-context, output-noise, and verification-hygiene issues.

## Current audit scope

The `audit` command reports local cost-hygiene signals in one compact pass.

| Check | Cost relevance |
| --- | --- |
| Instruction file size/churn (`CLAUDE.md`/`AGENTS.md`, nested) | Large startup context increases prompt overhead. |
| Duplicate/conflicting instructions | Unclear startup guidance can cause extra clarification and retries. |
| Volatile instruction content | Changing guidance makes local sessions less stable and repeatable. |
| Large/risky `@path` references | Referencing large files increases local context and output churn. |
| Missing noisy-path guidance | Noisy artifact paths create extra output and cleanup loops. |
| `.gitignore` + unignored large files | Extra local noise increases scan and review overhead. |
| MCP/tool surface checks | Broader tool surfaces add management and execution overhead. |
| Missing noisy output trimming guidance | Unbounded command output consumes local tokens and slows triage. |
| Missing verification ladder (install/lint/typecheck/unit/full/build) | Weak guardrails increase late-cycle failures and rework. |
| Usage visibility signals | Better visibility reduces repeated debugging cycles. |
| Human/JSON finding consistency | Mixed output formats can cause downstream confusion and extra work. |

## Result model

Human text output, JSON output, and score are all derived from the same findings array; severity order is `high > medium > low > info`.

## Local command examples

```sh
npm install
npm run build
node dist/cli.js audit
node dist/cli.js audit --json
```
