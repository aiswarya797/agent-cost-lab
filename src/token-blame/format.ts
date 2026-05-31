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
    "",
    "Findings:"
  ];

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
