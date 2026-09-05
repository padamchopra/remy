const MAC_LABEL = "release: mac";
const TESTFLIGHT_LABEL = "release: testflight";

function isMarkdown(path) {
  return path.toLowerCase().endsWith(".md");
}

function releaseLabelsForPaths(paths) {
  const changed = paths.filter((path) => !isMarkdown(path));
  const labels = [];
  if (changed.some((path) => (
    path.startsWith("desktop/")
    || path.startsWith("server/")
    || path.startsWith("web/")
    || path === "package.json"
    || path === ".github/workflows/mac.yml"
    || path.startsWith(".github/actions/")
  ))) labels.push(MAC_LABEL);
  if (changed.some((path) => (
    path.startsWith("mobile/")
    || path === ".github/workflows/testflight.yml"
    || path.startsWith(".github/actions/")
  ))) labels.push(TESTFLIGHT_LABEL);
  return labels;
}

module.exports = { MAC_LABEL, TESTFLIGHT_LABEL, releaseLabelsForPaths };
