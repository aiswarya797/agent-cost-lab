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
    warnings: parsed.warnings ?? []
  });

  return options.json ? formatTokenBlameJson(report) : formatTokenBlameText(report);
}

export function createTokenBlameReport(result) {
  const sortedDrivers = sortDrivers(result.drivers);
  const blameScore = clampNumber(sortedDrivers.reduce((total, driver) => total + driver.scoreContribution, 0), 0, 100);

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
    sessions: result.sessions,
    drivers: sortedDrivers,
    recommendations: buildRecommendations(sortedDrivers),
    notes: [
      "This is a local parsing-only diagnostics report.",
      "No API calls or network uploads are performed."
    ],
    warnings: result.warnings
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
