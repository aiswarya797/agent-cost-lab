const severityWeights = {
  high: 20,
  medium: 10,
  low: 5,
  info: 0
};

export function scoreFindings(findings) {
  const deductions = findings.reduce((total, finding) => total + severityWeights[finding.severity], 0);
  const maxScore = 100;

  return {
    score: Math.max(0, maxScore - deductions),
    maxScore,
    deductions
  };
}
