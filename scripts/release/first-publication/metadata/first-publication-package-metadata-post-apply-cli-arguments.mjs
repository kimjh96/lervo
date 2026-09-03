import { isAbsolute } from "node:path";

import { FirstPublicationBootstrapError } from "../transition/first-publication-bootstrap.mjs";

function fail() {
  throw new FirstPublicationBootstrapError(
    "first_publication_package_metadata_post_apply_arguments_invalid",
    "The CLI first-publication package metadata post-apply verification command arguments are invalid.",
  );
}

export function parseFirstPublicationPackageMetadataPostApplyArguments(args) {
  let receiptPath;
  let json = false;
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (name === "--json" && !json) {
      json = true;
      continue;
    }
    if (name !== "--receipt" || receiptPath !== undefined) fail();
    receiptPath = args[index + 1];
    if (receiptPath === undefined || receiptPath.startsWith("--")) fail();
    index += 1;
  }
  if (!isAbsolute(receiptPath ?? "")) fail();
  return { receiptPath, json };
}
