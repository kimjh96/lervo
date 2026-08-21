import { isAbsolute } from "node:path";

import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import {
  assertReleaseFilesUnchanged,
  readRegularReleaseFile,
} from "./release-attestation-file-set.mjs";

const maximumInputBytes = 64 * 1024;
const sourceIds = Object.freeze([
  "postApplyReport",
  "publicationAuthorization",
  "licenseApproval",
  "scopeConfirmation",
  "firstPublicationApproval",
]);

function fail() {
  throw new FirstPublicationBootstrapError(
    "first_publication_external_evidence_source_invalid",
    "CLI 최초 게시 외부 요구사항 증거 원본이 올바르지 않습니다.",
  );
}

function parseJson(contents) {
  try {
    const parsed = JSON.parse(contents.toString("utf8"));
    if (!contents.equals(Buffer.from(`${JSON.stringify(parsed, null, 2)}\n`))) fail();
    return parsed;
  } catch (error) {
    if (error instanceof FirstPublicationBootstrapError) throw error;
    fail();
  }
}

export async function readFirstPublicationExternalEvidenceSources(paths) {
  if (sourceIds.some((id) => !isAbsolute(paths?.[`${id}Path`] ?? ""))) fail();
  let contents;
  try {
    contents = await Promise.all(sourceIds.map((id) =>
      readRegularReleaseFile(paths[`${id}Path`], maximumInputBytes)
    ));
  } catch {
    fail();
  }
  const documents = Object.fromEntries(sourceIds.map((id, index) => [
    id,
    parseJson(contents[index]),
  ]));
  return {
    ...documents,
    assertUnchanged: () => assertReleaseFilesUnchanged(sourceIds.map((id, index) => ({
      path: paths[`${id}Path`],
      contents: contents[index],
      maximumSize: maximumInputBytes,
    }))),
  };
}
