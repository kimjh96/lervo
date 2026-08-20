const deliveryLabels = {
  pending: "실행 대기", leased: "Node 전달 중", completed: "실행 완료",
  rejected: "실행 거부", expired: "기한 만료",
};
const approvalLabels = {
  unavailable: "정책 확인 불가", denied: "정책에서 거부됨", not_required: "승인 불필요",
  approval_required: "승인 필요", partially_approved: "일부 승인됨", approved: "승인됨",
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
  addDetail(details, "역할", review.command.roleId);
  addDetail(details, "공급자", review.command.provider);
  addDetail(details, "위험도", review.command.risk);
  addDetail(details, "필수 검증", review.command.verificationSuiteIds.join(", ") || "없음");
  addDetail(details, "Command 만료", formatTime(review.command.expiresAt));
  approvalHelp.textContent = review.approval.maximumExpiresAt === null
    ? "현재 정책 snapshot이 없어 이 화면에서 승인할 수 없습니다."
    : `승인은 늦어도 ${formatTime(review.approval.maximumExpiresAt)}에 만료됩니다. 각 범위를 따로 확인하세요.`;
  for (const option of review.approval.options) {
    const item = document.createElement("li");
    item.className = "approval-option";
    const copy = document.createElement("div");
    const capability = document.createElement("strong");
    const paths = document.createElement("p");
    const button = document.createElement("button");
    capability.textContent = option.capability;
    paths.textContent = option.repositoryPaths.length === 0
      ? "저장소 경로 제한 없음"
      : `허용 경로: ${option.repositoryPaths.join(", ")}`;
    button.type = "button";
    button.textContent = option.approvalId === null ? "이 범위 승인" : "승인됨";
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
      ? "현재 정책은 이 실행을 거부합니다."
      : "별도로 승인할 범위가 없습니다.";
    approvalOptions.append(item);
  }
  reviewPanel.hidden = false;
}
