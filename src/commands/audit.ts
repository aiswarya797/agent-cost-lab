import os from "node:os";
import path from "node:path";
import { sortFindings } from "../core/findings.js";
import { formatJson, formatText } from "../core/format.js";
import { scoreFindings } from "../core/scoring.js";
import { scanHomeConfig, scanProject } from "../audit/scanners.js";

export async function runAuditCommand(options) {
  const projectPath = path.resolve(options.pathArg ?? process.cwd());
  const scanResult = await runAudit({
    projectPath,
    homeDir: os.homedir(),
    includeHomeChecks: options.pathArg === undefined
  });
  const report = createAuditReport(scanResult);

  return options.json ? formatJson(report) : formatText(report);
}

export async function runAudit(options) {
  const projectFindings = await scanProject(options);
  const homeFindings = options.includeHomeChecks ? await scanHomeConfig(options.homeDir) : [];
  const findings = sortFindings([...projectFindings, ...homeFindings]);

  return {
    projectPath: options.projectPath,
    findings,
    checked: {
      project: true,
      home: options.includeHomeChecks
    }
  };
}

export function createAuditReport(result) {
  const findings = sortFindings(result.findings);

  return {
    command: "audit",
    path: result.projectPath,
    score: scoreFindings(findings),
    findings,
    checked: result.checked
  };
}
