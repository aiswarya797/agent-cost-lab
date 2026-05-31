import { access, readFile, stat } from "node:fs/promises";
import path from "node:path";

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath) {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw);
}

function projectFinding(finding) {
  return { ...finding, scope: "project" };
}

export async function scanProject(options) {
  const projectPath = options.projectPath;
  const findings = [];

  const packageJsonPath = path.join(projectPath, "package.json");
  if (await exists(packageJsonPath)) {
    const packageJson = await readJson(packageJsonPath);
    if (isObject(packageJson)) {
      const scripts = isObject(packageJson.scripts) ? packageJson.scripts : {};
      const agentScripts = Object.entries(scripts).filter(([name, value]) => {
        return /agent|audit|eval|prompt|llm|token/i.test(name) || /agent|eval|prompt|llm|token/i.test(String(value));
      });

      if (agentScripts.length > 0 && typeof scripts["cost:audit"] !== "string") {
        findings.push(
          projectFinding({
            id: "project.missing-cost-audit-script",
            title: "Agent-related scripts do not include a local cost audit entry",
            severity: "low",
            path: "package.json",
            detail: "Package scripts mention agent, prompt, eval, LLM, or token workflows, but no cost:audit script is present.",
            recommendation: "Add a repeatable local script that runs this audit before agent-heavy changes."
          })
        );
      }
    }
  }

  if (!(await exists(path.join(projectPath, ".gitignore")))) {
    findings.push(
      projectFinding({
        id: "project.missing-gitignore",
        title: "Project has no .gitignore",
        severity: "medium",
        detail: "Without a .gitignore, generated traces, logs, caches, and local config are easier to commit by accident.",
        recommendation: "Add a .gitignore that covers local env files, generated outputs, logs, and dependency folders."
      })
    );
  }

  const envPath = path.join(projectPath, ".env");
  if (await exists(envPath)) {
    findings.push(
      projectFinding({
        id: "project.env-file-present",
        title: "Project contains a .env file",
        severity: "high",
        path: ".env",
        detail: "Local environment files can contain credentials or model/provider settings that should not be committed.",
        recommendation: "Keep secrets outside the repository and commit a sanitized .env.example if examples are useful."
      })
    );
  }

  const candidateGeneratedDirs = ["dist", "coverage", ".cache", ".turbo"];
  for (const dirName of candidateGeneratedDirs) {
    const dirPath = path.join(projectPath, dirName);
    if (await isDirectory(dirPath)) {
      findings.push(
        projectFinding({
          id: `project.generated-dir.${dirName}`,
          title: `Generated directory is present: ${dirName}`,
          severity: "info",
          path: dirName,
          detail: "Generated files can make audits noisier and may contain bulky intermediate output.",
          recommendation: "Keep generated directories out of committed fixtures unless they are intentionally part of a test case."
        })
      );
    }
  }

  return findings;
}

export async function scanHomeConfig(homeDir) {
  if (!homeDir) {
    return [];
  }

  const settingsPath = path.join(homeDir, ".claude", "settings.json");
  if (!(await exists(settingsPath))) {
    return [];
  }

  const findings = [];
  try {
    const settings = await readJson(settingsPath);
    if (isObject(settings) && hasAnyKey(settings, ["model", "maxTokens", "temperature", "tools"])) {
      findings.push({
        id: "home.claude-settings-present",
        title: "Claude settings file detected",
        severity: "info",
        scope: "home",
        path: "~/.claude/settings.json",
        detail: "A user-level Claude settings file exists and may affect local agent behavior. Contents were not printed.",
        recommendation: "Review local user-level settings separately when comparing audit results across machines."
      });
    }
  } catch {
    findings.push({
      id: "home.claude-settings-unreadable",
      title: "Claude settings file could not be parsed",
      severity: "low",
      scope: "home",
      path: "~/.claude/settings.json",
      detail: "A user-level Claude settings file exists, but this audit could not parse it. Contents were not printed.",
      recommendation: "Check the file locally if agent behavior differs between machines."
    });
  }

  return findings;
}

async function isDirectory(filePath) {
  try {
    return (await stat(filePath)).isDirectory();
  } catch {
    return false;
  }
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasAnyKey(value, keys) {
  return keys.some((key) => Object.prototype.hasOwnProperty.call(value, key));
}
