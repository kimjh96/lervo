import { isAbsolute } from "node:path";

import {
  resolveCliFirstPublication,
  writeFirstPublicationResolution,
} from "./lib/cli-first-publication-resolution.mjs";
import { FirstPublicationBootstrapError } from "./lib/first-publication-bootstrap.mjs";
import { ReleaseAttestationVerificationError } from
  "./lib/release-attestation-consumer.mjs";
import { ReleasePublicationAuthorizationError } from
  "./lib/release-publication-authorization.mjs";

function failArguments() {
  throw new FirstPublicationBootstrapError(
    "first_publication_resolution_arguments_invalid",
    "CLI 최초 게시 결과 확정 명령 인자가 올바르지 않습니다.",
  );
}

function parseArguments(args) {
  const allowed = [
    "--publication-authorization",
    "--bootstrap",
    "--arming-authorization",
    "--reservation-root",
    "--reconciliation-report",
    "--decision",
    "--output",
  ];
  const values = new Map();
  let online = false;
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (name === "--online") {
      if (online) failArguments();
      online = true;
      continue;
    }
    const value = args[index + 1];
    if (
      !allowed.includes(name) || values.has(name) || value === undefined ||
      value.startsWith("--")
    ) failArguments();
    values.set(name, value);
    index += 1;
  }
  if (!online || !allowed.every((name) => isAbsolute(values.get(name) ?? ""))) failArguments();
  return {
    options: {
      online,
      publicationAuthorizationPath: values.get("--publication-authorization"),
      bootstrapPath: values.get("--bootstrap"),
      armingAuthorizationPath: values.get("--arming-authorization"),
      reservationRoot: values.get("--reservation-root"),
      reconciliationReportPath: values.get("--reconciliation-report"),
      decisionPath: values.get("--decision"),
    },
    outputPath: values.get("--output"),
  };
}

try {
  const { options, outputPath } = parseArguments(process.argv.slice(2));
  const resolution = await resolveCliFirstPublication(options);
  await writeFirstPublicationResolution(outputPath, resolution);
  console.log(
    `CLI 최초 게시 결과 확정 완료 (${resolution.target.package}@${resolution.target.version}, 전환 검토 가능)`,
  );
} catch (error) {
  if (
    error instanceof FirstPublicationBootstrapError ||
    error instanceof ReleaseAttestationVerificationError ||
    error instanceof ReleasePublicationAuthorizationError
  ) console.error(`${error.code}: ${error.message}`);
  else console.error(
    "first_publication_resolution_failed: CLI 최초 게시 결과를 확정하지 못했습니다.",
  );
  process.exitCode = 1;
}
