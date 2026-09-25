const COMPUTER_LABEL = "release: computer";

function isMarkdown(path) {
  return path.toLowerCase().endsWith(".md");
}

function releaseLabelsForPaths(paths) {
  const changed = paths.filter((path) => !isMarkdown(path));
  const labels = [];
  if (changed.some((path) => (
    path.startsWith("contract/")
    || path.startsWith("server/")
    || path.startsWith("web/")
    || path === "hub/runtime/Dockerfile.computer"
    || path === "package.json"
    || path === ".github/workflows/release.yml"
    || path.startsWith(".github/actions/")
  ))) labels.push(COMPUTER_LABEL);
  return labels;
}

module.exports = { COMPUTER_LABEL, releaseLabelsForPaths };
