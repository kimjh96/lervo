import { boundedArray, boundedString, fail, record, uniqueStrings } from "./contract-common.mjs";

const categories = [
  "task_start",
  "historical_rationale",
  "status_and_continuation",
  "deictic_reference",
  "ambiguity_and_abstention",
  "mixed_language_shorthand_typo",
  "approval_and_authority",
  "fail_closed_grounding",
];

const intents = new Set([
  "start_or_continue_task",
  "explain_historical_rationale",
  "inspect_status",
  "propose_next_sequence",
  "explain_impact",
  "find_repository_source",
  "resolve_approval",
  "unknown",
]);

const referenceResolutions = new Set([
  "explicit_subject",
  "prior_turn",
  "current_workstream",
  "repository_roadmap",
  "prior_turn_and_current_workstream",
  "unresolved",
]);

const sourceClasses = new Set([
  "user_context",
  "repository_instructions",
  "current_workstream",
  "durable_decision",
  "repository_state",
  "knowledge_projection",
  "execution_evidence",
]);

const dispositions = new Set([
  "answer",
  "inspect_then_execute",
  "clarify",
  "abstain",
  "resolve_approval",
]);

const requiredBehaviors = new Set([
  "inspect_current_state",
  "read_canonical_source",
  "preserve_user_scope",
  "resolve_exact_reference",
  "explain_from_evidence",
  "continue_approved_scope",
  "request_missing_reference",
  "fail_closed",
  "revalidate_binding",
  "distinguish_evidence_levels",
]);

const prohibitedBehaviors = new Set([
  "invent_reference",
  "invent_source",
  "execute_ambiguous_scope",
  "claim_internal_use",
  "bypass_approval",
  "treat_projection_as_canonical",
  "silently_expand_scope",
  "activate_search_candidate",
]);

function validateContext(caseId, value) {
  const context = record(value, `${caseId}.context`);
  const priorTurns = boundedArray(context.priorTurns, `${caseId}.priorTurns`, 0, 4);
  for (const [turnIndex, value] of priorTurns.entries()) {
    const turn = record(value, `${caseId}.priorTurns[${turnIndex}]`);
    if (!new Set(["user", "assistant"]).has(turn.role)) {
      fail(`${caseId} has an invalid prior-turn role`);
    }
    boundedString(turn.text, `${caseId}.priorTurns[${turnIndex}].text`, 500);
  }
  if (!new Set(["available", "absent"]).has(context.currentWorkstream)) {
    fail(`${caseId} has invalid workstream availability`);
  }
  if (
    !new Set(["none", "one_exact_binding", "multiple_or_unbound"]).has(context.pendingAuthority)
  ) {
    fail(`${caseId} has invalid authority context`);
  }
  if (
    !new Set(["current", "hash_drift", "no_matching_source", "unreviewed_relation"]).has(
      context.repositoryCondition,
    )
  ) {
    fail(`${caseId} has invalid repository condition`);
  }
  return { context, priorTurns };
}

function validateExpectation(caseId, value, context, priorTurns) {
  const expectation = record(value, `${caseId}.expectation`);
  if (!intents.has(expectation.intent)) fail(`${caseId} has an invalid intent`);
  if (!referenceResolutions.has(expectation.referenceResolution)) {
    fail(`${caseId} has an invalid reference resolution`);
  }
  if (!dispositions.has(expectation.disposition)) fail(`${caseId} has an invalid disposition`);
  const expectedSourceClasses = uniqueStrings(
    boundedArray(expectation.sourceClasses, `${caseId}.sourceClasses`, 0, 7),
    `${caseId}.sourceClasses`,
    sourceClasses,
  );
  const required = uniqueStrings(
    boundedArray(expectation.requiredBehaviors, `${caseId}.requiredBehaviors`, 1, 8),
    `${caseId}.requiredBehaviors`,
    requiredBehaviors,
  );
  uniqueStrings(
    boundedArray(expectation.prohibitedBehaviors, `${caseId}.prohibitedBehaviors`, 1, 8),
    `${caseId}.prohibitedBehaviors`,
    prohibitedBehaviors,
  );
  if (expectation.referenceResolution === "prior_turn" && priorTurns.length === 0) {
    fail(`${caseId} resolves a missing prior turn`);
  }
  if (
    expectation.referenceResolution === "prior_turn_and_current_workstream" &&
    (priorTurns.length === 0 || context.currentWorkstream !== "available")
  ) {
    fail(`${caseId} lacks combined reference inputs`);
  }
  if (
    expectation.referenceResolution === "current_workstream" &&
    context.currentWorkstream !== "available"
  ) {
    fail(`${caseId} resolves an absent workstream`);
  }
  if (
    expectation.referenceResolution === "repository_roadmap" &&
    (context.currentWorkstream !== "absent" || context.repositoryCondition !== "current")
  ) {
    fail(`${caseId} resolves an unavailable repository roadmap`);
  }
  if (
    expectation.referenceResolution === "unresolved" &&
    !new Set(["clarify", "abstain"]).has(expectation.disposition)
  ) {
    fail(`${caseId} executes an unresolved reference`);
  }
  if (
    new Set(["clarify", "abstain"]).has(expectation.disposition) &&
    !required.some((item) => item === "request_missing_reference" || item === "fail_closed")
  ) {
    fail(`${caseId} lacks an explicit no-guess behavior`);
  }
  if (
    expectation.disposition === "resolve_approval" &&
    context.pendingAuthority !== "one_exact_binding"
  ) {
    fail(`${caseId} resolves approval without one exact binding`);
  }
  if (context.repositoryCondition === "hash_drift" && !required.includes("fail_closed")) {
    fail(`${caseId} does not fail closed on hash drift`);
  }
  if (context.repositoryCondition === "no_matching_source" && expectedSourceClasses.length > 0) {
    fail(`${caseId} claims a source where none matches`);
  }
}

export function validateGroundingSuite(value) {
  const suite = record(value, "grounding suite");
  if (
    suite.schemaVersion !== 1 ||
    suite.suiteId !== "ngsuite_repository_natural_language.v1" ||
    suite.publicPrompts !== true ||
    suite.provenance !== "verification_authored" ||
    suite.reviewStatus !== "pending_human_review"
  ) {
    fail("grounding suite header or review boundary is invalid");
  }
  const declaredCategories = boundedArray(suite.categories, "grounding categories", 8, 8).map(
    (value, index) => {
      const item = record(value, `grounding categories[${index}]`);
      if (item.minimumCases !== 4) fail("grounding category minimum is not four");
      return boundedString(item.category, `grounding categories[${index}].category`, 96);
    },
  );
  if (JSON.stringify(declaredCategories) !== JSON.stringify(categories)) {
    fail("grounding categories differ from the reviewed order");
  }
  const privacy = record(suite.privacy, "grounding privacy");
  if (
    privacy.fixtureText !== "checked_in_public" ||
    privacy.runtimeEvents !== "digest_and_coordinates_only" ||
    JSON.stringify(privacy.reportsExclude) !==
      JSON.stringify([
        "prompt_text",
        "prior_turn_text",
        "absolute_paths",
        "source_bodies",
        "judge_rationale",
      ])
  ) {
    fail("grounding privacy declaration is invalid");
  }
  const cases = boundedArray(suite.cases, "grounding cases", 32, 32).map((value, index) => {
    const item = record(value, `grounding cases[${index}]`);
    const caseId = boundedString(item.caseId, `grounding cases[${index}].caseId`, 128);
    const category = boundedString(item.category, `${caseId}.category`, 96);
    if (!categories.includes(category)) fail(`${caseId} has an unknown category`);
    const prompt = boundedString(item.prompt, `${caseId}.prompt`, 500);
    const { context, priorTurns } = validateContext(caseId, item.context);
    validateExpectation(caseId, item.expectation, context, priorTurns);
    validateExpectation(caseId, item.providerObservation, context, priorTurns);
    return { caseId, category, prompt, contextSignature: JSON.stringify(context) };
  });
  if (new Set(cases.map((item) => item.caseId)).size !== cases.length) {
    fail("grounding suite repeats case IDs");
  }
  if (
    new Set(cases.map((item) => `${item.prompt}\0${item.contextSignature}`)).size !== cases.length
  ) {
    fail("grounding suite repeats the same prompt and context");
  }
  for (const category of categories) {
    if (cases.filter((item) => item.category === category).length !== 4) {
      fail(`grounding suite does not contain four ${category} cases`);
    }
  }
  return { caseCount: cases.length, categoryCount: categories.length };
}
