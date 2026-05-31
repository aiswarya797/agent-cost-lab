export const AUDIT_THRESHOLDS = {
  instructionWarningLines: 150,
  instructionWarningBytes: 24 * 1024,
  instructionHighLines: 200,
  instructionHighBytes: 32 * 1024,
  referencedWarningBytes: 24 * 1024,
  referencedHighBytes: 32 * 1024,
  largeTextBytes: 1024 * 1024,
  largeAnyBytes: 5 * 1024 * 1024,
  mcpWarningServers: 5,
  mcpHighServers: 10
};

export const INSTRUCTION_FILE_NAMES = ["CLAUDE.md", "AGENTS.md"];

export const NOISY_PATH_HINTS = [
  "node_modules",
  "dist",
  "build",
  ".next",
  ".nuxt",
  "coverage",
  ".turbo",
  ".cache",
  "target",
  "vendor",
  "tmp",
  "logs"
];

export const NOISY_REFERENCE_PATH_HINTS = [
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "coverage",
  "dist",
  "build",
  "logs"
];

export const NOISY_GITIGNORE_HINTS = NOISY_PATH_HINTS.concat(["*.log", "*.map"]).concat(["coverage", "dist", "build"]);
