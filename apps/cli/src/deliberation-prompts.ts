import { deliberationLanguageFor } from "./deliberation-language.js";
import { deliberationPublicationGuidance } from "./deliberation-publication-guidance.js";

interface PromptRole {
  name: string;
  description: string;
}

function roleContext(role: PromptRole, locale: string): string[] {
  return locale === "ko"
    ? [`배정된 역할: ${role.name}`, `역할 관점: ${role.description}`]
    : [`Assigned role: ${role.name}`, `Role perspective: ${role.description}`];
}

function evidenceBoundary(locale: string): string {
  return locale === "ko"
    ? "Lervo가 주입한 정본 문서와 공유된 토론 산출물만 근거로 사용하세요. 저장소, 파일 시스템, 터미널 또는 도구를 직접 탐색하지 마세요."
    : "Use only the canonical documents and shared deliberation publications injected by Lervo. Do not inspect the repository, filesystem, terminal, or tools directly.";
}

/**
 * ADR-0608: the parts of a deliberation prompt Lervo did not write: the owner's topic and the
 * role's own name and perspective, which every prompt here embeds.
 */
export function deliberationPromptUntrusted(topic: string, role: PromptRole): string[] {
  return [topic, role.name, role.description];
}

export function proposalPrompt(topic: string, role: PromptRole, locale: string): string {
  const language = deliberationLanguageFor(locale);
  if (language.locale === "ko") {
    return [
      ...roleContext(role, locale),
      evidenceBoundary(locale),
      "아래 주제와 관련해 주입된 저장소 근거를 바탕으로 실행 가능한 제안서를 작성하세요.",
      "결론을 먼저 제시한 뒤 이유, 영향, 검증 방법을 응집된 한국어 문단으로 설명하세요.",
      "450어절과 여덟 문단 이내, 제목은 네 개 이하로 작성하세요.",
      ...deliberationPublicationGuidance(locale),
      "비공개 추론이나 JSON을 포함하지 마세요.",
      "",
      `주제: ${topic}`,
    ].join("\n");
  }
  return [
    ...roleContext(role, locale),
    evidenceBoundary(locale),
    "Use the injected repository evidence to write an actionable proposal for the topic below.",
    "Lead with the conclusion, then explain the reasons, impact, and verification method in coherent English paragraphs.",
    "Keep the proposal under 450 words and eight paragraphs, with no more than four headings.",
    ...deliberationPublicationGuidance(locale),
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
  if (language.locale === "ko") {
    return [
      ...roleContext(role, locale),
      evidenceBoundary(locale),
      "가장 최근의 공유 제안 또는 수정안을 독립적으로 검토하세요.",
      `첫 줄은 반드시 '${language.verdict.approved}' 또는 '${language.verdict.revisionRequired}'여야 합니다.`,
      "350어절과 여섯 문단 이내로 작성하세요.",
      ...deliberationPublicationGuidance(locale),
      "수정이 필요하면 결론을 막는 문제와 필요한 구체적 변경을 밝히세요.",
      "승인한다면 확인한 근거와 남은 한계를 설명하세요. JSON은 작성하지 마세요.",
      "",
      `검토 회차: ${round}`,
      `주제: ${topic}`,
    ].join("\n");
  }
  return [
    ...roleContext(role, locale),
    evidenceBoundary(locale),
    "Review the latest shared proposal or revision independently.",
    `The first line must be exactly '${language.verdict.approved}' or '${language.verdict.revisionRequired}'.`,
    "Keep the review under 350 words and six paragraphs.",
    ...deliberationPublicationGuidance(locale),
    "If revision is required, identify the issue that blocks the conclusion and the concrete change needed.",
    "If approved, explain the evidence you checked and any remaining limitations. Do not write JSON.",
    "",
    `Review round: ${round}`,
    `Topic: ${topic}`,
  ].join("\n");
}

export function revisionPrompt(topic: string, role: PromptRole, locale: string): string {
  const language = deliberationLanguageFor(locale);
  if (language.locale === "ko") {
    return [
      ...roleContext(role, locale),
      evidenceBoundary(locale),
      "공유 제안과 모든 차단 이의를 다시 읽고 이를 해소하는 수정안을 작성하세요.",
      "무엇을 왜 바꿨고 각 이의를 어떻게 해소했는지 응집된 한국어 문단으로 설명하세요.",
      "450어절과 여덟 문단 이내, 제목은 네 개 이하로 작성하세요.",
      ...deliberationPublicationGuidance(locale),
      "비공개 추론이나 JSON을 포함하지 마세요.",
      "",
      `주제: ${topic}`,
    ].join("\n");
  }
  return [
    ...roleContext(role, locale),
    evidenceBoundary(locale),
    "Read the shared proposal and every blocking objection again, then write a revision that resolves them.",
    "Explain what changed and why it resolves each objection in coherent English paragraphs.",
    "Keep the revision under 450 words and eight paragraphs, with no more than four headings.",
    ...deliberationPublicationGuidance(locale),
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
  const language = deliberationLanguageFor(locale);
  if (language.locale === "ko") {
    return [
      ...roleContext(role, locale),
      evidenceBoundary(locale),
      "가장 최근의 공유 제안과 독립 검토 결과를 읽으세요.",
      `별도로 실행된 ${suiteId} 검증의 범위와 그 결과가 결론에 어떤 의미인지 설명하세요.`,
      "300어절과 여섯 문단 이내로 작성하세요.",
      ...deliberationPublicationGuidance(locale),
      "근거가 나오기 전에 검증이 실행됐다고 주장하지 말고 JSON을 작성하지 마세요.",
      "",
      `주제: ${topic}`,
    ].join("\n");
  }
  return [
    ...roleContext(role, locale),
    evidenceBoundary(locale),
    "Read the latest shared proposal and independent review results.",
    `Explain what the separately executed ${suiteId} verification covers and what its result means for the conclusion.`,
    "Keep the verification explanation under 300 words and six paragraphs.",
    ...deliberationPublicationGuidance(locale),
    "Do not claim that verification has run before evidence is available, and do not write JSON.",
    "",
    `Topic: ${topic}`,
  ].join("\n");
}

export function decisionPrompt(topic: string, role: PromptRole, locale: string): string {
  const language = deliberationLanguageFor(locale);
  if (language.locale === "ko") {
    return [
      ...roleContext(role, locale),
      evidenceBoundary(locale),
      "가장 최근의 공유 제안, 승인된 검토, 실제 검증 결과를 읽으세요.",
      "채택된 결론을 먼저 제시한 뒤 범위, 근거, 다음 행동을 자연스러운 한국어로 설명하세요.",
      "450어절과 여덟 문단 이내로 작성하세요.",
      ...deliberationPublicationGuidance(locale),
      "검증되지 않은 주장, 비공개 추론, JSON을 포함하지 마세요.",
      "",
      `주제: ${topic}`,
    ].join("\n");
  }
  return [
    ...roleContext(role, locale),
    evidenceBoundary(locale),
    "Read the latest shared proposal, approved reviews, and actual verification results.",
    "Lead with the adopted conclusion, then explain its scope, evidence, and next action in natural English.",
    "Keep the decision under 450 words and eight paragraphs.",
    ...deliberationPublicationGuidance(locale),
    "Do not include unverified claims, private reasoning, or JSON.",
    "",
    `Topic: ${topic}`,
  ].join("\n");
}
