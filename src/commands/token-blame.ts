import path from "node:path";
import { parseUsageFile } from "../token-blame/parser.js";
import { analyzeTokenUsage } from "../token-blame/analyze.js";
import { formatTokenBlameJson, formatTokenBlameText } from "../token-blame/format.js";

export async function runTokenBlameCommand(options) {
  const inputPath = path.resolve(options.input);
  const parsed = await parseUsageFile(inputPath);
  const analysis = analyzeTokenUsage(parsed);
  const report = createTokenBlameReport({
    inputPath,
    sessions: analysis.sessions,
    summary: analysis.summary,
    drivers: analysis.drivers,
    healthySignals: analysis.healthySignals,
    warnings: parsed.warnings ?? [],
    verbose: options.verbose,
    unknownSessionAttribution: analysis.attributionCounts
  });

  return options.json ? formatTokenBlameJson(report) : formatTokenBlameText(report);
}

export function createTokenBlameReport(result) {
  const verbose = Boolean(result.verbose);
  const sortedDrivers = sortDrivers(result.drivers);
  const blameScore = clampNumber(sortedDrivers.reduce((total, driver) => total + driver.scoreContribution, 0), 0, 100);
  const compactSessions = (result.sessions || []).map(compactSessionSummary);
  const topSessions = [...compactSessions]
    .sort((left, right) => (right.totalTokens || 0) - (left.totalTokens || 0))
    .slice(0, 8)
    .map((session) => ({
      sessionId: session.sessionId,
      projectPath: session.projectPath,
      modelList: session.modelList,
      totalTokens: session.totalTokens,
      eventCount: session.eventCount,
      durationMs: session.durationMs
    }));

  const unknownSessionAttribution = result.unknownSessionAttribution || { project: 0, model: 0 };
  const warnings = [...(result.warnings || [])];
  if (unknownSessionAttribution.project > 0) {
    warnings.push(`unknownSessionAttribution.project=${unknownSessionAttribution.project}`);
  }
  if (unknownSessionAttribution.model > 0) {
    warnings.push(`unknownSessionAttribution.model=${unknownSessionAttribution.model}`);
  }

  return {
    command: "token-blame",
    input: {
      path: result.inputPath
    },
    score: {
      score: blameScore,
      maxScore: 100,
      contributors: sortedDrivers.length
    },
    summary: {
      ...result.summary,
      drivers: sortedDrivers.length
    },
    sessions: verbose ? result.sessions : compactSessions,
    drivers: sortedDrivers,
    topSessions,
    healthySignals: result.healthySignals || [],
    recommendations: buildRecommendations(sortedDrivers),
    unknownSessionAttribution,
    notes: [
      "This is a local parsing-only diagnostics report.",
      "No API calls or network uploads are performed."
    ],
    warnings
  };
}

function compactSessionSummary(session) {
  return {
    sessionId: session.sessionId,
    projectPath: session.projectPath,
    modelList: session.modelList,
    inputTokens: session.inputTokens,
    outputTokens: session.outputTokens,
    cacheWriteTokens: session.cacheWriteTokens,
    cacheReadTokens: session.cacheReadTokens,
    totalCost: Number.isFinite(session.totalCost) ? session.totalCost : undefined,
    totalTokens: session.totalTokens,
    eventCount: session.eventCount,
    startTimeMs: session.startTimeMs,
    endTimeMs: session.endTimeMs,
    startTime: session.startTime,
    endTime: session.endTime,
    durationMs: session.durationMs,
    outputRatio: session.outputRatio,
    cacheReadRatio: session.cacheReadRatio,
    modelBreakdowns: session.modelBreakdowns
  };
}

function buildRecommendations(drivers) {
  const byId = new Map();
  for (const driver of drivers) {
    if (driver.likelyFix && !byId.has(driver.id)) {
      byId.set(driver.id, driver.likelyFix);
    }
  }
  return [...byId.values()];
}

function sortDrivers(drivers) {
  return [...drivers].sort((left, right) => {
    if (right.scoreContribution !== left.scoreContribution) {
      return right.scoreContribution - left.scoreContribution;
    }

    const severityRank = { high: 0, medium: 1, low: 2 };
    return severityRank[left.severity] - severityRank[right.severity];
  });
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}
