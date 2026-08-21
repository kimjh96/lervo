import { writeFile } from "node:fs/promises";
import { isAbsolute } from "node:path";

import {
  createFirstPublicationArmingAuthorization,
  validateFirstPublicationArmingAuthorization,
  validateFirstPublicationArmingAuthorizationDocument,
} from "./first-publication-arming-authorization.mjs";
import { readFirstPublicationArmingSources } from
  "./first-publication-arming-sources.mjs";
import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";

function fail(code = "first_publication_arming_input_invalid") {
  throw new FirstPublicationBootstrapError(
    code,
    "CLI 최초 게시 실행 허가 입력이 올바르지 않습니다.",
  );
}

export async function authorizeCliFirstPublicationArming(options, dependencies = {}) {
  if (
    !isAbsolute(options?.publicationAuthorizationPath ?? "") ||
    !isAbsolute(options?.bootstrapPath ?? "") ||
    !isAbsolute(options?.decisionPath ?? "")
  ) fail();
  const readSources = dependencies.readSources ?? readFirstPublicationArmingSources;
  const now = dependencies.now ?? (() => new Date().toISOString());
  const sources = await readSources(options);
  const armedAt = now();
  const armingAuthorization = createFirstPublicationArmingAuthorization({
    ...sources,
    armedAt,
  });
  validateFirstPublicationArmingAuthorization(armingAuthorization, {
    ...sources,
    checkedAt: armedAt,
  });
  await sources.assertUnchanged();
  return armingAuthorization;
}

export async function writeFirstPublicationArmingAuthorization(
  outputPath,
  armingAuthorization,
) {
  if (!isAbsolute(outputPath)) fail();
  validateFirstPublicationArmingAuthorizationDocument(armingAuthorization);
  await writeFile(outputPath, `${JSON.stringify(armingAuthorization, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
}
