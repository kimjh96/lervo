import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  createReleaseSubjectsBinding,
  ReleaseSubjectsError,
  releaseSubjectsBindingName,
  verifyReleaseSubjects,
} from "./cli-release-subjects.mjs";

const maximumSubjectFiles = 8;

async function readSubjectDirectory(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  if (entries.length > maximumSubjectFiles || entries.some((entry) => !entry.isFile()))
    throw new ReleaseSubjectsError(
      "release_subjects_file_set_mismatch",
      "The release subject file set is not exact.",
    );
  const files = new Map();
  for (const entry of entries)
    files.set(entry.name, await readFile(resolve(directory, entry.name)));
  const bindingContents = files.get(releaseSubjectsBindingName);
  files.delete(releaseSubjectsBindingName);
  return { bindingContents, files };
}

/** Writes the binding beside freshly prepared subjects; a directory is bound at most once. */
export async function bindSubjectDirectory({ directory, version, revision, tree }) {
  const { bindingContents, files } = await readSubjectDirectory(directory);
  if (bindingContents !== undefined)
    throw new ReleaseSubjectsError(
      "release_subjects_file_set_mismatch",
      "The release subjects are already bound.",
    );
  const binding = createReleaseSubjectsBinding({ version, revision, tree, files });
  await writeFile(
    resolve(directory, releaseSubjectsBindingName),
    `${JSON.stringify(binding, null, 2)}\n`,
    { flag: "wx" },
  );
  return binding;
}

/**
 * Verifies a bound subject directory against the tree being released. After the smokes it proves
 * that the files they installed and published are still exactly the bound bytes; at publication it
 * proves that the downloaded files belong to the tag.
 */
export async function verifySubjectDirectory({ directory, expectedTag, tree, repository }) {
  const { bindingContents, files } = await readSubjectDirectory(directory);
  return verifyReleaseSubjects({
    expectedTag,
    tree,
    bindingContents: bindingContents ?? Buffer.alloc(0),
    files,
    repository,
  });
}
