export const terminalSkillPayloadAllowlists = {
  "terminal.skill.observed": [
    "skillId",
    "path",
    "contentHash",
    "provider",
    "source",
    "providerSessionDigest",
    "providerTurnDigest",
    "observedAt",
  ],
  "terminal.skill.turn_assessed": [
    "providerSessionDigest",
    "providerTurnDigest",
    "skillTelemetry",
    "externalSkillCount",
    "provider",
    "unknownSkillCount",
    "ambiguousSkillCount",
    "observedAt",
  ],
} as const;

export const terminalSkillPayloadSchemas = {
  "terminal.skill.observed": "terminalSkillObservedEventPayload",
  "terminal.skill.turn_assessed": "terminalSkillTurnAssessedEventPayload",
} as const;
