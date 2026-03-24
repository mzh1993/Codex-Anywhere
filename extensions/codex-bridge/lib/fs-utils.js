import path from "node:path";

export function isPathInsideAny(candidate, roots) {
  if (!isNonEmptyPathInput(candidate)) return false;
  if (!Array.isArray(roots) || roots.length === 0) return false;
  return roots.some((root) => isPathInside(candidate, root));
}

export function isPathInside(candidate, root) {
  if (!isNonEmptyPathInput(candidate) || !isNonEmptyPathInput(root)) return false;
  const resolvedCandidate = path.resolve(candidate);
  const resolvedRoot = path.resolve(root);
  const rootAnchor = path.parse(resolvedRoot).root;
  if (resolvedRoot === rootAnchor) {
    return path.parse(resolvedCandidate).root === rootAnchor;
  }
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`);
}

function isNonEmptyPathInput(value) {
  return typeof value === "string" && value.trim().length > 0;
}
