import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function fixture(file) {
  return path.join("tests", "fixtures", "token-blame", file);
}

async function runTokenBlame(args) {
  const processResult = await execFileAsync(process.execPath, ["dist/cli.js", "token-blame", ...args]);
  return processResult;
}

test("ccusage-style session JSON parses and reports totals", async () => {
  const result = await runTokenBlame(["--input", fixture("session.json"), "--json"]);
  const report = JSON.parse(result.stdout);

  assert.equal(report.command, "token-blame");
  assert.equal(report.summary.totalSessions, 2);
  assert.equal(report.summary.totalEvents, 2);
  assert.equal(Array.isArray(report.sessions), true);
  assert.equal(report.sessions[0].projectPath.includes("repo-alpha"), true);
});

test("project-grouped JSON is parsed as multiple projects", async () => {
  const result = await runTokenBlame(["--input", fixture("project-grouped.json"), "--json"]);
  const report = JSON.parse(result.stdout);

  const projects = new Set(report.sessions.map((session) => session.projectPath));
  assert.equal(projects.has("repo-alpha"), true);
  assert.equal(projects.has("repo-beta"), true);
  assert.equal(report.summary.totalSessions, 3);
});

test("JSONL raw usage file is parsed", async () => {
  const result = await runTokenBlame(["--input", fixture("raw-jsonl.log"), "--json"]);
  const report = JSON.parse(result.stdout);

  assert.equal(report.summary.totalSessions, 2);
  assert.equal(report.drivers.length >= 0, true);
});

test("missing usage file path returns error", async () => {
  await assert.rejects(
    async () => runTokenBlame(["--input", "tests/fixtures/token-blame/missing.json"]),
    (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /Cannot read usage input file/);
      return true;
    }
  );
});

test("repeated retries sample includes repeated_retries driver", async () => {
  const result = await runTokenBlame(["--input", fixture("repeated-retries.json"), "--json"]);
  const report = JSON.parse(result.stdout);

  assert.ok(report.drivers.some((driver) => driver.id === "token-blame.repeated-retries"));
});

test("fragmented sessions sample includes short_fragmented_sessions driver", async () => {
  const result = await runTokenBlame(["--input", fixture("fragmented.json"), "--json"]);
  const report = JSON.parse(result.stdout);

  assert.ok(report.drivers.some((driver) => driver.id === "token-blame.short-fragmented-sessions"));
});

test("swapped timestamps do not create negative session durations", async () => {
  const result = await runTokenBlame(["--input", fixture("swapped-timestamps.json"), "--json"]);
  const report = JSON.parse(result.stdout);

  for (const session of report.sessions) {
    if (session.durationMs !== undefined) {
      assert.ok(session.durationMs >= 0, `Expected non-negative duration, got ${session.durationMs}`);
    }
  }
});

test("commands with only shared first token do not trigger repeated_retries", async () => {
  const result = await runTokenBlame(["--input", fixture("shared-first-token.json"), "--json"]);
  const report = JSON.parse(result.stdout);

  assert.equal(report.drivers.some((driver) => driver.id === "token-blame.repeated-retries"), false);
});

test("claude transcript nested message.usage fields parse model and token buckets", async () => {
  const result = await runTokenBlame(["--input", fixture("claude-message-usage.jsonl"), "--json"]);
  const report = JSON.parse(result.stdout);

  assert.equal(report.summary.totalSessions, 2);
  assert.equal(report.summary.totalInputTokens, 155);
  assert.equal(report.summary.totalOutputTokens, 100);
  assert.equal(report.sessions[0].modelList.includes("claude-3-5-sonnet-20240620"), true);
});

test("sessions without cache writes do not automatically trigger cache-miss", async () => {
  const result = await runTokenBlame(["--input", fixture("no-cache-writes.json"), "--json"]);
  const report = JSON.parse(result.stdout);

  assert.equal(report.drivers.some((driver) => driver.id === "token-blame.cache-miss"), false);
});

test("sessions missing timestamps do not create short_fragmented_sessions by default", async () => {
  const result = await runTokenBlame(["--input", fixture("missing-timestamps-fragmented.json"), "--json"]);
  const report = JSON.parse(result.stdout);

  assert.equal(report.drivers.some((driver) => driver.id === "token-blame.short-fragmented-sessions"), false);
});

test("missing timestamps and same head command tokens do not trigger repeated_retries", async () => {
  const result = await runTokenBlame(["--input", fixture("shared-head-missing-timestamps.json"), "--json"]);
  const report = JSON.parse(result.stdout);

  assert.equal(report.drivers.some((driver) => driver.id === "token-blame.repeated-retries"), false);
});

test("text and JSON modes report same number of drivers", async () => {
  const jsonRun = await runTokenBlame(["--input", fixture("session.json"), "--json"]);
  const textRun = await runTokenBlame(["--input", fixture("session.json")]);

  const jsonReport = JSON.parse(jsonRun.stdout);
  const driverCountMatch = textRun.stdout.match(/^Drivers: (\d+)$/m);
  assert.ok(driverCountMatch !== null);
  assert.equal(Number(driverCountMatch[1]), jsonReport.drivers.length);
});
