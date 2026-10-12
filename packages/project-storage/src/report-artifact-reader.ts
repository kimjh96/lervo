import type { ReportReader } from "@lervo/storage-contract";
import type { CloseableArtifactStore } from "./types.js";

const uriPattern = /^lervo-cas:\/\/sha256\/([a-f0-9]{64})$/u;

/** Compose verified SQL report reads with the existing CAS write and lifecycle owner. */
export function withReportReader(
  artifacts: CloseableArtifactStore,
  reports: ReportReader | undefined,
): CloseableArtifactStore {
  if (reports === undefined) return artifacts;
  function read(uri: string): Uint8Array | null {
    const hash = uriPattern.exec(uri)?.[1];
    return hash === undefined ? null : reports!.getReport(`sha256:${hash}`);
  }
  return {
    put: (content) => artifacts.put(content),
    putStream: (chunks) => artifacts.putStream(chunks),
    async get(uri) {
      const report = read(uri);
      return report === null ? artifacts.get(uri) : Buffer.from(report);
    },
    async has(uri) {
      return read(uri) === null ? artifacts.has(uri) : true;
    },
    ...(artifacts.close ? { close: () => artifacts.close!() } : {}),
  };
}
