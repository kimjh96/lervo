import { loadProjectManifest } from "./config.js";
import { resolveProjectPaths } from "./layout.js";
import { readEventWriterCoordinateFile } from "./event-writer-coordinate-reader.js";
import { assertNoEventWriterActivationTransaction } from "./event-writer-activation-transaction-io.js";
import {
  assertReportStorageIdle,
  readReportStorageFile,
  reportStoragePaths,
} from "./report-storage-files.js";

/** One current manifest binds both independent storage coordinates; no observation is retained. */
export async function inspectProjectStorageCoordinates(repositoryRoot: string) {
  const paths = resolveProjectPaths(repositoryRoot);
  const manifest = await loadProjectManifest(paths.repositoryRoot);
  await Promise.all([
    assertNoEventWriterActivationTransaction(paths.data),
    assertReportStorageIdle(paths.data),
  ]);
  const [writer, report] = await Promise.all([
    readEventWriterCoordinateFile(paths.eventContract, manifest.projectId),
    readReportStorageFile(reportStoragePaths(paths.data).current, manifest.projectId),
  ]);
  return {
    manifest,
    writer: { repositoryRoot: paths.repositoryRoot, projectId: manifest.projectId, ...writer },
    reports: {
      projectId: manifest.projectId,
      coordinate: report?.coordinate ?? null,
      contentHash: report?.contentHash ?? null,
    },
  };
}
