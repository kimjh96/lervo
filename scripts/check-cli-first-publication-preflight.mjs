import { isAbsolute } from "node:path";

import { checkCliFirstPublicationPreflight } from
  "./lib/cli-first-publication-preflight.mjs";
import { formatFirstPublicationPreflight } from
  "./lib/first-publication-preflight-formatter.mjs";
import { FirstPublicationBootstrapError } from "./lib/first-publication-bootstrap.mjs";
import { ReleaseAttestationVerificationError } from
  "./lib/release-attestation-consumer.mjs";
import { ReleasePublicationAuthorizationError } from
  "./lib/release-publication-authorization.mjs";

function failArguments() {
  throw new FirstPublicationBootstrapError(
    "first_publication_preflight_arguments_invalid",
    "The CLI first-publication preflight command arguments are invalid.",
  );
}

function parseArguments(args) {
  const values = new Map();
  let online = false;
  let json = false;
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (name === "--online" || name === "--json") {
      if ((name === "--online" && online) || (name === "--json" && json)) failArguments();
      if (name === "--online") online = true;
      else json = true;
      continue;
    }
    if (![
      "--release-directory",
      "--publication-authorization",
      "--bootstrap",
      "--reservation-root",
      "--user-config",
    ].includes(name) || values.has(name) || index + 1 >= args.length) failArguments();
    values.set(name, args[index + 1]);
    index += 1;
  }
  const required = [
    "--release-directory",
    "--publication-authorization",
    "--bootstrap",
    "--reservation-root",
    "--user-config",
  ];
  if (!online || required.some((name) => !isAbsolute(values.get(name) ?? ""))) failArguments();
  return {
    online,
    json,
    releaseDirectory: values.get("--release-directory"),
    publicationAuthorizationPath: values.get("--publication-authorization"),
    bootstrapPath: values.get("--bootstrap"),
    reservationRoot: values.get("--reservation-root"),
    userConfigPath: values.get("--user-config"),
  };
}

try {
  const { json, ...options } = parseArguments(process.argv.slice(2));
  const report = await checkCliFirstPublicationPreflight(options);
  process.stdout.write(json
    ? `${JSON.stringify(report, null, 2)}\n`
    : formatFirstPublicationPreflight(report));
  if (report.status !== "ready") process.exitCode = 1;
} catch (error) {
  if (
    error instanceof FirstPublicationBootstrapError ||
    error instanceof ReleaseAttestationVerificationError ||
    error instanceof ReleasePublicationAuthorizationError
  ) console.error(`${error.code}: ${error.message}`);
  else console.error(
    "first_publication_preflight_failed: The CLI first-publication preflight could not be completed.",
  );
  process.exitCode = 1;
}
