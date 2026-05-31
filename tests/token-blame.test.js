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

test("mixed known and missing project within a session resolves to dominant project", async () => {
  const result = await runTokenBlame(["--input", fixture("mixed-project-resolution.json"), "--json"]);
  const report = JSON.parse(result.stdout);

  assert.equal(report.summary.totalSessions, 1);
  assert.equal(report.summary.totalEvents, 2);
  assert.equal(report.sessions[0].projectPath, "known-repo");
  assert.equal(report.unknownSessionAttribution.project, 0);
});

test("model resolves from provider/metadata shape when mixed with unknown", async () => {
  const result = await runTokenBlame(["--input", fixture("provider-metadata-model-resolution.json"), "--json"]);
  const report = JSON.parse(result.stdout);

  assert.equal(report.summary.totalSessions, 1);
  assert.equal(report.summary.totalEvents, 2);
  assert.equal(report.sessions[0].modelList.includes("claude-3-haiku-20240307"), true);
  assert.equal(report.unknownSessionAttribution.model, 0);
});

test("source transcript path fallback infers project id from projects/<project-id>.jsonl", async () => {
  const result = await runTokenBlame(["--input", fixture("projects/source-fallback-project.jsonl"), "--json"]);
  const report = JSON.parse(result.stdout);

  assert.equal(report.summary.totalSessions, 1);
  assert.equal(report.sessions[0].projectPath, "source-fallback-project");
  assert.equal(report.unknownSessionAttribution.project, 0);
});

test("JSONL raw usage file is parsed", async () => {
  const result = await runTokenBlame(["--input", fixture("raw-jsonl.log"), "--json"]);
  const report = JSON.parse(result.stdout);

  assert.equal(report.summary.totalSessions, 2);
  assert.equal(report.drivers.length >= 0, true);
});

test("compact JSON omits per-event blobs by default", async () => {
  const result = await runTokenBlame(["--input", fixture("session.json"), "--json"]);
  const report = JSON.parse(result.stdout);

  const hasEvents = report.sessions.some((session) => Array.isArray(session.events));
  assert.equal(hasEvents, false);
  assert.equal(Array.isArray(report.topSessions), true);
  assert.ok(report.topSessions.length >= 1);
});

test("verbose JSON keeps per-event blobs", async () => {
  const result = await runTokenBlame(["--input", fixture("session.json"), "--json", "--verbose"]);
  const report = JSON.parse(result.stdout);

  const hasEvents = report.sessions.some((session) => Array.isArray(session.events));
  assert.equal(hasEvents, true);
  assert.equal(report.sessions.some((session) => session.events.length > 0), true);
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

test("top-level session_id takes precedence over message.id", async () => {
  const result = await runTokenBlame(["--input", fixture("claude-message-session-precedence.jsonl"), "--json"]);
  const report = JSON.parse(result.stdout);

  assert.equal(report.summary.totalSessions, 1);
  assert.equal(report.summary.totalEvents, 2);
  assert.equal(report.sessions[0].sessionId, "real-session-123");
});

test("message.session groups repeated ids even with unique top-level ids", async () => {
  const result = await runTokenBlame(["--input", fixture("message-session-id-in-message.jsonl"), "--json"]);
  const report = JSON.parse(result.stdout);

  assert.equal(report.summary.totalSessions, 1);
  assert.equal(report.summary.totalEvents, 2);
  assert.equal(report.sessions[0].sessionId, "shared-message-session");
});

test("message.context tool tokens are summed into toolResultTokens", async () => {
  const result = await runTokenBlame(["--input", fixture("message-context-toolresult.jsonl"), "--json"]);
  const report = JSON.parse(result.stdout);

  assert.equal(report.summary.totalToolResultTokens, 60);
  assert.equal(report.sessions[0].toolResultTokens, 60);
});

test("message-model and model.id are included in session model breakdowns", async () => {
  const result = await runTokenBlame(["--input", fixture("message-model-attribution.jsonl"), "--json"]);
  const report = JSON.parse(result.stdout);

  assert.equal(report.summary.totalSessions, 1);
  assert.equal(report.summary.totalEvents, 2);
  assert.equal(report.sessions[0].modelList.includes("claude-3-haiku-20240307"), true);
  assert.equal(report.sessions[0].modelList.includes("gpt-4o-mini"), true);
  assert.equal(report.sessions[0].modelBreakdowns.some((item) => item.model === "claude-3-haiku-20240307"), true);
  assert.equal(report.sessions[0].modelBreakdowns.some((item) => item.model === "gpt-4o-mini"), true);
});

test("message-scoped project fields are used when top-level project is missing", async () => {
  const result = await runTokenBlame(["--input", fixture("message-project-attribution.jsonl"), "--json"]);
  const report = JSON.parse(result.stdout);

  assert.equal(report.summary.totalSessions, 1);
  assert.equal(report.sessions[0].projectPath, "repo-from-message");
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

test("long-session is timestamp-only and does not classify by missing duration", async () => {
  const result = await runTokenBlame(["--input", fixture("long-session-no-duration-no-timestamps.jsonl"), "--json"]);
  const report = JSON.parse(result.stdout);

  assert.equal(report.drivers.some((driver) => driver.id === "token-blame.long-sessions"), false);
});

test("cache-aware output ratio uses cache input and avoids old false positives", async () => {
  const result = await runTokenBlame(["--input", fixture("output-ratio-cache-input.jsonl"), "--json"]);
  const report = JSON.parse(result.stdout);

  assert.equal(report.drivers.some((driver) => driver.id === "token-blame.high-output-ratio"), false);
});

test("cache health signal appears for stable cache reuse patterns", async () => {
  const result = await runTokenBlame(["--input", fixture("cache-health-positive.jsonl"), "--json"]);
  const report = JSON.parse(result.stdout);

  assert.equal(Array.isArray(report.healthySignals), true);
  assert.equal(report.healthySignals.length > 0, true);
  assert.equal(report.healthySignals.every((signal) => signal.isPositive === true), true);
});

test("same drivers at different scale yield different blame scores", async () => {
  const smallResult = await runTokenBlame(["--input", fixture("scale-small-output-retries.jsonl"), "--json"]);
  const largeResult = await runTokenBlame(["--input", fixture("scale-large-output-retries.jsonl"), "--json"]);
  const smallReport = JSON.parse(smallResult.stdout);
  const largeReport = JSON.parse(largeResult.stdout);

  const smallDrivers = new Set(smallReport.drivers.map((driver) => driver.id)).values();
  const largeDrivers = new Set(largeReport.drivers.map((driver) => driver.id)).values();
  assert.deepEqual([...smallDrivers].sort(), [...largeDrivers].sort());
  assert.equal(smallReport.drivers.some((driver) => driver.id === "token-blame.repeated-retries"), true);
  assert.equal(smallReport.drivers.some((driver) => driver.id === "token-blame.high-output-ratio"), true);
  assert.notEqual(smallReport.score.score, largeReport.score.score);
});

test("text and JSON modes report same number of drivers", async () => {
  const jsonRun = await runTokenBlame(["--input", fixture("session.json"), "--json"]);
  const textRun = await runTokenBlame(["--input", fixture("session.json")]);

  const jsonReport = JSON.parse(jsonRun.stdout);
  const driverCountMatch = textRun.stdout.match(/^Drivers: (\d+)$/m);
  assert.ok(driverCountMatch !== null);
  assert.equal(Number(driverCountMatch[1]), jsonReport.drivers.length);
});
