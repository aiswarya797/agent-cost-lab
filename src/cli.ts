#!/usr/bin/env node
import { runAuditCommand } from "./commands/audit.js";
import { runTokenBlameCommand } from "./commands/token-blame.js";

async function main(argv) {
  const parsed = parseArgs(argv);

  if (parsed.command === "audit") {
    const output = await runAuditCommand({
      pathArg: parsed.pathArg,
      json: parsed.json
    });
    process.stdout.write(output);
    return;
  }

  if (parsed.command === "token-blame") {
    const output = await runTokenBlameCommand({
      input: parsed.inputPath,
      json: parsed.json
    });
    process.stdout.write(output);
    return;
  }

  throw new Error(`Unknown command: ${parsed.command}`);
}

function parseArgs(argv) {
  const [command = "audit", ...args] = argv;
  let pathArg;
  let json = false;
  let inputPath;

  if (command === "audit") {
    for (let index = 0; index < args.length; index += 1) {
      const arg = args[index];

      if (arg === "--json") {
        json = true;
        continue;
      }

      if (arg === "--path") {
        const next = args[index + 1];
        if (!next) {
          throw new Error("--path requires a value");
        }
        pathArg = next;
        index += 1;
        continue;
      }

      throw new Error(`Unknown option: ${arg}`);
    }
    return { command, pathArg, json };
  }

  if (command === "token-blame") {
    for (let index = 0; index < args.length; index += 1) {
      const arg = args[index];

      if (arg === "--json") {
        json = true;
        continue;
      }

      if (arg === "--input") {
        const next = args[index + 1];
        if (!next) {
          throw new Error("--input requires a value");
        }
        inputPath = next;
        index += 1;
        continue;
      }

      throw new Error(`Unknown option: ${arg}`);
    }

    if (!inputPath) {
      throw new Error("--input is required for token-blame");
    }

    return { command, inputPath, json };
  }

  throw new Error(`Unknown command: ${command}`);
}

main(process.argv.slice(2)).catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
