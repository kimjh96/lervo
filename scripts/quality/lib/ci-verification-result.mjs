export function aggregateCiVerification({
  coverage,
  plan,
  quality,
  build,
  tests,
  distribution,
  distributionRequired,
}) {
  if (!["full", "documentation_only"].includes(coverage)) return "failed";
  if (plan !== "success" || quality !== "success") return "failed";
  const expected = coverage === "full" ? "success" : "skipped";
  if ([build, tests].some((result) => result !== expected)) return "failed";
  if (distribution !== (distributionRequired ? "success" : "skipped")) return "failed";
  return "passed";
}
