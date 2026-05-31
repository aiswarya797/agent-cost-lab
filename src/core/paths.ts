import path from "node:path";

export function displayPathFor(absolutePath, cwd = process.cwd()) {
  const relativePath = path.relative(cwd, absolutePath);

  if (relativePath === "") {
    return ".";
  }

  if (!relativePath.startsWith("..") && !path.isAbsolute(relativePath)) {
    return relativePath;
  }

  return absolutePath;
}
