import { readRepositoryFile } from "@lervo/context";
import type { DoctorInspection } from "@lervo/diagnostics";
import { loadDocumentRegistry } from "@lervo/project";

import { doctorInspection, doctorIssue } from "./doctor-inspection-result.js";

export async function inspectDoctorDocuments(
  repositoryRoot: string,
): Promise<DoctorInspection[]> {
  let registry;
  try {
    registry = await loadDocumentRegistry(repositoryRoot);
  } catch {
    return [
      doctorInspection("document_registry", "unhealthy", 0, [
        doctorIssue(
          "document_registry_invalid",
          "Could not validate the document registry structure and contract.",
        ),
      ]),
      doctorInspection("document_sources", "unknown", 0, [
        doctorIssue(
          "document_source_invalid",
          "Could not inspect source files because the document registry is invalid.",
        ),
      ]),
    ];
  }
  const documents = Object.values(registry.documents);
  const reads = await Promise.allSettled(
    documents.map((document) => readRepositoryFile(repositoryRoot, document.path)),
  );
  const failed = reads.filter((result) => result.status === "rejected").length;
  return [
    doctorInspection("document_registry", "healthy", documents.length),
    doctorInspection(
      "document_sources",
      failed === 0 ? "healthy" : "unhealthy",
      documents.length,
      failed === 0
        ? []
        : [doctorIssue(
          "document_source_invalid",
          `Could not read ${failed} registered document sources as safe regular files.`,
        )],
    ),
  ];
}
