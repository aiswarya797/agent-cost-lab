#!/usr/bin/env node
import { runAuditCommand } from "./commands/audit.js";

async function main(argv) {
  const parsed = parseArgs(argv);

  if (parsed.command !== "audit") {
    throw new Error(`Unknown command: ${parsed.command}`);
  }

  const output = await runAuditCommand({
    pathArg: parsed.pathArg,
    json: parsed.json
  });
  process.stdout.write(output);
}

function parseArgs(argv) {
  const [command = "audit", ...args] = argv;
  let pathArg;
  let json = false;

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

main(process.argv.slice(2)).catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
