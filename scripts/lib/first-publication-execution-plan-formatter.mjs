const stepLabels = {
  validate_execution_inputs: "실행 입력을 다시 확인합니다.",
  prepare_interactive_publisher: "npm 대화형 게시 준비와 첫 사람 확인을 마칩니다.",
  reobserve_public_package_absence: "public npm에 같은 패키지가 없는지 다시 확인합니다.",
  create_durable_reservation: "중복 실행을 막는 일회성 예약을 저장합니다.",
  revalidate_release_artifact: "예약 뒤 게시 파일이 그대로인지 다시 확인합니다.",
  attempt_publication: "npm에 최초 게시를 한 번 시도합니다.",
  verify_registry_result: "npm에서 게시 결과와 배포 태그를 확인합니다.",
  record_terminal_result: "확인한 최종 결과를 예약 저장소에 기록합니다.",
};

const boundaryLabels = {
  before_reservation: "예약 전에는 상태 변경 없이 취소할 수 있습니다.",
  after_reservation_before_publication:
    "예약 뒤 게시 전에는 중단 상태를 기록하며, 다시 시도하려면 새 bootstrap이 필요합니다.",
  after_publication_started:
    "게시를 시작한 뒤에는 취소하거나 바로 다시 시도할 수 없습니다. npm 결과를 먼저 확인해야 합니다.",
};

export function formatFirstPublicationExecutionPlan(plan) {
  const lines = [
    "CLI 최초 게시 실행 계획",
    `대상: ${plan.target.package}@${plan.target.version} (${plan.target.distTag})`,
    "상태: 실행 권한 없음. 게시 활성화 기능도 구현되어 있지 않습니다.",
    "",
    "실행할 때 다시 확인할 항목:",
    "- 승인 유효 시간, npm 대화형 준비, 공개 패키지 부재, 예약 가능 여부, 게시 파일 무결성",
    "",
    "실행 순서:",
  ];
  for (const step of plan.steps) {
    lines.push(`${step.sequence}. ${stepLabels[step.id] ?? step.id}`);
  }
  lines.push("", "사람 확인:");
  for (const confirmation of plan.confirmations) {
    const timing = confirmation.timing === "before_reservation" ? "예약 전" : "게시 시도 뒤";
    lines.push(`- ${timing}: ${confirmation.phrase}`);
  }
  lines.push("", "취소 경계:");
  for (const boundary of plan.cancellationBoundaries) {
    lines.push(`- ${boundaryLabels[boundary.boundary] ?? boundary.boundary}`);
  }
  lines.push(
    "",
    "이 명령은 계획만 보여 줍니다. 온라인 확인, 사람 확인 요청, 예약, 실행 활성화, 패키지 게시를 실행하지 않았습니다.",
  );
  return `${lines.join("\n")}\n`;
}
