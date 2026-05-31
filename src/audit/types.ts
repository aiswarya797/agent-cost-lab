export const severities = ["high", "medium", "low", "info"];

export function isFindingScope(value) {
  return value === "project" || value === "home";
}

export function isSeverity(value) {
  return value === "high" || value === "medium" || value === "low" || value === "info";
}

export function normalizeCostMechanism(value) {
  const allowed = [
    "startup_context",
    "cache_miss",
    "tool_output",
    "tool_surface",
    "retries",
    "visibility"
  ];

  if (allowed.includes(value)) {
    return value;
  }

  return undefined;
}
