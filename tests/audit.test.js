import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { createAuditReport, runAudit } from "../dist/commands/audit.js";
import { formatText } from "../dist/core/format.js";
import { displayPathFor } from "../dist/core/paths.js";
import { scoreFindings } from "../dist/core/scoring.js";

const fixtureDisplayPath = "tests/fixtures/sample-repo";
const fixturePath = path.resolve(fixtureDisplayPath);
const execFileAsync = promisify(execFile);

const tmpPrefix = path.join(os.tmpdir(), "acl-audit-");

async function writeFixture(root, files) {
  for (const [relativePath, content] of Object.entries(files)) {
    const absolute = path.join(root, relativePath);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, content);
  }
}

function repeatedLines(count, value = "line") {
  return Array.from({ length: count }, () => value).join("\n");
}

test("score is derived from returned findings", async () => {
  const result = await runAudit({
    projectPath: fixturePath,
    includeHomeChecks: false
  });
  const report = createAuditReport(result);

  assert.deepEqual(report.score, scoreFindings(report.findings));
});

test("JSON output includes all findings used for scoring", async () => {
  const result = await runAudit({
    projectPath: fixturePath,
    includeHomeChecks: false
  });
  const report = createAuditReport(result);
  const json = JSON.parse(JSON.stringify(report));

  assert.equal(json.findings.length, report.findings.length);
  assert.deepEqual(json.score, scoreFindings(json.findings));
});

test("text and JSON modes agree on finding count for the same result", async () => {
  const result = await runAudit({
    projectPath: fixturePath,
    includeHomeChecks: false
  });
  const report = createAuditReport(result);
  const text = formatText(report);
  const countLine = text.split("\n").find((line) => line.startsWith("Findings: "));

  assert.equal(countLine, `Findings: ${report.findings.length}`);
});

test("CLI text and JSON modes agree on fixture finding count", async () => {
  const textRun = await execFileAsync(process.execPath, ["dist/cli.js", "audit", "--path", fixtureDisplayPath]);
  const jsonRun = await execFileAsync(process.execPath, ["dist/cli.js", "audit", "--path", fixtureDisplayPath, "--json"]);
  const json = JSON.parse(jsonRun.stdout);
  const textCount = Number(textRun.stdout.match(/^Findings: (\d+)$/m)?.[1]);

  assert.equal(textCount, json.findings.length);
});

test("fixture CLI output uses stable relative report paths", async () => {
  const textRun = await execFileAsync(process.execPath, ["dist/cli.js", "audit", "--path", fixtureDisplayPath]);
  const jsonRun = await execFileAsync(process.execPath, ["dist/cli.js", "audit", "--path", fixtureDisplayPath, "--json"]);
  const json = JSON.parse(jsonRun.stdout);

  assert.match(textRun.stdout, /^Path: tests\/fixtures\/sample-repo$/m);
  assert.equal(json.path, fixtureDisplayPath);
});

test("fixture findings keep project-relative paths", async () => {
  const jsonRun = await execFileAsync(process.execPath, ["dist/cli.js", "audit", "--path", fixtureDisplayPath, "--json"]);
  const json = JSON.parse(jsonRun.stdout);
  const findingPaths = json.findings.map((finding) => finding.path).filter(Boolean);

  assert.ok(findingPaths.includes(".env"));
  assert.ok(findingPaths.includes("package.json"));
  assert.equal(findingPaths.some((findingPath) => path.isAbsolute(findingPath)), false);
});

test("display path falls back to absolute path outside cwd", () => {
  const outsidePath = path.resolve("..", "outside-repo");

  assert.equal(displayPathFor(outsidePath), outsidePath);
});

test("display path keeps child names that start with parent-dir characters", () => {
  const cwd = path.resolve("tests");
  const insidePath = path.join(cwd, "..fixture");

  assert.equal(displayPathFor(insidePath, cwd), "..fixture");
});

test("info findings are explicit zero-deduction score context", () => {
  const score = scoreFindings([
    {
      id: "test.info",
      title: "Informational finding",
      severity: "info",
      scope: "project",
      detail: "Context only.",
      recommendation: "No score action needed."
    }
  ]);

  assert.equal(score.score, 100);
  assert.equal(score.deductions, 0);
  assert.deepEqual(score.nonDeductingSeverities, ["info"]);
});

test("fixture audit is independent of user-home Claude settings", async () => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), "acl-home-"));
  await mkdir(path.join(homeDir, ".claude"));
  await writeFile(
    path.join(homeDir, ".claude", "settings.json"),
    JSON.stringify({ model: "local-test-model", apiKey: "must-not-appear" })
  );

  const withoutHome = await runAudit({
    projectPath: fixturePath,
    homeDir,
    includeHomeChecks: false
  });
  const withHome = await runAudit({
    projectPath: fixturePath,
    homeDir,
    includeHomeChecks: true
  });

  assert.equal(withoutHome.findings.some((finding) => finding.scope === "home"), false);
  assert.equal(withHome.findings.some((finding) => finding.id === "home.claude-settings-present"), true);

  const fixtureReport = createAuditReport(withoutHome);
  assert.equal(JSON.stringify(fixtureReport).includes("must-not-appear"), false);
  assert.equal(JSON.stringify(fixtureReport).includes("local-test-model"), false);
});

test("oversized instruction file check flags medium and high thresholds", async () => {
  const root = await mkdtemp(tmpPrefix);
  await writeFixture(root, {
    "CLAUDE.md": `${repeatedLines(151)}\n`,
    "nested/AGENTS.md": `${repeatedLines(205)}\n`
  });

  const report = createAuditReport(
    await runAudit({
      projectPath: root,
      includeHomeChecks: false
    })
  );

  const ids = new Set(report.findings.map((finding) => finding.id));
  assert.ok(ids.has("project.instruction-size.medium"));
  assert.ok(ids.has("project.instruction-size.high"));
});

test("instruction discovery skips noisy generated directories", async () => {
  const root = await mkdtemp(tmpPrefix);
  await writeFixture(root, {
    "dist/AGENTS.md": "line\n".repeat(220),
    "CLAUDE.md": "Dist artifacts are noisy and should be avoided in agent context.\n",
    ".gitignore": "dist/\n"
  });

  const result = await runAudit({
    projectPath: root,
    includeHomeChecks: false
  });

  const distFindings = result.findings.filter((finding) => finding.path === "dist/AGENTS.md" || finding.path === "./dist/AGENTS.md");
  assert.equal(distFindings.length, 0);
});
test("duplicate and conflicting instruction detection works", async () => {
  const root = await mkdtemp(tmpPrefix);
  await writeFixture(root, {
    "AGENTS.md": "# Setup\nRun npm install\n# Setup\nRun yarn install\nAlways run full tests\nThen run targeted tests\nUse prettier and biome\n"
  });

  const result = await runAudit({
    projectPath: root,
    includeHomeChecks: false
  });
  const ids = new Set(result.findings.map((finding) => finding.id));

  assert.ok(ids.has("project.instruction-duplicate.heading"));
  assert.ok([...ids].some((id) => id.startsWith("project.instruction-conflict")));
});

test("volatile instruction content is flagged", async () => {
  const root = await mkdtemp(tmpPrefix);
  await writeFixture(root, {
    "CLAUDE.md": "# Notes\nGenerated at 2026-01-01 on 12:34\nBranch: main\nCommit: 1a2b3c4d5e6f7g8h9i0j\nTODO: status update\n"
  });

  const result = await runAudit({
    projectPath: root,
    includeHomeChecks: false
  });

  assert.ok(result.findings.some((finding) => finding.id === "project.instruction-volatile"));
});

test("large @path references are detected", async () => {
  const root = await mkdtemp(tmpPrefix);
  await writeFixture(root, {
    "README.md": `${"a".repeat(35 * 1024)}\n`,
    "CLAUDE.md": "Reference @README.md for instructions.\n"
  });

  const result = await runAudit({
    projectPath: root,
    includeHomeChecks: false
  });

  const ids = new Set(result.findings.map((finding) => finding.id));
  assert.ok(ids.has("project.instruction-ref.large") || ids.has("project.instruction-ref.large-high"));
});

test("missing noisy path guidance is reported", async () => {
  const root = await mkdtemp(tmpPrefix);
  await writeFixture(root, {
    "dist/.keep": "",
    "CLAUDE.md": "Agent notes.\n"
  });

  const result = await runAudit({
    projectPath: root,
    includeHomeChecks: false
  });

  assert.ok(result.findings.some((finding) => finding.id === "project.noisy-path-guidance" && finding.path === "dist"));
});

test("missing noisy path from .gitignore coverage is flagged", async () => {
  const root = await mkdtemp(tmpPrefix);
  await writeFixture(root, {
    "dist/.keep": "",
    ".gitignore": "node_modules/\n"
  });

  const result = await runAudit({
    projectPath: root,
    includeHomeChecks: false
  });

  assert.ok(result.findings.some((finding) => finding.id === "project.gitignore-missing-noisy-path"));
});

test("large unignored files are detected via temporary fixture", async () => {
  const root = await mkdtemp(tmpPrefix);
  await writeFixture(root, {
    "very-large-notes.txt": `${"a".repeat(1100 * 1024)}\n`
  });

  const result = await runAudit({
    projectPath: root,
    includeHomeChecks: false
  });

  assert.ok(result.findings.some((finding) => finding.id === "project.unignored.large-text"));
});

test("MCP server count is flagged without leaking config contents", async () => {
  const root = await mkdtemp(tmpPrefix);
  await writeFixture(root, {
    ".mcp.json": JSON.stringify({
      mcpServers: {
        one: { command: "server-one", apiKey: "should-not-leak" },
        two: { command: "server-two" },
        three: { command: "server-three" },
        four: { command: "server-four" },
        five: { command: "server-five" },
        six: { command: "server-six" }
      }
    }),
    "CLAUDE.md": "Noisy path guidance.\n"
  });

  const report = createAuditReport(
    await runAudit({
      projectPath: root,
      includeHomeChecks: false
    })
  );

  assert.ok(report.findings.some((finding) => finding.id === "project.mcp-servers-many" || finding.id === "project.mcp-servers-high-count"));
  assert.equal(JSON.stringify(report).includes("should-not-leak"), false);
});

test("noisy output command detection catches uncapped commands", async () => {
  const root = await mkdtemp(tmpPrefix);
  await writeFixture(root, {
    "package.json": JSON.stringify({
      name: "temp-audit",
      scripts: {
        test: "npm test",
        lint: "npm run lint",
        build: "npm run build"
      }
    }),
    "CLAUDE.md": "Use npm install to start.\n"
  });

  const result = await runAudit({
    projectPath: root,
    includeHomeChecks: false
  });

  assert.ok(result.findings.some((finding) => finding.id === "project.output-trimming"));
});

test("verification ladder guidance is detected as missing when scripts exist", async () => {
  const root = await mkdtemp(tmpPrefix);
  await writeFixture(root, {
    "package.json": JSON.stringify({
      name: "temp-audit",
      scripts: {
        install: "npm ci",
        lint: "npm run lint",
        "typecheck": "npm run typecheck",
        "test:unit": "npm run test:unit",
        test: "npm run test",
        build: "npm run build"
      }
    }),
    "AGENTS.md": "General notes only.\n"
  });

  const result = await runAudit({
    projectPath: root,
    includeHomeChecks: false
  });

  assert.ok(result.findings.some((finding) => finding.id === "project.verify-missing.install"));
  assert.ok(result.findings.some((finding) => finding.id === "project.verify-missing.lint"));
  assert.ok(result.findings.some((finding) => finding.id === "project.verify-missing.typecheck"));
  assert.ok(result.findings.some((finding) => finding.id === "project.verify-missing.unit-test"));
  assert.ok(result.findings.some((finding) => finding.id === "project.verify-missing.full-test"));
  assert.ok(result.findings.some((finding) => finding.id === "project.verify-missing.build"));
});

test("missing usage visibility is detected", async () => {
  const root = await mkdtemp(tmpPrefix);
  await writeFixture(root, {
    "package.json": JSON.stringify({
      name: "temp-audit",
      scripts: {
        test: "npm test"
      }
    }),
    "CLAUDE.md": "General instructions.\n"
  });

  const result = await runAudit({
    projectPath: root,
    includeHomeChecks: false
  });

  assert.ok(result.findings.some((finding) => finding.id === "project.usage-visibility-missing"));
});
