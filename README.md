# Agent Cost Lab

Agent Cost Lab reports local cost-hygiene signals for projects that use agentic tooling, prompts, evals, or token-heavy workflows.

It is intentionally modest: the audit command does not calculate exact wasted tokens, does not estimate exact savings, and is not an ROI dashboard. It points out local conditions that can make agent work harder to review or easier to misconfigure.

The tool makes no network calls, sends no telemetry, performs no API calls, and does not do remote lookups.

## Install

```sh
npm install
npm run build
```

## Audit

```sh
node dist/cli.js audit
node dist/cli.js audit --path tests/fixtures/sample-repo
node dist/cli.js audit --json
node dist/cli.js audit --path tests/fixtures/sample-repo --json
```

Text and JSON output are produced from the same findings array. The score is also derived from that same returned findings array.

Displayed report paths are relative to the current working directory when possible. Paths used inside findings stay project-relative, such as `.env` or `package.json`.

The score is a simple cost-hygiene signal, not a savings estimate. `high`, `medium`, and `low` findings reduce the score; `info` findings are shown for context and do not reduce the score.

When `--path` is provided, the audit checks only the requested project path. Running without `--path` may also include clearly labeled user-home checks, such as detecting that `~/.claude/settings.json` exists. Home checks never print secrets or full configuration contents.
