const COMPUTER_LABEL = "release: computer";
const TESTFLIGHT_LABEL = "release: testflight";

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
  if (changed.some((path) => (
    path.startsWith("mobile/")
    || path === ".github/workflows/testflight.yml"
    || path.startsWith(".github/actions/")
  ))) labels.push(TESTFLIGHT_LABEL);
  return labels;
}

module.exports = { COMPUTER_LABEL, TESTFLIGHT_LABEL, releaseLabelsForPaths };
