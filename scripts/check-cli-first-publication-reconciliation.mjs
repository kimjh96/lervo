import { isAbsolute } from "node:path";

import { reconcileCliFirstPublication } from
  "./lib/cli-first-publication-reconciliation.mjs";
import { FirstPublicationBootstrapError } from "./lib/first-publication-bootstrap.mjs";
import { formatFirstPublicationReconciliation } from
  "./lib/first-publication-reconciliation-formatter.mjs";
import { ReleaseAttestationVerificationError } from
  "./lib/release-attestation-consumer.mjs";
import { ReleasePublicationAuthorizationError } from
  "./lib/release-publication-authorization.mjs";

function failArguments() {
  throw new FirstPublicationBootstrapError(
    "first_publication_reconciliation_arguments_invalid",
    "The CLI first-publication reconciliation command arguments are invalid.",
  );
}

function parseArguments(args) {
  const values = new Map();
  let online = false;
  let json = false;
  const allowed = [
    "--publication-authorization",
    "--bootstrap",
    "--arming-authorization",
    "--reservation-root",
  ];
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (name === "--online" || name === "--json") {
      if ((name === "--online" && online) || (name === "--json" && json)) failArguments();
      if (name === "--online") online = true;
      else json = true;
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
    online,
    json,
    publicationAuthorizationPath: values.get("--publication-authorization"),
    bootstrapPath: values.get("--bootstrap"),
    armingAuthorizationPath: values.get("--arming-authorization"),
    reservationRoot: values.get("--reservation-root"),
  };
}

try {
  const { json, ...options } = parseArguments(process.argv.slice(2));
  const report = await reconcileCliFirstPublication(options);
  process.stdout.write(json
    ? `${JSON.stringify(report, null, 2)}\n`
    : formatFirstPublicationReconciliation(report));
} catch (error) {
  if (
    error instanceof FirstPublicationBootstrapError ||
    error instanceof ReleaseAttestationVerificationError ||
    error instanceof ReleasePublicationAuthorizationError
  ) console.error(`${error.code}: ${error.message}`);
  else console.error(
    "first_publication_reconciliation_failed: The CLI first-publication result could not be reconciled.",
  );
  process.exitCode = 1;
}
