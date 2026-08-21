import { isAbsolute } from "node:path";

import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";

function fail() {
  throw new FirstPublicationBootstrapError(
    "first_publication_package_metadata_apply_arguments_invalid",
    "CLI 최초 게시 package metadata 적용 명령 인자가 올바르지 않습니다.",
  );
}

export function parseFirstPublicationPackageMetadataApplyArguments(args) {
  let permitPath;
  let write = false;
  let recover = false;
  let json = false;
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (["--write", "--recover", "--json"].includes(name)) {
      if (
        (name === "--write" && write) ||
        (name === "--recover" && recover) ||
        (name === "--json" && json)
      ) fail();
      if (name === "--write") write = true;
      if (name === "--recover") recover = true;
      if (name === "--json") json = true;
      continue;
    }
    if (name !== "--permit" || permitPath !== undefined) fail();
    permitPath = args[index + 1];
    if (permitPath === undefined || permitPath.startsWith("--")) fail();
    index += 1;
  }
  if (recover) {
    if (write || permitPath !== undefined) fail();
    return { mode: "recover", json };
  }
  if (!write || !isAbsolute(permitPath ?? "")) fail();
  return { mode: "apply", permitPath, json };
}
