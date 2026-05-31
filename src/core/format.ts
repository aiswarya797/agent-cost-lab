export function formatJson(report) {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function formatText(report) {
  const lines = [
    "Agent Cost Lab audit",
    `Path: ${report.path}`,
    `Score: ${report.score.score}/${report.score.maxScore}`,
    "Score note: info findings do not reduce the score.",
    `Findings: ${report.findings.length}`,
    ""
  ];

  if (report.findings.length === 0) {
    lines.push("No local cost-hygiene findings.");
  } else {
    for (const finding of report.findings) {
      lines.push(`[${finding.severity}] ${finding.title}`);
      lines.push(`  id: ${finding.id}`);
      lines.push(`  scope: ${finding.scope}`);
      if (finding.path) {
        lines.push(`  path: ${finding.path}`);
      }
      lines.push(`  detail: ${finding.detail}`);
      lines.push(`  recommendation: ${finding.recommendation}`);
      lines.push("");
    }
  }

  lines.push("Note: this audit reports local cost-hygiene signals only.");
  lines.push("It does not calculate exact wasted tokens, exact savings, or ROI.");

  return `${lines.join("\n").trimEnd()}\n`;
}
