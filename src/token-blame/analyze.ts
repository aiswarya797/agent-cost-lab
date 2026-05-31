const LONG_SESSION_DURATION_MS = 120 * 60 * 1000;
const SHORT_SESSION_DURATION_MS = 10 * 60 * 1000;
const FRAGMENTED_WINDOW_MS = 90 * 60 * 1000;
const RETRY_GAP_MS = 3 * 60 * 1000;

const LOW_TIER_MODELS = new Set([
  "gpt-4o-mini",
  "gpt-3.5-turbo",
  "gpt-3.5-turbo-0125",
  "claude-3-haiku-20240307",
  "claude-3-haiku"
]);

const DRIVER_ORDER = [
  "token-blame.long-sessions",
  "token-blame.repeated-retries",
  "token-blame.expensive-model-choice",
  "token-blame.high-output-ratio",
  "token-blame.cache-miss",
  "token-blame.cache-write-pressure",
  "token-blame.tool-result-bloat",
  "token-blame.short-fragmented-sessions"
];

export function analyzeTokenUsage(parsed) {
  const sessions = summarizeEventsToSessions(parsed.sessions || []);
  const summary = buildSummary(parsed.sessions || [], sessions);
  const drivers = [
    ...detectLongSessions(sessions),
    ...detectRepeatedRetries(parsed.sessions || []),
    ...detectExpensiveModelChoice(sessions),
    ...detectHighOutputRatio(sessions),
    ...detectCacheMiss(sessions),
    ...detectCacheWritePressure(sessions),
    ...detectToolResultBloat(sessions),
    ...detectShortFragmentedSessions(sessions)
  ];

  return {
    sessions,
    summary,
    drivers
  };
}

function summarizeEventsToSessions(events) {
  const sessionsById = new Map();
  for (const event of events) {
    if (!event || !event.sessionId) {
      continue;
    }

    const session = sessionsById.get(event.sessionId) || {
      sessionId: event.sessionId,
      projectPath: event.projectPath || "unknown-project",
      modelList: [...new Set((event.modelList && event.modelList.length > 0 ? event.modelList : ["unknown-model"]))],
      inputTokens: 0,
      outputTokens: 0,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
      totalTokens: 0,
      totalCost: 0,
      eventCount: 0,
      events: [],
      modelBreakdowns: [],
      commandSignatures: [],
      toolResultTokens: 0,
      startTimeMs: undefined,
      endTimeMs: undefined
    };

    session.eventCount += 1;
    session.events.push({
      time: event.startTimeMs,
      signature: event.raw?.commandSignature,
      commandLike: Boolean(event.raw?.commandLike),
      toolSignature: event.raw?.toolCallSignature,
      projectPath: event.projectPath,
      modelList: event.modelList,
      inputTokens: event.inputTokens
    });

    session.inputTokens += event.inputTokens;
    session.outputTokens += event.outputTokens;
    session.cacheWriteTokens += event.cacheWriteTokens;
    session.cacheReadTokens += event.cacheReadTokens;
    session.totalTokens += event.totalTokens;
    session.totalCost += event.totalCost ?? 0;
    session.toolResultTokens += event.toolResultTokens ?? 0;

    for (const item of event.modelList || []) {
      if (!session.modelList.includes(item)) {
        session.modelList.push(item);
      }
    }

    for (const breakdown of event.modelBreakdowns || []) {
      session.modelBreakdowns.push(breakdown);
    }

    session.commandSignatures.push(event.raw?.commandSignature);

    const eventStart = event.startTimeMs ?? event.endTimeMs;
    if (eventStart !== undefined) {
      session.startTimeMs = chooseEarlierTime(session.startTimeMs, eventStart);
      session.endTimeMs = chooseLaterTime(session.endTimeMs, eventStart);
    }
    if (event.endTimeMs !== undefined) {
      session.endTimeMs = chooseLaterTime(session.endTimeMs, event.endTimeMs);
    }

    sessionsById.set(event.sessionId, session);
  }

  const sessions = [...sessionsById.values()].map((session) => {
    if (session.startTimeMs !== undefined && session.endTimeMs !== undefined) {
      const durationMs = session.endTimeMs - session.startTimeMs;
      if (durationMs >= 0) {
        session.durationMs = durationMs;
      }
    }
    session.modelList = [...new Set(session.modelList)].sort();
    session.outputRatio = session.inputTokens > 0 ? session.outputTokens / session.inputTokens : null;
    session.cacheReadRatio = session.inputTokens + session.cacheWriteTokens + session.cacheReadTokens > 0
      ? session.cacheReadTokens / (session.inputTokens + session.cacheWriteTokens + session.cacheReadTokens)
      : null;

    session.modelBreakdowns = aggregateModelBreakdowns(session.modelBreakdowns);
    return session;
  });

  for (const session of sessions) {
    session.startTime = session.startTimeMs === undefined ? null : new Date(session.startTimeMs).toISOString();
    session.endTime = session.endTimeMs === undefined ? null : new Date(session.endTimeMs).toISOString();
  }

  return sessions;
}

function buildSummary(rawEvents, sessions) {
  return {
    totalEvents: rawEvents.length,
    totalSessions: sessions.length,
    totalInputTokens: sessions.reduce((sum, session) => sum + (session.inputTokens || 0), 0),
    totalOutputTokens: sessions.reduce((sum, session) => sum + (session.outputTokens || 0), 0),
    totalCacheWriteTokens: sessions.reduce((sum, session) => sum + (session.cacheWriteTokens || 0), 0),
    totalCacheReadTokens: sessions.reduce((sum, session) => sum + (session.cacheReadTokens || 0), 0),
    totalToolResultTokens: sessions.reduce((sum, session) => sum + (session.toolResultTokens || 0), 0)
  };
}

function detectLongSessions(sessions) {
  const withDurations = sessions.filter((session) => Number.isFinite(session.durationMs));
  const tokenP95 = quantile(sessions.map((session) => session.totalTokens).filter((value) => value > 0), 0.95);

  const affected = [];
  for (const session of sessions) {
    if (Number.isFinite(session.durationMs) && session.durationMs >= LONG_SESSION_DURATION_MS) {
      affected.push(session.sessionId);
      continue;
    }

    if (!Number.isFinite(session.durationMs) && tokenP95 > 0 && session.totalTokens > tokenP95) {
      affected.push(session.sessionId);
    }
  }

  if (affected.length === 0) {
    return [];
  }

  return [
    {
      id: "token-blame.long-sessions",
      title: "Long or oversized sessions",
      severity: pickSeverity(affected.length, 12),
      scoreContribution: 18,
      sampleSize: affected.length,
      affectedSessions: [...new Set(affected)].slice(0, 8),
      confidence: clamp(0.3 + affected.length / 20, 0, 0.95),
      why: `${affected.length} session(s) lasted longer than 120m or were large token outliers without duration data.`,
      likelyFix: "Batch work into cleaner checkpoints and reset context between long stretches.",
      evidenceSummary: `Top sessions: ${affected.slice(0, 4).join(", ")}`
    }
  ];
}

function detectRepeatedRetries(events) {
  const timedEvents = events.filter((event) => Number.isFinite(event.startTimeMs ?? event.endTimeMs));
  const sortedEvents = [...timedEvents].sort((left, right) => {
    const leftTime = left.startTimeMs ?? left.endTimeMs;
    const rightTime = right.startTimeMs ?? right.endTimeMs;
    return leftTime - rightTime;
  });

  const repeated = [];
  for (let index = 1; index < sortedEvents.length; index += 1) {
    const previous = sortedEvents[index - 1];
    const current = sortedEvents[index];

    const projectMatch = (previous.projectPath || "unknown-project") === (current.projectPath || "unknown-project");
    const gap = timeDiffMs(current, previous);
    const duplicateCommand = hasNearDuplicateSignature(previous, current);

    if (projectMatch && Number.isFinite(gap) && gap <= RETRY_GAP_MS && duplicateCommand) {
      repeated.push({
        current,
        previous
      });
    }
  }

  if (repeated.length < 2) {
    return [];
  }

  const bySession = new Map();
  for (const match of repeated) {
    const sessionId = match.current.sessionId || "unknown-session";
    const sessions = bySession.get(sessionId) || [];
    sessions.push(match.current);
    sessions.push(match.previous);
    bySession.set(sessionId, sessions);
  }

  const affected = [...bySession.entries()].filter(([, matches]) => uniqueSessions(matches).length >= 2);
  if (affected.length === 0) {
    return [];
  }

  const affectedSessions = affected.map(([sessionId]) => sessionId);
  return [
    {
      id: "token-blame.repeated-retries",
      title: "Likely repeated retries",
      severity: "medium",
      scoreContribution: 20,
      sampleSize: affected.length,
      affectedSessions,
      confidence: 0.8,
      why: "Consecutive short-gap entries show near-duplicate prompt or tool payloads.",
      likelyFix: "Keep command/result de-duping rules and avoid reissuing unchanged prompts.",
      evidenceSummary: `Matched pairs across ${affected.length} session(s) with close retry timing.`
    }
  ];
}

function detectExpensiveModelChoice(sessions) {
  const affected = [];

  for (const session of sessions) {
    const modelCost = {};
    let totalCost = 0;
    for (const breakdown of session.modelBreakdowns || []) {
      const cost = Number.isFinite(breakdown.cost) ? breakdown.cost : undefined;
      const contribution = cost ?? breakdown.inputTokens + breakdown.outputTokens + breakdown.cacheWriteTokens + breakdown.cacheReadTokens;
      if (contribution > 0) {
        modelCost[breakdown.model] = (modelCost[breakdown.model] || 0) + contribution;
        totalCost += contribution;
      }
    }

    if (totalCost === 0 || Object.keys(modelCost).length === 0) {
      continue;
    }

    const entries = Object.entries(modelCost).sort((left, right) => right[1] - left[1]);
    const [winnerModel, winnerValue] = entries[0];
    const ratio = winnerValue / totalCost;

    if (ratio >= 0.7 && !LOW_TIER_MODELS.has(winnerModel.toLowerCase())) {
      affected.push(session.sessionId);
    }
  }

  if (affected.length === 0) {
    return [];
  }

  return [
    {
      id: "token-blame.expensive-model-choice",
      title: "Dominant expensive model usage",
      severity: "high",
      scoreContribution: 16,
      sampleSize: affected.length,
      affectedSessions: affected,
      confidence: 0.88,
      why: "One model dominates session cost-share above 70%, suggesting higher spend per token profile.",
      likelyFix: "Pin a lower-cost fallback model for non-complex tasks.",
      evidenceSummary: `Dominant models in sessions: ${affected.join(", ")}`
    }
  ];
}

function detectHighOutputRatio(sessions) {
  const byProject = new Map();
  for (const session of sessions) {
    if (session.outputRatio === null || session.outputRatio <= 0 || session.inputTokens < 20) {
      continue;
    }
    const list = byProject.get(session.projectPath) || [];
    list.push(session);
    byProject.set(session.projectPath, list);
  }

  const affected = [];
  for (const [projectPath, sessionsForProject] of byProject.entries()) {
    const ratios = sessionsForProject.map((session) => session.outputRatio).filter((ratio) => ratio !== null && Number.isFinite(ratio)).sort((a, b) => a - b);
    if (ratios.length === 0) {
      continue;
    }
    const projectMedian = quantile(ratios, 0.5);
    const project95 = quantile(ratios, 0.95);
    for (const session of sessionsForProject) {
      const ratio = session.outputRatio;
      if (ratio > 0 && (ratio >= project95 || ratio >= projectMedian * 3)) {
        affected.push(session.sessionId);
      }
    }
  }

  if (affected.length === 0) {
    return [];
  }

  const unique = [...new Set(affected)];
  return [
    {
      id: "token-blame.high-output-ratio",
      title: "Output-heavy interaction pattern",
      severity: unique.length > 3 ? "high" : "medium",
      scoreContribution: unique.length > 3 ? 14 : 9,
      sampleSize: unique.length,
      affectedSessions: unique,
      confidence: 0.75,
      why: "Output tokens are high relative to inputs compared with project baseline.",
      likelyFix: "Trim verbose outputs, prefer summaries, and cap diagnostic detail by default.",
      evidenceSummary: `High ratios in ${unique.length} session(s).`
    }
  ];
}

function detectCacheMiss(sessions) {
  const ratios = sessions
    .filter((session) => session.cacheWriteTokens > 0 || session.cacheReadTokens > 0)
    .map((session) => session.cacheReadRatio)
    .filter((ratio) => ratio !== null && Number.isFinite(ratio));
  const projectMedian = quantile(ratios, 0.5);
  if (ratios.length === 0 || !Number.isFinite(projectMedian)) {
    return [];
  }

  const affected = sessions.filter((session) => {
    if (!(session.cacheWriteTokens > 0 || session.cacheReadTokens > 0)) {
      return false;
    }
    if (session.cacheReadRatio === null) {
      return false;
    }
    if (session.cacheReadRatio > 0.25) {
      return false;
    }
    return session.cacheReadRatio < Math.max(0.08, projectMedian * 0.4);
  });

  if (affected.length === 0) {
    return [];
  }

  return [
    {
      id: "token-blame.cache-miss",
      title: "Likely cache-miss pattern",
      severity: "medium",
      scoreContribution: 12,
      sampleSize: affected.length,
      affectedSessions: affected.map((session) => session.sessionId),
      confidence: 0.67,
      why: "Session cache-read shares are much lower than project baseline while cache writes stay non-trivial.",
      likelyFix: "Stabilize prompt structure and repeated sections to increase cache reuse.",
      evidenceSummary: `Cache-read ratio is under project norm in ${affected.length} session(s).`
    }
  ];
}

function detectCacheWritePressure(sessions) {
  const byProjectModel = new Map();
  for (const session of sessions) {
    for (const model of session.modelList) {
      const key = `${session.projectPath}|${model}`;
      const list = byProjectModel.get(key) || [];
      list.push(session);
      byProjectModel.set(key, list);
    }
  }

  const affected = [];
  for (const sessionsWithKey of byProjectModel.values()) {
    if (sessionsWithKey.length < 2) {
      continue;
    }
    const writeValues = sessionsWithKey.map((session) => session.cacheWriteTokens).filter((value) => value > 0).sort((a, b) => a - b);
    if (writeValues.length < 2) {
      continue;
    }
    const threshold = quantile(writeValues, 0.9);
    for (const session of sessionsWithKey) {
      if (session.cacheWriteTokens >= threshold && session.cacheWriteTokens > 100) {
        affected.push(session.sessionId);
      }
    }
  }

  if (affected.length === 0) {
    return [];
  }

  const unique = [...new Set(affected)];
  return [
    {
      id: "token-blame.cache-write-pressure",
      title: "Sustained cache-write pressure",
      severity: "low",
      scoreContribution: 10,
      sampleSize: unique.length,
      affectedSessions: unique,
      confidence: 0.6,
      why: "Repeated sessions under same project/model pair write large amounts of cache tokens.",
      likelyFix: "Reduce short prompt churn and keep reusable context blocks stable.",
      evidenceSummary: `High cache-write sessions for shared project/model pairing: ${unique.join(", ")}`
    }
  ];
}

function detectToolResultBloat(sessions) {
  const ratios = sessions
    .map((session) => session.outputRatio)
    .filter((ratio) => ratio !== null && Number.isFinite(ratio));
  const outputP95 = quantile(ratios, 0.95);
  const affected = [];

  for (const session of sessions) {
    const toolSignal = session.toolResultTokens > 0;
    const ratio = session.outputRatio ?? 0;
    const highOutput = outputP95 > 0 && ratio > outputP95;

    if (toolSignal && session.toolResultTokens >= session.inputTokens * 2) {
      affected.push(session.sessionId);
      continue;
    }

    if (toolSignal && session.toolResultTokens > 0 && ratio >= 2.5) {
      affected.push(session.sessionId);
      continue;
    }

    if (!toolSignal && highOutput && session.inputTokens < 200 && ratio >= 5) {
      affected.push(session.sessionId);
    }
  }

  if (affected.length === 0) {
    return [];
  }

  const unique = [...new Set(affected)];
  return [
    {
      id: "token-blame.tool-result-bloat",
      title: "Possible tool result bloat",
      severity: "medium",
      scoreContribution: 12,
      sampleSize: unique.length,
      affectedSessions: unique,
      confidence: 0.7,
      why: "Detected tool output-heavy sessions with low input compared to output.",
      likelyFix: "Trim tool output payloads or request summary-mode tool results.",
      evidenceSummary: `${unique.length} session(s) show tool-result-heavy token patterns.`
    }
  ];
}

function detectShortFragmentedSessions(sessions) {
  const byProjectModel = new Map();
  for (const session of sessions) {
    if (!Number.isFinite(session.startTimeMs)) {
      continue;
    }
    for (const model of session.modelList) {
      const key = `${session.projectPath}|${model}`;
      const list = byProjectModel.get(key) || [];
      list.push(session);
      byProjectModel.set(key, list);
    }
  }

  const affected = [];
  for (const sessionsForPair of byProjectModel.values()) {
    const sorted = sessionsForPair.slice().sort((left, right) => left.startTimeMs - right.startTimeMs);

    if (sorted.length < 3) {
      continue;
    }

    const tokenP95 = quantile(sorted.map((session) => session.totalTokens).filter((value) => value > 0), 0.95);
    const targetTokens = Math.max(2500, tokenP95 * 0.9);

    for (let start = 0; start < sorted.length; start += 1) {
      const bucket = [];
      let end = start;
      let totalTokens = 0;
      const windowStart = sorted[start].startTimeMs;

      while (end < sorted.length) {
        const candidate = sorted[end];
        const candidateStart = candidate.startTimeMs;
        if (!Number.isFinite(candidate.durationMs)) {
          end += 1;
          continue;
        }

        const durationMs = candidate.durationMs;
        if (candidateStart - windowStart > FRAGMENTED_WINDOW_MS) {
          break;
        }
        if (durationMs <= SHORT_SESSION_DURATION_MS) {
          totalTokens += candidate.totalTokens;
          bucket.push(candidate);
        }
        end += 1;
      }

      if (bucket.length >= 3 && totalTokens >= targetTokens) {
        affected.push(...bucket.map((session) => session.sessionId));
        break;
      }
    }
  }

  if (affected.length === 0) {
    return [];
  }

  const unique = [...new Set(affected)];
  return [
    {
      id: "token-blame.short-fragmented-sessions",
      title: "Many short sessions near the same timeline",
      severity: "medium",
      scoreContribution: 12,
      sampleSize: unique.length,
      affectedSessions: unique,
      confidence: 0.68,
      why: "Short sessions clustered within 90m produced combined token volume comparable to one long run.",
      likelyFix: "Consider a continuous context window with checkpointed checkpoints instead of frequent resets.",
      evidenceSummary: `Cluster includes ${unique.length} session(s).`
    }
  ];
}

function aggregateModelBreakdowns(entries) {
  const grouped = new Map();
  for (const entry of entries) {
    if (!entry || !entry.model) {
      continue;
    }
    const current = grouped.get(entry.model) || {
      model: entry.model,
      inputTokens: 0,
      outputTokens: 0,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
      cost: 0
    };

    current.inputTokens += entry.inputTokens ?? 0;
    current.outputTokens += entry.outputTokens ?? 0;
    current.cacheWriteTokens += entry.cacheWriteTokens ?? 0;
    current.cacheReadTokens += entry.cacheReadTokens ?? 0;
    if (Number.isFinite(entry.cost)) {
      current.cost += entry.cost;
    }

    grouped.set(entry.model, current);
  }
  return [...grouped.values()];
}

function pickSeverity(count, base) {
  if (count >= 5) {
    return "high";
  }
  if (base >= 18 || count >= 3) {
    return "high";
  }
  if (count >= 2 || base >= 12) {
    return "medium";
  }
  return "low";
}

function quantile(values, pct) {
  if (!values.length) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * pct) - 1));
  return sorted[index];
}

function uniqueSessions(events) {
  const ids = [];
  for (const event of events) {
    const sessionId = event.sessionId || "unknown-session";
    if (!ids.includes(sessionId)) {
      ids.push(sessionId);
    }
  }
  return ids;
}

function timeDiffMs(current, previous) {
  const left = previous.startTimeMs ?? previous.endTimeMs ?? 0;
  const right = current.startTimeMs ?? current.endTimeMs ?? 0;
  return right - left;
}

function hasNearDuplicateSignature(left, right) {
  const leftSignature = left.raw?.commandSignature || "";
  const rightSignature = right.raw?.commandSignature || "";

  if (leftSignature && rightSignature) {
    if (leftSignature === rightSignature) {
      return true;
    }

    const leftHead2 = headTokens(leftSignature, 2);
    const rightHead2 = headTokens(rightSignature, 2);
    if (leftHead2 && rightHead2 && leftHead2 === rightHead2) {
      return true;
    }

    const leftHead3 = headTokens(leftSignature, 3);
    const rightHead3 = headTokens(rightSignature, 3);
    return Boolean(leftHead3 && rightHead3 && leftHead3 === rightHead3);
  }

  if (!leftSignature && !rightSignature) {
    const leftTool = left.raw?.toolCallSignature;
    const rightTool = right.raw?.toolCallSignature;
    return Boolean(leftTool) && leftTool === rightTool;
  }

  return false;
}

function headTokens(signature, count) {
  const tokens = signature.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < count) {
    return null;
  }
  return tokens.slice(0, count).join(" ");
}

function chooseEarlierTime(current, candidate) {
  if (!Number.isFinite(current)) {
    return candidate;
  }
  return Math.min(current, candidate);
}

function chooseLaterTime(current, candidate) {
  if (!Number.isFinite(current)) {
    return candidate;
  }
  return Math.max(current, candidate);
}

function clamp(value, min, max) {
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
