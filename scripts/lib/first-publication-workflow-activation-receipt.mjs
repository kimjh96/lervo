import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import { canonicalDigest, canonicalJson } from "./release-artifact-manifest.mjs";

const digestPattern = /^sha256:[a-f0-9]{64}$/u;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;

function fail() {
  throw new FirstPublicationBootstrapError(
    "first_publication_workflow_activation_receipt_invalid",
    "CLI 최초 게시 workflow 활성화 적용 영수증이 올바르지 않습니다.",
  );
}

function exactKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort());
}

function timestamp(value) {
  if (typeof value !== "string" || !timestampPattern.test(value)) fail();
  const result = Date.parse(value);
  if (!Number.isFinite(result)) fail();
  return result;
}

export function validateFirstPublicationWorkflowActivationReceiptDocument(receipt) {
  if (
    !exactKeys(receipt, [
      "schemaVersion", "status", "receiptType", "planDigest", "permitDigest",
      "readinessDigest", "controlsRecheckedAt", "workflow", "appliedAt",
      "activation", "externalSettings", "publication", "receiptDigest",
    ]) || receipt.schemaVersion !== 1 || receipt.status !== "applied" ||
    receipt.receiptType !== "first_publication_stage_only_workflow_activation" ||
    ![receipt.planDigest, receipt.permitDigest, receipt.readinessDigest, receipt.receiptDigest]
      .every((digest) => digestPattern.test(digest ?? "")) ||
    !exactKeys(receipt.workflow, ["byteCount", "sha256"]) ||
    !Number.isSafeInteger(receipt.workflow.byteCount) || receipt.workflow.byteCount < 1 ||
    !digestPattern.test(receipt.workflow.sha256 ?? "") ||
    receipt.activation !== "stage_only_workflow_active" ||
    receipt.externalSettings !== "observed_not_changed" ||
    receipt.publication !== "not_attempted"
  ) fail();
  if (timestamp(receipt.appliedAt) < timestamp(receipt.controlsRecheckedAt)) fail();
  const { receiptDigest, ...body } = receipt;
  if (receiptDigest !== canonicalDigest(body)) fail();
  return receipt;
}
