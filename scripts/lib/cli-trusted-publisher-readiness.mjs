import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "yaml";

import { observeGitHubPublisherEnvironment } from "./github-environment-observer.mjs";
import { readJson, repositoryRoot } from "./installed-cli.mjs";
import { observeNpmTrustedPublisher } from "./npm-trust-observer.mjs";
import {
  createTrustedPublisherReadinessReport,
  TrustedPublisherReadinessError,
} from "./trusted-publisher-readiness.mjs";

const packageManifestPath = resolve(repositoryRoot, "apps/cli/package.json");
const workflowPath = resolve(repositoryRoot, ".github/workflows/cli-release-matrix.yml");

export async function checkCliTrustedPublisherReadiness(
  { repository, online = false },
  dependencies = {},
) {
  const observeNpm = dependencies.observeNpmTrustedPublisher ?? observeNpmTrustedPublisher;
  const observeGitHub = dependencies.observeGitHubPublisherEnvironment ??
    observeGitHubPublisherEnvironment;
  let packageManifest;
  let workflow;
  try {
    [packageManifest, workflow] = await Promise.all([
      readJson(packageManifestPath),
      readFile(workflowPath, "utf8").then((contents) => parse(contents)),
    ]);
  } catch {
    throw new TrustedPublisherReadinessError(
      "trusted_publisher_readiness_source_invalid",
      "Trusted Publisher 준비 상태 원본을 읽지 못했습니다.",
    );
  }
  const [npmObservation, githubObservation] = online
    ? await Promise.all([
        observeNpm(),
        observeGitHub({ repository }),
      ])
    : [undefined, undefined];
  return createTrustedPublisherReadinessReport({
    repository,
    packageManifest,
    workflow,
    npmObservation,
    githubObservation,
  });
}

const checkLabels = {
  package_identity: "패키지 정보",
  workflow_activation_boundary: "게시 작업 비활성 경계",
  npm_package_access: "npm 패키지 쓰기 권한",
  npm_trusted_publisher: "npm Trusted Publisher",
  github_environment: "GitHub 게시 환경",
};

const reasonMessages = {
  package_identity_invalid: "공개 CLI 패키지 정보가 현재 계약과 다릅니다.",
  package_repository_missing: "package.json에 GitHub 저장소 주소가 없습니다.",
  package_repository_mismatch: "package.json의 저장소 주소가 선택한 저장소와 다릅니다.",
  package_license_unresolved: "공개 배포에 사용할 라이선스가 정해지지 않았습니다.",
  package_registry_unpinned: "publishConfig에 npm public registry가 고정되지 않았습니다.",
  package_provenance_disabled: "npm provenance가 꺼져 있습니다.",
  release_workflow_invalid: "CLI release workflow 구조가 올바르지 않습니다.",
  publish_job_already_active: "준비 확인 전에 실제 npm 게시 작업이 활성화되어 있습니다.",
  npm_observation_missing: "온라인 npm 확인을 실행하지 않았습니다.",
  npm_observation_unavailable: "npm 설정을 읽기 전용으로 확인하지 못했습니다.",
  npm_public_package_not_visible: "@lervo/cli이 public npm registry에서 보이지 않습니다.",
  npm_trust_not_observed: "공개 package가 보이지 않아 npm Trusted Publisher를 확인하지 않았습니다.",
  npm_trusted_publisher_missing: "npm Trusted Publisher가 설정되지 않았습니다.",
  npm_publisher_provider_mismatch: "npm publisher가 GitHub Actions로 설정되지 않았습니다.",
  npm_publisher_repository_mismatch: "npm publisher의 저장소가 선택한 저장소와 다릅니다.",
  npm_publisher_workflow_mismatch: "npm publisher의 workflow 파일이 release workflow와 다릅니다.",
  npm_publisher_environment_mismatch: "npm publisher의 environment가 npm-release와 다릅니다.",
  npm_publisher_permission_mismatch: "npm publisher 권한이 stage publish 하나로 제한되지 않았습니다.",
  github_observation_missing: "온라인 GitHub 환경 확인을 실행하지 않았습니다.",
  github_observation_unavailable: "GitHub 게시 환경을 읽기 전용으로 확인하지 못했습니다.",
  github_environment_missing: "GitHub npm-release 환경이 없습니다.",
  github_required_reviewer_missing: "npm-release 환경에 필수 검토자가 없습니다.",
  github_self_review_allowed: "실행 요청자가 자신의 게시를 승인할 수 있습니다.",
  github_release_tag_policy_mismatch: "npm-release 환경이 v* tag 하나로 제한되지 않았습니다.",
};

export function formatTrustedPublisherReadiness(report) {
  const state = report.status === "ready" ? "준비됨" : "차단됨";
  const lines = [`CLI Trusted Publisher 준비 상태: ${state}`];
  for (const item of report.checks) {
    const itemState = item.status === "ready"
      ? "준비됨"
      : item.status === "unknown"
        ? "확인 불가"
        : "차단됨";
    lines.push(`- ${checkLabels[item.id]}: ${itemState}`);
    for (const reason of item.reasons) {
      lines.push(`  ${reasonMessages[reason] ?? "준비 조건을 확인하지 못했습니다."}`);
    }
  }
  lines.push("이 검사는 외부 설정을 바꾸거나 package를 게시하지 않았습니다.");
  return `${lines.join("\n")}\n`;
}
