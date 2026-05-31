import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
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
