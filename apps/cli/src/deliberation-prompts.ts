import { deliberationLanguageFor } from "./deliberation-language.js";

interface PromptRole {
  name: string;
  description: string;
}

function roleContext(role: PromptRole): string[] {
  return [`Assigned role: ${role.name}`, `Role perspective: ${role.description}`];
}

export function proposalPrompt(topic: string, role: PromptRole, locale: string): string {
  deliberationLanguageFor(locale);
  return [
    ...roleContext(role),
    "Inspect repository evidence and write an actionable proposal for the topic below.",
    "Lead with the conclusion, then explain the reasons, impact, and verification method in coherent English paragraphs.",
    "Do not include private reasoning or JSON.",
    "",
    `Topic: ${topic}`,
  ].join("\n");
}

export function reviewPrompt(
  topic: string,
  round: number,
  role: PromptRole,
  locale: string,
): string {
  const language = deliberationLanguageFor(locale);
  return [
    ...roleContext(role),
    "Review the latest shared proposal or revision independently.",
    `The first line must be exactly '${language.verdict.approved}' or '${language.verdict.revisionRequired}'.`,
    "If revision is required, identify the issue that blocks the conclusion and the concrete change needed.",
    "If approved, explain the evidence you checked and any remaining limitations. Do not write JSON.",
    "",
    `Review round: ${round}`,
    `Topic: ${topic}`,
  ].join("\n");
}

export function revisionPrompt(topic: string, role: PromptRole, locale: string): string {
  deliberationLanguageFor(locale);
  return [
    ...roleContext(role),
    "Read the shared proposal and every blocking objection again, then write a revision that resolves them.",
    "Explain what changed and why it resolves each objection in coherent English paragraphs.",
    "Do not include private reasoning or JSON.",
    "",
    `Topic: ${topic}`,
  ].join("\n");
}

export function verificationPrompt(
  topic: string,
  suiteId: string,
  role: PromptRole,
  locale: string,
): string {
  deliberationLanguageFor(locale);
  return [
    ...roleContext(role),
    "Read the latest shared proposal and independent review results.",
    `Explain what the separately executed ${suiteId} verification covers and what its result means for the conclusion.`,
    "Do not claim that verification has run before evidence is available, and do not write JSON.",
    "",
    `Topic: ${topic}`,
  ].join("\n");
}

export function decisionPrompt(topic: string, role: PromptRole, locale: string): string {
  deliberationLanguageFor(locale);
  return [
    ...roleContext(role),
    "Read the latest shared proposal, approved reviews, and actual verification results.",
    "Lead with the adopted conclusion, then explain its scope, evidence, and next action in natural English.",
    "Do not include unverified claims, private reasoning, or JSON.",
    "",
    `Topic: ${topic}`,
  ].join("\n");
}
