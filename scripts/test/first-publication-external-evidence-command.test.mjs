import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";

import { describe, it } from "vitest";

import { inspectCliFirstPublicationExternalEvidence } from
  "../lib/cli-first-publication-external-evidence.mjs";
import { parseFirstPublicationExternalEvidenceArguments } from
  "../lib/first-publication-external-evidence-cli-arguments.mjs";
import { formatFirstPublicationExternalEvidenceReport } from
  "../lib/first-publication-external-evidence-formatter.mjs";
import { createExternalEvidenceFixture } from
  "./fixtures/first-publication-external-evidence.mjs";

const absoluteArguments = [
  "--receipt", "/tmp/receipt.json",
  "--post-apply-report", "/tmp/post.json",
  "--publication-authorization", "/tmp/publication.json",
  "--license-approval", "/tmp/license.json",
  "--scope-confirmation", "/tmp/scope.json",
  "--first-publication-approval", "/tmp/approval.json",
  "--online",
];

function dependencies(fixture, additions = {}) {
  return {
    transactionRoot: fixture.transactionRoot,
    verifyPostApply: async () => fixture.documents.postApplyReport,
    observePackage: async () => fixture.packageObservation,
    now: () => fixture.observedAt,
    ...additions,
  };
}

describe("first-publication external requirement evidence command", () => {
  it("requires all absolute inputs and explicit online mode", () => {
    const parsed = parseFirstPublicationExternalEvidenceArguments([
      ...absoluteArguments,
      "--json",
    ]);
    assert.equal(parsed.options.receiptPath, "/tmp/receipt.json");
    assert.equal(parsed.options.scopeConfirmationPath, "/tmp/scope.json");
    assert.equal(parsed.json, true);
    for (const args of [
      absoluteArguments.filter((value) => value !== "--online"),
      absoluteArguments.slice(2),
      absoluteArguments.map((value) => value === "/tmp/license.json" ? "relative.json" : value),
      [...absoluteArguments, "--online"],
      [...absoluteArguments, "--unknown"],
    ]) {
      assert.throws(
        () => parseFirstPublicationExternalEvidenceArguments(args),
        { code: "first_publication_external_evidence_arguments_invalid" },
      );
    }
  });

  it("rechecks post-apply evidence around one online observation without writes", async () => {
    const fixture = await createExternalEvidenceFixture();
    try {
      const paths = Object.values(fixture.evidencePaths);
      const before = await Promise.all(paths.map((path) => readFile(path)));
      let postChecks = 0;
      let observations = 0;
      const report = await inspectCliFirstPublicationExternalEvidence(
        fixture.evidencePaths,
        fixture.paths,
        dependencies(fixture, {
          verifyPostApply: async () => {
            postChecks += 1;
            return fixture.documents.postApplyReport;
          },
          observePackage: async () => {
            observations += 1;
            return fixture.packageObservation;
          },
        }),
      );
      assert.equal(report.status, "evidence_bound");
      assert.equal(postChecks, 2);
      assert.equal(observations, 1);
      assert.deepEqual(await Promise.all(paths.map((path) => readFile(path))), before);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("rejects stale post-apply evidence before online observation", async () => {
    const fixture = await createExternalEvidenceFixture();
    try {
      let observations = 0;
      await assert.rejects(inspectCliFirstPublicationExternalEvidence(
        fixture.evidencePaths,
        fixture.paths,
        dependencies(fixture, {
          verifyPostApply: async () => ({
            ...fixture.documents.postApplyReport,
            status: "changed",
          }),
          observePackage: async () => {
            observations += 1;
            return fixture.packageObservation;
          },
        }),
      ), { code: "first_publication_external_evidence_post_apply_invalid" });
      assert.equal(observations, 0);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("rejects an invalid human document before online observation", async () => {
    const fixture = await createExternalEvidenceFixture();
    try {
      fixture.documents.licenseApproval.target.license = "MIT";
      await writeFile(
        fixture.evidencePaths.licenseApprovalPath,
        `${JSON.stringify(fixture.documents.licenseApproval, null, 2)}\n`,
      );
      let observations = 0;
      await assert.rejects(inspectCliFirstPublicationExternalEvidence(
        fixture.evidencePaths,
        fixture.paths,
        dependencies(fixture, {
          observePackage: async () => {
            observations += 1;
            return fixture.packageObservation;
          },
        }),
      ), { code: "first_publication_external_evidence_license_approval_invalid" });
      assert.equal(observations, 0);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("rejects post-apply evidence changed across the online observation", async () => {
    const fixture = await createExternalEvidenceFixture();
    try {
      let checks = 0;
      await assert.rejects(inspectCliFirstPublicationExternalEvidence(
        fixture.evidencePaths,
        fixture.paths,
        dependencies(fixture, {
          verifyPostApply: async () => {
            checks += 1;
            return checks === 1
              ? fixture.documents.postApplyReport
              : { ...fixture.documents.postApplyReport, status: "changed" };
          },
        }),
      ), { code: "first_publication_external_evidence_post_apply_invalid" });
      assert.equal(checks, 2);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("rejects evidence files changed during observation", async () => {
    const fixture = await createExternalEvidenceFixture();
    try {
      await assert.rejects(inspectCliFirstPublicationExternalEvidence(
        fixture.evidencePaths,
        fixture.paths,
        dependencies(fixture, {
          observePackage: async () => {
            await writeFile(fixture.evidencePaths.licenseApprovalPath, "{}\n");
            return fixture.packageObservation;
          },
        }),
      ), { code: "release_attestation_release_set_changed" });
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("keeps identities and digests out of the Korean output", async () => {
    const fixture = await createExternalEvidenceFixture();
    try {
      const report = await inspectCliFirstPublicationExternalEvidence(
        fixture.evidencePaths,
        fixture.paths,
        dependencies(fixture),
      );
      const output = formatFirstPublicationExternalEvidenceReport(report);
      assert.match(output, /이 결과는 게시 실행 허가가 아닙니다/u);
      assert.match(output, /사람의 신원과 npm scope 권한은 외부 시스템에서 검증하지 않았습니다/u);
      assert.equal(output.includes(report.evidenceReportDigest), false);
      assert.equal(output.includes("release-owner@example.invalid"), false);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
});
