// ADR-0467 owner-turn capture evaluation contract. The suite holds verification-authored owner
// turns in English and Korean (explicit rules, paraphrases, implicit corrections that need the
// preceding agent turn, decisions, personal preferences, and negatives) with the expected
// semantic class, plus one recorded real-provider observation per case. Classification is the
// provider's; this contract checks only structure and the recorded agreement.

export const instructionCaptureSuiteId = "ngsuite_instruction_capture.v1";
const classes = new Set([
  "none",
  "durable_instruction",
  "correction_of_agent_behavior",
  "decision",
  "preference_personal",
]);
const forms = new Set([
  "explicit",
  "paraphrased",
  "implicit_correction",
  "decision",
  "personal",
  "negative",
]);
const durableClasses = new Set(["durable_instruction", "correction_of_agent_behavior"]);
const MINIMUM_CLASS_AGREEMENT = 0.8;
const MINIMUM_DURABLE_RECALL = 0.85;

function fail(message) {
  throw new Error(`Instruction capture evaluation: ${message}`);
}

function exactKeys(value, keys, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    fail(`${label} must be an object.`);
  const actual = Object.keys(value).sort();
  if (actual.join(",") !== [...keys].sort().join(","))
    fail(`${label} keys must be ${[...keys].sort().join(", ")}.`);
}

function text(value, maximum, label) {
  if (typeof value !== "string" || value.trim() === "" || value.length > maximum)
    fail(`${label} must be non-empty text of at most ${maximum} characters.`);
}

/** Validates the suite and returns the recorded agreement figures. */
export function validateInstructionCaptureSuite(suite) {
  exactKeys(
    suite,
    [
      "schemaVersion",
      "suiteId",
      "publicPrompts",
      "provenance",
      "reviewStatus",
      "cases",
      "observation",
    ],
    "suite",
  );
  if (suite.schemaVersion !== 1 || suite.suiteId !== instructionCaptureSuiteId)
    fail("the suite identity is invalid.");
  if (suite.publicPrompts !== true || suite.provenance !== "verification_authored")
    fail("the suite must contain public, verification-authored prompts.");
  if (!["pending_human_review", "human_reviewed"].includes(suite.reviewStatus))
    fail("the review status is invalid.");
  if (!Array.isArray(suite.cases) || suite.cases.length < 24 || suite.cases.length > 64)
    fail("the suite needs 24 to 64 cases.");
  const ids = new Set();
  const coverage = new Map();
  for (const item of suite.cases) {
    exactKeys(
      item,
      ["caseId", "language", "form", "surface", "ownerTurn", "precedingAgentTurn", "expectedClass"],
      "case",
    );
    if (!/^capture\.(en|ko)\.[a-z_]+\.[0-9]{2}$/u.test(item.caseId) || ids.has(item.caseId))
      fail(`case ID ${item.caseId} is invalid or duplicated.`);
    ids.add(item.caseId);
    if (
      !["en", "ko"].includes(item.language) ||
      !item.caseId.startsWith(`capture.${item.language}.`)
    )
      fail(`${item.caseId} has an invalid language.`);
    if (!forms.has(item.form)) fail(`${item.caseId} has an invalid form.`);
    if (!["terminal_prompt", "conversation"].includes(item.surface))
      fail(`${item.caseId} has an invalid surface.`);
    text(item.ownerTurn, 500, `${item.caseId} ownerTurn`);
    if (item.precedingAgentTurn !== null)
      text(item.precedingAgentTurn, 500, `${item.caseId} precedingAgentTurn`);
    if (item.form === "implicit_correction" && item.precedingAgentTurn === null)
      fail(`${item.caseId} is an implicit correction without the agent turn it corrects.`);
    if (!classes.has(item.expectedClass)) fail(`${item.caseId} has an invalid expected class.`);
    const key = `${item.language}:${item.form}`;
    coverage.set(key, (coverage.get(key) ?? 0) + 1);
  }
  for (const language of ["en", "ko"]) {
    for (const form of ["explicit", "paraphrased", "implicit_correction", "decision", "negative"])
      if ((coverage.get(`${language}:${form}`) ?? 0) < 2)
        fail(`${language} needs at least two ${form} cases.`);
    if ((coverage.get(`${language}:personal`) ?? 0) < 1)
      fail(`${language} needs at least one personal-preference case.`);
  }
  const observation = suite.observation;
  exactKeys(observation, ["provider", "adapterId", "observedAt", "results"], "observation");
  if (!["claude", "codex"].includes(observation.provider))
    fail("the observed provider is invalid.");
  if (Number.isNaN(Date.parse(observation.observedAt))) fail("the observation time is invalid.");
  if (!Array.isArray(observation.results) || observation.results.length !== suite.cases.length)
    fail("every case needs exactly one recorded observation.");
  const expected = new Map(suite.cases.map((item) => [item.caseId, item]));
  let agreed = 0;
  let durableExpected = 0;
  let durableObserved = 0;
  const falsePositives = [];
  for (const result of observation.results) {
    exactKeys(result, ["caseId", "observedClass", "durableDisposition"], "observation result");
    const item = expected.get(result.caseId);
    if (item === undefined) fail(`observation ${result.caseId} has no case.`);
    expected.delete(result.caseId);
    if (!classes.has(result.observedClass)) fail(`${result.caseId} has an invalid observed class.`);
    if (!["none", "workstream", "canonical", "pending"].includes(result.durableDisposition))
      fail(`${result.caseId} has an invalid durable disposition.`);
    if (result.observedClass === item.expectedClass) agreed += 1;
    if (durableClasses.has(item.expectedClass)) {
      durableExpected += 1;
      if (durableClasses.has(result.observedClass)) durableObserved += 1;
    }
    if (
      (item.expectedClass === "none" || item.expectedClass === "preference_personal") &&
      result.durableDisposition === "canonical"
    )
      falsePositives.push(result.caseId);
  }
  const classAgreement = agreed / suite.cases.length;
  const durableRecall = durableExpected === 0 ? 1 : durableObserved / durableExpected;
  if (falsePositives.length > 0)
    fail(`non-rule turns became canonical rule proposals: ${falsePositives.join(", ")}.`);
  if (classAgreement < MINIMUM_CLASS_AGREEMENT)
    fail(`class agreement ${classAgreement.toFixed(3)} is below ${MINIMUM_CLASS_AGREEMENT}.`);
  if (durableRecall < MINIMUM_DURABLE_RECALL)
    fail(`durable rule recall ${durableRecall.toFixed(3)} is below ${MINIMUM_DURABLE_RECALL}.`);
  return {
    instructionCaptureCaseCount: suite.cases.length,
    instructionCaptureClassAgreement: classAgreement,
    instructionCaptureDurableRecall: durableRecall,
  };
}
