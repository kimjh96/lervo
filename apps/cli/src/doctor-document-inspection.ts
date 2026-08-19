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
          "문서 registry의 구조와 계약을 확인할 수 없습니다.",
        ),
      ]),
      doctorInspection("document_sources", "unknown", 0, [
        doctorIssue(
          "document_source_invalid",
          "문서 registry가 유효하지 않아 원본 파일을 확인하지 못했습니다.",
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
          `등록된 문서 원본 ${failed}개를 안전한 일반 파일로 읽지 못했습니다.`,
        )],
    ),
  ];
}
