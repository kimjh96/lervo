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
    "The CLI first-publication execution authorization command arguments are invalid.",
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
    `CLI first-publication one-time execution authorization bound (${armingAuthorization.target.package}@${armingAuthorization.target.version})`,
  );
} catch (error) {
  if (
    error instanceof FirstPublicationBootstrapError ||
    error instanceof ReleaseAttestationVerificationError ||
    error instanceof ReleasePublicationAuthorizationError
  ) console.error(`${error.code}: ${error.message}`);
  else console.error(
    "first_publication_arming_failed: The CLI first-publication execution authorization could not be created.",
  );
  process.exitCode = 1;
}
