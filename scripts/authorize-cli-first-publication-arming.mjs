import { isAbsolute } from "node:path";

import {
  authorizeCliFirstPublicationArming,
  writeFirstPublicationArmingAuthorization,
} from "./lib/cli-first-publication-arming.mjs";
import { FirstPublicationBootstrapError } from "./lib/first-publication-bootstrap.mjs";
import { ReleaseAttestationVerificationError } from
  "./lib/release-attestation-consumer.mjs";
import { ReleasePublicationAuthorizationError } from
  "./lib/release-publication-authorization.mjs";

function failArguments() {
  throw new FirstPublicationBootstrapError(
    "first_publication_arming_arguments_invalid",
    "CLI 최초 게시 실행 허가 명령 인자가 올바르지 않습니다.",
  );
}

function parseArguments(args) {
  const values = new Map();
  const allowed = [
    "--publication-authorization",
    "--bootstrap",
    "--decision",
    "--output",
  ];
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    const value = args[index + 1];
    if (
      !allowed.includes(name) || values.has(name) || value === undefined ||
      value.startsWith("--")
    ) failArguments();
    values.set(name, value);
    index += 1;
  }
  if (!allowed.every((name) => isAbsolute(values.get(name) ?? ""))) failArguments();
  return {
    options: {
      publicationAuthorizationPath: values.get("--publication-authorization"),
      bootstrapPath: values.get("--bootstrap"),
      decisionPath: values.get("--decision"),
    },
    outputPath: values.get("--output"),
  };
}

try {
  const { options, outputPath } = parseArguments(process.argv.slice(2));
  const armingAuthorization = await authorizeCliFirstPublicationArming(options);
  await writeFirstPublicationArmingAuthorization(outputPath, armingAuthorization);
  console.log(
    `CLI 최초 게시 1회 실행 허가 결속 완료 (${armingAuthorization.target.package}@${armingAuthorization.target.version})`,
  );
} catch (error) {
  if (
    error instanceof FirstPublicationBootstrapError ||
    error instanceof ReleaseAttestationVerificationError ||
    error instanceof ReleasePublicationAuthorizationError
  ) console.error(`${error.code}: ${error.message}`);
  else console.error(
    "first_publication_arming_failed: CLI 최초 게시 실행 허가를 만들지 못했습니다.",
  );
  process.exitCode = 1;
}
