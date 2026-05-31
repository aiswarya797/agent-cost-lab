import path from "node:path";

export function displayPathFor(absolutePath, cwd = process.cwd()) {
  const relativePath = path.relative(cwd, absolutePath);

  if (relativePath === "") {
    return ".";
  }

  const isOutsideCwd = relativePath === ".." || relativePath.startsWith(`..${path.sep}`);

  if (!isOutsideCwd && !path.isAbsolute(relativePath)) {
    return relativePath;
  }

  return absolutePath;
}
