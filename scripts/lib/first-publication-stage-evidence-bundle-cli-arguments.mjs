import { isAbsolute } from "node:path";

import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";

function fail() {
  throw new FirstPublicationBootstrapError(
    "first_publication_stage_evidence_bundle_arguments_invalid",
    "CLI 최초 게시 stage 증거 묶음 명령 인자가 올바르지 않습니다.",
  );
}

export function parseFirstPublicationStageEvidenceBundleArguments(args) {
  const names = [
    "--stage-review-report", "--decision", "--authorization",
    "--result-directory", "--reconciliation-report", "--output",
  ];
  const values = new Map();
  let write = false;
  let json = false;
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (["--write", "--json"].includes(name)) {
      const alreadySet = name === "--write" ? write : json;
      if (alreadySet) fail();
      if (name === "--write") write = true;
      else json = true;
      continue;
    }
    const value = args[index + 1];
    if (!names.includes(name) || values.has(name) || value === undefined ||
        value.startsWith("--")) fail();
    values.set(name, value);
    index += 1;
  }
  if (
    !write || values.size !== names.length ||
    names.some((name) => !isAbsolute(values.get(name) ?? ""))
  ) fail();
  return {
    stageReviewReportPath: values.get("--stage-review-report"),
    decisionPath: values.get("--decision"),
    authorizationPath: values.get("--authorization"),
    resultDirectory: values.get("--result-directory"),
    reconciliationReportPath: values.get("--reconciliation-report"),
    outputPath: values.get("--output"),
    write: true,
    json,
  };
}
