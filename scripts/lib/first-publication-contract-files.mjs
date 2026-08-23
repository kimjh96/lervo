import { isAbsolute } from "node:path";

import { validateFirstPublicationBootstrapAuthorization } from
  "./first-publication-bootstrap-reader.mjs";
import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import {
  assertReleaseFilesUnchanged,
  readRegularReleaseFile,
} from "./release-attestation-file-set.mjs";
import { validateReleasePublicationAuthorization } from
  "./release-publication-authorization.mjs";

const maximumInputBytes = 64 * 1024;

function fail() {
  throw new FirstPublicationBootstrapError(
    "first_publication_contract_files_invalid",
    "The CLI first-publication contract file is invalid.",
  );
}

function parseJson(contents) {
  try {
    return JSON.parse(contents.toString("utf8"));
  } catch {
    fail();
  }
}

export async function readFirstPublicationContractFiles({
  publicationAuthorizationPath,
  bootstrapPath,
}) {
  if (!isAbsolute(publicationAuthorizationPath ?? "") ||
      !isAbsolute(bootstrapPath ?? "")) fail();
  const [authorizationContents, bootstrapContents] = await Promise.all([
    readRegularReleaseFile(publicationAuthorizationPath, maximumInputBytes),
    readRegularReleaseFile(bootstrapPath, maximumInputBytes),
  ]);
  return {
    publicationAuthorization: validateReleasePublicationAuthorization(
      parseJson(authorizationContents),
    ),
    bootstrap: validateFirstPublicationBootstrapAuthorization(parseJson(bootstrapContents)),
    assertUnchanged: () => assertReleaseFilesUnchanged([
      {
        path: publicationAuthorizationPath,
        contents: authorizationContents,
        maximumSize: maximumInputBytes,
      },
      {
        path: bootstrapPath,
        contents: bootstrapContents,
        maximumSize: maximumInputBytes,
      },
    ]),
  };
}
