# Agent Cost Lab

Agent Cost Lab reports local cost-hygiene checks that are useful before and during agent sessions.

## audit

`audit` is a local, one-pass check of repository instruction and workflow files to surface startup-context, output-noise, and verification-hygiene issues.

## token-blame

`token-blame` is local spend-driver diagnostics over usage logs. It is a parser-only workflow: no API or telemetry calls are made, and nothing from logs is uploaded.
It is intentionally local/developer-side diagnostics and does not yet link findings to future tool outcomes.

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

npx agent-cost-lab token-blame --input usage.json
npx agent-cost-lab token-blame --input usage.json --json
```

## token-blame local usage examples

```sh
node dist/cli.js token-blame --input usage.json
node dist/cli.js token-blame --input usage.json --json
```
