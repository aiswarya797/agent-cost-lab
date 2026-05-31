# Agent Cost Lab

Agent Cost Lab reports local cost-hygiene checks that are useful before and during agent sessions.

## Goals

- Focus on local signals in the repository and optional user-level settings.
- Keep behavior deterministic and deterministic only.
- Keep local-only operation: no network calls, no telemetry, no API calls, no remote lookups.

## What this command does for new projects

`audit` is a day-one sanity pass for agent workflows: it inspects repository-local instruction and workflow files to catch avoidable context bloat, noisy output patterns, and weak verification guidance before an agent session begins, without changing your code or requiring any network/remote access.

## Current audit scope

The `audit` command reports local cost-hygiene signals across these areas.

| Audit area | What it checks | Cost relevance | Cost mechanism mapping | Typical signal/action |
| --- | --- | --- | --- | --- |
| Instruction file size | Scans `CLAUDE.md` and `AGENTS.md` files (including nested ones) for large/long-running instructions. | Large startup context can increase prompt load and reduce token efficiency in each agent session. | `startup context`, `instruction stability` | Keep instruction docs concise; split by workflow and avoid duplicated startup chatter. |
| Duplicate / conflicting instructions | Detects repeated headings, near-duplicate lines, mixed package-manager directives, and conflicting test guidance. | Conflicting instruction order can cause extra clarification turns and avoidable retries. | `instruction stability`, `startup context` | Consolidate to one canonical path per setup/test flow. |
| Volatile instruction content | Flags dynamic or unstable lines (timestamps, branch/commit chatter, ephemeral status text). | Volatile startup context makes sessions less reproducible and can push repeated reseeds. | `instruction stability` | Prefer stable, evergreen project guidance and keep volatile status out of instruction files. |
| Large / important `@path` references | Checks for large referenced files and noisy-file references from instruction text. | Pulling large refs can expand local context and increase tool output processing. | `tool_output`, `cache_miss` | Point to stable, lean references and document only the files truly needed at startup. |
| Noisy-path guidance | Verifies guidance exists for common generated/noisy directories and build artifacts. | Missing guidance leads to noisy command output and recurring cleanup/recheck loops. | `tool_output`, `local verification discipline` | Add explicit guidance for handling noisy paths and generated artifacts. |
| `.gitignore` / unignored large files | Tracks noisy directories and large files that are present but not ignored locally. | Unignored generated noise increases scan and review overhead in local workflows. | `tool_output`, `cache_miss` | Keep `.gitignore` aligned with local generated artifacts and large temporary files. |
| MCP/tool surface checks | Audits MCP server surface and related project-level tool inputs. | Large tool surfaces increase cognitive overhead and risk of unneeded agent runtime work. | `tool surface` | Review MCP/tool surface and keep server/tool configuration intentional. |
| Output-trimming guidance | Looks for missing output-noise control on common commands. | Untrimmed command output adds avoidable token overhead and can hide useful signal. | `tool_output` | Add output limits and focused output modes in instruction guidance. |
| Verification ladder | Checks instruction coverage for install, lint, typecheck, unit test, full test, and build steps. | Missing checkpoints weakens local verification discipline and can push late-cycle failures. | `local verification discipline`, `startup context` | Document a practical verification ladder and keep it in sync with scripts. |
| Usage visibility | Detects local visibility patterns for recent usage, command counts, and reportable workflow clues. | Better visibility supports quicker diagnosis and reduces repeated work in the same session. | `usage visibility`, `instruction stability` | Improve local command/task visibility and keep audit artifacts understandable. |
| Findings consistency between outputs | Ensures human text and JSON outputs are driven by the same findings set. | Prevents interpretation mismatches that waste downstream troubleshooting effort. | `workflow consistency` | Use text output for readout and JSON for tooling with the same input data set. |

## Result model

Text and JSON use the same finding array.

- `score` is computed from the same findings that are printed in output.
- The same findings drive both `--json` and human text output.
- Severity order is `high > medium > low > info`.

### How to read cost impact

- Use the findings list as a cost-hygiene checklist, not a billing meter.
- Focus first on high-severity items that clearly block predictable startup context, noisy output, or verification flow.
- Medium and low items are signals for future cleanup where you choose the right tradeoff for the project.

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

- The tool is local-only: no network calls, telemetry, API calls, or remote lookups.
- It is not an exact token-counter and does not estimate exact savings.
- It is not an ROI dashboard.
- It reports local cost-hygiene patterns only.
- It does not claim precision it cannot verify.
- It does not print secrets, full configs, env values, keys, or command arguments that may contain credentials.
