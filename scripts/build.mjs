import { chmod, cp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const dist = path.join(root, "dist");

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
for (const entry of await readdir(path.join(root, "src"))) {
  await cp(path.join(root, "src", entry), path.join(dist, entry), { recursive: true });
}

await renameExtensions(dist);
await chmod(path.join(dist, "cli.js"), 0o755);

async function renameExtensions(directory) {
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await renameExtensions(sourcePath);
      continue;
    }

    if (entry.isFile() && sourcePath.endsWith(".ts")) {
      const jsPath = sourcePath.slice(0, -3) + ".js";
      const content = await (await import("node:fs/promises")).readFile(sourcePath, "utf8");
      await writeFile(jsPath, content);
      await rm(sourcePath);
    }
  }
}
