# Agent Cost Lab

Agent Cost Lab reports local cost-hygiene checks that are useful before and during agent sessions.

## Goals

- Focus on local signals in the repository and optional user-level settings.
- Keep behavior deterministic and deterministic only.
- Keep local-only operation: no network calls, no telemetry, no API calls, no remote lookups.

## Current audit scope

The `audit` command reports:

- Instruction file bloat and churn risk for `CLAUDE.md` / `AGENTS.md` (including nested copies).
- Duplicate or conflicting instructions and mixed package-management/test guidance.
- Volatile instruction content that can make startup context unstable.
- Large or risky `@path` references from instruction files.
- Missing guidance for noisy/generated paths.
- `.gitignore` and unignored large-file coverage for noisy repository artifacts.
- MCP/tool surface size and explicit allowlist coverage.
- Missing output-trimming strategy for noisy commands.
- Missing targeted verification ladder in documentation for install/lint/typecheck/unit/full test/build.
- Usage and cost visibility signals.
- Stability of local findings so human and JSON output remain aligned.

## Result model

Text and JSON use the same finding array.

- `score` is computed from the same findings that are printed in output.
- The same findings drive both `--json` and human text output.
- Severity order is `high > medium > low > info`.

## Local command examples

```sh
npm install
npm run build
node dist/cli.js audit
node dist/cli.js audit --path tests/fixtures/sample-repo
node dist/cli.js audit --json
node dist/cli.js audit --path tests/fixtures/sample-repo --json
```

## Reporting philosophy

- The tool is not an exact token-counter.
- It does not estimate exact savings.
- It is not an ROI dashboard.
- It does not claim precision it cannot reliably verify.
- It reports local cost-hygiene patterns only.
- It does not print full configs, secrets, env values, keys, or command arguments that may contain credentials.
