const stepLabels = {
  validate_execution_inputs: "Revalidate execution inputs.",
  prepare_interactive_publisher: "Complete interactive npm publication preparation and the first human confirmation.",
  reobserve_public_package_absence: "Recheck that the package is absent from public npm.",
  create_durable_reservation: "Store a one-time reservation that prevents duplicate execution.",
  revalidate_release_artifact: "Revalidate that the publication artifact is unchanged after reservation.",
  attempt_publication: "Attempt the first npm publication once.",
  verify_registry_result: "Verify the publication result and distribution tag on npm.",
  record_terminal_result: "Record the verified terminal result in the reservation store.",
};

const boundaryLabels = {
  before_reservation: "Before reservation, cancellation causes no state change.",
  after_reservation_before_publication:
    "After reservation but before publication, an interrupted state is recorded and a new bootstrap is required to retry.",
  after_publication_started:
    "After publication starts, it cannot be cancelled or retried immediately. Verify the npm result first.",
};

export function formatFirstPublicationExecutionPlan(plan) {
  const lines = [
    "CLI first-publication execution plan",
    `Target: ${plan.target.package}@${plan.target.version} (${plan.target.distTag})`,
    "Status: no execution authorization. Publication activation is not implemented.",
    "",
    "Items to revalidate at execution:",
    "- Approval validity, interactive npm readiness, public package absence, reservation availability, and publication artifact integrity",
    "",
    "Execution order:",
  ];
  for (const step of plan.steps) {
    lines.push(`${step.sequence}. ${stepLabels[step.id] ?? step.id}`);
  }
  lines.push("", "Human confirmations:");
  for (const confirmation of plan.confirmations) {
    const timing = confirmation.timing === "before_reservation" ? "Before reservation" : "After the publication attempt";
    lines.push(`- ${timing}: ${confirmation.phrase}`);
  }
  lines.push("", "Cancellation boundaries:");
  for (const boundary of plan.cancellationBoundaries) {
    lines.push(`- ${boundaryLabels[boundary.boundary] ?? boundary.boundary}`);
  }
  lines.push(
    "",
    "This command only displays the plan. It did not perform online checks, request human confirmation, reserve, activate execution, or publish a package.",
  );
  return `${lines.join("\n")}\n`;
}
