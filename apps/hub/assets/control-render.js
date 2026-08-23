const deliveryLabels = {
  pending: "Pending", leased: "Sent to Node", completed: "Completed",
  rejected: "Rejected", expired: "Expired",
};
const approvalLabels = {
  unavailable: "Policy unavailable", denied: "Denied by policy", not_required: "No approval required",
  approval_required: "Approval required", partially_approved: "Partially approved", approved: "Approved",
};

function clear(element) {
  while (element.firstChild !== null) element.removeChild(element.firstChild);
}

function formatTime(value) {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString("ko-KR") : value;
}

function addDetail(details, label, value) {
  const container = document.createElement("div");
  const term = document.createElement("dt");
  const description = document.createElement("dd");
  term.textContent = label;
  description.textContent = value;
  container.append(term, description);
  details.append(container);
}

export function renderControlReview(review, onApprove) {
  const reviewPanel = document.querySelector("#review");
  const deliveryStatus = document.querySelector("#delivery-status");
  const approvalStatus = document.querySelector("#approval-status");
  const details = document.querySelector("#command-details");
  const approvalHelp = document.querySelector("#approval-help");
  const approvalOptions = document.querySelector("#approval-options");
  clear(details);
  clear(approvalOptions);
  deliveryStatus.textContent = deliveryLabels[review.delivery.status] ?? review.delivery.status;
  deliveryStatus.classList.toggle("success", review.delivery.status === "completed");
  approvalStatus.textContent = approvalLabels[review.approval.state] ?? review.approval.state;
  approvalStatus.classList.toggle("success", ["approved", "not_required"].includes(review.approval.state));
  addDetail(details, "Command ID", review.delivery.commandId);
  addDetail(details, "Role", review.command.roleId);
  addDetail(details, "Provider", review.command.provider);
  addDetail(details, "Risk", review.command.risk);
  addDetail(details, "Required verification", review.command.verificationSuiteIds.join(", ") || "None");
  addDetail(details, "Command expires", formatTime(review.command.expiresAt));
  approvalHelp.textContent = review.approval.maximumExpiresAt === null
    ? "No current policy snapshot is available, so this command cannot be approved here."
    : `Approvals expire no later than ${formatTime(review.approval.maximumExpiresAt)}. Review each scope separately.`;
  for (const option of review.approval.options) {
    const item = document.createElement("li");
    item.className = "approval-option";
    const copy = document.createElement("div");
    const capability = document.createElement("strong");
    const paths = document.createElement("p");
    const button = document.createElement("button");
    capability.textContent = option.capability;
    paths.textContent = option.repositoryPaths.length === 0
      ? "No repository path restriction"
      : `Allowed paths: ${option.repositoryPaths.join(", ")}`;
    button.type = "button";
    button.textContent = option.approvalId === null ? "Approve this scope" : "Approved";
    button.disabled = option.approvalId !== null || review.approval.maximumExpiresAt === null ||
      review.approval.state === "denied";
    button.addEventListener("click", () => onApprove(option, button));
    copy.append(capability, paths);
    item.append(copy, button);
    approvalOptions.append(item);
  }
  if (review.approval.options.length === 0) {
    const item = document.createElement("li");
    item.className = "approval-option";
    item.textContent = review.approval.state === "denied"
      ? "The current policy denies this execution."
      : "There are no scopes to approve separately.";
    approvalOptions.append(item);
  }
  reviewPanel.hidden = false;
}
