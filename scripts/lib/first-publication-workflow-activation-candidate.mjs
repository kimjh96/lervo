import { isMap, parseDocument } from "yaml";

import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import { inspectFirstPublicationStageOnlyWorkflow } from
  "./first-publication-transition-policy.mjs";
import {
  canonicalDigest,
  canonicalJson,
  sha256,
} from "./release-artifact-manifest.mjs";
import { inspectTrustedPublisherInactiveWorkflow } from
  "./trusted-publisher-readiness.mjs";

export const stagePublicationPackageScript =
  "node scripts/stage-cli-release-publication.mjs";

export const stageOnlyWorkflowJobYaml = `  publish-cli:
    name: Stage CLI publication
    if: github.event_name == 'workflow_dispatch' && github.ref_type == 'tag'
    needs: attested-cli
    runs-on: ubuntu-latest
    environment: npm-release
    permissions:
      contents: read
      id-token: write
    steps:
      - name: Check out repository
        uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd
        with:
          persist-credentials: false
      - name: Set up Node
        uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020
        with:
          node-version: 22.13.0
          package-manager-cache: false
      - name: Set up pnpm
        uses: pnpm/action-setup@d15e628ca66d93ee5f352c71671a7bc6a97af5c9
      - name: Download exact release files
        uses: actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093
        with:
          name: lervo-cli-\${{ github.ref_name }}
          path: \${{ runner.temp }}
      - name: Install dependencies
        run: pnpm install --frozen-lockfile
      - name: Stage exact CLI package
        run: pnpm release:publication:stage --release-directory "\${RUNNER_TEMP}/lervo-release" --publication-authorization "\${RUNNER_TEMP}/lervo-publication-authorization.json"
`;

function fail(code = "first_publication_workflow_activation_candidate_invalid") {
  throw new FirstPublicationBootstrapError(
    code,
    "CLI 최초 게시 workflow 활성화 후보가 올바르지 않습니다.",
  );
}

function exactKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort());
}

function snapshot(snapshot) {
  if (
    !exactKeys(snapshot, ["contents", "byteCount", "sha256"]) ||
    !Buffer.isBuffer(snapshot.contents) || snapshot.contents.length === 0 ||
    snapshot.byteCount !== snapshot.contents.length ||
    snapshot.sha256 !== sha256(snapshot.contents)
  ) fail();
  return snapshot;
}

function packageManifest(input) {
  const source = snapshot(input.packageSnapshot);
  let parsed;
  try {
    parsed = JSON.parse(source.contents.toString("utf8"));
  } catch {
    fail("first_publication_workflow_activation_source_format_unsupported");
  }
  if (
    !source.contents.equals(Buffer.from(`${JSON.stringify(parsed, null, 2)}\n`)) ||
    canonicalJson(parsed) !== canonicalJson(input.packageManifest) ||
    parsed?.scripts?.["release:publication:stage"] !== stagePublicationPackageScript
  ) {
    fail(parsed?.scripts?.["release:publication:stage"] === undefined
      ? "first_publication_workflow_activation_stage_command_missing"
      : "first_publication_workflow_activation_source_format_unsupported");
  }
  return source;
}

function workflowDocument(input) {
  const source = snapshot(input.workflowSnapshot);
  let text;
  let document;
  try {
    text = source.contents.toString("utf8");
    if (!source.contents.equals(Buffer.from(text)) || !text.endsWith("\n") || text.includes("\r")) {
      fail("first_publication_workflow_activation_source_format_unsupported");
    }
    document = parseDocument(text, { keepSourceTokens: true, uniqueKeys: true });
  } catch (error) {
    if (error instanceof FirstPublicationBootstrapError) throw error;
    fail("first_publication_workflow_activation_source_format_unsupported");
  }
  if (
    document.errors.length > 0 || document.warnings.length > 0 || !isMap(document.contents)
  ) fail("first_publication_workflow_activation_source_format_unsupported");
  const jobsPairs = document.contents.items.filter(({ key }) => key?.value === "jobs");
  const jobs = jobsPairs[0]?.value;
  const workflow = document.toJS();
  if (
    jobsPairs.length !== 1 || !isMap(jobs) ||
    !Array.isArray(jobs.range) || !Number.isSafeInteger(jobs.range[1]) ||
    jobs.range[1] <= 0 || text[jobs.range[1] - 1] !== "\n" ||
    canonicalJson(workflow) !== canonicalJson(input.workflow)
  ) fail("first_publication_workflow_activation_source_format_unsupported");
  const inactive = inspectTrustedPublisherInactiveWorkflow(workflow);
  if (inactive.status !== "ready") {
    fail(inactive.reasons.includes("publish_job_already_active")
      ? "first_publication_workflow_activation_already_active"
      : "first_publication_workflow_activation_candidate_invalid");
  }
  if (
    workflow.jobs?.["attested-cli"] === null ||
    typeof workflow.jobs?.["attested-cli"] !== "object" ||
    Array.isArray(workflow.jobs?.["attested-cli"])
  ) fail();
  return { source, text, document, jobs, workflow };
}

function candidateBody(candidate) {
  return {
    schemaVersion: candidate.schemaVersion,
    status: candidate.status,
    candidateType: candidate.candidateType,
    sources: candidate.sources,
    insertion: candidate.insertion,
    output: candidate.output,
    activation: candidate.activation,
    sideEffects: candidate.sideEffects,
  };
}

export function createFirstPublicationWorkflowActivationCandidate(input) {
  const packageSource = packageManifest(input);
  const { source: workflowSource, text, jobs, workflow } = workflowDocument(input);
  const insertionOffset = jobs.range[1];
  const outputBytes = Buffer.from(
    `${text.slice(0, insertionOffset)}${stageOnlyWorkflowJobYaml}${text.slice(insertionOffset)}`,
  );
  let outputWorkflow;
  try {
    const outputDocument = parseDocument(outputBytes.toString("utf8"), { uniqueKeys: true });
    if (outputDocument.errors.length > 0 || outputDocument.warnings.length > 0) fail();
    outputWorkflow = outputDocument.toJS();
  } catch (error) {
    if (error instanceof FirstPublicationBootstrapError) throw error;
    fail();
  }
  const withoutCandidate = structuredClone(outputWorkflow);
  delete withoutCandidate?.jobs?.["publish-cli"];
  const ready = inspectFirstPublicationStageOnlyWorkflow(outputWorkflow);
  if (
    canonicalJson(withoutCandidate) !== canonicalJson(workflow) ||
    ready.status !== "ready"
  ) fail();
  const body = {
    schemaVersion: 1,
    status: "review_required",
    candidateType: "first_publication_stage_only_workflow_activation",
    sources: {
      workflow: { byteCount: workflowSource.byteCount, sha256: workflowSource.sha256 },
      package: { byteCount: packageSource.byteCount, sha256: packageSource.sha256 },
    },
    insertion: {
      operation: "insert_job",
      job: "publish-cli",
      byteOffset: insertionOffset,
    },
    output: { byteCount: outputBytes.length, sha256: sha256(outputBytes) },
    activation: {
      mode: "trusted_publisher_stage_only",
      environment: "npm-release",
      permission: "createStagedPackage",
      directPublish: "forbidden",
      packageScript: stagePublicationPackageScript,
    },
    sideEffects: {
      writesAllowed: false,
      sourceChanged: false,
      externalSettingsChanged: false,
      publicationAttempted: false,
    },
  };
  const candidate = { ...body, candidateDigest: canonicalDigest(body) };
  return { candidate, outputBytes };
}

export function validateFirstPublicationWorkflowActivationCandidate(result, input) {
  const candidate = result?.candidate;
  const body = candidateBody(candidate ?? {});
  if (
    !exactKeys(result, ["candidate", "outputBytes"]) || !Buffer.isBuffer(result.outputBytes) ||
    !exactKeys(candidate, [...Object.keys(body), "candidateDigest"]) ||
    candidate.schemaVersion !== 1 || candidate.status !== "review_required" ||
    candidate.candidateType !== "first_publication_stage_only_workflow_activation" ||
    candidate.candidateDigest !== canonicalDigest(body)
  ) fail();
  const expected = createFirstPublicationWorkflowActivationCandidate(input);
  if (
    canonicalJson(candidate) !== canonicalJson(expected.candidate) ||
    !result.outputBytes.equals(expected.outputBytes)
  ) fail();
  return result;
}
