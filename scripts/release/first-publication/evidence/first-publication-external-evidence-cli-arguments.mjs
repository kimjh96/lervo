import { isAbsolute } from "node:path";

import { FirstPublicationBootstrapError } from "../transition/first-publication-bootstrap.mjs";

const pathArguments = Object.freeze({
  "--receipt": "receiptPath",
  "--post-apply-report": "postApplyReportPath",
  "--publication-authorization": "publicationAuthorizationPath",
  "--license-approval": "licenseApprovalPath",
  "--scope-confirmation": "scopeConfirmationPath",
  "--first-publication-approval": "firstPublicationApprovalPath",
});

function fail() {
  throw new FirstPublicationBootstrapError(
    "first_publication_external_evidence_arguments_invalid",
    "The CLI first-publication external-requirements evidence command arguments are invalid.",
  );
}

export function parseFirstPublicationExternalEvidenceArguments(args) {
  const paths = {};
  let online = false;
  let json = false;
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (["--online", "--json"].includes(name)) {
      if ((name === "--online" && online) || (name === "--json" && json)) fail();
      if (name === "--online") online = true;
      if (name === "--json") json = true;
      continue;
    }
    const id = pathArguments[name];
    if (id === undefined || paths[id] !== undefined) fail();
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) fail();
    paths[id] = value;
    index += 1;
  }
  if (!online || Object.values(pathArguments).some((id) => !isAbsolute(paths[id] ?? ""))) fail();
  return { options: paths, json };
}
