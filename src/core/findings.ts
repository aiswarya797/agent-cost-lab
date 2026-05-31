export function sortFindings(findings) {
  const severityRank = {
    high: 0,
    medium: 1,
    low: 2,
    info: 3
  };

  return [...findings].sort((left, right) => {
    const severityDiff = severityRank[left.severity] - severityRank[right.severity];
    if (severityDiff !== 0) {
      return severityDiff;
    }

    return `${left.scope}:${left.id}:${left.path ?? ""}`.localeCompare(
      `${right.scope}:${right.id}:${right.path ?? ""}`
    );
  });
}
