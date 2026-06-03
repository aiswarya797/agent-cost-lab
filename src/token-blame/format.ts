export function formatTokenBlameText(report) {
  const lines = [
    "Agent Cost Lab token-blame",
    `Path: ${report.input.path}`,
    `Blame score: ${report.score.score}/${report.score.maxScore}`,
    `Summary sessions: ${report.summary.totalSessions}`,
    `Summary events: ${report.summary.totalEvents}`,
    `Drivers: ${report.drivers.length}`,
    "Totals:",
    `  inputTokens: ${report.summary.totalInputTokens}`,
    `  outputTokens: ${report.summary.totalOutputTokens}`,
    `  cacheWriteTokens: ${report.summary.totalCacheWriteTokens}`,
    `  cacheReadTokens: ${report.summary.totalCacheReadTokens}`,
    `  toolResultTokens: ${report.summary.totalToolResultTokens || 0}`,
    `  estimatedCost: ${typeof report.summary.totalEstimatedCost === "number" ? report.summary.totalEstimatedCost : "n/a"}`,
    `  estimatedCostWithoutCache: ${typeof report.summary.totalEstimatedCostWithoutCache === "number" ? report.summary.totalEstimatedCostWithoutCache : "n/a"}`,
    `  estimatedCacheSavings: ${typeof report.summary.totalEstimatedCacheSavings === "number" ? report.summary.totalEstimatedCacheSavings : "n/a"}`,
  "",
    "Findings:"
  ];

  if (Array.isArray(report.topSessions) && report.topSessions.length > 0) {
    lines.push("");
    lines.push("Top sessions by estimated cost:");
    for (const topSession of report.topSessions.slice(0, 3)) {
      lines.push(`  - ${topSession.sessionId}: ${typeof topSession.estimatedCost === "number" ? topSession.estimatedCost : topSession.totalTokens}`);
    }
  }

  if (Array.isArray(report.topProjectsByEstimatedCost) && report.topProjectsByEstimatedCost.length > 0) {
    lines.push("");
    lines.push("Top projects by estimated cost:");
    for (const topProject of report.topProjectsByEstimatedCost.slice(0, 3)) {
      lines.push(`  - ${topProject.projectPath}: ${typeof topProject.estimatedCost === "number" ? topProject.estimatedCost : topProject.totalTokens}`);
    }
  }

  if (Array.isArray(report.topModelsByEstimatedCost) && report.topModelsByEstimatedCost.length > 0) {
    lines.push("");
    lines.push("Top models by estimated cost:");
    for (const topModel of report.topModelsByEstimatedCost.slice(0, 3)) {
      lines.push(`  - ${topModel.model}: ${typeof topModel.estimatedCost === "number" ? topModel.estimatedCost : topModel.totalTokens}`);
    }
  }

  if (Array.isArray(report.topToolsByEstimatedCost) && report.topToolsByEstimatedCost.length > 0) {
    lines.push("");
    lines.push("Top tools by estimated cost:");
    for (const topTool of report.topToolsByEstimatedCost.slice(0, 3)) {
      lines.push(`  - ${topTool.toolName}: ${typeof topTool.estimatedCost === "number" ? topTool.estimatedCost : topTool.score}`);
    }
  }

  if (Array.isArray(report.topToolCategories) && report.topToolCategories.length > 0) {
    lines.push("");
    lines.push("Top tool categories:");
    for (const category of report.topToolCategories.slice(0, 3)) {
      lines.push(`  - ${category.category}: ${category.score}`);
    }
  }

  if (report.drivers.length === 0) {
    lines.push("  No high-confidence drivers were detected in this file.");
  } else {
    for (const driver of report.drivers) {
      lines.push(`  [${driver.severity}] ${driver.title}`);
      lines.push(`    id: ${driver.id}`);
      lines.push(`    scoreContribution: ${driver.scoreContribution}`);
      lines.push(`    affectedSessions (${driver.sampleSize}): ${driver.affectedSessions.join(", ") || "none"}`);
      lines.push(`    confidence: ${driver.confidence}`);
      lines.push(`    why: ${driver.why}`);
      lines.push(`    likelyFix: ${driver.likelyFix}`);
    }
  }

  if (report.drivers.length > 0) {
    lines.push("");
    lines.push("Top drivers:");
    const top = [...report.drivers]
      .sort((left, right) => right.scoreContribution - left.scoreContribution)
      .slice(0, 3);
    for (const driver of top) {
      lines.push(`  - ${driver.id}: ${driver.likelyFix}`);
    }
  }

  if (Array.isArray(report.healthySignals) && report.healthySignals.length > 0) {
    lines.push("");
    lines.push("Healthy signals:");
    for (const signal of report.healthySignals) {
      lines.push(`  [${signal.severity}] ${signal.title}`);
      lines.push(`    id: ${signal.id}`);
      lines.push(`    sessions (${signal.affectedSessions.length}): ${signal.affectedSessions.join(", ") || "none"}`);
      lines.push(`    confidence: ${signal.confidence}`);
      lines.push(`    why: ${signal.why}`);
    }
  }

  lines.push("");
  lines.push("Recommendations:");
  for (const recommendation of report.recommendations) {
    lines.push(`  - ${recommendation}`);
  }
  lines.push("");
  lines.push("Note: local parsing-only diagnostics, no external API calls.");

  if (Array.isArray(report.warnings) && report.warnings.length > 0) {
    lines.push("");
    lines.push("Warnings:");
    for (const warning of report.warnings) {
      lines.push(`  - ${warning}`);
    }
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

export function formatTokenBlameJson(report) {
  return `${JSON.stringify(report, null, 2)}\n`;
}
