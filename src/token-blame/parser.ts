import { readFile } from "node:fs/promises";
import path from "node:path";

const TIMESTAMP_KEYS = [
  ["message", "timestamp"],
  ["message", "start_time"],
  ["message", "startTime"],
  ["startTime"],
  ["startedAt"],
  ["start"],
  ["timestamp"],
  ["session", "startTime"],
  ["activityStart"]
];

const END_TIME_KEYS = [
  ["message", "end_time"],
  ["message", "endTime"],
  ["endTime"],
  ["end"],
  ["finishedAt"],
  ["stoppedAt"],
  ["lastActivity"],
  ["session", "lastActivity"]
];

const RAW_TIMESTAMP_KEYS = [
  ["timestamp"],
  ["time"],
  ["loggedAt"],
  ["createdAt"]
];

const NUMBER_PATHS = {
  inputTokens: [
    ["message", "usage", "inputTokens"],
    ["message", "usage", "input_tokens"],
    ["inputTokens"],
    ["input_tokens"],
    ["usage", "inputTokens"],
    ["usage", "input_tokens"],
    ["usage", "totalInputTokens"]
  ],
  outputTokens: [
    ["message", "usage", "outputTokens"],
    ["message", "usage", "output_tokens"],
    ["outputTokens"],
    ["output_tokens"],
    ["usage", "outputTokens"],
    ["usage", "output_tokens"],
    ["usage", "totalOutputTokens"]
  ],
  cacheWriteTokens: [
    ["message", "usage", "cache_creation_input_tokens"],
    ["message", "usage", "cache_creation_tokens"],
    ["message", "usage", "cacheWriteTokens"],
    ["message", "usage", "cache_write_tokens"],
    ["cacheCreationTokens"],
    ["cache_creation_tokens"],
    ["cache_creation_input_tokens"],
    ["usage", "cache_creation_input_tokens"],
    ["cacheWriteTokens"],
    ["cache_write_tokens"]
  ],
  cacheReadTokens: [
    ["message", "usage", "cache_read_input_tokens"],
    ["message", "usage", "cache_read_tokens"],
    ["message", "usage", "cacheReadTokens"],
    ["cacheReadTokens"],
    ["cache_read_tokens"],
    ["cache_read_input_tokens"],
    ["usage", "cache_read_input_tokens"],
    ["usage", "cacheReadTokens"]
  ],
  totalTokens: [
    ["message", "usage", "total_tokens"],
    ["message", "usage", "totalTokens"],
    ["totalTokens"],
    ["total_tokens"],
    ["tokenCount"],
    ["usage", "total_tokens"]
  ],
  toolResultTokens: [
    ["message", "usage", "tool_result_tokens"],
    ["message", "usage", "toolOutputTokens"],
    ["message", "usage", "tool_output_tokens"],
    ["toolResultTokens"],
    ["tool_result_tokens"],
    ["tool_output_tokens"],
    ["tool", "resultTokens"],
    ["toolCall", "outputTokens"],
    ["tool_call", "result_tokens"],
    ["usage", "tool_output_tokens"]
  ],
  totalCost: [
    ["message", "usage", "cost"],
    ["message", "usage", "total_cost"],
    ["totalCost"],
    ["total_cost"],
    ["usage", "cost"]
  ]
};

const TOOL_RESULT_CONTEXT_PATHS = [
  ["tool_output_tokens"],
  ["toolResultTokens"],
  ["tool_result_tokens"],
  ["toolCall", "outputTokens"],
  ["result_tokens"]
];

export async function parseUsageFile(filePath) {
  let rawText;
  try {
    rawText = await readFile(filePath, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      throw new Error(`Cannot read usage input file: ${filePath}`);
    }
    throw new Error(`Unable to read usage input file: ${filePath}`);
  }

  return parseUsageText(rawText, { source: filePath });
}

export function parseUsageText(rawText, options = {}) {
  const source = options.source || "input";
  const fallbackSessionId = `inferred-${source}`;
  const trimmed = rawText.trim();
  if (!trimmed) {
    throw new Error(`Usage file is empty: ${source}`);
  }

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      return parseStructuredUsage(parsed, source);
    } catch (error) {
      // Fall through to JSONL parsing.
    }
  }

  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    throw new Error(`Usage file has no entries: ${source}`);
  }

  const sessions = [];
  const warnings = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    try {
      sessions.push(normalizeUsageEvent(JSON.parse(line), {
        index,
        fallbackSessionId,
        source
      }));
    } catch (error) {
      throw new Error(`Invalid JSONL at line ${index + 1} in ${source}: ${error.message}`);
    }
  }

  return { source, sessions, warnings };
}

function parseStructuredUsage(data, source) {
  const sessions = [];
  const warnings = [];
  const fallbackSessionId = `inferred-${source}`;

  if (!data || typeof data !== "object") {
    throw new Error(`Unsupported usage JSON shape in ${source}: expected object or array`);
  }

  if (Array.isArray(data)) {
    for (let index = 0; index < data.length; index += 1) {
      sessions.push(normalizeUsageEvent(data[index], {
        index,
        fallbackSessionId,
        source
      }));
    }
    return { source, sessions, warnings };
  }

  if (Array.isArray(data.data) && data.type === "session") {
    for (let index = 0; index < data.data.length; index += 1) {
      sessions.push(normalizeUsageEvent(data.data[index], {
        index,
        fallbackSessionId,
        source
      }));
    }
    return { source, sessions, warnings };
  }

  if (data.projects && isPlainObject(data.projects)) {
    for (const [projectPath, projectEntries] of Object.entries(data.projects)) {
      if (!Array.isArray(projectEntries)) {
        warnings.push(`Project entry ${projectPath} is not an array in ${source}.`);
        continue;
      }

      for (let index = 0; index < projectEntries.length; index += 1) {
        const entry = projectEntries[index];
        sessions.push(normalizeUsageEvent(entry, {
          index,
          projectPath,
          source,
          fallbackSessionId: `${fallbackSessionId}:project-${projectPath}`
        }));
      }
    }
    return { source, sessions, warnings };
  }

  sessions.push(normalizeUsageEvent(data, { index: 0, fallbackSessionId, source }));
  return { source, sessions, warnings };
}

export function normalizeUsageEvent(event, context = {}) {
  if (!event || typeof event !== "object") {
    throw new Error("Usage entry is not an object");
  }

  const sessionId = getFirstString(event, [
    ["message", "session_id"],
    ["message", "sessionId"],
    ["message", "session"],
    ["message", "session", "id"],
    ["message", "session", "sessionId"],
    ["message", "id"],
    ["session_id"],
    ["sessionId"],
    ["session"]
  ]) || context.fallbackSessionId || `inferred-${context.index ?? 0}`;
  const projectPath = getFirstString(event, [
    ["message", "caller"],
    ["message", "metadata", "project"],
    ["message", "metadata", "workspace"],
    ["message", "projectPath"],
    ["message", "project"],
    ["message", "rootPath"],
    ["message", "cwd"],
    ["message", "workingDirectory"],
    ["message", "path"],
    ["message", "workspace"],
    ["projectPath"],
    ["project_path"],
    ["project"],
    ["rootPath"],
    ["session", "projectPath"],
    ["session", "project"]
  ]) ||
    getFirstStringFromMessageContext(event, "project") ||
    getFirstStringFromMessageContext(event, "workspace") ||
    getFirstStringFromMessageContext(event, "cwd") ||
    getFirstStringFromMessageContext(event, "workingDirectory") ||
    getFirstStringFromMessageContext(event, "path") ||
    getFirstStringFromMessageContext(event, "projectPath") ||
    getFirstStringFromMessageContext(event, "rootPath") ||
    context.projectPath ||
    deriveProjectPathFromSource(context.source) ||
    "unknown-project";
  const modelList = extractModels(event);
  const startTimeMs = extractTimestamp(event, TIMESTAMP_KEYS);
  const endTimeMs = extractTimestamp(event, END_TIME_KEYS);
  const fallbackTs = extractTimestamp(event, RAW_TIMESTAMP_KEYS);

  const inputTokens = getFirstNumber(event, NUMBER_PATHS.inputTokens) ?? 0;
  const outputTokens = getFirstNumber(event, NUMBER_PATHS.outputTokens) ?? 0;
  const cacheWriteTokens = getFirstNumber(event, NUMBER_PATHS.cacheWriteTokens) ?? 0;
  const cacheReadTokens = getFirstNumber(event, NUMBER_PATHS.cacheReadTokens) ?? 0;
  const totalCost = getFirstNumber(event, NUMBER_PATHS.totalCost);
  const directToolResultTokens = sumByPathCandidates(event, NUMBER_PATHS.toolResultTokens);
  const contextToolResultTokens = extractToolResultTokensFromMessageContext(event);
  const toolResultTokens = directToolResultTokens + contextToolResultTokens;
  const explicitTotal = getFirstNumber(event, NUMBER_PATHS.totalTokens);
  const totalTokens = explicitTotal ?? (inputTokens + outputTokens + cacheWriteTokens + cacheReadTokens);
  const modelBreakdowns = normalizeModelBreakdowns(event);
  if (modelBreakdowns.length === 0 && modelList.length > 0) {
    modelBreakdowns.push({
      model: modelList[0],
      inputTokens,
      outputTokens,
      cacheWriteTokens,
      cacheReadTokens,
      cost: totalCost
    });
  }

  const commandText = getFirstString(event, [
    ["message", "command"],
    ["message", "userPrompt"],
    ["message", "prompt"],
    ["message", "input"],
    ["message", "content"],
    ["message", "text"],
    ["command"],
    ["userPrompt"],
    ["prompt"],
    ["input"],
    ["content"],
    ["message"],
    ["text"]
  ]);
  const toolName = getFirstString(event, [["tool"], ["toolName"], ["tool_name"]]);
  const toolCallSignature = normalizeSignature(getFirstString(event, [["toolCall"], ["tool_call"], ["toolCallName"]]) || "");
  const commandSignature = normalizeSignature(commandText || "");
  const isCommandLike = Boolean(
    commandText &&
      /(^|[\s,:;])(?:npm|pnpm|yarn|bun|git|curl|ls|find|cat|node|python|go|pytest|npm\s+run|npx|aws)\b/.test(
        commandText.toLowerCase()
      )
  );

  const raw = {
    command: commandSignature ? commandSignature.slice(0, 120) : null,
    tool: toolName || null,
    commandLike: isCommandLike,
    commandSignature,
    toolCallSignature,
    hasCommandText: Boolean(commandText && commandText.trim().length > 0),
    hasToolResultTokens: toolResultTokens > 0
  };

  return {
    sessionId,
    projectPath,
    modelList,
    inputTokens,
    outputTokens,
    cacheWriteTokens,
    cacheReadTokens,
    totalCost: Number.isFinite(totalCost) ? totalCost : undefined,
    totalTokens,
    startTimeMs: firstDefinedNumber(startTimeMs, fallbackTs),
    endTimeMs: firstDefinedNumber(endTimeMs, fallbackTs),
    raw,
    toolResultTokens,
    modelBreakdowns
  };
}

function getFirstStringFromMessageContext(event, key) {
  const contextItems = getByPath(event, ["message", "context"]);
  if (!Array.isArray(contextItems)) {
    return undefined;
  }

  for (const item of contextItems) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const direct = item[key];
    if (typeof direct === "string" && direct.trim()) {
      return direct.trim();
    }

    const nested = item.context;
    if (nested && typeof nested === "object" && typeof nested[key] === "string" && nested[key].trim()) {
      return nested[key].trim();
    }
  }

  return undefined;
}

function deriveProjectPathFromSource(source) {
  if (typeof source !== "string" || !source.endsWith(".jsonl")) {
    return undefined;
  }

  const parts = source.split(path.sep);
  if (!parts.includes("projects")) {
    return undefined;
  }

  return path.parse(source).name;
}

function normalizeModelBreakdowns(event) {
  const values = getByPath(event, ["modelBreakdowns"]) ?? getByPath(event, ["model_breakdowns"]) ?? getByPath(event, ["message", "modelBreakdowns"]);
  if (!Array.isArray(values)) {
    return [];
  }

  return values
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const normalizedModel = normalizeModelName(getFirstString(entry, [["model"], ["name"], ["id"]]));
      const model = normalizedModel || "unknown-model";

      return {
        model,
        inputTokens: getFirstNumber(entry, [["inputTokens"], ["input_tokens"], ["input"]]) ?? 0,
        outputTokens: getFirstNumber(entry, [["outputTokens"], ["output_tokens"], ["output"]]) ?? 0,
        cacheWriteTokens: getFirstNumber(entry, [["cacheCreationTokens"], ["cache_creation_tokens"], ["cache_write_tokens"], ["cacheCreationInputTokens"]]) ?? 0,
        cacheReadTokens: getFirstNumber(entry, [["cacheReadTokens"], ["cache_read_tokens"], ["cache_read_input_tokens"]]) ?? 0,
        cost: getFirstNumber(entry, [["cost"], ["costUSD"], ["totalCost"]])
      };
    })
    .filter(Boolean);
}

function extractModels(event) {
  const models = [];
  let messageModelFound = false;

  const addModel = (value, source = "top") => {
    const normalized = normalizeModelName(value);
    if (!normalized) {
      return;
    }
    if (!models.includes(normalized)) {
      models.push(normalized);
      if (source === "message") {
        messageModelFound = true;
      }
    }
  };

  const modelsUsed =
    getByPath(event, ["message", "modelsUsed"]) ??
    getByPath(event, ["message", "models"]) ??
    getByPath(event, ["modelsUsed"]) ??
    getByPath(event, ["models"]);

  if (Array.isArray(modelsUsed)) {
    for (const item of modelsUsed) {
      if (typeof item === "string" && item.trim()) {
        addModel(item, "message");
      }
    }
  }

  addModel(getFirstString(event, [["message", "provider", "model"]]), "message");
  addModel(getFirstString(event, [["message", "provider", "modelId"]]), "message");
  addModel(getFirstString(event, [["message", "provider", "name"]]), "message");
  addModel(getFirstString(event, [["message", "metadata", "model"]]), "message");
  addModel(getFirstString(event, [["message", "metadata", "modelId"]]), "message");
  addModel(getFirstString(event, [["message", "request", "model"]]), "message");
  addModel(getFirstString(event, [["message", "params", "model"]]), "message");
  addModel(getFirstString(event, [["message", "model_name"]]), "message");
  addModel(getFirstString(event, [["message", "model"]]), "message");
  addModel(getFirstString(event, [["message", "modelName"]]), "message");
  addModel(getFirstString(event, [["message", "model", "id"]]), "message");

  if (!messageModelFound) {
    addModel(getFirstString(event, [["provider", "model"]]), "top");
    addModel(getFirstString(event, [["provider", "modelId"]]), "top");
    addModel(getFirstString(event, [["provider", "name"]]), "top");
    addModel(getFirstString(event, [["metadata", "model"]]), "top");
    addModel(getFirstString(event, [["metadata", "modelId"]]), "top");
    addModel(getFirstString(event, [["request", "model"]]), "top");
    addModel(getFirstString(event, [["params", "model"]]), "top");
    addModel(getFirstString(event, [["model_name"]]), "top");
    addModel(getFirstString(event, [["model"]]), "top");
    addModel(getFirstString(event, [["modelName"]]), "top");
  }
  for (const breakdown of normalizeModelBreakdowns(event)) {
    addModel(breakdown.model);
  }

  if (models.length === 0) {
    return ["unknown-model"];
  }

  return [...new Set(models)];
}

function normalizeModelName(value) {
  if (typeof value !== "string") {
    return undefined;
  }

  let normalized = value.trim().toLowerCase().replace(/["'`]/g, "");
  if (!normalized) {
    return undefined;
  }

  const providerPrefix = normalized.match(/^([^/]+)\/(.+)$/);
  if (providerPrefix && looksLikeProviderPrefix(providerPrefix[1])) {
    normalized = providerPrefix[2];
  }

  if (normalized.includes("@")) {
    normalized = normalized.replace(/@[^@]+$/g, "");
  }

  const hasVersionTag = normalized.match(/^(.*):([^:]+)$/);
  if (hasVersionTag && !/^[0-9]/.test(hasVersionTag[2])) {
    normalized = hasVersionTag[1];
  }

  normalized = normalized.replace(/\(.*\)$/g, "");
  return normalized.trim() || undefined;
}

function looksLikeProviderPrefix(value) {
  return ["openai", "anthropic", "google", "azure", "bedrock", "aws", "meta", "cohere", "groq"].includes(value);
}

function firstDefinedNumber(...values) {
  for (const value of values) {
    if (Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

function extractToolResultTokensFromMessageContext(event) {
  const contextItems = getByPath(event, ["message", "context"]);
  if (!Array.isArray(contextItems)) {
    return 0;
  }

  let total = 0;
  for (const item of contextItems) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const contextValue = item.context;
    if (!contextValue || typeof contextValue !== "object") {
      continue;
    }

    for (const path of TOOL_RESULT_CONTEXT_PATHS) {
      const value = coerceFiniteNumber(getByPath(contextValue, path));
      if (Number.isFinite(value)) {
        total += value;
      }
    }
  }

  return total;
}

function extractTimestamp(event, candidates) {
  for (const path of candidates) {
    const raw = getByPath(event, path);
    const asNumber = coerceTimestamp(raw);
    if (Number.isFinite(asNumber)) {
      return asNumber;
    }
  }
  return undefined;
}

function coerceTimestamp(value) {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 1_000_000_000_000 ? value * 1000 : value;
  }

  if (typeof value === "string") {
    const direct = Number(value);
    if (Number.isFinite(direct)) {
      return direct < 1_000_000_000_000 ? direct * 1000 : direct;
    }
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
  }
  }
  return undefined;
}

function sumByPathCandidates(source, candidates) {
  let total = 0;
  for (const path of candidates) {
    const value = coerceFiniteNumber(getByPath(source, path));
    if (Number.isFinite(value)) {
      total += value;
    }
  }
  return total;
}

function normalizeSignature(input) {
  if (!input) {
    return null;
  }
  return input
    .toLowerCase()
    .replace(/["'`]/g, "")
    .replace(/\b[0-9a-f]{10,}\b/gi, "<id>")
    .replace(/\b\d+\b/g, "<num>")
    .replace(/\s+/g, " ")
    .trim();
}

function getByPath(source, pathParts) {
  let current = source;
  for (const part of pathParts) {
    if (!current || typeof current !== "object" || !Object.prototype.hasOwnProperty.call(current, part)) {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

function getFirstString(source, candidates) {
  for (const candidate of candidates) {
    const value = getByPath(source, candidate);
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function getFirstNumber(source, candidates) {
  for (const candidate of candidates) {
    const raw = getByPath(source, candidate);
    const value = coerceFiniteNumber(raw);
    if (Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

function coerceFiniteNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
