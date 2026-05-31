import { access, readFile, readdir, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import {
  AUDIT_THRESHOLDS,
  INSTRUCTION_FILE_NAMES,
  INSTRUCTION_SCAN_EXCLUDE_DIRS,
  NOISY_PATH_HINTS,
  NOISY_REFERENCE_PATH_HINTS
} from "./constants.js";

const require = createRequire(import.meta.url);

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function toProjectRelative(projectPath, absolutePath) {
  const rel = path.relative(projectPath, absolutePath);
  if (rel === "") {
    return ".";
  }
  return rel.startsWith(`..${path.sep}`) || rel === ".." ? absolutePath : rel;
}

function buildFinding({ id, title, severity, scope = "project", filePath, detail, recommendation, costMechanism }) {
  const result = {
    id,
    title,
    severity,
    scope,
    detail,
    recommendation
  };
  if (filePath) {
    result.path = filePath;
  }
  if (costMechanism) {
    result.costMechanism = costMechanism;
  }
  return result;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function readText(filePath) {
  return readFile(filePath, "utf8");
}

function hasAnyKey(value, keys) {
  return keys.some((key) => Object.prototype.hasOwnProperty.call(value, key));
}

async function collectInstructionFiles(projectPath) {
  const all = [];
  const items = await readdir(projectPath, { withFileTypes: true });

  for (const item of items) {
    if (INSTRUCTION_SCAN_EXCLUDE_DIRS.includes(item.name)) {
      continue;
    }

    const child = path.join(projectPath, item.name);
    if (item.isDirectory()) {
      const nested = await collectInstructionFiles(child);
      all.push(...nested);
      continue;
    }

    if (INSTRUCTION_FILE_NAMES.includes(item.name)) {
      all.push(child);
    }
  }

  return all;
}

async function collectFilesForStats(rootPath) {
  const items = [];
  const walk = async (dirPath) => {
    const entries = await readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === ".git") {
        continue;
      }

      const child = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") {
          continue;
        }
        await walk(child);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const statInfo = await stat(child);
      items.push({
        absolutePath: child,
        relativePath: path.relative(rootPath, child),
        size: statInfo.size
      });
    }
  };

  await walk(rootPath);
  return items;
}

function parseGitignore(ignoreText) {
  const exact = new Set();
  const suffix = new Set();

  for (const rawLine of ignoreText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("!")) {
      continue;
    }

    const normalized = line.replace(/^\//, "");
    if (normalized.endsWith("/")) {
      exact.add(normalized.slice(0, -1));
      continue;
    }
    if (normalized.includes("*")) {
      suffix.add(normalized);
      continue;
    }
    exact.add(normalized);
  }

  return { exact, suffix };
}

function isIgnored(relativePath, parsed) {
  const normalized = relativePath.replace(/\\/g, "/");
  const parts = normalized.split("/");

  for (const pattern of parsed.exact) {
    const normalizedPattern = pattern.replace(/\\/g, "/");
    if (normalized === normalizedPattern || normalized.startsWith(`${normalizedPattern}/`) || parts.includes(normalizedPattern)) {
      return true;
    }
  }

  const lower = normalized.toLowerCase();
  for (const pattern of parsed.suffix) {
    const lowerPattern = pattern.toLowerCase();
    if (lowerPattern.startsWith("*.") && lower.endsWith(lowerPattern.slice(1))) {
      return true;
    }
    if (lower.includes(lowerPattern)) {
      return true;
    }
  }

  return false;
}

function isTextLike(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const allow = [
    ".md",
    ".txt",
    ".json",
    ".toml",
    ".yaml",
    ".yml",
    ".js",
    ".ts",
    ".jsx",
    ".tsx",
    ".mjs",
    ".cjs",
    ".py",
    ".go",
    ".css",
    ".html",
    ".xml",
    ".ini",
    ".cfg",
    ".sh",
    ".bash"
  ];
  return ext === "" || allow.includes(ext);
}

function normalizeLine(line) {
  return line
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .replace(/\bhttps?:\/\/[^\s]+/g, "")
    .trim();
}

function isLikelyReference(reference) {
  if (!reference || reference.length < 2) {
    return false;
  }

  if (/^[a-z0-9_.-]+$/i.test(reference) && !reference.includes("/") && !reference.includes(".")) {
    return false;
  }

  return reference.startsWith(".") || reference.startsWith("/") || reference.includes("/") || reference.includes(".");
}

function noisyCommand(line) {
  const patterns = [
    /\bnpm\s+(run\s+)?(test|coverage|lint|install|build)/i,
    /\byarn\s+(run\s+)?(test|coverage|lint|install|build)/i,
    /\bpnpm\s+(run\s+)?(test|coverage|lint|install|build)/i,
    /\bbun\s+(run\s+)?(test|coverage|lint|install|build)/i,
    /\bgo\s+test\b/i,
    /\bpytest\b/i,
    /\bjest\b/i,
    /\bvitest\b/i,
    /\bgit\s+diff\b/i,
    /\btree\b/i,
    /--update(?:-snapshot)?/i
  ];
  return patterns.some((pattern) => pattern.test(line));
}

function hasOutputCap(line) {
  const hints = [
    /\b--silent\b/i,
    /\b--quiet\b/i,
    /\b--json\b/i,
    /\b--porcelain\b/i,
    /\btail\s+-n\b/i,
    /--max-warnings/i,
    /--testNamePattern/i,
    /\b-k\b/i,
    /--targeted/i,
    /\b--changed\b/i
  ];
  return hints.some((pattern) => pattern.test(line));
}

function mentionsTokens(lowerText, tokens) {
  return tokens.some((token) => lowerText.includes(token));
}

function maybeAddUnique(findings, candidate) {
  const signature = `${candidate.id}|${candidate.path || ""}`;
  const exists = findings.some((existing) => `${existing.id}|${existing.path || ""}` === signature);
  if (!exists) {
    findings.push(candidate);
  }
}

function scanInstructionSize(rel, text) {
  const findings = [];
  const lines = text.split(/\r?\n/).length;
  const bytes = Buffer.byteLength(text, "utf8");

  if (lines > AUDIT_THRESHOLDS.instructionHighLines || bytes > AUDIT_THRESHOLDS.instructionHighBytes) {
    findings.push(
      buildFinding({
        id: "project.instruction-size.high",
        title: "Instruction file is oversized",
        severity: "high",
        filePath: rel,
        detail: `Has ${lines} lines and ${bytes} bytes.`,
        recommendation: "Move task-specific detail to referenced documents or command-level notes.",
        costMechanism: "startup_context"
      })
    );
    return findings;
  }

  if (lines > AUDIT_THRESHOLDS.instructionWarningLines || bytes > AUDIT_THRESHOLDS.instructionWarningBytes) {
    findings.push(
      buildFinding({
        id: "project.instruction-size.medium",
        title: "Instruction file is oversized",
        severity: "medium",
        filePath: rel,
          detail: `Has ${lines} lines and ${bytes} bytes.`,
        recommendation: "Split instructions by workflow and keep startup context concise.",
        costMechanism: "startup_context"
      })
    );
  }

  return findings;
}

function scanInstructionDuplicates(rel, text) {
  const findings = [];
  const headings = new Map();
  const normalizedLines = new Map();

  for (const line of text.split(/\r?\n/)) {
    const headingMatch = line.match(/^\s*#+\s*(.+)$/);
    if (headingMatch) {
      const heading = headingMatch[1].trim().toLowerCase();
      if (heading) {
        headings.set(heading, (headings.get(heading) || 0) + 1);
      }
    }

    const normalized = normalizeLine(line);
    if (normalized.length >= 20) {
      normalizedLines.set(normalized, (normalizedLines.get(normalized) || 0) + 1);
    }
  }

  for (const [heading, count] of headings.entries()) {
    if (count > 1) {
      findings.push(
        buildFinding({
          id: "project.instruction-duplicate.heading",
          title: "Duplicate heading in instruction file",
          severity: "low",
          filePath: rel,
          detail: `Heading repeats (${count} times): ${heading}`,
          recommendation: "Keep one canonical section per heading.",
          costMechanism: "retries"
        })
      );
      break;
    }
  }

  for (const [line, count] of normalizedLines.entries()) {
    if (count > 1) {
      findings.push(
        buildFinding({
          id: "project.instruction-duplicate.line",
          title: "Near-duplicate instruction lines",
          severity: "low",
          filePath: rel,
          detail: `A normalized instruction line appears ${count} times: ${line}`,
          recommendation: "Deduplicate meaningful lines to reduce startup churn.",
          costMechanism: "retries"
        })
      );
      break;
    }
  }

  const lower = text.toLowerCase();
  const managerTokens = ["npm", "yarn", "pnpm", "bun"].filter((item) => lower.includes(item));
  if (managerTokens.length > 1) {
    findings.push(
      buildFinding({
        id: "project.instruction-conflict.package-manager",
        title: "Conflicting package manager guidance",
        severity: "medium",
        filePath: rel,
        detail: `Mentions multiple package managers: ${managerTokens.join(", ")}`,
        recommendation: "Use one canonical package manager across startup instructions.",
        costMechanism: "retries"
      })
    );
  }

  if (/always run full tests?/i.test(text) && /target(ed)?\s+test/i.test(text)) {
    findings.push(
      buildFinding({
        id: "project.instruction-conflict.test-scope",
        title: "Conflicting test scope instructions",
        severity: "low",
        filePath: rel,
        detail: "Both full-suite and targeted-test defaults appear in the same instruction set.",
        recommendation: "State one default verification strategy with explicit escalation rules.",
        costMechanism: "retries"
      })
    );
  }

  const conflictPairs = [
    ["prettier", "biome"],
    ["eslint", "biome"],
    ["jest", "vitest"],
    ["npm", "pnpm"]
  ];
  for (const [left, right] of conflictPairs) {
    if (lower.includes(left) && lower.includes(right)) {
      findings.push(
        buildFinding({
          id: `project.instruction-conflict.${left}-vs-${right}`,
          title: "Conflicting tooling references",
          severity: "low",
          filePath: rel,
          detail: `Both ${left} and ${right} appear as active tooling references.`,
          recommendation: "Keep one canonical stack and move alternatives to explicit exception sections.",
          costMechanism: "retries"
        })
      );
      break;
    }
  }

  return findings;
}

function scanInstructionVolatile(rel, text) {
  const findings = [];
  const patterns = [
    /\b\d{4}-\d{2}-\d{2}\b/, // date
    /\b\d{1,2}:\d{2}(:\d{2})?\b/, // timestamp
    /\b[0-9a-f]{7,40}\b/i, // hash-like
    /\bbranch\b\s*[:\-]\s*\S+/i,
    /\bgenerated\s+at\b|\blast\s+updated\b|\brecent\b/i,
    /^\s*#+\s*(todo|status|wip)/i
  ];
  const hit = [];

  for (const line of text.split(/\r?\n/)) {
    for (const pattern of patterns) {
      if (pattern.test(line)) {
        hit.push(pattern.toString());
      }
    }
  }

  if (hit.length > 0) {
    findings.push(
      buildFinding({
        id: "project.instruction-volatile",
        title: "Volatile instruction content",
        severity: "medium",
        filePath: rel,
        detail: "Instruction file appears to contain timestamps, dates, hashes, or status sections.",
        recommendation: "Move temporary status and run history to session notes or issue logs.",
        costMechanism: "cache_miss"
      })
    );
  }

  return findings;
}

function isInsideProject(projectPath, filePath) {
  const relative = path.relative(projectPath, filePath);
  return !relative.startsWith(`..${path.sep}`) && relative !== "..";
}

async function scanInstructionReferences(projectPath, absPath, relPath, text) {
  const findings = [];
  const matches = text.matchAll(/@([^\s`"'()<>\[\]{}]+)/g);
  const entries = [...matches]
    .map((match) => match[1].replace(/["'`>\],]/g, ""))
    .filter(isLikelyReference)
    .filter((value, index, all) => all.indexOf(value) === index);

  if (entries.length === 0) {
    return findings;
  }

  const dir = path.dirname(absPath);
  const lockFiles = new Set(["package-lock.json", "yarn.lock", "pnpm-lock.yaml"]);

  for (const entry of entries) {
    const resolved = path.resolve(dir, entry);
    if (!isInsideProject(projectPath, resolved)) {
      continue;
    }

    if (!(await exists(resolved))) {
      continue;
    }

    const statResult = await stat(resolved);
    if (!statResult.isFile()) {
      continue;
    }

    const basename = path.basename(resolved);
    const lower = basename.toLowerCase();
    const size = statResult.size;
    const relResolved = toProjectRelative(projectPath, resolved);

    const isLarge = size > AUDIT_THRESHOLDS.referencedHighBytes || size > AUDIT_THRESHOLDS.referencedWarningBytes;
    const isKnownLargeKind = lockFiles.has(basename) || NOISY_REFERENCE_PATH_HINTS.some((name) => lower.includes(name));

    if (isLarge || isKnownLargeKind || lower === "readme.md") {
      findings.push(
        buildFinding({
          id: isLarge && size > AUDIT_THRESHOLDS.referencedHighBytes ? "project.instruction-ref.large-high" : "project.instruction-ref.large",
          title: "Instruction references a large/noisy file",
          severity: isLarge && size > AUDIT_THRESHOLDS.referencedHighBytes ? "medium" : "low",
          filePath: relResolved,
          detail: `Referenced path from ${relPath}: ${relResolved} (${size} bytes).`,
          recommendation: "Keep imported instruction references focused and small.",
          costMechanism: "cache_miss"
        })
      );
    }
  }

  return findings;
}

function detectNoisyPathPresence(projectPath, files) {
  const present = {
    paths: [],
    generatedClients: false,
    snapshots: false,
    sourceMaps: false,
    minified: false
  };

  for (const hint of NOISY_PATH_HINTS) {
    if (existsSync(path.join(projectPath, hint))) {
      present.paths.push(hint);
    }
  }

  for (const item of files) {
    const rel = item.relativePath.toLowerCase();
    if (!present.generatedClients && /generated/.test(rel) && /client/.test(rel)) {
      present.generatedClients = true;
    }
    if (!present.snapshots && /snapshot/.test(rel)) {
      present.snapshots = true;
    }
    if (!present.sourceMaps && rel.endsWith(".map")) {
      present.sourceMaps = true;
    }
    if (!present.minified && /\.min\.(js|css|mjs|cjs)$/.test(rel)) {
      present.minified = true;
    }
  }

  return present;
}

function scanMissingNoisyPathGuidance(mergedInstructionText, presence) {
  const findings = [];
  const lowerText = mergedInstructionText.toLowerCase();

  for (const pathToken of NOISY_PATH_HINTS) {
    if (presence.paths.includes(pathToken) && !lowerText.includes(pathToken)) {
      findings.push(
        buildFinding({
          id: "project.noisy-path-guidance",
          title: "Noisy path exists but guidance does not mention avoiding it",
          severity: "low",
          filePath: pathToken,
          detail: `${pathToken} exists, but guidance for skipping noisy output is missing.`,
          recommendation: "Add a short avoid/noise section for generated paths.",
          costMechanism: "tool_output"
        })
      );
    }
  }

  const generatedFindings = [
    ["generated clients", presence.generatedClients],
    ["snapshots", presence.snapshots],
    ["source maps", presence.sourceMaps],
    ["minified bundles", presence.minified]
  ];

  for (const [label, present] of generatedFindings) {
    if (present && !lowerText.includes(label)) {
      findings.push(
        buildFinding({
          id: "project.noisy-path-guidance",
          title: "Noisy output type exists but guidance does not mention it",
          severity: "low",
          filePath: label,
          detail: `${label} exist in repository and should be avoided in startup context.`,
          recommendation: "Document generated artifacts and skip rules for these outputs.",
          costMechanism: "tool_output"
        })
      );
    }
  }

  return findings;
}

function scanGitignore(projectPath, files) {
  const findings = [];
  const gitignorePath = path.join(projectPath, ".gitignore");
  if (!existsSync(gitignorePath)) {
    findings.push(
      buildFinding({
        id: "project.gitignore-missing",
        title: "Project has no .gitignore",
        severity: "medium",
        filePath: ".gitignore",
        detail: "A project without .gitignore can accidentally surface generated files in local workflows.",
        recommendation: "Add a .gitignore entry for noisy directories and generated artifacts.",
        costMechanism: "tool_output"
      })
    );
  }

  let parsedIgnore = { exact: new Set(), suffix: new Set() };
  if (existsSync(gitignorePath)) {
    const raw = requireSyncRead(gitignorePath);
    parsedIgnore = parseGitignore(raw);
  }

  for (const token of NOISY_PATH_HINTS) {
    const tokenPath = path.join(projectPath, token);
    if (!existsSync(tokenPath)) {
      continue;
    }

    if (!isIgnored(token, parsedIgnore)) {
      findings.push(
        buildFinding({
          id: "project.gitignore-missing-noisy-path",
          title: "Noisy path not ignored",
          severity: "medium",
          filePath: token,
          detail: `Path ${token} exists but no corresponding .gitignore rule was detected.`,
          recommendation: "Add ignore rules for noisy directories and generated files.",
          costMechanism: "tool_output"
        })
      );
    }
  }

  for (const item of files) {
    if (isIgnored(item.relativePath, parsedIgnore)) {
      continue;
    }

    if (item.size > AUDIT_THRESHOLDS.largeAnyBytes) {
      findings.push(
        buildFinding({
          id: "project.unignored.large-file",
          title: "Large unignored file",
          severity: "high",
          filePath: item.relativePath,
          detail: `File is ${item.size} bytes and not ignored by .gitignore.`,
          recommendation: "Ignore or partition large files to keep local snapshots clean.",
          costMechanism: "tool_output"
        })
      );
      continue;
    }

    if (isTextLike(item.absolutePath) && item.size > AUDIT_THRESHOLDS.largeTextBytes) {
      findings.push(
        buildFinding({
          id: "project.unignored.large-text",
          title: "Large unignored text file",
          severity: "medium",
          filePath: item.relativePath,
          detail: `Text file is ${item.size} bytes and not ignored by .gitignore.`,
          recommendation: "Add ignore entries for large generated text artifacts.",
          costMechanism: "tool_output"
        })
      );
    }
  }

  return findings;
}

function parseMcpEntries(config) {
  if (!isObject(config)) {
    return [];
  }
  if (isObject(config.mcpServers)) {
    return Object.entries(config.mcpServers).map(([name, cfg]) => ({ name, cfg }));
  }
  if (Array.isArray(config.servers)) {
    return config.servers.map((item, index) => ({ name: item.name || `server-${index + 1}`, cfg: item }));
  }
  if (isObject(config.servers)) {
    return Object.entries(config.servers).map(([name, cfg]) => ({ name, cfg }));
  }
  return [];
}

function hasAllowList(cfg) {
  if (!isObject(cfg)) {
    return false;
  }
  const allowListKeys = [
    "toolAllowlist",
    "tool_allowlist",
    "tools",
    "allowedTools",
    "toolFilters",
    "allowed_tools"
  ];

  return allowListKeys.some((key) => {
    const value = cfg[key];
    return Array.isArray(value) && value.length > 0;
  });
}

async function scanMcp(projectPath, pathCandidates, scope = "project") {
  const findings = [];

  for (const candidate of pathCandidates) {
    if (!(await exists(candidate.absolute))) {
      continue;
    }

    let config = null;
    try {
      config = await readJson(candidate.absolute);
    } catch {
      findings.push(
        buildFinding({
          id: `${scope}.mcp-config-unparseable`,
          title: "MCP config exists but is not parseable",
          severity: "low",
          filePath: candidate.label,
          detail: "File was unreadable as JSON; contents were not printed.",
          recommendation: "Validate the config file format before auditing MCP surface.",
          costMechanism: "tool_surface"
        })
      );
      continue;
    }

    const entries = parseMcpEntries(config);
    if (entries.length === 0) {
      continue;
    }

    if (entries.length > AUDIT_THRESHOLDS.mcpHighServers) {
      findings.push(
        buildFinding({
          id: `${scope}.mcp-servers-high-count`,
          title: "Many MCP servers configured",
          severity: "high",
          filePath: candidate.label,
          detail: `Detected ${entries.length} MCP servers.`,
          recommendation: "Reduce enabled servers and keep only needed ones.",
          costMechanism: "tool_surface"
        })
      );
    } else if (entries.length > AUDIT_THRESHOLDS.mcpWarningServers) {
      findings.push(
        buildFinding({
          id: `${scope}.mcp-servers-many`,
          title: "MCP server count is high",
          severity: "medium",
          filePath: candidate.label,
          detail: `Detected ${entries.length} MCP servers.`,
          recommendation: "Reduce enabled servers until only current needs remain.",
          costMechanism: "tool_surface"
        })
      );
    }

    const broad = entries.filter(({ cfg }) => !hasAllowList(cfg)).length;
    if (broad > 0) {
      findings.push(
        buildFinding({
        id: `${scope}.mcp-broad-tools`,
          title: "MCP server entries without explicit allowlists",
          severity: "low",
          filePath: candidate.label,
          detail: `${broad} MCP entries did not declare explicit tool allowlists.`,
          recommendation: "Add explicit allowlists or tool filters to shrink tool surface.",
          costMechanism: "tool_surface"
        })
      );
    }
  }

  return findings;
}

async function scanNoOutputTrimming(projectPath, packageJson, instructionText) {
  const findings = [];
  const filesWithNoisy = [];

  if (packageJson && isObject(packageJson.scripts)) {
    for (const [name, raw] of Object.entries(packageJson.scripts)) {
      const line = String(raw);
      if (noisyCommand(line) && !hasOutputCap(line)) {
        filesWithNoisy.push(`package.json:${name}`);
      }
    }
  }

  const makefilePath = path.join(projectPath, "Makefile");
  if (await exists(makefilePath)) {
    const text = await readText(makefilePath);
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith("\t")) {
        continue;
      }
      if (noisyCommand(line) && !hasOutputCap(line)) {
        filesWithNoisy.push("Makefile");
        break;
      }
    }
  }

  const pyprojectPath = path.join(projectPath, "pyproject.toml");
  if (await exists(pyprojectPath)) {
    const text = await readText(pyprojectPath);
    for (const line of text.split(/\r?\n/)) {
      if (noisyCommand(line) && !hasOutputCap(line)) {
        filesWithNoisy.push("pyproject.toml");
        break;
      }
    }
  }

  const scriptsDir = path.join(projectPath, "scripts");
  if (await exists(scriptsDir)) {
    const entries = await readdir(scriptsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }
      const scriptPath = path.join(scriptsDir, entry.name);
      const text = await readText(scriptPath);
      for (const line of text.split(/\r?\n/)) {
        if (noisyCommand(line) && !hasOutputCap(line)) {
          filesWithNoisy.push(`scripts/${entry.name}`);
          break;
        }
      }
    }
  }

  for (const line of instructionText.split(/\r?\n/)) {
    if (noisyCommand(line) && !hasOutputCap(line)) {
      filesWithNoisy.push("instruction file guidance");
      break;
    }
  }

  if (filesWithNoisy.length > 0) {
    findings.push(
      buildFinding({
        id: "project.output-trimming",
        title: "Potentially noisy commands lack output trimming",
        severity: "medium",
        filePath: [...new Set(filesWithNoisy)].join(", "),
        detail: "Noisy commands were found without --quiet/--silent/--json or explicit target flags.",
        recommendation: "Add concise variants or output caps to reduce review noise.",
        costMechanism: "tool_output"
      })
    );
  }

  return findings;
}

function scriptCategoryCoverage(scriptName, scriptValue, categories) {
  const loweredName = String(scriptName).toLowerCase();
  const loweredValue = String(scriptValue).toLowerCase();
  const haystack = `${loweredName} ${loweredValue}`;

  const contains = (needles) => needles.some((needle) => haystack.includes(needle));
  return {
    install: contains(["install", "ci", "i "]),
    lint: contains(["lint"]),
    typecheck: contains(["typecheck", "type-check", "tsc"]),
    unitTest: contains(["test:unit", " unit", "jest", "pytest", "vitest"]),
    fullTest: contains(["test", "coverage"]),
    build: contains(["build"])
  };
}

function scanVerificationLadder(packageJson, instructionText) {
  const findings = [];
  if (!isObject(packageJson) || !isObject(packageJson.scripts)) {
    return findings;
  }

  const lowerInstruction = instructionText.toLowerCase();
  const categories = {
    install: {
      id: "project.verify-missing.install",
      title: "Install command guidance missing",
      recommendation: "Document install command in instruction files.",
      terms: ["npm install", "yarn install", "pnpm install", "bun install", "npm ci"]
    },
    lint: {
      id: "project.verify-missing.lint",
      title: "Lint command guidance missing",
      recommendation: "Document lint command and when to run it.",
      terms: ["lint", "eslint", "biome"]
    },
    typecheck: {
      id: "project.verify-missing.typecheck",
      title: "Typecheck command guidance missing",
      recommendation: "Document a local typecheck step.",
      terms: ["typecheck", "type-check", "tsc", "pyright", "mypy"]
    },
    unitTest: {
      id: "project.verify-missing.unit-test",
      title: "Targeted test guidance missing",
      recommendation: "Document a targeted test command for local iteration.",
      terms: ["test:unit", "--run", "--changed", "-k ", "targeted", "vitest", "pytest -k"]
    },
    fullTest: {
      id: "project.verify-missing.full-test",
      title: "Full test guidance missing",
      recommendation: "Document a full verification command for milestones.",
      terms: ["npm test", "yarn test", "pnpm test", "bun test", "coverage", "full test"]
    },
    build: {
      id: "project.verify-missing.build",
      title: "Build guidance missing",
      recommendation: "Document build command in instruction set.",
      terms: ["npm run build", "yarn build", "pnpm build", "bun build"]
    }
  };

  for (const [key, category] of Object.entries(categories)) {
    let hasScript = false;
    for (const [scriptName, scriptValue] of Object.entries(packageJson.scripts)) {
      const coverage = scriptCategoryCoverage(scriptName, scriptValue, null);
      if (coverage[key]) {
        hasScript = true;
        break;
      }
    }

    if (!hasScript) {
      continue;
    }

    if (!mentionsTokens(lowerInstruction, category.terms)) {
      findings.push(
        buildFinding({
          id: category.id,
          title: category.title,
          severity: key === "unitTest" || key === "fullTest" ? "medium" : "low",
          detail: "A script for this step exists, but instruction docs do not provide a documented ladder guidance.",
          recommendation: category.recommendation,
          costMechanism: "retries"
        })
      );
    }
  }

  return findings;
}

function scanUsageVisibility(projectPath, filesText, instructionText) {
  const findings = [];
  const markers = [
    "ccusage",
    "claude-usage",
    "statusline",
    "usage report",
    "usage summary",
    "token usage",
    "cost review",
    "codex session"
  ];

  const lowerAll = `${filesText.toLowerCase()}\n${instructionText.toLowerCase()}`;
  if (!mentionsTokens(lowerAll, markers)) {
    findings.push(
      buildFinding({
        id: "project.usage-visibility-missing",
        title: "Usage visibility signal is missing",
        severity: "low",
        detail: "No local usage visibility tool or statusline markers were found in local docs.",
        recommendation: "Add a local usage report command or local visibility note.",
        costMechanism: "visibility"
      })
    );
  }

  return findings;
}

export async function scanProject(options) {
  const projectPath = options.projectPath;
  const findings = [];

  const packageJsonPath = path.join(projectPath, "package.json");
  if (await exists(packageJsonPath)) {
    try {
      const packageJson = await readJson(packageJsonPath);
      const scripts = packageJson && isObject(packageJson.scripts) ? packageJson.scripts : {};
      const agentScripts = Object.entries(scripts).filter(([name, value]) => {
        return /agent|audit|eval|prompt|llm|token/i.test(String(name)) || /agent|eval|prompt|llm|token/i.test(String(value));
      });

      if (agentScripts.length > 0 && typeof scripts["cost:audit"] !== "string") {
        findings.push(
          buildFinding({
            id: "project.missing-cost-audit-script",
            title: "Agent-related scripts do not include a local cost audit entry",
            severity: "low",
            filePath: "package.json",
            detail: "Package scripts mention agent or token workflows, but no cost:audit script exists.",
            recommendation: "Add a local script that runs this audit before heavy agent operations.",
            costMechanism: "retries"
          })
        );
      }
    } catch {
      findings.push(
        buildFinding({
          id: "project.package-json-unparseable",
          title: "package.json exists but could not be parsed",
          severity: "low",
          filePath: "package.json",
          detail: "Could not parse package.json. Contents were not printed.",
          recommendation: "Fix package.json format before this audit relies on scripts.",
          costMechanism: "tool_output"
        })
      );
    }
  }

  const envPath = path.join(projectPath, ".env");
  if (await exists(envPath)) {
    findings.push(
      buildFinding({
        id: "project.env-file-present",
        title: "Project contains a .env file",
        severity: "high",
        filePath: ".env",
        detail: "Local environment files can include secrets and provider settings.",
        recommendation: "Use env examples and keep secret files untracked.",
        costMechanism: "visibility"
      })
    );
  }

  const instructionPaths = await collectInstructionFiles(projectPath);
  const instructionTextsByPath = {};
  for (const instructionPath of instructionPaths) {
    instructionTextsByPath[instructionPath] = await readText(instructionPath);
  }

  const instructionData = Object.entries(instructionTextsByPath).map(([absPath, text]) => ({
    absolutePath: absPath,
    relativePath: toProjectRelative(projectPath, absPath),
    text
  }));
  const mergedInstructionText = instructionData.map((item) => item.text).join("\n");

  for (const entry of instructionData) {
    findings.push(
      ...scanInstructionSize(entry.relativePath, entry.text),
      ...scanInstructionDuplicates(entry.relativePath, entry.text),
      ...scanInstructionVolatile(entry.relativePath, entry.text),
      ...await scanInstructionReferences(projectPath, entry.absolutePath, entry.relativePath, entry.text)
    );
  }

  const fileItems = await collectFilesForStats(projectPath);
  const pathPresence = detectNoisyPathPresence(projectPath, fileItems);

  findings.push(...scanMissingNoisyPathGuidance(mergedInstructionText, pathPresence));
  findings.push(...scanGitignore(projectPath, fileItems));

  const projectMcpCandidates = [
    { absolute: path.join(projectPath, ".mcp.json"), label: ".mcp.json" },
    { absolute: path.join(projectPath, ".claude", "settings.json"), label: ".claude/settings.json" }
  ];
  findings.push(...await scanMcp(projectPath, projectMcpCandidates));

  const packageJsonData = (await exists(packageJsonPath)) ? await readJson(packageJsonPath).catch(() => ({})) : {};
  findings.push(...(await scanNoOutputTrimming(projectPath, packageJsonData, mergedInstructionText)));
  findings.push(...scanVerificationLadder(packageJsonData, mergedInstructionText));

  const readmePath = path.join(projectPath, "README.md");
  const readmeText = (await exists(readmePath)) ? await readText(readmePath) : "";
  findings.push(...scanUsageVisibility(projectPath, readmeText, mergedInstructionText));

  return findings;
}

export async function scanHomeConfig(homeDir) {
  const findings = [];

  if (!homeDir) {
    return findings;
  }

  const settingsPath = path.join(homeDir, ".claude", "settings.json");
  if (!(await exists(settingsPath))) {
    return findings;
  }

  try {
    const settings = await readJson(settingsPath);
    const homeMcp = await scanMcp(homeDir, [{ absolute: settingsPath, label: "~/.claude/settings.json" }], "home");

    if (isObject(settings) && hasAnyKey(settings, ["model", "maxTokens", "temperature", "tools"])) {
      findings.push(
        {
          id: "home.claude-settings-present",
          title: "Claude settings file detected",
          severity: "info",
          scope: "home",
          path: "~/.claude/settings.json",
          detail: "A user-level Claude settings file exists and may affect local agent behavior. Contents were not printed.",
          recommendation: "Review user-level settings separately when comparing audit results across machines.",
          costMechanism: "tool_surface"
        }
      );
    }

    findings.push(...homeMcp);
  } catch {
    findings.push(
      {
        id: "home.claude-settings-unreadable",
        title: "Claude settings file could not be parsed",
        severity: "low",
        scope: "home",
        path: "~/.claude/settings.json",
        detail: "A user-level Claude settings file exists, but this audit could not parse it. Contents were not printed.",
        recommendation: "Check the file locally if agent behavior differs between machines.",
        costMechanism: "tool_surface"
      }
    );
  }

  return findings;
}

function existsSync(filePath) {
  try {
    const fs = require("node:fs");
    fs.accessSync(filePath);
    return true;
  } catch {
    return false;
  }
}

function requireSyncRead(filePath) {
  const fs = require("node:fs");
  return fs.readFileSync(filePath, "utf8");
}
